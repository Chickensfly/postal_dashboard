# Postal Portal

An at-a-glance view of the consolidated postal-code dataset: a world coverage map, a
sortable country list, and per-country or bulk downloads.

**79 countries with postal codes · 3,661,760 rows · 9 more delivered without codes ·
sources dated 22 Jan 2025 – 29 Sep 2025.**

## Run it

Two processes in development — API on 8000, Vite on 5173 (which proxies `/api` to 8000):

```bash
cd "/Users/jeff/Downloads/Postal Portal" && .venv/bin/uvicorn server.main:app --reload --port 8000
```

```bash
cd "/Users/jeff/Downloads/Postal Portal/web" && npm run dev
```

Then open http://localhost:5173.

For a single process, build the frontend once and let the API serve it — everything is
then on http://localhost:8000:

```bash
cd "/Users/jeff/Downloads/Postal Portal/web" && npm run build
```

## Deploying

GitHub-friendly by design: `.gitignore` excludes `.venv/`, `web/node_modules/`,
`web/dist/`, `data/` (the original unused dump), and the two things that shouldn't be
committed — `app/data/` (the master parquet, per-environment) and
`app/on_demand_cache/` (regenerable). Everything else, including `app/catalog.json`
and `app/raw_sources/`, is small enough to commit directly — no individual file here
comes close to GitHub's 100 MB hard limit.

A host with no `to JD/` tree at all needs exactly one extra step before first start —
fetch the master parquet:

```bash
DRIVE_FILE_ID=<id from the Drive share link> \
  .venv/bin/python scripts/sync_from_drive.py
```

That writes `app/data/postal_codes_final.parquet` (the default
`$POSTAL_PORTAL_MASTER_PARQUET` target). Then `pip install -r server/requirements.txt`,
`npm ci && npm run build` in `web/`, and run uvicorn behind whatever reverse
proxy/TLS the host provides — same as local dev, just pointed at a fetched file
instead of `to JD/`.

**The Drive file needs to be shared "Anyone with the link (Viewer)"** — the sync
script uses `gdown` against a public link rather than a Google Cloud service account,
trading stricter access control for zero OAuth setup. Re-run
`sync_from_drive.py` whenever the master parquet is updated (see "Adding new data");
it overwrites the local copy atomically, so a request mid-download never sees a
partial file.

## How the data is arranged

The dataset is **not** copied into this app, and it is not converted to SQL. Three tiers:

| Tier | What | Where | Size |
|---|---|---|---|
| Catalog | Everything the map and list need — one row per country | `app/catalog.json` (generated, committed to git) | ~95 KB |
| Master data | Every row, canonical schema | `app/data/postal_codes_final.parquet` (synced from Google Drive) | 80 MB |
| Raw sources | The 9 no-postal-code countries' original JD files | `app/raw_sources/` (generated, committed to git) | ~1.4 MB |

That's the **entire** data footprint needed to run this app anywhere: **~81 MB**, none
of it the `to JD/` tree. csv and xlsx are never stored at rest for the 79 canonical
countries — `/api/download` generates each one on first request straight from the
master parquet (`scripts/pp_lib/formats.py`) and caches it under
`app/on_demand_cache/` (gitignored, regenerable, never shipped). Drill-down queries
run the same way: **DuckDB directly against the master parquet**, `country_iso2`
pushed into the scan. No `.sql` dump anywhere (it would be *larger* than the CSVs and
unusable until imported).

Locally, with the full `to JD/` tree present, none of this changes anything you'd
notice — `MASTER_PARQUET` defaults to `to JD/pipeline/data/clean/postal_codes_final.parquet`
unless `$POSTAL_PORTAL_MASTER_PARQUET` says otherwise. The Drive sync only matters for
a host that doesn't have `to JD/` at all — see **Deploying** below.

## Adding new data

Drop a new or revised file into **`to JD/數據更新/`** — that folder always wins over
any batch file (highest `_v` number wins if there's more than one), so it's the
drop-zone for both a correction to an existing country and a country you haven't
seen before. Then re-run the pipeline chain, each stage feeding the next:

```bash
cd "/Users/jeff/Downloads/to JD/pipeline"
python3 scripts/discover_files.py    # rescans every batch folder -> file_manifest.csv
python3 scripts/ingest.py            # column-maps the new file -> canonical_raw.parquet
python3 scripts/enrich.py            # iso3/continent/country_lc/region_1 backfill
python3 scripts/validate.py          # drops blank-postal-code rows -> postal_codes_final.parquet
python3 scripts/write_output.py      # regenerates postal_codes_all.csv + all by_country/*.csv
python3 scripts/export_xlsx.py       # regenerates XLSX (pass ISO2 codes to scope it, e.g. `FR IT`)
python3 scripts/audit_integrity.py   # read-only adversarial check -- run this every time
```

Then bring Postal Portal up to date (dev machine, full `to JD/` access required —
`build_catalog.py` is never run on a deploy host):

```bash
cd "/Users/jeff/Downloads/Postal Portal"
.venv/bin/python scripts/build_catalog.py
```

This regenerates `app/catalog.json` and `app/raw_sources/`, and warms
`app/on_demand_cache/` for every country/format (which is also how it records
accurate download sizes — expect this step to take several minutes, not seconds:
writing CA's and IL's XLSX is genuinely slow, openpyxl stamping a per-cell text format
on 892,800 and 579,268 rows respectively — the same cost the old `export_xlsx.py` always
had, just paid here instead). Commit the result (`catalog.json` + `app/raw_sources/`
are tiny, both meant to be committed) and push.

If a deploy host is running against a Drive-synced master parquet rather than
`to JD/`, upload the new `postal_codes_final.parquet` to the same Drive file
(replace its content, keeping the same file ID) and have the host re-run
`scripts/sync_from_drive.py`, then clear `app/on_demand_cache/` so stale
pre-generated csv/xlsx aren't served alongside the new data — `rm -rf
app/on_demand_cache/*` and let the next requests regenerate.

Restart the API afterward either way — it loads `catalog.json` once at startup:

```bash
pkill -f "uvicorn server.main:app"
.venv/bin/uvicorn server.main:app --port 8000 &
```

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

One row per country: checkbox, name (with native-script name), ISO2, region, admin
depth, postal-code count, last-updated date, and a download button. Every column sorts;
filter by region, status, or free text over name/ISO2/ISO3.

Tick several countries and the footer streams them as one zip. The size shown is the
real total for the selected format, so a 400 MB pick is visible before you start it.

**Last updated** is the filesystem mtime of the country's authoritative source file
under `../to JD/`, resolved through the pipeline's own
`data/interim/version_resolution.csv` (which picks one file per country: a `數據更新`
revision beats a batch file, highest version wins). The full date and the source
filename are in the row's tooltip.

**Admin depth** is the deepest `region_N` level that actually holds data — not the
number of columns present. Several files declare a level and leave it entirely blank.

## The 9 countries without postal codes

BO, CD, CG, CM, ML, QA, SR, TG, UG each have a delivered file whose postal-code column
is absent or 100 % blank, so the pipeline excluded them and they have no canonical
output. Their source files still carry a real region hierarchy (2–4 levels) and
coordinates, so **the app serves JD's original file for them**, marked `RAW` — copied
into `app/raw_sources/` by `build_catalog.py` (~1.4 MB total, committed to git) rather
than referenced under `to JD/`, which a deploy host won't have:

- Un-normalized — each file has its own column names and encoding (SR uses GeoNames-style
  `order1_name`; QA's local-language columns are mojibake in the source).
- Available as CSV always, XLSX for 7 of the 9 (ML and TG have no XLSX).
- No row preview, because there is nothing in the canonical dataset to preview. The
  drawer lists the source file's columns and level fill rates instead.
- In a mixed zip they are flagged `[RAW SOURCE]` in `MANIFEST.txt`.

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

| Endpoint | Notes |
|---|---|
| `GET /api/catalog` | The whole catalog. |
| `GET /api/country/{iso2}/preview?limit=&q=` | DuckDB over the master parquet. `q` matches postal code, place, or any region name. 404 for unknown ISO2; empty result for the raw-source countries. |
| `GET /api/download/{iso2}?fmt=csv\|xlsx\|parquet` | 409 if that country has no file in that format, with the formats it does have. |
| `POST /api/bundle` | `{"iso2": [...], "fmt": "..."}` → streaming zip plus a `MANIFEST.txt`. CSV bundles are deflated (444 MB of CSV → 24 MB); XLSX/parquet are stored and carry a `Content-Length`. |

Interactive docs at `/api/docs`.

Downloads never assemble a path from request input. For the 79 canonical countries,
`fmt` and `iso2` select a DuckDB query against the master parquet
(`scripts/pp_lib/formats.py:materialize`), cached to `app/on_demand_cache/<ISO2>.<fmt>`
after first generation; for the 9 raw-source countries, they select an entry in a
table built from the catalog at startup, pointing into `app/raw_sources/`. The app
only ever writes inside `app/`.

## Layout

```
scripts/build_catalog.py     dev-machine-only build step (needs full to JD/ access)
scripts/sync_from_drive.py   fetches the master parquet on a deploy host
scripts/pp_lib/formats.py    shared csv/xlsx/parquet generation (build-time + runtime)
app/catalog.json             generated, committed
app/raw_sources/             generated, committed (~1.4 MB)
app/data/                    gitignored -- the synced master parquet lives here
app/on_demand_cache/         gitignored -- generated csv/xlsx/parquet, per environment
server/main.py                FastAPI
web/                          Vite + React + TypeScript
web/public/vendor/            countries-110m.json (Natural Earth 110m, vendored for offline use)
data/                         pre-existing, unused by the running app -- see .gitignore
```

Local dev defaults to reading the sibling `../to JD/` tree for the master parquet;
`$POSTAL_PORTAL_MASTER_PARQUET` overrides it (what a deploy host without `to JD/`
sets, after `sync_from_drive.py`). `build_catalog.py` always needs the full tree —
it's a dev-machine-only step, never run on a deploy host.
