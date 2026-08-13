#!/usr/bin/env python3
"""
Pull the master parquet down from Google Drive.

This is the one thing a deploy host actually needs from `to JD/` (80 MB, vs. the
~1.8 GB of CSV/XLSX pipeline/data/clean/ also holds) -- everything else the server
needs either ships in git (catalog.json, the 9 bundled raw-source files) or is
generated on demand from this file (scripts/lib/formats.py).

Uses a public "anyone with the link" share rather than a Google Cloud service
account -- no OAuth setup, no Cloud project, works from a plain `DRIVE_FILE_ID`.
Trade-off: anyone with the link can read it. Switch to the Drive API + a service
account (share the file to the service account's email, not "anyone with the link")
if that's not acceptable for this dataset.

Usage:
    DRIVE_FILE_ID=<id> python3 scripts/sync_from_drive.py
    python3 scripts/sync_from_drive.py --file-id <id> --out /path/to/master.parquet
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import gdown

APP_ROOT = Path(__file__).resolve().parent.parent

# Overridable via --out / POSTAL_PORTAL_MASTER_PARQUET so this can target either the
# local dev layout (to JD/pipeline/data/clean/postal_codes_final.parquet, keeping
# build_catalog.py's default unchanged) or a deploy host's own data directory.
DEFAULT_OUT = APP_ROOT / "app" / "data" / "postal_codes_final.parquet"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--file-id",
        default=os.environ.get("DRIVE_FILE_ID"),
        help="Google Drive file ID (from the share link). Also read from $DRIVE_FILE_ID.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(os.environ.get("POSTAL_PORTAL_MASTER_PARQUET", DEFAULT_OUT)),
        help=f"Where to write it (default: {DEFAULT_OUT}).",
    )
    args = parser.parse_args()

    if not args.file_id:
        sys.exit(
            "error: no Drive file ID given. Pass --file-id or set $DRIVE_FILE_ID.\n"
            "Get it from the share link: https://drive.google.com/file/d/<FILE_ID>/view"
        )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    tmp = args.out.with_suffix(args.out.suffix + ".part")

    print(f"downloading Drive file {args.file_id} -> {args.out}")
    try:
        gdown.download(id=args.file_id, output=str(tmp), quiet=False)
    except (gdown.exceptions.FileURLRetrievalError, gdown.exceptions.DownloadError) as e:
        tmp.unlink(missing_ok=True)
        sys.exit(
            f"error: could not access Drive file {args.file_id}.\n"
            "Most likely cause: it isn't shared as 'Anyone with the link (Viewer)' "
            "-- gdown has no login and can't read a private file.\n"
            f"({e})"
        )

    if not tmp.exists() or tmp.stat().st_size == 0:
        tmp.unlink(missing_ok=True)
        sys.exit(
            "error: download produced no data. Common cause: the file isn't shared "
            "as 'Anyone with the link' -- gdown can't authenticate to Drive."
        )

    tmp.rename(args.out)  # atomic -- a build running concurrently never sees a partial file
    size_mb = args.out.stat().st_size / 1e6
    print(f"done: {args.out} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
