import type { Country, Format } from './types'

export const compactRows = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n.toLocaleString('en-US')

export function bytes(n: number): string {
  if (n <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

export const sizeOf = (c: Country, fmt: Format) => c.files[fmt]?.bytes ?? 0

/** "2025-09-29" -> "29 Sep 2025". Parsed as UTC so the date never shifts a day. */
export function prettyDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** "2025-09-29" -> "29 Sep 25". The sidebar's Updated column, where a 4-digit
 *  year costs more width than it adds -- the full date is in the tooltip. */
export function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  })
}

/** "2025-09-29" -> "2025". A plain slice, not a Date parse, since the source is
 *  already an ISO string. The default precision everywhere the Year/Month
 *  toggle (see DatePrecision below) applies. */
export function yearOnly(iso: string): string {
  return iso.slice(0, 4)
}

/** A last-updated range collapsed to year(s): "2025" when both ends fall in the
 *  same year, "2025 – 2026" otherwise. */
export function yearRange(start: string, end: string): string {
  const a = yearOnly(start)
  const b = yearOnly(end)
  return a === b ? a : `${a} – ${b}`
}

/** "2025-09-29" -> "Sep 2025". Parsed as UTC so the date never shifts a day --
 *  same convention as prettyDate/shortDate above. */
export function monthYear(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** A last-updated range collapsed to month+year: "Sep 2025" when both ends fall
 *  in the same month, "Sep 2025 – Aug 2026" otherwise. Mirrors yearRange's
 *  collapsing logic one precision level down. */
export function monthYearRange(start: string, end: string): string {
  const a = monthYear(start)
  const b = monthYear(end)
  return a === b ? a : `${a} – ${b}`
}

/** The app-wide "last updated" precision preference (App.tsx's Year/Month
 *  toggle) -- threaded down to every component that displays a last_updated
 *  value or range, so one toggle controls all of them at once. */
export type DatePrecision = 'year' | 'month'

/** A single last-updated date at the given precision -- what every "Updated"
 *  cell/stat renders instead of calling yearOnly directly. */
export function updatedAt(iso: string, precision: DatePrecision): string {
  return precision === 'month' ? monthYear(iso) : yearOnly(iso)
}

/** A last-updated range at the given precision -- the masthead totals' version
 *  of updatedAt above. */
export function updatedRange(start: string, end: string, precision: DatePrecision): string {
  return precision === 'month' ? monthYearRange(start, end) : yearRange(start, end)
}

export function monthsAgo(iso: string, now = new Date()): number {
  const d = new Date(`${iso}T00:00:00Z`)
  return (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
}
