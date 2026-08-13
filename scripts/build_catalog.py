#!/usr/bin/env python3
"""
Build the Postal Portal catalog.

This is a DEV-MACHINE-ONLY script -- it needs the full `to JD/` tree (batches,
pipeline reference data, the enrichment library) and is never run on the deploy
host. Its two outputs are what actually ship there:

  app/catalog.json           everything the map + sidebar needs (~95 KB) -- commit
                              this to git; it's the one thing that makes the deployed
                              server's catalog match what `to JD/` currently holds.
  app/raw_sources/*.csv,xlsx  the 9 no-postal-code countries' original JD files
                              (~1.4 MB total) -- small enough to commit directly,
                              so the deploy host never needs `to JD/` for these either.

Reads, strictly read-only:
  <JD>/pipeline/data/interim/version_resolution.csv   one authoritative source file per country
  <JD>/pipeline/data/clean/postal_codes_final.parquet  3.66M rows, canonical schema (or
                                                        $POSTAL_PORTAL_MASTER_PARQUET, so
                                                        this can also run against a
                                                        Drive-synced copy -- see
                                                        sync_from_drive.py)
  <JD>/pipeline/data/reference/countries.csv           iso3 / continent reference
  <JD>/pipeline/reports/countries_with_no_postal_codes.csv

csv/xlsx are never pre-generated for the 79 canonical countries -- they're produced
on demand (scripts/lib/formats.py), same code path the deployed server uses. This run
still exercises that path once per country/format, purely to record accurate byte
counts in catalog.json and warm the cache so the very first real download isn't the
one paying the conversion cost.

"last updated" is the filesystem mtime of the resolved source file under `to JD/`.

Idempotent: re-run after a new batch lands. Nothing outside app/ is ever written.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import shutil
import sys
from pathlib import Path

import duckdb
import pandas as pd
import pyarrow.parquet as pq
import pycountry

APP_ROOT = Path(__file__).resolve().parent.parent
JD_ROOT = APP_ROOT.parent / "to JD"

PIPELINE = JD_ROOT / "pipeline"

# A distinct package name (not "lib") deliberately -- the pipeline's own
# scripts/lib package gets imported right below, and Python caches only one
# module under a given name in sys.modules.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from pp_lib.formats import materialize  # noqa: E402

# Reuse the pipeline's own offline pycountry-CLDR translation mechanism (one
# implementation, not a second copy of it) to derive a local-language name for
# the countries below, which never reach the main pipeline's enrichment step
# because they're excluded before it runs (no usable postal codes).
sys.path.insert(0, str(PIPELINE / "scripts"))
from lib.enrichment import load_country_languages, translated_country_name  # noqa: E402

COUNTRY_LANGUAGES = load_country_languages()
CLEAN = PIPELINE / "data" / "clean"
MASTER_PARQUET = Path(
    os.environ.get("POSTAL_PORTAL_MASTER_PARQUET", CLEAN / "postal_codes_final.parquet")
)
VERSION_RESOLUTION = PIPELINE / "data" / "interim" / "version_resolution.csv"
COUNTRIES_REF = PIPELINE / "data" / "reference" / "countries.csv"
NO_POSTAL_REPORT = PIPELINE / "reports" / "countries_with_no_postal_codes.csv"

OUT_DIR = APP_ROOT / "app"
OUT_CATALOG = OUT_DIR / "catalog.json"
OUT_CACHE_DIR = OUT_DIR / "on_demand_cache"
OUT_RAW_SOURCES_DIR = OUT_DIR / "raw_sources"

REGION_LEVELS = range(1, 6)

# Columns loaded from the master parquet. Deliberately not the whole table --
# postal_code_norm, timezone and utc_offset aren't needed to describe coverage.
STAT_COLUMNS = [
    "country_iso2",
    "country_iso3",
    "country_en",
    "country_lc",
    "continent_code",
    "continent_name",
    "postal_code",
    "place_name",
    "region_1_iso_code",
    "latitude",
    *[f"region_{n}_{suffix}" for n in REGION_LEVELS for suffix in ("lc", "en")],
]


def die(msg: str) -> None:
    sys.exit(f"error: {msg}")


def local_name_for(iso2: str, name_en: str) -> str | None:
    """Local-language country name for the delivered-no-data countries.

    JD's own source files carry a `country_lc` column for these, but it's just
    `country_en` duplicated -- confirmed across all 9 -- so it's not a usable
    source. This calls the same config-driven, individually-verified translation
    the pipeline uses for its 79 canonical countries (see
    pipeline/configs/country_primary_language.yaml); returns None if that config
    has no entry, same as the pipeline does.
    """
    cfg = COUNTRY_LANGUAGES.get(iso2)
    if cfg is None:
        return None
    return translated_country_name(iso2, name_en, cfg["language"])


def check_inputs() -> None:
    for p in (
        MASTER_PARQUET,
        VERSION_RESOLUTION,
        COUNTRIES_REF,
        NO_POSTAL_REPORT,
    ):
        if not p.exists():
            die(f"missing required input: {p}\n(is '{JD_ROOT}' still in place?)")


def read_csv_str(path: Path) -> pd.DataFrame:
    """Read as text with NA-detection off.

    continent_code for North America is the literal string 'NA'. Default NA
    detection turns it into a null and silently loses the continent for
    US/CA/MX/GT/PA -- see POSTAL_CODE_SCHEMA_DESIGN.md sec. 8.2.
    """
    return pd.read_csv(path, dtype=str, keep_default_na=False, na_values=[])


def iso_numeric(iso2: str) -> str | None:
    """ISO 3166-1 numeric code -- the join key to the TopoJSON geometry ids."""
    country = pycountry.countries.get(alpha_2=iso2)
    return country.numeric if country else None


def nonblank(series: pd.Series) -> pd.Series:
    """Non-null and not whitespace-only. The sources use both to mean 'absent'."""
    return series.notna() & (series.astype("string").str.strip() != "")


def level_label(level: int, has_iso_subdivision: bool) -> str:
    if level == 1:
        return "Subdivision (ISO 3166-2)" if has_iso_subdivision else "Level 1"
    return f"Level {level}"


def country_stats(sub: pd.DataFrame) -> dict:
    """Per-country coverage facts, computed from the country's own rows."""
    n = len(sub)
    has_iso_subdivision = bool(nonblank(sub["region_1_iso_code"]).any())

    levels = []
    depth = 0
    for level in REGION_LEVELS:
        filled = (nonblank(sub[f"region_{level}_lc"]) | nonblank(sub[f"region_{level}_en"])).sum()
        if filled:
            depth = level
        levels.append(
            {
                "level": level,
                "label": level_label(level, has_iso_subdivision),
                "filled_pct": round(100.0 * filled / n, 1) if n else 0.0,
                "has_en": bool(nonblank(sub[f"region_{level}_en"]).any()),
                "has_lc": bool(nonblank(sub[f"region_{level}_lc"]).any()),
            }
        )

    example = sub["postal_code"].dropna()
    return {
        "rows": n,
        "admin_depth": depth,
        # Only the levels a country actually reaches -- trailing empties carry no signal.
        "admin_levels": levels[:depth],
        "coord_coverage_pct": round(100.0 * sub["latitude"].notna().sum() / n, 1) if n else 0.0,
        "has_place_name": bool(nonblank(sub["place_name"]).any()),
        "postal_code_example": str(example.iloc[0]) if len(example) else None,
        "region_1_iso_coverage_pct": (
            round(100.0 * nonblank(sub["region_1_iso_code"]).sum() / n, 1) if n else 0.0
        ),
    }


REGION_HEADER = re.compile(r"^region_?(\d)_?(lc|en)?$")
# Suriname's file uses GeoNames-style `order1_name` / `order8_name` instead of
# `region<N>`. The numbers are GeoNames admin ranks, not our level indices, so
# they are ranked into consecutive levels by depth order.
ORDER_HEADER = re.compile(r"^order(\d+)_name$")


def source_stats(csv_path: Path, encoding: str, delimiter: str) -> dict:
    """Describe a source file the pipeline rejected for having no postal codes.

    These 9 countries never reach the canonical dataset, but their source files
    still carry a real region hierarchy and coordinates -- so the catalog reports
    what's in the file itself. Headers are read in their original, un-normalized
    form (three different JD templates, plus QA's mislabeled `region_en`), so the
    level count comes from whatever `region<N>` columns are present.
    """
    df = pd.read_csv(
        csv_path,
        dtype=str,
        keep_default_na=False,
        na_values=[],
        encoding=encoding or "utf-8",
        sep=delimiter or ",",
        engine="python",
        on_bad_lines="skip",
    )
    columns = {c.strip().lower(): c for c in df.columns}

    levels: dict[int, dict[str, str]] = {}
    for lower, original in columns.items():
        m = REGION_HEADER.match(lower)
        if m:
            levels.setdefault(int(m.group(1)), {})[m.group(2) or "lc"] = original

    if not levels:
        ordered = sorted(
            (int(m.group(1)), columns[lower])
            for lower in columns
            if (m := ORDER_HEADER.match(lower))
        )
        for index, (_, original) in enumerate(ordered, start=1):
            levels[index] = {"en": original}

    n = len(df)
    admin_levels = []
    depth = 0
    for level in sorted(levels):
        cols = levels[level]
        filled = pd.Series(False, index=df.index)
        for col in cols.values():
            filled |= nonblank(df[col])
        count = int(filled.sum())
        # Depth counts levels that carry data, not columns that merely exist --
        # several of these files declare a region_3 and leave it entirely blank.
        if count:
            depth = level
        admin_levels.append(
            {
                "level": level,
                "label": f"Level {level}",
                "filled_pct": round(100.0 * count / n, 1) if n else 0.0,
                "has_en": "en" in cols,
                "has_lc": "lc" in cols,
            }
        )

    lat_col = columns.get("latitude") or columns.get("lat")
    coord_pct = (
        round(100.0 * nonblank(df[lat_col]).sum() / n, 1) if lat_col and n else 0.0
    )
    return {
        "rows": 0,  # canonical postal-code rows -- there are none
        "admin_depth": depth,
        "admin_levels": admin_levels[:depth] if depth else [],
        "coord_coverage_pct": coord_pct,
        "has_place_name": "place_name" in columns,
        "postal_code_example": None,
        "region_1_iso_coverage_pct": 0.0,
        "source_columns": list(df.columns),
    }


def main() -> None:
    check_inputs()
    OUT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    OUT_RAW_SOURCES_DIR.mkdir(parents=True, exist_ok=True)

    version_resolution = read_csv_str(VERSION_RESOLUTION)
    reference = read_csv_str(COUNTRIES_REF).set_index("country_iso2")
    no_postal = set(read_csv_str(NO_POSTAL_REPORT)["country_iso2"])

    print(f"reading {MASTER_PARQUET.name} ...", flush=True)
    master = pq.read_table(MASTER_PARQUET, columns=STAT_COLUMNS).to_pandas()
    print(f"  {len(master):,} rows", flush=True)

    grouped = {iso2: sub for iso2, sub in master.groupby("country_iso2", sort=True)}
    duck = duckdb.connect()

    countries = []
    unmatched_numeric = []
    for _, row in version_resolution.iterrows():
        iso2 = row["country_iso2"]
        source_path = JD_ROOT / row["selected_rel_path"]
        if not source_path.exists():
            die(f"{iso2}: resolved source file is missing: {source_path}")

        last_updated = dt.date.fromtimestamp(source_path.stat().st_mtime).isoformat()
        sub = grouped.get(iso2)
        covered = sub is not None and len(sub) > 0

        ref = reference.loc[iso2] if iso2 in reference.index else None
        numeric = iso_numeric(iso2)
        if numeric is None:
            unmatched_numeric.append(iso2)

        name_en = (sub["country_en"].iloc[0] if covered
                   else (ref["country_en"] if ref is not None else iso2))

        entry = {
            "iso2": iso2,
            "iso3": (sub["country_iso3"].iloc[0] if covered
                     else (ref["country_iso3"] if ref is not None else None)),
            "iso_numeric": numeric,
            "name_en": name_en,
            "name_lc": (sub["country_lc"].iloc[0] if covered
                        else local_name_for(iso2, name_en)),
            "continent_code": (sub["continent_code"].iloc[0] if covered
                               else (ref["continent_code"] if ref is not None else None)),
            "continent_name": (sub["continent_name"].iloc[0] if covered
                               else (ref["continent_name"] if ref is not None else None)),
            "status": "covered" if covered else "delivered_no_data",
            "last_updated": last_updated,
            "source_file": source_path.name,
            "source_batch": row["selected_batch"],
            "source_rows": int(row["n_rows"]) if row["n_rows"] else 0,
        }

        if covered:
            entry.update(country_stats(sub))
            # Generated on demand, not pre-shipped: this is the same code path the
            # deployed server uses at request time (scripts/lib/formats.py), run here
            # once per format purely to record a real byte count in catalog.json and
            # warm the cache. No 706 MB of CSV / 325 MB of XLSX needs to exist on disk
            # for this to work -- only the ~80 MB master parquet does.
            entry["files"] = {}
            for fmt in ("parquet", "csv", "xlsx"):
                path = materialize(duck, MASTER_PARQUET, OUT_CACHE_DIR, iso2, fmt)
                if path is not None:
                    entry["files"][fmt] = {"bytes": path.stat().st_size}
            missing = {"csv", "xlsx", "parquet"} - set(entry["files"])
            if missing:
                die(f"{iso2}: covered but failed to materialize format(s): {sorted(missing)}")
        else:
            # A file was delivered but its postal_code column is absent or 100% blank,
            # so the pipeline dropped the country and there is no canonical output.
            # The source file still holds a region hierarchy and coordinates, which is
            # worth having -- so it is offered for download as-is, marked raw. Copied
            # into the repo (a few hundred KB each) rather than referenced under
            # `to JD/`, which the deploy host won't have.
            entry.update(source_stats(source_path, row["selected_encoding"], row["selected_delimiter"]))
            xlsx_sibling = source_path.with_suffix(".xlsx")
            entry["files"] = {}
            for fmt, src in (("csv", source_path), ("xlsx", xlsx_sibling)):
                if not src.exists():
                    continue
                dest = OUT_RAW_SOURCES_DIR / src.name
                shutil.copyfile(src, dest)
                entry["files"][fmt] = {"bytes": dest.stat().st_size, "raw": True, "name": src.name}
            entry["files_are_source"] = True
            entry["note"] = (
                "No usable postal codes in the delivered file, so this country is not "
                "in the canonical dataset. The download is JD's original source file, "
                "un-normalized, kept for its administrative levels and coordinates."
            )
            if iso2 not in no_postal:
                print(f"  warning: {iso2} has no rows but is not in {NO_POSTAL_REPORT.name}")

        countries.append(entry)
        print(f"  {iso2} {entry['status']:18} rows={entry['rows']:>7} "
              f"depth={entry['admin_depth']} updated={last_updated} "
              f"files={','.join(entry['files']) or 'none'}"
              f"{' (raw source)' if entry.get('files_are_source') else ''}", flush=True)

    covered_entries = [c for c in countries if c["status"] == "covered"]
    catalog = {
        "generated_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "totals": {
            "countries": len(covered_entries),
            "countries_with_files": len(countries),
            "delivered_no_data": len(countries) - len(covered_entries),
            "rows": sum(c["rows"] for c in countries),
            "continents": sorted({c["continent_name"] for c in covered_entries if c["continent_name"]}),
            "last_updated_range": [
                min(c["last_updated"] for c in countries),
                max(c["last_updated"] for c in countries),
            ],
            "download_bytes": {
                fmt: sum(c["files"].get(fmt, {}).get("bytes", 0) for c in covered_entries)
                for fmt in ("csv", "xlsx", "parquet")
            },
        },
        "countries": sorted(countries, key=lambda c: c["name_en"]),
    }

    OUT_CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")

    print(
        f"\nwrote {OUT_CATALOG.relative_to(APP_ROOT)} "
        f"({OUT_CATALOG.stat().st_size / 1024:.0f} KB): "
        f"{catalog['totals']['countries']} covered, "
        f"{catalog['totals']['delivered_no_data']} delivered-no-data, "
        f"{catalog['totals']['rows']:,} rows"
    )
    if unmatched_numeric:
        print(f"note: no ISO numeric code (won't render on the map): {unmatched_numeric}")


if __name__ == "__main__":
    main()
