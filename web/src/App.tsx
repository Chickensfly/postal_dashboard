import { useEffect, useMemo, useRef, useState } from 'react'
import WorldMap from './WorldMap'
import CountryTable from './CountryTable'
import { compare, type Sort, type SortKey } from './sorting'
import { BIN_LABELS, RAMP_VARS } from './mapScale'
import CountryDrawer from './CountryDrawer'
import { downloadBundle, fetchCatalog } from './api'
import { bytes, compactRows, prettyDate, sizeOf } from './format'
import type { Catalog, Country, Format } from './types'

const FORMATS: Format[] = ['csv', 'xlsx', 'parquet']
const FORMAT_LABEL: Record<Format, string> = { csv: 'CSV', xlsx: 'XLSX', parquet: 'Parquet' }

type Theme = 'light' | 'dark' | null

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [region, setRegion] = useState('all')
  const [status, setStatus] = useState<'all' | 'covered' | 'delivered_no_data'>('all')
  const [sort, setSort] = useState<Sort>({ key: 'name_en', dir: 'asc' })
  const [fmt, setFmt] = useState<Format>('xlsx')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [focused, setFocused] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [theme] = useState<Theme>('dark')

  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({})

  useEffect(() => {
    fetchCatalog().then(setCatalog).catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme
    else delete document.documentElement.dataset.theme
  }, [theme])

  const visible = useMemo(() => {
    if (!catalog) return []
    const needle = search.trim().toLowerCase()
    return catalog.countries
      .filter((c) => {
        if (region !== 'all' && c.continent_name !== region) return false
        if (status !== 'all' && c.status !== status) return false
        if (!needle) return true
        return (
          c.name_en.toLowerCase().includes(needle) ||
          c.iso2.toLowerCase().includes(needle) ||
          (c.iso3 ?? '').toLowerCase().includes(needle) ||
          (c.name_lc ?? '').toLowerCase().includes(needle)
        )
      })
      .sort((a, b) => compare(a, b, sort))
  }, [catalog, search, region, status, sort])

  // Selectable = has a file in the format the footer is set to. That includes the
  // no-postal-code countries, whose raw source files exist as csv (and mostly xlsx).
  const selectable = useMemo(
    () => visible.filter((c) => !!c.files[fmt]),
    [visible, fmt],
  )
  const allSelected =
    selectable.length > 0 && selectable.every((c) => checked.has(c.iso2))

  const selectedCountries = useMemo(() => {
    if (!catalog) return [] as Country[]
    return catalog.countries.filter((c) => checked.has(c.iso2))
  }, [catalog, checked])

  // A country checked in one format may not exist in another (ML and TG have no
  // xlsx), so the footer only ever counts and sends what the current format serves.
  const sendable = selectedCountries.filter((c) => !!c.files[fmt])
  const selectedRows = sendable.reduce((n, c) => n + c.rows, 0)
  const selectedBytes = sendable.reduce((n, c) => n + sizeOf(c, fmt), 0)
  const selectedRaw = sendable.filter((c) => c.files_are_source)

  const focusCountry = (iso2: string) => {
    setFocused(iso2)
    rowRefs.current[iso2]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  const toggleRow = (iso2: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (!next.delete(iso2)) next.add(iso2)
      return next
    })

  const toggleAll = () =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (allSelected) selectable.forEach((c) => next.delete(c.iso2))
      else selectable.forEach((c) => next.add(c.iso2))
      return next
    })

  const runBundle = async () => {
    setBusy(true)
    try {
      await downloadBundle(sendable.map((c) => c.iso2), fmt)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error && !catalog) {
    return (
      <div className="state error">
        <div>
          <p>
            <strong>Could not load the catalog.</strong>
          </p>
          <p>{error}</p>
          <p style={{ color: 'var(--text-secondary)' }}>
            Is the API running? <code>.venv/bin/uvicorn server.main:app --port 8000</code>
          </p>
        </div>
      </div>
    )
  }

  if (!catalog) return <div className="state">Loading catalog…</div>

  const { totals } = catalog
  const focusedCountry = focused ? catalog.countries.find((c) => c.iso2 === focused) : undefined

  return (
    <div className="app">
      <header className="masthead">
        <h1>Postal Portal</h1>
        <div className="totals">
          <span>
            <b>{totals.countries + totals.delivered_no_data}</b> countries
          </span>
          <span>
            <b>{totals.rows.toLocaleString('en-US')}</b> postal codes
          </span>
          <span>
            {prettyDate(totals.last_updated_range[0])} –{' '}
            {prettyDate(totals.last_updated_range[1])}
          </span>
        </div>
        <span className="spacer" />
      </header>

      <div className="body">
        <section className="map-pane">
          <WorldMap countries={catalog.countries} selected={focused} onSelect={focusCountry} />
          <div className="legend">
            <span className="ramp">
              <span>Postal codes</span>
              <span className="bins">
                {RAMP_VARS.map((v, i) => (
                  <span
                    key={v}
                    className="swatch"
                    style={{ background: `var(${v})` }}
                    title={BIN_LABELS[i]}
                  />
                ))}
              </span>
              <span>
                {BIN_LABELS[0]} → {BIN_LABELS[BIN_LABELS.length - 1]}
              </span>
            </span>
            <span className="cat">
              <span
                className="swatch"
                style={{
                  background:
                    'repeating-linear-gradient(45deg, var(--status-warning) 0 3px, transparent 3px 6px)',
                }}
              />
              No postal codes
            </span>
            <span className="cat">
              <span className="swatch" style={{ background: 'var(--map-absent)' }} />
              Not in the dataset
            </span>
          </div>
        </section>

        <section className="sidebar">
          <div className="controls">
            <input
              type="search"
              value={search}
              placeholder="Search country or ISO code…"
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search countries"
            />
            <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region">
              <option value="all">All regions</option>
              {totals.continents.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              aria-label="Status"
            >
              <option value="all">All statuses</option>
              <option value="covered">With postal codes</option>
              <option value="delivered_no_data">No usable codes</option>
            </select>
          </div>



          <div className="result-line">
            <span>
              {visible.length} of {totals.countries_with_files} countries ·{' '}
              {compactRows(visible.reduce((n, c) => n + c.rows, 0))} codes listed
            </span>
            {checked.size > 0 && (
              <button type="button" onClick={() => setChecked(new Set())}>
                clear selection
              </button>
            )}
          </div>



          <CountryTable
            rows={visible}
            fmt={fmt}
            sort={sort}
            onSort={(key: SortKey) =>
              setSort((s) =>
                s.key === key
                  ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
                  : { key, dir: key === 'rows' || key === 'last_updated' ? 'desc' : 'asc' },
              )
            }
            selectedRows={checked}
            onToggleRow={toggleRow}
            onToggleAll={toggleAll}
            allSelected={allSelected}
            focused={focused}
            onFocus={focusCountry}
            rowRefs={rowRefs}
          />

          <div className="selection-bar">
            <span className="summary">
              {checked.size === 0 ? (
                <>Select countries to download several at once.</>
              ) : (
                <>
                  <b>{sendable.length}</b> selected · <b>{compactRows(selectedRows)}</b> codes ·{' '}
                  <b>{bytes(selectedBytes)}</b> as {FORMAT_LABEL[fmt]}
                  {selectedRaw.length > 0 && (
                    <>
                      {' '}
                      · <b>{selectedRaw.length}</b> raw source
                    </>
                  )}
                  {sendable.length < checked.size && (
                    <>
                      {' '}
                      ·{' '}
                      <span style={{ color: 'var(--status-warning)' }}>
                        {checked.size - sendable.length} not available as {FORMAT_LABEL[fmt]}
                      </span>
                    </>
                  )}
                </>
              )}
            </span>
            <span className="fmt-group">
              {FORMATS.map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={fmt === f}
                  onClick={() => setFmt(f)}
                >
                  {FORMAT_LABEL[f]}
                </button>
              ))}
            </span>
            <button
              type="button"
              className="btn-primary"
              disabled={sendable.length === 0 || busy}
              onClick={runBundle}
            >
              {busy ? 'Zipping…' : `Download ${sendable.length || ''} as .zip`}
            </button>
            {fmt === 'csv' && (
              <span className="csv-note">
                <span className="dot">⚠</span> Excel re-strips leading zeros when a CSV is
                double-clicked (01067 → 1067). Use XLSX for Excel, or import the CSV with{' '}
                <em>Data ▸ Get Data ▸ From Text/CSV</em> and set <code>postal_code</code> to Text.
              </span>
            )}
          </div>
        </section>
      </div>

      {focusedCountry && (
        <CountryDrawer country={focusedCountry} onClose={() => setFocused(null)} />
      )}
    </div>
  )
}
