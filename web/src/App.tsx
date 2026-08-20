import { useEffect, useMemo, useRef, useState } from 'react'
import WorldMap from './WorldMap'
import CountryTable from './CountryTable'
import { compare, type Sort, type SortKey } from './sorting'
import { BIN_LABELS, RAMP_VARS } from './mapScale'
import CountryDrawer from './CountryDrawer'
import { fetchCatalog } from './api'
import { compactRows, prettyDate } from './format'
import type { Catalog } from './types'

type Theme = 'light' | 'dark' | null

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [region, setRegion] = useState('all')
  const [status, setStatus] = useState<'all' | 'covered' | 'delivered_no_data'>('all')
  const [sort, setSort] = useState<Sort>({ key: 'name_en', dir: 'asc' })
  const [focused, setFocused] = useState<string | null>(null)
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

  const focusCountry = (iso2: string) => {
    setFocused(iso2)
    rowRefs.current[iso2]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  if (error && !catalog) {
    return (
      <div className="state error">
        <div>
          <p>
            <strong>Could not load the catalog.</strong>
          </p>
          <p>{error}</p>
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
          </div>

          <CountryTable
            rows={visible}
            sort={sort}
            onSort={(key: SortKey) =>
              setSort((s) =>
                s.key === key
                  ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
                  : { key, dir: key === 'rows' || key === 'last_updated' ? 'desc' : 'asc' },
              )
            }
            focused={focused}
            onFocus={focusCountry}
            rowRefs={rowRefs}
          />
        </section>
      </div>

      {focusedCountry && (
        <CountryDrawer country={focusedCountry} onClose={() => setFocused(null)} />
      )}
    </div>
  )
}
