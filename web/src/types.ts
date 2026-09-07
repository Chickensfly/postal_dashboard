export type Format = 'csv' | 'xlsx' | 'parquet'

/** "all_rows" (the default everywhere) is never sent by the UI explicitly -- it's
 *  what every country already behaves as. These two are the pilot toggle states. */
export type View = 'postal_codes' | 'admin_areas'

export type FileEntry = {
  bytes: number
  /** True when this is JD's original source file rather than pipeline output. */
  raw?: boolean
  /** Filename as served (source files keep their JD_<ISO2> name). */
  name?: string
}

export type AdminLevel = {
  level: number
  label: string
  filled_pct: number
  has_en: boolean
  has_lc: boolean
}

export type Country = {
  iso2: string
  iso3: string | null
  iso_numeric: string | null
  name_en: string
  name_lc: string | null
  continent_code: string | null
  continent_name: string | null
  /** `covered` = usable postal codes. `delivered_no_data` = a file exists but its
   *  postal_code column is absent or 100% blank, so there is nothing to download. */
  status: 'covered' | 'delivered_no_data'
  last_updated: string
  source_file: string
  source_batch: string
  source_rows: number
  rows: number
  admin_depth: number
  admin_levels: AdminLevel[]
  coord_coverage_pct: number
  has_place_name: boolean
  postal_code_example: string | null
  region_1_iso_coverage_pct: number
  files: Partial<Record<Format, FileEntry>>
  /** Set on the countries with no usable postal codes: every entry in `files` is
   *  JD's un-normalized source file, kept for its admin levels and coordinates. */
  files_are_source?: boolean
  /** Columns present in that source file (raw countries only). */
  source_columns?: string[]
  note?: string
  /** Present only for the small pilot set of countries (see build_catalog.py's
   *  PILOT_COUNTRIES) offering the postal-codes/admin-areas split. Its absence is
   *  exactly the signal the UI uses to hide the view toggle for every other country. */
  view_stats?: Record<View, { rows: number }>
  view_files?: Record<View, Partial<Record<Format, FileEntry>>>
  /** Populated by scripts/link_drive_files.py against a Drive folder you maintain
   *  yourself -- absent until that's been run for this country. Always scoped to
   *  all-rows (the postal-codes/admin-areas split stays parquet-only; see that
   *  script's docstring), so these links don't change with the view toggle. */
  drive_links?: Partial<Record<'csv' | 'xlsx', string>>
  /** First 100 rows, committed directly to git (web/public/samples/<ISO2>.csv) --
   *  present for every country regardless of its full size, since some (CA, IL)
   *  exceed GitHub's 100 MB per-file limit in full. What the sidebar's bulk
   *  "select several, download as one zip" feature bundles. */
  sample_csv?: { bytes: number; rows: number }
}

export type Catalog = {
  generated_at: string
  totals: {
    countries: number
    countries_with_files: number
    delivered_no_data: number
    rows: number
    continents: string[]
    last_updated_range: [string, string]
    download_bytes: Record<Format, number>
  }
  countries: Country[]
}

export type Preview = {
  iso2: string
  columns: string[]
  rows: (string | number | null)[][]
  matched: number
  truncated: boolean
}

/** Admin Boundaries -- a wholly separate, standalone dataset: administrative-
 *  boundary reference data (country -> region1 -> region2 -> ... -> region6,
 *  e.g. states/provinces/districts/villages) for 91 countries, with no postal
 *  codes involved. Not to be confused with `View`/'admin_areas' above, which is
 *  a completely different, pre-existing feature (a per-country dedup toggle on
 *  the postal-codes data, inside CountryDrawer.tsx) -- these types, and every
 *  component that uses them, are named distinctly on purpose. Produced by
 *  scripts/build_admin_boundaries_catalog.py; keep this in sync with whatever
 *  that script actually emits. */
export type AdminBoundaryLevel = { level: number; unit_count: number }

export type AdminBoundaryCountry = {
  code: string
  /** ISO 3166-1 numeric -- the join key AdminBoundaryMap.tsx uses against the
   *  same world-atlas TopoJSON WorldMap.tsx already loads. */
  iso_numeric: string | null
  name_en: string
  name_lc: string | null
  /** Deepest region level (1-6) with at least one non-blank value. */
  max_tier: number
  /** One entry per level from 1 to max_tier: the count of distinct admin units
   *  at that level, counted by unique parent chain (the tuple of
   *  region1..regionN), not a naive distinct-value count on that column alone. */
  level_counts: AdminBoundaryLevel[]
  /** Leaf-level record count in this country's source file. */
  total_rows: number
}

export type AdminBoundaryCatalog = {
  generated_at: string
  totals: { countries: number; total_leaf_records: number; max_tier_reached: number }
  countries: AdminBoundaryCountry[]
}
