import { useEffect, useMemo, useRef, useState } from 'react'
import WorldMap from './WorldMap'
import CountryTable from './CountryTable'
import AdminBoundaryMap from './AdminBoundaryMap'
import AdminBoundaryTable from './AdminBoundaryTable'
import {
  compare,
  compareAdminBoundary,
  type AdminBoundarySort,
  type AdminBoundarySortKey,
  type Sort,
  type SortKey,
} from './sorting'
import { ADMIN_BOUNDARY_BIN_LABELS, BIN_LABELS, RAMP_VARS } from './mapScale'
import CountryDrawer from './CountryDrawer'
import { fetchAdminBoundaryCatalog, fetchCatalog, sampleCsvUrl } from './api'
import { downloadSelectionZip } from './zip'
import { bytes, compactRows, updatedRange, type DatePrecision } from './format'
import type { AdminBoundaryCatalog, Catalog, Country } from './types'

type Theme = 'light' | 'dark' | null

// The dataset switcher's two panes. Deliberately not named after `View`
// ('postal_codes' | 'admin_areas' in types.ts) -- that type belongs to the
// unrelated, pre-existing per-country dedup toggle in CountryDrawer.tsx, and
// this is a top-level tab between two entirely separate datasets.
type Tab = 'postal' | 'admin_boundaries'

const ADMIN_BOUNDARIES_DRIVE_URL =
  'https://drive.google.com/drive/folders/1tnPFlp6gGrCYTkijdozqrbYpRyz9FFkS?usp=sharing'

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [region, setRegion] = useState('all')
  const [status, setStatus] = useState<'all' | 'covered' | 'delivered_no_data'>('all')
  const [sort, setSort] = useState<Sort>({ key: 'name_en', dir: 'asc' })
  const [focused, setFocused] = useState<string | null>(null)
  const [theme] = useState<Theme>('dark')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [zipping, setZipping] = useState(false)

  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({})

  const [tab, setTab] = useState<Tab>('postal')

  // App-wide "last updated" precision preference -- one toggle in the masthead
  // controls the postal-codes masthead stat, CountryTable's Updated column,
  // CountryDrawer's Updated stat, WorldMap's tooltip, and the admin-boundaries
  // equivalents of all four (see format.ts's DatePrecision doc comment).
  // Defaults to 'year' so today's behavior is unchanged until someone toggles it.
  const [precision, setPrecision] = useState<DatePrecision>('year')

  // Admin Boundaries -- a wholly separate dataset and catalog fetch from the
  // one above (see types.ts's AdminBoundaryCountry doc comment). Fetched
  // alongside the postal-codes catalog rather than lazily on first tab click:
  // its catalog.json is ~30 KB, cheap enough not to bother deferring.
  const [adminCatalog, setAdminCatalog] = useState<AdminBoundaryCatalog | null>(null)
  const [adminError, setAdminError] = useState<string | null>(null)
  const [adminSearch, setAdminSearch] = useState('')
  const [adminSort, setAdminSort] = useState<AdminBoundarySort>({ key: 'name_en', dir: 'asc' })
  const [adminFocused, setAdminFocused] = useState<string | null>(null)
  const adminRowRefs = useRef<Record<string, HTMLTableRowElement | null>>({})

  useEffect(() => {
    fetchCatalog().then(setCatalog).catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    fetchAdminBoundaryCatalog()
      .then(setAdminCatalog)
      .catch((e: Error) => setAdminError(e.message))
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

  // Selectable = has a sample CSV to put in the zip -- true for every country in
  // practice (build_catalog.py generates one for covered and raw-source alike),
  // but guarded rather than assumed.
  const selectable = useMemo(() => visible.filter((c) => !!c.sample_csv), [visible])
  const allSelected = selectable.length > 0 && selectable.every((c) => checked.has(c.iso2))

  const selectedCountries = useMemo(() => {
    if (!catalog) return [] as Country[]
    return catalog.countries.filter((c) => checked.has(c.iso2))
  }, [catalog, checked])
  const sendable = selectedCountries.filter((c) => !!c.sample_csv)

  const focusCountry = (iso2: string) => {
    setFocused(iso2)
    rowRefs.current[iso2]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  const adminVisible = useMemo(() => {
    if (!adminCatalog) return []
    const needle = adminSearch.trim().toLowerCase()
    return adminCatalog.countries
      .filter((c) => {
        if (!needle) return true
        return (
          c.name_en.toLowerCase().includes(needle) ||
          c.code.toLowerCase().includes(needle) ||
          (c.name_lc ?? '').toLowerCase().includes(needle)
        )
      })
      .sort((a, b) => compareAdminBoundary(a, b, adminSort))
  }, [adminCatalog, adminSearch, adminSort])

  const adminFocusCountry = (code: string) => {
    setAdminFocused(code)
    adminRowRefs.current[code]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
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

  const runZip = async () => {
    setZipping(true)
    try {
      await downloadSelectionZip(
        sendable.map((c) => ({ name: `${c.iso2}.csv`, url: sampleCsvUrl(c.iso2) })),
        `postal-portal-samples-${sendable.length}.zip`,
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setZipping(false)
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
        <span className="fmt-group" role="group" aria-label="Dataset">
          <button type="button" aria-pressed={tab === 'postal'} onClick={() => setTab('postal')}>
            Postal Codes
          </button>
          <button
            type="button"
            aria-pressed={tab === 'admin_boundaries'}
            onClick={() => setTab('admin_boundaries')}
          >
            Admin Levels
          </button>
        </span>
        {tab === 'postal' ? (
          <div className="totals">
            <span>
              <b>{totals.countries + totals.delivered_no_data}</b> countries
            </span>
            <span>
              <b>{totals.rows.toLocaleString('en-US')}</b> postal codes
            </span>
            <span>
              {updatedRange(totals.last_updated_range[0], totals.last_updated_range[1], precision)}
            </span>
          </div>
        ) : (
          adminCatalog && (
            <div className="totals">
              <span>
                <b>{adminCatalog.totals.countries}</b> countries
              </span>
              <span>
                <b>{adminCatalog.totals.total_leaf_records.toLocaleString('en-US')}</b> leaf records
              </span>
              <span>up to tier {adminCatalog.totals.max_tier_reached}</span>
              <span>
                {updatedRange(
                  adminCatalog.totals.last_updated_range[0],
                  adminCatalog.totals.last_updated_range[1],
                  precision,
                )}
              </span>
            </div>
          )
        )}
        {/*
        <span className="fmt-group" role="group" aria-label="Date precision">
          <button type="button" aria-pressed={precision === 'year'} onClick={() => setPrecision('year')}>
            Year
          </button>
          <button
            type="button"
            aria-pressed={precision === 'month'}
            onClick={() => setPrecision('month')}
          >
            Month
          </button>
        </span>
        */}
        <span className="spacer" />
      </header>

      <div className="body">
        {tab === 'postal' ? (
        <>
        <section className="map-pane">
          <WorldMap
            countries={catalog.countries}
            selected={focused}
            onSelect={focusCountry}
            precision={precision}
          />
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
            precision={precision}
          />

          <div className="selection-bar">
            <span className="summary">
              {checked.size === 0 ? (
                <>Select countries to download their sample CSVs (first 100 rows each) as one zip.</>
              ) : (
                <>
                  <b>{sendable.length}</b> selected ·{' '}
                  <b>{bytes(sendable.reduce((n, c) => n + (c.sample_csv?.bytes ?? 0), 0))}</b> as
                  sample CSVs
                  {sendable.length < checked.size && (
                    <>
                      {' '}
                      ·{' '}
                      <span style={{ color: 'var(--status-warning)' }}>
                        {checked.size - sendable.length} have no sample available
                      </span>
                    </>
                  )}
                </>
              )}
            </span>
            <button
              type="button"
              className="btn-primary"
              disabled={sendable.length === 0 || zipping}
              onClick={runZip}
            >
              {zipping ? 'Zipping…' : `Download ${sendable.length || ''} as .zip`}
            </button>
          </div>
        </section>
        </>
        ) : (
        <>
        <section className="map-pane">
          {adminError && !adminCatalog ? (
            <div className="state error">
              <div>
                <p>
                  <strong>Could not load the Admin Boundaries catalog.</strong>
                </p>
                <p>{adminError}</p>
              </div>
            </div>
          ) : !adminCatalog ? (
            <div className="state">Loading catalog…</div>
          ) : (
            <>
              <AdminBoundaryMap
                countries={adminCatalog.countries}
                selected={adminFocused}
                onSelect={adminFocusCountry}
                precision={precision}
              />
              <div className="legend">
                <span className="ramp">
                  <span>Leaf records</span>
                  <span className="bins">
                    {RAMP_VARS.map((v, i) => (
                      <span
                        key={v}
                        className="swatch"
                        style={{ background: `var(${v})` }}
                        title={ADMIN_BOUNDARY_BIN_LABELS[i]}
                      />
                    ))}
                  </span>
                  <span>
                    {ADMIN_BOUNDARY_BIN_LABELS[0]} →{' '}
                    {ADMIN_BOUNDARY_BIN_LABELS[ADMIN_BOUNDARY_BIN_LABELS.length - 1]}
                  </span>
                </span>
                <span className="cat">
                  <span className="swatch" style={{ background: 'var(--map-absent)' }} />
                  Not in the dataset
                </span>
              </div>
            </>
          )}
        </section>

        <section className="sidebar">
          <div className="controls">
            <input
              type="search"
              value={adminSearch}
              placeholder="Search country or code…"
              onChange={(e) => setAdminSearch(e.target.value)}
              aria-label="Search countries"
            />
          </div>

          <div className="result-line">
            <span>
              {adminVisible.length} of {adminCatalog?.totals.countries ?? 0} countries ·{' '}
              {compactRows(adminVisible.reduce((n, c) => n + c.total_rows, 0))} leaf records listed
            </span>
          </div>

          <AdminBoundaryTable
            rows={adminVisible}
            sort={adminSort}
            onSort={(key: AdminBoundarySortKey) =>
              setAdminSort((s) =>
                s.key === key
                  ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
                  : {
                      key,
                      dir:
                        key === 'total_rows' || key === 'max_tier' || key === 'last_updated'
                          ? 'desc'
                          : 'asc',
                    },
              )
            }
            focused={adminFocused}
            onFocus={adminFocusCountry}
            rowRefs={adminRowRefs}
            precision={precision}
          />

          <div className="selection-bar">
            <span className="summary">
              Full administrative-levels dataset, all {adminCatalog?.totals.countries ?? 91}{' '}
              countries, CSVs, available via Google Drive
            </span>
            <a
              className="btn-primary"
              href={ADMIN_BOUNDARIES_DRIVE_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Drive ↗
            </a>
          </div>
        </section>
        </>
        )}
      </div>

      {focusedCountry && (
        <CountryDrawer
          country={focusedCountry}
          onClose={() => setFocused(null)}
          precision={precision}
        />
      )}
    </div>
  )
}
