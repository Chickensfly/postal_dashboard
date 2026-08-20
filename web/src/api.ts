import type { Catalog, View } from './types'

// import.meta.env.BASE_URL is Vite's configured `base` (see vite.config.ts) --
// '/' locally, '/<repo-name>/' once deployed to a GitHub Pages project page. Every
// static asset path in this app goes through it so the site works unmodified at
// either location.
const BASE = import.meta.env.BASE_URL

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`)
  }
  return res.json() as Promise<T>
}

export const fetchCatalog = () => json<Catalog>(`${BASE}catalog.json`)

/** A country's static parquet file -- all-rows by default, or one of the
 *  postal_codes/admin_areas dedup views. Matches build_catalog.py's own naming
 *  (`<ISO2>.parquet`, `<ISO2>.<view>.parquet`) exactly -- it's what generates
 *  these files in the first place. */
export const parquetUrl = (iso2: string, view?: View) =>
  `${BASE}parquet/${iso2}${view ? `.${view}` : ''}.parquet`

/** A no-postal-code country's original JD source file, bundled directly in git
 *  (small enough not to need Drive -- see build_catalog.py's docstring). */
export const rawSourceUrl = (filename: string) => `${BASE}raw_sources/${filename}`
