import type { Country } from './types'

export type SortKey =
  | 'name_en'
  | 'iso2'
  | 'continent_name'
  | 'rows'
  | 'admin_depth'
  | 'last_updated'

export type Sort = { key: SortKey; dir: 'asc' | 'desc' }

export function compare(a: Country, b: Country, sort: Sort): number {
  const flip = sort.dir === 'asc' ? 1 : -1
  const av = a[sort.key]
  const bv = b[sort.key]
  if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * flip
  return String(av ?? '').localeCompare(String(bv ?? ''), 'en') * flip
}
