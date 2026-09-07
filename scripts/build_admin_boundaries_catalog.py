#!/usr/bin/env python3
"""
Build the Admin Boundaries catalog -- static-site edition.

Dev-machine-only script, modeled on scripts/build_catalog.py's structure (read
that one first) but entirely independent: not modified, not imported from.

This is a SEPARATE dataset from postal_codes: administrative-boundary reference
data (country -> region1 -> region2 -> ... -> region6, e.g. states/provinces/
districts/villages) for 91 countries, with no postal codes involved at all.
Deliberately named "admin-boundaries" everywhere -- NOT "admin_areas" -- to
avoid colliding with the unrelated, already-existing pilot feature of that name
(types.ts's `View = 'postal_codes' | 'admin_areas'`, a per-country dedup toggle
inside CountryDrawer.tsx). Two different concepts; two different names.

Reads, strictly read-only:
  <SRC_DIR>/<ISO2>_admin_area.csv   one file per country, 91 total, all sharing
                                     one 17-column canonical schema:
                                       country_code, country_lc, country_en,
                                       region1_lc, region1_en, ..., region6_lc,
                                       region6_en, timezone, utc
                                     region_lc = native/local name, region_en =
                                     English name (either may be blank per
                                     level, never both where that level
                                     applies). timezone/utc are ignored here.
                                     Row count = leaf-level records.

Writes:
  web/public/admin-boundaries/catalog.json
  web/public/admin-boundaries/parquet/<ISO2>.parquet   all rows, all 17 columns

Idempotent: re-run any time the source CSVs change. Nothing outside
web/public/admin-boundaries/ is written -- web/public/catalog.json and
web/public/parquet/ (the unrelated postal-codes dataset) are never touched.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sys
from pathlib import Path

import pandas as pd
import pycountry

APP_ROOT = Path(__file__).resolve().parent.parent

# Sibling of the Postal Portal repo itself, same pattern as build_catalog.py's
# own JD_ROOT -- overridable via env var for a machine where the CSVs live
# somewhere else.
SRC_DIR = Path(
    os.environ.get("ADMIN_BOUNDARIES_SRC")
    or (APP_ROOT.parent / "Admin Area 2025" / "normalized")
)

WEB_PUBLIC = APP_ROOT / "web" / "public" / "admin-boundaries"
OUT_CATALOG = WEB_PUBLIC / "catalog.json"
OUT_PARQUET_DIR = WEB_PUBLIC / "parquet"

MAX_LEVELS = 6
REGION_LEVELS = range(1, MAX_LEVELS + 1)

COLUMNS = [
    "country_code", "country_lc", "country_en",
    *[f"region{n}_{suffix}" for n in REGION_LEVELS for suffix in ("lc", "en")],
    "timezone", "utc",
]


def die(msg: str) -> None:
    sys.exit(f"error: {msg}")


def read_csv_str(path: Path) -> pd.DataFrame:
    """Read as text with NA-detection off -- blank means "" here, never NaN,
    same reasoning as build_catalog.py's read_csv_str (a source using a literal
    string value that pandas would otherwise sniff as null)."""
    return pd.read_csv(path, dtype=str, keep_default_na=False, na_values=[])


def nonblank(series: pd.Series) -> pd.Series:
    return series.astype("string").str.strip() != ""


def first_nonblank(series: pd.Series) -> str | None:
    s = series[nonblank(series)]
    return str(s.iloc[0]) if len(s) else None


def resolved_level(df: pd.DataFrame, level: int) -> pd.Series:
    """Per row, the region name at this level: `_lc` if it carries a value,
    else `_en`. Matches the audited logic exactly -- whichever of the two is
    non-blank at each level for that row."""
    lc = df[f"region{level}_lc"]
    en = df[f"region{level}_en"]
    return lc.where(nonblank(lc), en).astype("string").str.strip()


def iso_numeric(code: str) -> str | None:
    """ISO 3166-1 numeric code -- the join key AdminBoundaryMap.tsx uses
    against the same world-atlas TopoJSON WorldMap.tsx already loads."""
    country = pycountry.countries.get(alpha_2=code)
    return country.numeric if country else None


def country_stats(code: str, df: pd.DataFrame) -> dict:
    """Per-country coverage facts, computed from the country's own rows.

    level_counts[i] is NOT a naive distinct-value count on region_i alone --
    it's the count of distinct PARENT CHAINS: the tuple of
    (region1, region2, ..., region_i) across all rows, using resolved_level()'s
    lc-or-en value at each level. Two different provinces can legitimately
    share a same-named district without that being one unit; counting the
    tuple, not the bare column, is what keeps that from happening. This exact
    method was worked out and verified in a prior audit -- replicated here
    faithfully, not reinvented.
    """
    max_tier = 0
    for level in REGION_LEVELS:
        if (nonblank(df[f"region{level}_lc"]) | nonblank(df[f"region{level}_en"])).any():
            max_tier = level

    resolved_cols = {level: resolved_level(df, level) for level in range(1, max_tier + 1)}

    level_counts = []
    for level in range(1, max_tier + 1):
        chain = pd.concat([resolved_cols[n] for n in range(1, level + 1)], axis=1)
        distinct = chain.drop_duplicates().shape[0]
        level_counts.append({"level": level, "unit_count": int(distinct)})

    name_en = first_nonblank(df["country_en"])
    return {
        "code": code,
        "iso_numeric": iso_numeric(code),
        "name_en": name_en or code,
        "name_lc": first_nonblank(df["country_lc"]),
        "max_tier": max_tier,
        "level_counts": level_counts,
        "total_rows": int(len(df)),
    }


def main() -> None:
    if not SRC_DIR.exists():
        die(f"missing source directory: {SRC_DIR}")

    OUT_PARQUET_DIR.mkdir(parents=True, exist_ok=True)

    csv_paths = sorted(SRC_DIR.glob("*_admin_area.csv"))
    if not csv_paths:
        die(f"no *_admin_area.csv files found under {SRC_DIR}")

    countries = []
    failed: list[str] = []
    unmatched_numeric: list[str] = []

    for csv_path in csv_paths:
        code = csv_path.name.removesuffix("_admin_area.csv")
        try:
            df = read_csv_str(csv_path)
            missing = [c for c in COLUMNS if c not in df.columns]
            if missing:
                raise ValueError(f"missing expected columns: {missing}")

            entry = country_stats(code, df)
            if entry["iso_numeric"] is None:
                unmatched_numeric.append(code)

            out_path = OUT_PARQUET_DIR / f"{code}.parquet"
            df[COLUMNS].to_parquet(out_path, index=False, compression="zstd")

            countries.append(entry)
            print(
                f"  {code}  rows={entry['total_rows']:>7}  max_tier={entry['max_tier']}  "
                f"levels={[lc['unit_count'] for lc in entry['level_counts']]}",
                flush=True,
            )
        except Exception as e:  # noqa: BLE001 -- report and keep going, one bad file shouldn't sink the other 90
            failed.append(f"{csv_path.name}: {e}")
            print(f"  FAILED {csv_path.name}: {e}", flush=True)

    countries.sort(key=lambda c: c["name_en"])

    catalog = {
        "generated_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "totals": {
            "countries": len(countries),
            "total_leaf_records": sum(c["total_rows"] for c in countries),
            "max_tier_reached": max((c["max_tier"] for c in countries), default=0),
        },
        "countries": countries,
    }

    OUT_CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")

    print(
        f"\nwrote {OUT_CATALOG.relative_to(APP_ROOT)} "
        f"({OUT_CATALOG.stat().st_size / 1024:.0f} KB): "
        f"{catalog['totals']['countries']} countries, "
        f"{catalog['totals']['total_leaf_records']:,} leaf records, "
        f"max tier reached {catalog['totals']['max_tier_reached']}"
    )
    if unmatched_numeric:
        print(f"note: no ISO numeric code (won't render on the map): {unmatched_numeric}")
    if failed:
        print(f"\n{len(failed)} file(s) failed to parse:")
        for f in failed:
            print(f"  {f}")


if __name__ == "__main__":
    main()
