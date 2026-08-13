"""
Shared on-demand format conversion: query one country's rows out of the master
parquet, write it as csv/xlsx/parquet, cache the result on disk.

Used by both scripts/build_catalog.py (dev-time -- to record accurate file sizes in
catalog.json and pre-warm the cache) and server/main.py (runtime -- generate on first
request, serve the cached file on every request after). Same code path both places on
purpose: a size recorded in catalog.json should be the exact byte count a user's
download gets, not an estimate.

Deploying without the full ~1.8 GB `to JD/pipeline/data/clean/` tree depends on this:
the deploy host only needs the single master parquet (80 MB, synced from Google Drive
by sync_from_drive.py) -- csv/xlsx are never stored at rest, only ever generated from
it, exactly reproducing what write_output.py / export_xlsx.py already do.
"""

from __future__ import annotations

import csv
from pathlib import Path

import duckdb
import pandas as pd
from openpyxl.utils import get_column_letter

# Mirrors pipeline/scripts/lib/schema.py:TEXT_SAFE_COLUMNS. Duplicated, not
# imported: the canonical schema is a frozen historical fact (these are exactly the
# 24 delivered columns, unchanged since the pipeline's second pass), and the deploy
# host must not need `to JD/` on its Python path just to read this one constant.
TEXT_SAFE_COLUMNS = {
    "country_iso2", "country_iso3", "country_en", "country_lc",
    "continent_code", "continent_name",
    "postal_code", "postal_code_norm", "place_name",
    "region_1_lc", "region_1_en", "region_1_iso_code",
    "region_2_lc", "region_2_en",
    "region_3_lc", "region_3_en", "region_4_lc", "region_4_en",
    "region_5_lc", "region_5_en",
    "timezone", "utc_offset",
}

# Excel's hard ceiling is 1,048,576 rows including the header (see export_xlsx.py).
# Nothing in the current dataset gets close (CA is the largest at 892,800), but a
# future country could -- the guard matches the pipeline's own behavior: skip, don't
# truncate silently.
EXCEL_ROW_LIMIT = 1_048_575

TEXT_FORMAT = "@"  # Excel's "Text" number format


def query_country(duck: duckdb.DuckDBPyConnection, master_parquet: Path, iso2: str) -> pd.DataFrame:
    """One country's full row set, straight off the master parquet.

    country_iso2 is pushed into the parquet scan (DuckDB predicate pushdown), so this
    reads only that country's row groups -- not the full 3.66M-row file -- exactly
    like the /preview endpoint already does.
    """
    return duck.execute(
        "SELECT * FROM read_parquet($p) WHERE country_iso2 = $iso2",
        {"p": str(master_parquet), "iso2": iso2},
    ).df()


def write_csv(df: pd.DataFrame, out_path: Path) -> None:
    # QUOTE_NONNUMERIC quotes every text-safe column as a literal string -- the same
    # mechanism write_output.py uses. Reading this file back with dtype=str (or via
    # the XLSX below) keeps leading zeros; a bare `pd.read_csv` still won't, which is
    # the CSV-vs-Excel warning the UI repeats.
    df.to_csv(out_path, index=False, quoting=csv.QUOTE_NONNUMERIC, na_rep="")


def write_xlsx(df: pd.DataFrame, out_path: Path, sheet_name: str) -> bool:
    """Returns False (writing nothing) if the row count exceeds Excel's limit --
    mirrors export_xlsx.py's own skip-and-report behavior rather than truncating."""
    if len(df) > EXCEL_ROW_LIMIT:
        return False
    with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name=sheet_name)
        ws = writer.sheets[sheet_name]
        for i, col in enumerate(df.columns, start=1):
            if col in TEXT_SAFE_COLUMNS:
                letter = get_column_letter(i)
                # Stamp the whole column, including the header cell, so Excel treats
                # every value as text -- this is the actual fix for the leading-zero
                # bug; a plain df.to_excel() alone would reintroduce it.
                for cell in ws[letter]:
                    cell.number_format = TEXT_FORMAT
        ws.freeze_panes = "A2"
    return True


def write_parquet(df: pd.DataFrame, out_path: Path) -> None:
    df.to_parquet(out_path, index=False, compression="zstd")


def materialize(
    duck: duckdb.DuckDBPyConnection,
    master_parquet: Path,
    cache_dir: Path,
    iso2: str,
    fmt: str,
) -> Path | None:
    """Return the cached file for (iso2, fmt), generating it first if needed.

    Returns None if the country has no rows, or (xlsx only) exceeds Excel's row
    limit -- callers should treat that the same as "format not available".
    """
    if fmt not in ("csv", "xlsx", "parquet"):
        raise ValueError(f"unknown format: {fmt}")

    out_path = cache_dir / f"{iso2}.{fmt}"
    if out_path.exists():
        return out_path

    df = query_country(duck, master_parquet, iso2)
    if df.empty:
        return None

    cache_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")
    try:
        if fmt == "csv":
            write_csv(df, tmp_path)
        elif fmt == "xlsx":
            if not write_xlsx(df, tmp_path, iso2):
                return None
        elif fmt == "parquet":
            write_parquet(df, tmp_path)
        tmp_path.rename(out_path)  # atomic -- a concurrent reader never sees a partial file
    finally:
        tmp_path.unlink(missing_ok=True)

    return out_path
