#!/usr/bin/env python3
"""
Postal Portal API.

Needs only two things to run, neither of which is the 1.8 GB `to JD/pipeline/data/
clean/` tree:
  app/catalog.json                 the whole catalog (~95 KB, ships in git)
  app/data/postal_codes_final.parquet   the master data (~80 MB, synced from Google
                                    Drive by scripts/sync_from_drive.py -- see
                                    $POSTAL_PORTAL_MASTER_PARQUET below)

csv/xlsx are never read from disk pre-generated -- they're produced on first request
from the master parquet (scripts/pp_lib/formats.py, the same code build_catalog.py
uses to record sizes) and cached under app/on_demand_cache/. The 9 no-postal-code
countries are the one exception: their original JD source files are small enough
(~1.4 MB total) to ship directly in git, under app/raw_sources/.

Local dev with the full `to JD/` tree present needs nothing extra -- the default
master-parquet path still points there. Set $POSTAL_PORTAL_MASTER_PARQUET to point
at a Drive-synced copy instead (what a deploy host without `to JD/` does).

Run:  .venv/bin/uvicorn server.main:app --reload --port 8000
      (from the Postal Portal directory)
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Literal
from zipfile import ZIP_DEFLATED, ZIP_STORED

import duckdb
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from zipstream import ZipStream

APP_ROOT = Path(__file__).resolve().parent.parent
JD_ROOT = APP_ROOT.parent / "to JD"  # optional -- only used as the default data source

sys.path.insert(0, str(APP_ROOT / "scripts"))
from pp_lib.formats import materialize  # noqa: E402

CATALOG_PATH = APP_ROOT / "app" / "catalog.json"
RAW_SOURCE_DIR = APP_ROOT / "app" / "raw_sources"
CACHE_DIR = APP_ROOT / "app" / "on_demand_cache"
WEB_DIST = APP_ROOT / "web" / "dist"

MASTER_PARQUET = Path(
    os.environ.get(
        "POSTAL_PORTAL_MASTER_PARQUET",
        JD_ROOT / "pipeline" / "data" / "clean" / "postal_codes_final.parquet",
    )
)

Format = Literal["csv", "xlsx", "parquet"]

MEDIA_TYPES = {
    "csv": "text/csv",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "parquet": "application/vnd.apache.parquet",
}

CSV_WARNING = (
    "WARNING about the CSV files: postal codes in these files are correct and "
    "zero-padded on disk, but Excel re-infers types when you double-click a CSV and "
    "will silently strip leading zeros (e.g. 01067 -> 1067). Either use the XLSX "
    "download instead, or import via Data > Get Data > From Text/CSV and set "
    "postal_code to Text. Never re-save a CSV from Excel."
)

# Columns the preview search scans. Ordered widest-value-first for readability.
SEARCHABLE = [
    "postal_code",
    "postal_code_norm",
    "place_name",
    *[f"region_{n}_{s}" for n in range(1, 6) for s in ("en", "lc")],
]

app = FastAPI(title="Postal Portal", docs_url="/api/docs", openapi_url="/api/openapi.json")


def _load_catalog() -> dict:
    if not CATALOG_PATH.exists():
        raise RuntimeError(
            f"{CATALOG_PATH} not found -- run: .venv/bin/python scripts/build_catalog.py"
        )
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


if not MASTER_PARQUET.exists():
    raise RuntimeError(
        f"master parquet not found at {MASTER_PARQUET}\n"
        "Either run this against the full `to JD/` tree (local dev), or fetch it: "
        ".venv/bin/python scripts/sync_from_drive.py --file-id <id>"
    )

CATALOG = _load_catalog()
COUNTRIES: dict[str, dict] = {c["iso2"]: c for c in CATALOG["countries"]}
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# iso2 -> fmt -> path, for the 9 no-postal-code countries only -- their original JD
# files, bundled in git under app/raw_sources/. Covered countries need no such table:
# any of csv/xlsx/parquet is generated on demand from the master parquet instead.
RAW_DOWNLOADS: dict[str, dict[str, Path]] = {
    c["iso2"]: {fmt: RAW_SOURCE_DIR / info["name"] for fmt, info in c["files"].items()}
    for c in CATALOG["countries"]
    if c.get("files_are_source")
}
if RAW_DOWNLOADS and not RAW_SOURCE_DIR.exists():
    print(f"warning: {RAW_SOURCE_DIR} missing -- the no-postal-code countries' "
          f"downloads will 404 until scripts/build_catalog.py has been run and "
          f"app/raw_sources/ committed")

# One connection, read-only queries only. DuckDB handles concurrent reads on it.
DUCK = duckdb.connect(database=":memory:")
DUCK.execute("SET enable_progress_bar = false")


def resolve_download(iso2: str, fmt: str) -> Path:
    """Covered countries: generate-on-demand-and-cache from the master parquet.
    Raw-source countries: look up their bundled original file. Either way, request
    input selects a row in a table or a query parameter -- never a filesystem path."""
    iso2 = iso2.upper()
    if iso2 not in COUNTRIES:
        raise HTTPException(404, f"unknown country: {iso2}")
    country = COUNTRIES[iso2]

    if country.get("files_are_source"):
        available = RAW_DOWNLOADS.get(iso2, {})
        if fmt not in available:
            raise HTTPException(
                409,
                f"{iso2} is not available as {fmt}"
                + (f" — try {' or '.join(sorted(available))}" if available else ""),
            )
        path = available[fmt]
        if not path.exists():
            raise HTTPException(404, f"{path.name} is not on disk at {path.parent}")
        return path

    if country["rows"] == 0:
        raise HTTPException(409, f"{iso2} has no rows to export")

    path = materialize(DUCK, MASTER_PARQUET, CACHE_DIR, iso2, fmt)
    if path is None:
        raise HTTPException(409, f"{iso2} could not be generated as {fmt}")
    return path


@app.get("/api/catalog")
def get_catalog() -> JSONResponse:
    return JSONResponse(CATALOG)


@app.get("/api/country/{iso2}/preview")
def preview(
    iso2: str,
    limit: int = Query(100, ge=1, le=1000),
    q: str = Query("", max_length=100),
) -> dict:
    """Sample rows for one country, straight off the master parquet.

    The country_iso2 filter is pushed down into the parquet scan, so this reads
    only that country's row groups -- not the full 3.66M rows.
    """
    iso2 = iso2.upper()
    if iso2 not in COUNTRIES:
        raise HTTPException(404, f"unknown country: {iso2}")
    if COUNTRIES[iso2]["rows"] == 0:
        # Not in the canonical dataset, so the parquet holds nothing to preview.
        return {"iso2": iso2, "columns": [], "rows": [], "matched": 0, "truncated": False}

    params: dict[str, object] = {"master": str(MASTER_PARQUET), "iso2": iso2, "limit": limit}
    where = "country_iso2 = $iso2"
    if q.strip():
        # Parameterized LIKE across the searchable text columns; % is escaped so a
        # user typing '%' searches for a literal percent sign.
        needle = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        params["needle"] = f"%{needle}%"
        ors = " OR ".join(
            f"{col} ILIKE $needle ESCAPE '\\'" for col in SEARCHABLE
        )
        where += f" AND ({ors})"

    sql = f"SELECT * FROM read_parquet($master) WHERE {where} LIMIT $limit"
    rel = DUCK.execute(sql, params)
    columns = [d[0] for d in rel.description]
    rows = rel.fetchall()

    count_sql = f"SELECT count(*) FROM read_parquet($master) WHERE {where}"
    count_params = {k: v for k, v in params.items() if k != "limit"}
    matched = DUCK.execute(count_sql, count_params).fetchone()[0]

    return {
        "iso2": iso2,
        "columns": columns,
        # Postal codes stay strings all the way out -- json.dumps of a str keeps "01067".
        "rows": [list(r) for r in rows],
        "matched": matched,
        "truncated": matched > len(rows),
    }


def row_count(country: dict) -> int:
    """Canonical postal-code rows, or source rows for the raw source files."""
    return country["source_rows"] if country.get("files_are_source") else country["rows"]


@app.get("/api/download/{iso2}")
def download(iso2: str, fmt: Format = "xlsx") -> FileResponse:
    path = resolve_download(iso2, fmt)
    country = COUNTRIES[iso2.upper()]
    return FileResponse(
        path,
        media_type=MEDIA_TYPES[fmt],
        filename=path.name,
        headers={
            "X-Postal-Portal-Rows": str(row_count(country)),
            "X-Postal-Portal-Raw-Source": "1" if country.get("files_are_source") else "0",
        },
    )


class BundleRequest(BaseModel):
    iso2: list[str] = Field(min_length=1, max_length=200)
    fmt: Format = "xlsx"


@app.post("/api/bundle")
def bundle(req: BundleRequest) -> StreamingResponse:
    """Stream a zip of several countries.

    ZipStream yields the archive chunk by chunk, so a 400 MB bundle never lands in
    memory -- important when CA (165 MB) and IL (132 MB) are in the same selection.
    Each country is generated (or served from cache) via resolve_download() before
    zipping starts, so a mid-stream generation failure can't leave a truncated zip.
    """
    seen: list[str] = []
    for raw in req.iso2:
        code = raw.upper()
        if code not in seen:
            seen.append(code)
    paths = [(code, resolve_download(code, req.fmt)) for code in seen]

    total_rows = sum(row_count(COUNTRIES[code]) for code, _ in paths)
    total_bytes = sum(p.stat().st_size for _, p in paths)
    raw = [code for code, _ in paths if COUNTRIES[code].get("files_are_source")]

    manifest_lines = [
        "Postal Portal bundle",
        f"format: {req.fmt}",
        f"countries: {len(paths)}",
        f"rows: {total_rows:,}",
        f"catalog generated: {CATALOG['generated_at']}",
        "",
        f"{'ISO2':6}{'file':28}{'rows':>10}  {'last updated':13}from",
    ]
    for code, path in paths:
        c = COUNTRIES[code]
        manifest_lines.append(
            f"{code:6}{path.name[:26]:28}{row_count(c):>10,}  "
            f"{c['last_updated']:13}{c['source_file']}"
            f"{'   [RAW SOURCE]' if c.get('files_are_source') else ''}"
        )
    if raw:
        manifest_lines += [
            "",
            f"RAW SOURCE files in this bundle: {', '.join(raw)}. These countries have no "
            "usable postal codes, so they are not part of the canonical dataset and their "
            "files are JD's originals -- column names and encoding vary per file, and there "
            "is no postal_code data. They are included for their administrative levels and "
            "coordinates.",
        ]
    if req.fmt == "csv":
        manifest_lines += ["", CSV_WARNING]
    manifest = ("\n".join(manifest_lines) + "\n").encode("utf-8")

    # CSV is plain text and deflates roughly 4x, which is worth a lot on a 165 MB
    # file -- but a compressed stream has no predictable length, so the browser
    # loses its progress bar. XLSX and parquet are already compressed internally,
    # so for those we store and can advertise Content-Length.
    compress = req.fmt == "csv"
    zs = ZipStream(sized=not compress, compress_type=ZIP_DEFLATED if compress else ZIP_STORED)
    zs.add(manifest, "MANIFEST.txt")
    for _, path in paths:
        zs.add_path(path, path.name)

    name = f"postal-portal-{len(paths)}-countries-{req.fmt}.zip"
    headers = {
        "Content-Disposition": f'attachment; filename="{name}"',
        "X-Postal-Portal-Uncompressed-Bytes": str(total_bytes),
    }
    if not compress:
        headers["Content-Length"] = str(len(zs))
    return StreamingResponse(zs, media_type="application/zip", headers=headers)


# Serve the built frontend last so /api/* wins. Absent in dev (Vite serves it).
if WEB_DIST.exists():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
