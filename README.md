# Postal Portal

An at-a-glance view of the consolidated postal-code dataset: a world coverage map, a
sortable country list, and per-country downloads.

**79 countries with postal codes · 3,664,362 rows · 9 more delivered without codes ·
sources dated 22 Jan 2025 – 13 Aug 2026.**

The deployed site is **fully static** — no backend, no database, nothing to host but
files. See "How the data is arranged" for how that works.

## Run it

```bash
cd "/Users/jeff/Downloads/Postal Portal/web" && npm run dev
```

Then open http://localhost:5173. That's it — `catalog.json`, the per-country parquet
files, and the 9 raw sources all live under `web/public/`, which Vite serves directly;
search runs in-browser via `duckdb-wasm`. There is no server process to start.

`npm run build` (also in `web/`) produces the same thing GitHub Pages deploys —
`web/dist/`, which any static file server can serve as-is (`npx serve web/dist`,
`python3 -m http.server`, etc.).

A separate optional tool, `server/main.py` (FastAPI + DuckDB against the master
parquet), still exists for local data exploration — see "API" below — but the
frontend never calls it and it is never deployed.

## Deploying

Push to `main` and GitHub Actions (`.github/workflows/deploy.yml`) builds `web/` and
publishes `web/dist/` to GitHub Pages — no server to provision, no reverse proxy, no
TLS to set up. One-time setup on the repo: **Settings → Pages → Source: "GitHub
Actions"**. After that, every push to `main` redeploys automatically (or trigger it
by hand from the Actions tab).

This works because the entire site is static files checked into git — including the
108 MB of per-country parquet under `web/public/parquet/` (largest single file
8.5 MB; well under GitHub's 100 MB per-file limit). Nothing needs fetching from
Google Drive or anywhere else at deploy time. Drive only comes in for CSV/XLSX
downloads, which the static site can't generate itself — see "How the data is
arranged" and "Adding new data".

`web/vite.config.ts`'s `base` is computed by the workflow itself (a user/org page
repo like `<you>.github.io` serves at the domain root; any other repo serves at
`/<repo-name>/`) — nothing to configure by hand regardless of what the repo is named.

## How the data is arranged

The dataset is **not** copied whole into the deployed app, and it is not converted to
SQL. The static site ships three things, all under `web/public/` and all committed
to git:

| What | Where | Size |
|---|---|---|
| Catalog — everything the map and list need, one row per country | `web/public/catalog.json` | ~110 KB |
| Per-country parquet — all-rows plus the postal-codes/admin-areas dedup views | `web/public/parquet/<ISO2>[.view].parquet` | 108 MB total, largest file 8.5 MB |
| Raw sources — the 9 no-postal-code countries' original JD files | `web/public/raw_sources/` | ~1.4 MB |

That's the **entire** data footprint of the deployed site: **~110 MB**, none of it the
`to JD/` tree, no backend needed to serve any of it. Parquet downloads are direct
links to these files. Search runs **`duckdb-wasm` in the visitor's own browser**
against whichever per-country file is on screen — nothing round-trips to a server.
CSV/XLSX are the one thing a static site genuinely can't produce on demand: those are
links out to a Google Drive folder instead (`drive_links` in the catalog, populated
by `scripts/link_drive_files.py` — see "Adding new data"). No `.sql` dump anywhere
either way (it would be *larger* than the CSVs and unusable until imported).

**Separately**, `server/main.py` is a small FastAPI + DuckDB tool for querying the
*master* parquet (every country, every row, undeduped) directly — useful for local
data exploration, not part of the deployed site and not called by the frontend at
all. It reads `to JD/pipeline/data/clean/postal_codes_final.parquet` by default, or
a Drive-synced copy via `$POSTAL_PORTAL_MASTER_PARQUET` + `scripts/sync_from_drive.py`
(**the Drive file needs to be shared "Anyone with the link (Viewer)"** for `gdown`
to read it with no OAuth setup) — see its own docstring for details.

## Adding new data

**1. Drop it into `to JD/數據更新/`** — that folder always wins version resolution
over any batch file (highest `_v` number wins if there's more than one), so it's
the drop-zone for both a correction to an existing country and a country you
haven't seen before.

**2. Re-run the pipeline chain**, each stage feeding the next:

```bash
cd "/Users/jeff/Downloads/to JD/pipeline"
python3 scripts/discover_files.py    # rescans every batch folder -> file_manifest.csv
python3 scripts/ingest.py            # column-maps the new file -> canonical_raw.parquet
python3 scripts/enrich.py            # iso3/continent/country_lc/region_1 backfill
python3 scripts/validate.py          # drops blank-postal-code rows -> postal_codes_final.parquet
python3 scripts/write_output.py      # regenerates postal_codes_all.csv + all by_country/*.csv
python3 scripts/export_xlsx.py       # regenerates XLSX (pass ISO2 codes to scope it, e.g. `FR IT`)
python3 scripts/audit_integrity.py   # read-only adversarial check -- always run this
```

**3. Rebuild Postal Portal's catalog** (dev machine, full `to JD/` access
required — `build_catalog.py` is never run on a deploy host):

```bash
cd "/Users/jeff/Downloads/Postal Portal"
.venv/bin/python scripts/build_catalog.py
```

This regenerates `web/public/catalog.json`, `web/public/parquet/` (all-rows plus
both dedup views, per country), and `web/public/raw_sources/` — **budget under a
minute**, since the static site ships parquet only (csv/xlsx generation was dropped
from this script entirely once CSV/XLSX became Drive links instead of on-demand
files — see "How the data is arranged"). Commit the result afterward — everything
under `web/public/` is meant to be committed — and push to `main`; GitHub Actions
rebuilds and redeploys automatically (see "Deploying").

**4. Keep the Drive-linked CSV/XLSX in sync** (only if this data change affects a
country's CSV/XLSX and you're using Drive links for it): drop the regenerated
`by_country/<ISO2>.csv` / `by_country_xlsx/<ISO2>.xlsx` into your public Drive
folder (overwriting the old ones), then re-run:

```bash
cd "/Users/jeff/Downloads/Postal Portal"
python3 scripts/link_drive_files.py --folder-id <id> --api-key <key>
```

This re-scans the folder and rewrites `drive_links` in `web/public/catalog.json` to
match — commit and push that too. Skipping this step just means the site's CSV/XLSX
links still point at the previous version until you do; it's independent of step 3.

**If you're running `server/main.py`'s local-dev mode against a Drive-synced master
parquet** (no `to JD/` on that machine): re-upload the new
`postal_codes_final.parquet` to the same Drive file (replace its content, keeping
the same file ID), then re-run `scripts/sync_from_drive.py` and clear
`app/on_demand_cache/*` so it doesn't keep serving stale downloads alongside the new
data. This is unrelated to the deployed static site, which never reads this file.

`countries_with_no_postal_codes.csv` is regenerated by `validate.py` too, so a country
that finally gets real postal codes automatically graduates to `covered` on the next
`build_catalog.py` run — nothing to edit by hand for that case.

### Three edge cases that need a manual touch first

- **Unusual column headers** on a brand-new country. `validate.py`'s report calls out
  any `UNMAPPED` column. Add a small entry to `MANUAL_OVERRIDES` in
  `pipeline/scripts/lib/mapping.py` — Cyprus's trilingual header is the existing
  example to copy.
- **A genuinely new batch folder** (not `數據更新`) — add its name to `RAW_DIRS` in
  `pipeline/scripts/discover_files.py`. Dropping into `數據更新` avoids this.
- **Want `country_lc` auto-filled** for a new country — add a line to
  `pipeline/configs/country_primary_language.yaml` (language code, plus a `note` and
  `judgment_call: true` if the country has more than one official language). Verify
  the translation actually resolves to something sensible before trusting it:
  ```bash
  cd "/Users/jeff/Downloads/to JD/pipeline" && python3 -c "
  import sys; sys.path.insert(0, 'scripts')
  from lib.enrichment import translated_country_name
  import pycountry
  c = pycountry.countries.get(alpha_2='XX')
  print(translated_country_name('XX', c.name, 'LANG_CODE'))"
  ```
  This is also the mechanism Postal Portal's `build_catalog.py` reuses (via
  `local_name_for()`) to fill in a local name for the no-postal-code countries, which
  never reach the main pipeline's enrichment step at all.

## What the map shows

Three states, each in the legend:

- **Filled blue** — postal codes present. The shade is a 5-bin log scale on row count
  (`<1K` → `500K+`); Canada's 892,800 and Ireland's 139 need a log scale to stay
  distinguishable. The ramp is the dataviz sequential blue, validated in both themes.
- **Amber hatch** — a file was delivered but has no usable postal codes (9 countries).
  Hatch as well as hue, so the state never depends on colour alone.
- **Grey** — not in the dataset.

Hover for a tooltip, click to open a country. Scroll or use `+ − ⤾` to zoom.

## The sidebar

One row per country: name (with native-script name), ISO2, region, admin depth,
postal-code count, admin-area count, last-updated date, and a quick download button
(all-rows Parquet, or the best available JD original for a no-postal-code country).
Every column sorts; filter by region, status, or free text over name/ISO2/ISO3.

Click a row to open its detail drawer — search, the postal-codes/admin-areas view
toggle, and every download (Parquet directly, CSV/XLSX via Drive) live there.

**Last updated** is the filesystem mtime of the country's authoritative source file
under `../to JD/`, resolved through the pipeline's own
`data/interim/version_resolution.csv` (which picks one file per country: a `數據更新`
revision beats a batch file, highest version wins). The full date and the source
filename are in the row's tooltip.

**Admin depth** is the deepest `region_N` level that actually holds data — not the
number of columns present. Several files declare a level and leave it entirely blank.

## Postal codes vs. admin areas

Every country's data is inherently many-to-many — one postal code can cover several
admin areas and vice versa (DE's 23,296 rows collapse to just 652 distinct 3-level
region tuples; AU postcode `0822` alone spans 111 Northern Territory localities).
Every covered country has a second and third way to view and download its data, via
a toggle in the drawer:

- **Postal Codes** — one row per distinct `postal_code`.
- **Admin Areas** — one row per distinct `region_1..5` combination.

Whichever field varies within a group is **blanked, not arbitrarily picked** — e.g.
AU postcode `0822`'s postal-codes-view row shows the state but blanks the locality
(111 candidates, no honest single answer); the central Sydney admin area spans 148
postal codes, so its admin-areas-view row blanks `postal_code`. This is
`scripts/pp_lib/formats.py`'s `dedupe()` — a vectorized pandas groupby (`first()` +
`nunique()`, see the performance note below) with `dropna=False` (required:
region_4/5 are entirely `NaN`, not empty string, for most countries, and pandas'
default groupby silently drops every row when a key column is `NaN`) that keeps a
column's value only where every row in the group agrees, blanking it otherwise.

The sidebar's **Areas** column shows each country's distinct-admin-area count next
to its existing postal-code count (**Codes**, unchanged — still the canonical row
count, not deduped); both are sortable. The view toggle itself lives only in the
detail drawer now — the sidebar's per-row download button is fixed to all-rows
Parquet (a quick, single click); every other view/format combination is a click
into the drawer away.

This was piloted on Australia only at first (`PILOT_COUNTRIES` in
`build_catalog.py`), then rolled out to every covered country once proven — that
constant no longer exists; `view_stats`/`view_files` are unconditional for any
`covered` entry now. The 9 no-postal-code countries still have neither (there's
nothing to dedupe), so the view toggle doesn't apply to them — they keep serving
their one JD original file regardless.

**Search in the drawer** runs `duckdb-wasm` directly against whichever parquet file
is on screen (all-rows or one of the two views) — a deliberate simplification versus
the old server-backed design, which joined back to the master parquet so a search
term could match a value a view's dedupe had blanked out. A static site has no
master file in the visitor's browser to join against, so a term that lived only in
a field a group's dedupe blanked won't surface a match *in that view* (switching
views, or to all rows, still finds it). `server/main.py`'s own `/preview` endpoint
(local-dev only, not part of the deployed site) still does the smarter join, for
whoever queries the master parquet directly through it.

**Build-time cost**: materializing 2 extra views for every country used to roughly
double or triple `build_catalog.py`'s runtime (~27 minutes at its worst) back when
it also generated CSV/XLSX for every view — openpyxl's per-cell text-formatting
cost on CA/IL/NL, paid three times over. Once CSV/XLSX moved to Drive links (see
"How the data is arranged") and `build_catalog.py` became parquet-only, that cost
disappeared entirely: a full run, all 79 covered countries × 3 views, now finishes
in **well under a minute**.

`dedupe()`'s first implementation used `groupby(...).agg({col: custom_fn})` — a
custom Python callable invoked once per group per column, which does not
vectorize. AU's few thousand groups hid this completely; CA's ~892,000
postal-code groups never finished (killed after 48+ minutes stuck). Rewritten to
use `groupby().first()` + `groupby().nunique()` — both vectorized, C-level
pandas methods — which dedupes CA's full dataset in under 2 seconds. Confirmed
both versions agree on AU's known cases (postcode `0822`, `0872`, the
central-Sydney tuple) before switching. If you're extending `dedupe()`: avoid
`.agg()` with a custom per-group callable for anything that might see more than a
few thousand groups — it will silently seem to hang, not error.

### Australia's data source

AU was swapped on 2026-08-13 from `Batch 1 (23-1-2025)/JD_AU_澳大利亚.csv`
(15,957 rows, no coordinates, informal region_2 names, a region_4 sub-suburb level
for ~32% of rows) to `數據更新/JD_AU_v2.csv` (18,559 rows, coordinates for every
row, ABS SA4 region_2 areas, no region_4) — a genuine taxonomy change, not a
superset, so the old data was archived rather than discarded:
`pipeline/data/archive/AU_pre-SA4_2026-08-13/` (`AU.csv`, `AU.xlsx`, an AU-only
parquet slice, and `NOTES.md` explaining what's in it and why it might still
matter).

This also surfaced a real gap in `materialize()`'s caching, fixed at the same
time: it checked only whether a cached file *existed*, never whether the master
parquet had changed since — so swapping AU's source would have left the app
silently serving AU's *old* cached csv/xlsx/parquet forever. Fixed by comparing
mtimes (regenerate if the master parquet is newer than the cache entry) — note
this means **any** pipeline data change invalidates the *entire* on-demand cache,
not just the country that changed (the master parquet's mtime doesn't say which
countries' rows moved) — a deliberate correctness-over-speed trade, not a bug.

## The 9 countries without postal codes

BO, CD, CG, CM, ML, QA, SR, TG, UG each have a delivered file whose postal-code column
is absent or 100 % blank, so the pipeline excluded them and they have no canonical
output. Their source files still carry a real region hierarchy (2–4 levels) and
coordinates, so **the app serves JD's original file for them**, marked `RAW` — copied
into `web/public/raw_sources/` by `build_catalog.py` (~1.4 MB total, committed to
git) rather than referenced under `to JD/`, which the deployed site never has:

- Un-normalized — each file has its own column names and encoding (SR uses GeoNames-style
  `order1_name`; QA's local-language columns are mojibake in the source).
- Available as CSV always, XLSX for 7 of the 9 (ML and TG have no XLSX). Direct,
  same-origin downloads — no Drive involved, unlike the 79 canonical countries' CSV/XLSX.
- No row preview, because there is nothing in the canonical dataset to preview. The
  drawer lists the source file's columns and level fill rates instead.
- `server/main.py`'s `/api/bundle` (local-dev only) flags them `[RAW SOURCE]` in a
  mixed zip's `MANIFEST.txt`; the deployed site has no bundle/zip feature.

Their local-language country name (`name_lc`) doesn't come from these files either —
JD's own `country_lc` column for all 9 is just `country_en` duplicated, confirmed by
inspection. It's derived instead via `local_name_for()` in `build_catalog.py`, which
calls the pipeline's own offline pycountry-CLDR translation (`translated_country_name`
in `pipeline/scripts/lib/enrichment.py`), driven by the same
`country_primary_language.yaml` config used for the 79 canonical countries.

## A known-fixed data bug: `country_lc` stuck at the English name

For 17 of the 79 canonical countries (AR, CL, CO, EC, FR, GT, ID, IT, JO, KE, LU, MY,
PA, SG, UY, VE, ZA — 232,649 rows), the source file pre-filled `country_lc` with the
English name instead of leaving it blank, which meant the pipeline's enrichment step
silently skipped translating it even though `country_primary_language.yaml` already
had the right language configured. Fixed in `_impute_country_lc`
(`pipeline/scripts/lib/enrichment.py`) by also treating "`country_lc` identical to
`country_en`" as untranslated, scoped to countries whose configured language isn't
English (so genuinely English-speaking countries like US/CA/GB/AU/NZ/GH/NG are left
alone). 6 of the 17 now show a distinct local name (e.g. IT → *Italia*, JO → *الأردن*,
ZA → *IRiphabliki yaseNingizimu Afrika*); the other 11 resolve to the same spelling —
verified against pycountry's own translation catalog as genuine cognates (e.g.
*Argentina*, *Uruguay*, *Kenya* really are spelled the same in Spanish/Swahili), not a
silent failure. This was a real pipeline fix, not just a display one — the delivered
CSV/XLSX for these 17 countries were regenerated (`enrich.py → validate.py →
write_output.py → export_xlsx.py`) and Postal Portal's own `data/by_country/` copies
re-synced to match.

## A warning the UI repeats

**Opening the CSVs in Excel re-strips leading zeros** (`01067` → `1067`). The files on
disk are correct; Excel re-infers types on open, and quoting does not prevent it. Use the
XLSX download — those store postal codes as genuine text cells — or import the CSV via
*Data ▸ Get Data ▸ From Text/CSV* with `postal_code` set to Text. Never re-save a CSV
from Excel. This is the same defect that corrupted 122,581 codes across 20 countries in
the original source data.

## API

`server/main.py` is a standalone FastAPI tool for querying the master parquet
directly — **not part of the deployed site** and not called by the frontend (which
talks to static files + duckdb-wasm instead; see "How the data is arranged"). Useful
for local data exploration:

```bash
cd "/Users/jeff/Downloads/Postal Portal" && .venv/bin/uvicorn server.main:app --reload --port 8000
```

| Endpoint | Notes |
|---|---|
| `GET /api/catalog` | The whole catalog (reads `web/public/catalog.json`). |
| `GET /api/country/{iso2}/preview?limit=&q=` | DuckDB over the master parquet. `q` matches postal code, place, or any region name. 404 for unknown ISO2; empty result for the raw-source countries. |
| `GET /api/download/{iso2}?fmt=csv\|xlsx\|parquet` | 409 if that country has no file in that format, with the formats it does have. |
| `POST /api/bundle` | `{"iso2": [...], "fmt": "..."}` → streaming zip plus a `MANIFEST.txt`. CSV bundles are deflated (444 MB of CSV → 24 MB); XLSX/parquet are stored and carry a `Content-Length`. |

Interactive docs at `/api/docs`.

Downloads never assemble a path from request input. For the 79 canonical countries,
`fmt` and `iso2` select a DuckDB query against the master parquet
(`scripts/pp_lib/formats.py:materialize`), cached to `app/on_demand_cache/<ISO2>.<fmt>`
after first generation — deliberately separate from `web/public/parquet/`, so this
tool's cache never collides with the static site's own files; for the 9 raw-source
countries, they select an entry in a table built from the catalog at startup,
pointing into `web/public/raw_sources/`.

## Layout

```
scripts/build_catalog.py     dev-machine-only build step (needs full to JD/ access) --
                              writes web/public/{catalog.json,parquet/,raw_sources/}
scripts/link_drive_files.py  scans a public Drive folder, writes drive_links into
                              web/public/catalog.json for CSV/XLSX downloads
scripts/sync_from_drive.py   fetches the master parquet for server/main.py's local-dev mode
scripts/pp_lib/formats.py    shared parquet generation (build-time) + csv/xlsx (server/main.py only)
web/public/catalog.json      generated, committed -- what the deployed site fetches
web/public/parquet/          generated, committed (108 MB) -- what the deployed site downloads/searches
web/public/raw_sources/      generated, committed (~1.4 MB)
app/data/                    gitignored -- server/main.py's synced master parquet lives here
app/on_demand_cache/         gitignored -- server/main.py's generated csv/xlsx/parquet
server/main.py               FastAPI, local-dev-only (see "API") -- never deployed
web/                          Vite + React + TypeScript -- the deployed site
web/src/duckdb.ts             lazy-loaded duckdb-wasm instance + query helper, used by the search UI
web/public/vendor/            countries-110m.json (Natural Earth 110m, vendored for offline use)
.github/workflows/deploy.yml  builds web/ and publishes web/dist/ to GitHub Pages on push to main
data/                         pre-existing, unused by the running app -- see .gitignore
```

Local dev defaults to reading the sibling `../to JD/` tree for `server/main.py`'s
master parquet; `$POSTAL_PORTAL_MASTER_PARQUET` overrides it. `build_catalog.py`
always needs the full tree too — it's a dev-machine-only step, never run on a deploy
host (there is no deploy host to run it on; GitHub Actions only builds the already-
generated, already-committed `web/public/` into `web/dist/`).
