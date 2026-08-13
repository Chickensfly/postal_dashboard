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

export function monthsAgo(iso: string, now = new Date()): number {
  const d = new Date(`${iso}T00:00:00Z`)
  return (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
}
