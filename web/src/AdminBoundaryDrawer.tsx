import { useEffect, useState } from 'react'
import type { AdminBoundaryCountry } from './types'
import { adminSampleCsvUrl } from './api'
import { parseCsv } from './csv'
import { bytes, yearOnly } from './format'

// A sibling of CountryDrawer.tsx, not an extension of it -- same visual
// language (drawer/table/meta classes from index.css) but a different data
// shape and a much simpler job. CountryDrawer runs live DuckDB-WASM queries
// against a country's full parquet file, with search. This dataset doesn't
// need that machinery: there's no live querying here, just a static parse of
// the same 100-row sample CSV that's already committed to git and already
// linked from AdminBoundaryTable.tsx's download column -- see this file's
// task doc for why duckdb was deliberately not used.

/** True if every row's value in this column position is blank. Computed from
 *  the fetched sample only (up to 100 rows), not from the full source file --
 *  cheap, and good enough to keep the table from being dominated by columns
 *  that happen to be entirely empty in the rows we can actually show. A
 *  country whose deeper tiers only appear after row 100 will have those
 *  columns hidden here even though the full file has data in them; the
 *  drawer is explicitly a preview of the sample, not a claim about the whole
 *  file, so that's an acceptable trade for a readable table. */
function nonEmptyColumns(header: string[], rows: string[][]): boolean[] {
  return header.map((_, i) => rows.some((r) => (r[i] ?? '').trim() !== ''))
}

export default function AdminBoundaryDrawer({
  country,
  onClose,
}: {
  country: AdminBoundaryCountry
  onClose: () => void
}) {
  const [header, setHeader] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(adminSampleCsvUrl(country.code))
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        return res.text()
      })
      .then((text) => {
        if (cancelled) return
        const parsed = parseCsv(text)
        setHeader(parsed.header)
        setRows(parsed.rows)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [country.code])

  const keep = nonEmptyColumns(header, rows)
  const visibleCols = header.map((col, i) => ({ col, i })).filter(({ i }) => keep[i])

  return (
    <div
      className="drawer-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="presentation"
    >
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`${country.name_en} detail`}>
        <header>
          <div style={{ flex: 1 }}>
            <h2>
              {country.name_en} <span className="iso-badge">{country.code}</span>
            </h2>
            <div className="sub">
              {country.name_lc && country.name_lc !== country.name_en && `${country.name_lc} · `}
              Tier {country.max_tier}
            </div>
          </div>
          <span className="dl-buttons">
            {country.sample_csv && (
              <a
                href={adminSampleCsvUrl(country.code)}
                download
                title={`First ${country.sample_csv.rows} rows only -- see the sidebar's zip download for more`}
              >
                Sample CSV {bytes(country.sample_csv.bytes)}
              </a>
            )}
          </span>
          <button type="button" className="close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="drawer-meta">
          <div>
            <div className="k">Max tier</div>
            <div className="v">{country.max_tier}</div>
          </div>
          <div>
            <div className="k">Leaf records</div>
            <div className="v">{country.total_rows.toLocaleString('en-US')}</div>
          </div>
          <div>
            <div className="k">Last updated</div>
            <div className="v">{yearOnly(country.last_updated)}</div>
          </div>
        </div>

        <div className="preview" style={{ gridTemplateRows: 'auto minmax(0, 1fr)' }}>
          <div className="preview-controls">
            <span className="matched">
              {loading
                ? 'loading…'
                : error
                  ? ''
                  : `showing first ${rows.length.toLocaleString('en-US')} of ${country.total_rows.toLocaleString('en-US')} rows`}
            </span>
          </div>

          <div className="preview-scroll">
            {error ? (
              <div className="state error">{error}</div>
            ) : (
              <table className="rows">
                <thead>
                  <tr>
                    {visibleCols.map(({ col }) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, r) => (
                    <tr key={r}>
                      {visibleCols.map(({ col, i }) => (
                        <td key={col} className={row[i] ? undefined : 'blank'}>
                          {row[i] || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}
