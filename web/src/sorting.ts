import type { Country } from './types'

export type SortKey =
  | 'name_en'
  | 'iso2'
  | 'continent_name'
  | 'rows'
  | 'admin_area_rows'
  | 'admin_depth'
  | 'last_updated'

export type Sort = { key: SortKey; dir: 'asc' | 'desc' }

// admin_area_rows isn't a top-level Country field (it's nested under
// view_stats.admin_areas.rows), so it needs a lookup rather than direct property
// access -- missing for the 9 no-postal-code countries, sorted as 0 either way.
function sortValue(c: Country, key: SortKey): string | number | null {
  if (key === 'admin_area_rows') return c.view_stats?.admin_areas.rows ?? 0
  return c[key]
}

export function compare(a: Country, b: Country, sort: Sort): number {
  const flip = sort.dir === 'asc' ? 1 : -1
  const av = sortValue(a, sort.key)
  const bv = sortValue(b, sort.key)
  if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * flip
  return String(av ?? '').localeCompare(String(bv ?? ''), 'en') * flip
}
