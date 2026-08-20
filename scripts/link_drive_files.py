#!/usr/bin/env python3
"""
Discover CSV/XLSX files sitting in a Google Drive folder and wire them into
catalog.json as `drive_links` -- the "drop files in, have them appear" step.

The static site never generates or hosts CSV/XLSX (see build_catalog.py's
docstring) -- they're too big for GitHub. Instead, you drop a country's files
(named exactly like the pipeline's own output: `<ISO2>.csv`, `<ISO2>.xlsx` --
literally the files under `to JD/pipeline/data/clean/by_country[_xlsx]/`) into a
Drive folder shared as "Anyone with the link", and this script lists that folder
and records a link per file. Re-run it whenever the folder's contents change --
idempotent, always reflects the folder's current state.

Only needs a Google API key (Cloud Console -> APIs & Services -> Credentials ->
Create API Key, restricted to the Drive API) -- no OAuth, no service account, no
write access to your Drive at all. Read-only `files.list` against a folder YOU
chose to make public is the whole permission surface:
    https://www.googleapis.com/drive/v3/files?q='<folderId>'+in+parents&key=<apiKey>

Scope: all-rows CSV/XLSX only. The postal-codes/admin-areas view split stays a
parquet-only distinction (those files are already shipped directly, no Drive
needed) -- linking view-specific CSV/XLSX too would need 3x the files in the
folder for comparatively little benefit.

Usage:
    python3 scripts/link_drive_files.py --folder-id <id> --api-key <key>
    DRIVE_FOLDER_ID=<id> DRIVE_API_KEY=<key> python3 scripts/link_drive_files.py
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = APP_ROOT / "web" / "public" / "catalog.json"

API_URL = "https://www.googleapis.com/drive/v3/files"

# <ISO2>.csv / <ISO2>.xlsx -- exactly what write_output.py / export_xlsx.py already
# name their output. Case-insensitive: Drive doesn't enforce a casing convention.
FILENAME_RE = re.compile(r"^([a-zA-Z]{2})\.(csv|xlsx)$")


def list_folder(folder_id: str, api_key: str) -> list[dict]:
    """Every file directly inside the folder, paginated."""
    files: list[dict] = []
    page_token = None
    while True:
        params = {
            "q": f"'{folder_id}' in parents and trashed = false",
            "key": api_key,
            "fields": "nextPageToken, files(id, name)",
            "pageSize": "1000",
        }
        if page_token:
            params["pageToken"] = page_token
        url = f"{API_URL}?{urllib.parse.urlencode(params)}"
        try:
            with urllib.request.urlopen(url) as resp:
                data = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            sys.exit("\n".join([
                f"error: Drive API returned {e.code} for folder {folder_id}.",
                "Most likely cause: the folder isn't shared as 'Anyone with the link',",
                "or the API key isn't valid/isn't restricted to allow the Drive API.",
                body,
            ]))
        files.extend(data.get("files", []))
        page_token = data.get("nextPageToken")
        if not page_token:
            return files


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--folder-id",
        default=os.environ.get("DRIVE_FOLDER_ID"),
        help="Google Drive folder ID (from its share link). Also read from $DRIVE_FOLDER_ID.",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("DRIVE_API_KEY"),
        help="Google API key, restricted to the Drive API. Also read from $DRIVE_API_KEY.",
    )
    args = parser.parse_args()

    if not args.folder_id or not args.api_key:
        sys.exit("\n".join([
            "error: need both --folder-id and --api-key (or $DRIVE_FOLDER_ID / $DRIVE_API_KEY).",
            "Get the folder ID from its share link: https://drive.google.com/drive/folders/<FOLDER_ID>",
            "Get an API key: Google Cloud Console -> APIs & Services -> Credentials -> Create API Key (restrict it to the Drive API).",
        ]))

    if not CATALOG_PATH.exists():
        sys.exit(f"error: {CATALOG_PATH} not found -- run scripts/build_catalog.py first.")
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    covered = {c["iso2"]: c for c in catalog["countries"] if c["status"] == "covered"}

    print(f"listing Drive folder {args.folder_id} ...")
    files = list_folder(args.folder_id, args.api_key)
    print(f"  {len(files)} file(s) in folder")

    links: dict[str, dict[str, str]] = {}
    unmatched: list[str] = []
    unknown_iso2: list[str] = []
    for f in files:
        m = FILENAME_RE.match(f["name"])
        if not m:
            unmatched.append(f["name"])
            continue
        iso2, fmt = m.group(1).upper(), m.group(2).lower()
        if iso2 not in covered:
            unknown_iso2.append(f["name"])
            continue
        links.setdefault(iso2, {})[fmt] = f"https://drive.google.com/file/d/{f['id']}/view"

    for iso2, country in covered.items():
        if iso2 in links:
            country["drive_links"] = links[iso2]
        else:
            country.pop("drive_links", None)

    CATALOG_PATH.write_text(json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")

    linked_both = sum(1 for v in links.values() if "csv" in v and "xlsx" in v)
    linked_some = len(links)
    missing = sorted(set(covered) - set(links))
    print(
        f"\nlinked {linked_some}/{len(covered)} covered countries "
        + f"({linked_both} with both csv+xlsx, {linked_some - linked_both} with only one)"
    )
    if missing:
        print(f"not yet in the folder ({len(missing)}): {', '.join(missing)}")
    if unmatched:
        print(f"\nignored (name doesn't match <ISO2>.csv/<ISO2>.xlsx): {', '.join(unmatched)}")
    if unknown_iso2:
        print(f"ignored (ISO2 not a covered country in catalog.json): {', '.join(unknown_iso2)}")
    print(f"\nwrote {CATALOG_PATH.relative_to(APP_ROOT)}")


if __name__ == "__main__":
    main()
