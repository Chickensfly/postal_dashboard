import type { Country, Format } from './types'
import { bytes, prettyDate, shortDate, sizeOf } from './format'
import { downloadUrl } from './api'
import type { Sort, SortKey } from './sorting'

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'name_en', label: 'Country' },
  { key: 'iso2', label: 'ISO2' },
  { key: 'continent_name', label: 'Region' },
  { key: 'admin_depth', label: 'Admin' },
  { key: 'rows', label: 'Codes', numeric: true },
  { key: 'last_updated', label: 'Updated', numeric: true },
]

const FORMAT_LABEL: Record<Format, string> = { csv: 'CSV', xlsx: 'XLSX', parquet: 'PQ' }

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

type Props = {
  rows: Country[]
  /** Format the per-row download button uses — shared with the bulk footer. */
  fmt: Format
  sort: Sort
  onSort: (key: SortKey) => void
  selectedRows: Set<string>
  onToggleRow: (iso2: string) => void
  onToggleAll: () => void
  allSelected: boolean
  focused: string | null
  onFocus: (iso2: string) => void
  rowRefs: React.RefObject<Record<string, HTMLTableRowElement | null>>
}

export default function CountryTable({
  rows,
  fmt,
  sort,
  onSort,
  selectedRows,
  onToggleRow,
  onToggleAll,
  allSelected,
  focused,
  onFocus,
  rowRefs,
}: Props) {
  return (
    <div className="table-scroll">
      <table className="countries">
        <thead>
          <tr>
            <th className="col-check">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                aria-label="Select all listed countries with data"
              />
            </th>
            {COLUMNS.map((col) => (
              <th key={col.key} className={col.numeric ? 'col-num' : undefined}>
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
            const available = !!c.files[fmt]
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
                <td className="col-check">
                  <input
                    type="checkbox"
                    checked={selectedRows.has(c.iso2)}
                    disabled={!available}
                    onChange={() => onToggleRow(c.iso2)}
                    aria-label={`Select ${c.name_en}`}
                  />
                </td>
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
                <td className="col-num" title={`${prettyDate(c.last_updated)} — ${c.source_file}`}>
                  {shortDate(c.last_updated)}
                </td>
                <td>
                  {available ? (
                    <span className="dl-buttons">
                      {/* One button, in whichever format the footer toggle selects, so
                          single and bulk downloads never disagree. All three formats
                          with their sizes are in the detail drawer. */}
                      <a
                        href={downloadUrl(c.iso2, fmt)}
                        className={fmt === 'csv' ? 'warn' : undefined}
                        title={[
                          `Download ${c.files[fmt]?.name ?? `${c.iso2}.${fmt}`} (${bytes(sizeOf(c, fmt))})`,
                          c.files_are_source
                            ? 'JD source file, un-normalized: admin levels and coordinates, no postal codes'
                            : '',
                          fmt === 'csv'
                            ? 'Excel strips leading zeros from CSVs; use XLSX for Excel'
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' — ')}
                        download
                      >
                        ⤓ {FORMAT_LABEL[fmt]}
                        {c.files_are_source && <span className="raw-tag">raw</span>}
                      </a>
                    </span>
                  ) : (
                    <span className="nodata-tag" title={`Not available as ${FORMAT_LABEL[fmt]}`}>
                      <span className="dot" aria-hidden="true" />
                      no {FORMAT_LABEL[fmt]}
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
