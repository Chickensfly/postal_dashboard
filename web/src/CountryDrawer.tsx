import { useEffect, useState } from 'react'
import type { Country, Preview } from './types'
import { parquetUrl, sampleCsvUrl } from './api'
import { queryParquet } from './duckdb'
import { bytes, yearOnly } from './format'

// Same columns the old server-side search scanned -- postal code fields, place
// name, and every region_N_en/lc pair. Ordered widest-value-first for readability.
const SEARCHABLE = [
  'postal_code',
  'postal_code_norm',
  'place_name',
  ...[1, 2, 3, 4, 5].flatMap((n) => [`region_${n}_en`, `region_${n}_lc`]),
]

// This runs directly against the country's all-rows parquet file -- unlike the
// old server, which joined back to the master parquet.
async function searchCountry(
  url: string,
  q: string,
  limit: number,
): Promise<Preview> {
  const needle = q.trim()
  let whereSql = ''
  let params: unknown[] = []
  if (needle) {
    const escaped = needle.replace(/[\\%_]/g, (c) => `\\${c}`)
    // CAST to VARCHAR: a region_N column beyond a country's actual admin depth is
    // entirely NULL, and DuckDB's parquet reader infers an all-null column as
    // DOUBLE (there's no non-null value to infer a string type from) -- ILIKE has
    // no DOUBLE overload, so querying it uncast throws a binder error rather than
    // just finding no match. Casting makes every column searchable uniformly
    // regardless of how an empty one happened to get typed.
    whereSql = `WHERE ${SEARCHABLE.map((c) => `CAST(${c} AS VARCHAR) ILIKE ? ESCAPE '\\'`).join(' OR ')}`
    params = SEARCHABLE.map(() => `%${escaped}%`)
  }
  const [rows, countRow] = await Promise.all([
    queryParquet<Record<string, unknown>>(
      url,
      `SELECT * FROM read_parquet('$file') ${whereSql} LIMIT ${limit}`,
      params,
    ),
    queryParquet<{ n: bigint | number }>(
      url,
      `SELECT count(*) AS n FROM read_parquet('$file') ${whereSql}`,
      params,
    ),
  ])
  const columns = rows.length > 0 ? Object.keys(rows[0]) : []
  const matched = Number(countRow[0]?.n ?? 0)
  return {
    iso2: '',
    columns,
    rows: rows.map((r) => columns.map((c) => r[c] as string | number | null)),
    matched,
    truncated: matched > rows.length,
  }
}

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

  // Reset the query when switching countries, so a stale search doesn't silently
  // carry over to the next one.
  useEffect(() => {
    setQuery('')
  }, [country.iso2])

  useEffect(() => {
    if (country.status !== 'covered') {
      setPreview(null)
      return
    }
    let cancelled = false
    const url = parquetUrl(country.iso2)
    const timer = setTimeout(() => {
      setLoading(true)
      setError(null)
      searchCountry(url, query, 100)
        .then((p) => !cancelled && setPreview(p))
        .catch((e: Error) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setLoading(false))
    }, query ? 220 : 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [country.iso2, country.status, query])

  const activeRows = country.rows

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
          {/* Sample only, deliberately -- the full file (raw JD source or the
              canonical CSV/XLSX) is never offered from the UI, covered country
              or not. See CountryTable.tsx's quickDownload for the matching
              per-row behavior. */}
          <span className="dl-buttons">
            {country.sample_csv && (
              <a
                href={sampleCsvUrl(country.iso2)}
                download
                title={`First ${country.sample_csv.rows} rows only`}
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
            <div className="k">{country.files_are_source ? 'Source rows' : 'Postal codes'}</div>
            <div className="v">
              {(country.files_are_source ? country.source_rows : activeRows).toLocaleString(
                'en-US',
              )}
              {country.files_are_source && (
                <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>no postal codes</div>
              )}
            </div>
          </div>
          <div>
            <div className="k">Last updated</div>
            <div className="v">{yearOnly(country.last_updated)}</div>
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
                previewed here. The Sample CSV above is the first{' '}
                {country.sample_csv?.rows ?? 100} rows of JD&apos;s original{' '}
                <code>{country.source_file}</code> ({country.source_batch}), kept for the
                administrative levels and coordinates below.
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
