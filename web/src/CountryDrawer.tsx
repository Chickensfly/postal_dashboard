import { useEffect, useState } from 'react'
import type { Country, Format, Preview } from './types'
import { fetchPreview, downloadUrl } from './api'
import { bytes, prettyDate, sizeOf } from './format'

const FORMATS: Format[] = ['csv', 'xlsx', 'parquet']
const FORMAT_LABEL: Record<Format, string> = { csv: 'CSV', xlsx: 'XLSX', parquet: 'Parquet' }

export default function CountryDrawer({
  country,
  onClose,
}: {
  country: Country
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Reset the query when switching countries, so a stale search doesn't hide rows.
  useEffect(() => setQuery(''), [country.iso2])

  useEffect(() => {
    if (country.status !== 'covered') {
      setPreview(null)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setLoading(true)
      setError(null)
      fetchPreview(country.iso2, query, 100, controller.signal)
        .then(setPreview)
        .catch((e: Error) => e.name !== 'AbortError' && setError(e.message))
        .finally(() => setLoading(false))
    }, query ? 220 : 0)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [country.iso2, country.status, query])

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
              {country.name_en} <span className="iso-badge">{country.iso2}</span>
            </h2>
            <div className="sub">
              {country.name_lc && country.name_lc !== country.name_en && `${country.name_lc} · `}
              {country.continent_name} · {country.iso3}
            </div>
          </div>
          <span className="dl-buttons">
            {FORMATS.filter((fmt) => country.files[fmt]).map((fmt) => (
              <a
                key={fmt}
                href={downloadUrl(country.iso2, fmt)}
                className={fmt === 'csv' ? 'warn' : undefined}
                title={
                  fmt === 'csv'
                    ? 'Excel strips leading zeros from CSVs — use XLSX for Excel'
                    : undefined
                }
                download
              >
                {FORMAT_LABEL[fmt]} {bytes(sizeOf(country, fmt))}
                {country.files_are_source && <span className="raw-tag">raw</span>}
              </a>
            ))}
          </span>
          <button type="button" className="close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="drawer-meta">
          <div>
            <div className="k">{country.files_are_source ? 'Source rows' : 'Postal codes'}</div>
            <div className="v">
              {(country.files_are_source ? country.source_rows : country.rows).toLocaleString(
                'en-US',
              )}
              {country.files_are_source && (
                <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>no postal codes</div>
              )}
            </div>
          </div>
          <div>
            <div className="k">Last updated</div>
            <div className="v">{prettyDate(country.last_updated)}</div>
          </div>
          <div>
            <div className="k">Source file</div>
            <div className="v" style={{ fontSize: 12 }}>
              {country.source_file}
              <div style={{ color: 'var(--text-muted)' }}>{country.source_batch}</div>
            </div>
          </div>
          <div>
            <div className="k">Coordinates</div>
            <div className="v">{country.coord_coverage_pct}% of rows</div>
          </div>
          <div>
            <div className="k">Example code</div>
            <div className="v">{country.postal_code_example ?? '—'}</div>
          </div>
          <div>
            <div className="k">ISO 3166-2 match</div>
            <div className="v">{country.region_1_iso_coverage_pct}%</div>
          </div>
        </div>

        {country.status === 'covered' ? (
          <div className="preview">
            <div className="levels">
              <div className="k" style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 6 }}>
                ADMINISTRATIVE LEVELS ({country.admin_depth})
              </div>
              {country.admin_levels.map((lvl) => (
                <div className="lvl" key={lvl.level}>
                  <span>
                    {lvl.label}
                    <span style={{ color: 'var(--text-muted)' }}>
                      {' '}
                      {lvl.has_en && lvl.has_lc ? 'en+local' : lvl.has_en ? 'en' : 'local'}
                    </span>
                  </span>
                  <span className="bar">
                    <span style={{ width: `${lvl.filled_pct}%` }} />
                  </span>
                  <span className="pct">{lvl.filled_pct}%</span>
                </div>
              ))}
            </div>

            <div className="preview-controls">
              <input
                type="search"
                value={query}
                placeholder="Search postal codes, places or regions…"
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className="matched">
                {loading
                  ? 'searching…'
                  : preview
                    ? `${preview.matched.toLocaleString('en-US')} match${preview.matched === 1 ? '' : 'es'}${
                        preview.truncated ? ` · showing ${preview.rows.length}` : ''
                      }`
                    : ''}
              </span>
              
            </div>

            <div className="preview-scroll">
              {error ? (
                <div className="state error">{error}</div>
              ) : (
                <table className="rows">
                  <thead>
                    <tr>
                      {preview?.columns.map((col) => (
                        <th key={col}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview?.rows.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j} className={cell === null || cell === '' ? 'blank' : undefined}>
                            {cell === null || cell === '' ? '—' : String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : (
          <div style={{ overflow: 'auto', minHeight: 0 }}>
            <div className="raw-banner">
              <span className="dot" aria-hidden="true">
                ⚠
              </span>
              <span>
                <strong>Raw source file.</strong> {country.name_en} has no usable postal codes —
                its postal-code column is absent or entirely blank across{' '}
                {country.source_rows.toLocaleString('en-US')} rows, confirmed in both the CSV and
                XLSX where both exist — so it is not part of the canonical dataset and cannot be
                previewed here. The download is JD&apos;s original{' '}
                <code>{country.source_file}</code> ({country.source_batch}) with its own column
                names and encoding, kept for the administrative levels and coordinates below.
              </span>
            </div>

            {country.admin_levels.length > 0 && (
              <div className="levels">
                <div
                  className="k"
                  style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 6 }}
                >
                  ADMINISTRATIVE LEVELS IN THE SOURCE FILE ({country.admin_depth})
                </div>
                {country.admin_levels.map((lvl) => (
                  <div className="lvl" key={lvl.level}>
                    <span>
                      {lvl.label}
                      <span style={{ color: 'var(--text-muted)' }}>
                        {' '}
                        {lvl.has_en && lvl.has_lc ? 'en+local' : lvl.has_en ? 'en' : 'local'}
                      </span>
                    </span>
                    <span className="bar">
                      <span style={{ width: `${lvl.filled_pct}%` }} />
                    </span>
                    <span className="pct">{lvl.filled_pct}%</span>
                  </div>
                ))}
              </div>
            )}

            {country.source_columns && (
              <div className="source-columns">
                <div
                  className="k"
                  style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 4 }}
                >
                  COLUMNS IN THE SOURCE FILE ({country.source_columns.length})
                </div>
                {country.source_columns.map((col) => (
                  <code key={col}>{col}</code>
                ))}
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  )
}
