export type Format = 'csv' | 'xlsx' | 'parquet'

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
