import type { Country, Format } from './types'
import { bytes, prettyDate, shortDate } from './format'
import { parquetUrl, rawSourceUrl } from './api'
import type { Sort, SortKey } from './sorting'

const COLUMNS: { key: SortKey; label: string; title?: string; numeric?: boolean }[] = [
  { key: 'name_en', label: 'Country' },
  { key: 'iso2', label: 'ISO2' },
  { key: 'continent_name', label: 'Region' },
  { key: 'admin_depth', label: 'Admin' },
  { key: 'rows', label: 'Codes', title: 'Postal-code rows in the canonical dataset', numeric: true },
  {
    key: 'admin_area_rows',
    label: 'Areas',
    title: 'Distinct admin-area combinations (region_1..5) -- see the Admin Areas download view',
    numeric: true,
  },
  { key: 'last_updated', label: 'Updated', numeric: true },
]

/** Abbreviated so the region column stays one line in the sidebar. */
const SHORT_REGION: Record<string, string> = {
  'North America': 'N. America',
  'South America': 'S. America',
}

function DepthBars({ depth }: { depth: number }) {
  return (
    <>
      <span className="depth" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => (
          <i
            key={n}
            className={n <= depth ? '' : 'off'}
            style={{ height: `${3 + n * 1.8}px` }}
          />
        ))}
      </span>
      <span className="depth-label">{depth > 0 ? `L${depth}` : '—'}</span>
    </>
  )
}

/** The one quick download this table offers per row -- all-rows parquet for a
 *  covered country, or the best available JD original for a no-postal-code one.
 *  Every other format/view combination is a click away in the detail drawer,
 *  which is also where CSV/XLSX (Drive-linked for covered countries) live. */
function quickDownload(c: Country): { fmt: Format; href: string; bytes: number } | null {
  if (c.files_are_source) {
    const fmt = (['xlsx', 'csv'] as Format[]).find((f) => c.files[f])
    if (!fmt) return null
    return { fmt, href: rawSourceUrl(c.files[fmt]!.name!), bytes: c.files[fmt]!.bytes }
  }
  if (!c.files.parquet) return null
  return { fmt: 'parquet', href: parquetUrl(c.iso2), bytes: c.files.parquet.bytes }
}

type Props = {
  rows: Country[]
  sort: Sort
  onSort: (key: SortKey) => void
  focused: string | null
  onFocus: (iso2: string) => void
  rowRefs: React.RefObject<Record<string, HTMLTableRowElement | null>>
}

export default function CountryTable({ rows, sort, onSort, focused, onFocus, rowRefs }: Props) {
  return (
    <div className="table-scroll">
      <table className="countries">
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th key={col.key} className={col.numeric ? 'col-num' : undefined} title={col.title}>
                <button type="button" onClick={() => onSort(col.key)}>
                  {col.label}
                  {sort.key === col.key && (
                    <span className="arrow">{sort.dir === 'asc' ? '▲' : '▼'}</span>
                  )}
                </button>
              </th>
            ))}
            <th>Download</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const covered = c.status === 'covered'
            const dl = quickDownload(c)
            return (
              <tr
                key={c.iso2}
                ref={(el) => {
                  rowRefs.current[c.iso2] = el
                }}
                className={[
                  focused === c.iso2 ? 'selected' : '',
                  covered ? '' : 'no-data',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <td>
                  <button
                    type="button"
                    className="country-name"
                    onClick={() => onFocus(c.iso2)}
                    style={{ background: 'none', border: 0, padding: 0, textAlign: 'left' }}
                  >
                    <span className="en">{c.name_en}</span>
                    {c.name_lc && c.name_lc !== c.name_en && (
                      <span className="lc">{c.name_lc}</span>
                    )}
                  </button>
                </td>
                <td>
                  <span className="iso-badge">{c.iso2}</span>
                </td>
                <td title={c.continent_name ?? undefined}>
                  {c.continent_name ? (SHORT_REGION[c.continent_name] ?? c.continent_name) : '—'}
                </td>
                <td>
                  <DepthBars depth={c.admin_depth} />
                </td>
                <td className="col-num" title={covered ? undefined : `${c.source_rows.toLocaleString('en-US')} source rows, none with a postal code`}>
                  {covered ? c.rows.toLocaleString('en-US') : '—'}
                </td>
                <td className="col-num">
                  {c.view_stats ? c.view_stats.admin_areas.rows.toLocaleString('en-US') : '—'}
                </td>
                <td className="col-num" title={`${prettyDate(c.last_updated)} — ${c.source_file}`}>
                  {shortDate(c.last_updated)}
                </td>
                <td>
                  {dl ? (
                    <span className="dl-buttons">
                      <a
                        href={dl.href}
                        title={[
                          `Download ${c.iso2}.${dl.fmt} (${bytes(dl.bytes)})`,
                          c.files_are_source
                            ? 'JD source file, un-normalized: admin levels and coordinates, no postal codes'
                            : 'All rows, Parquet — open the detail view for CSV/XLSX and the postal-codes/admin-areas split',
                        ].join(' — ')}
                        download
                      >
                        ⤓ {dl.fmt === 'parquet' ? 'PQ' : dl.fmt.toUpperCase()}
                        {c.files_are_source && <span className="raw-tag">raw</span>}
                      </a>
                    </span>
                  ) : (
                    <span className="nodata-tag" title="No download available">
                      <span className="dot" aria-hidden="true" />
                      none
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} style={{ padding: '18px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No countries match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
