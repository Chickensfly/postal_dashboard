import type { AdminBoundaryCountry, Country } from './types'

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

// --- Admin Boundaries: a separate sort key set for a separate row type (see
// types.ts's AdminBoundaryCountry doc comment) -- kept apart from SortKey/Sort/
// compare above rather than folded in, since the two row shapes barely overlap
// (no `rows`/`admin_depth`/`continent_name` here) and existing postal-code sort
// keys must not change.
export type AdminBoundarySortKey = 'name_en' | 'code' | 'max_tier' | 'total_rows'

export type AdminBoundarySort = { key: AdminBoundarySortKey; dir: 'asc' | 'desc' }

export function compareAdminBoundary(
  a: AdminBoundaryCountry,
  b: AdminBoundaryCountry,
  sort: AdminBoundarySort,
): number {
  const flip = sort.dir === 'asc' ? 1 : -1
  const av = a[sort.key]
  const bv = b[sort.key]
  if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * flip
  return String(av ?? '').localeCompare(String(bv ?? ''), 'en') * flip
}
