import type { AdminBoundaryCountry } from './types'
import type { AdminBoundarySort, AdminBoundarySortKey } from './sorting'

// A sibling of CountryTable.tsx, not an extension of it -- CountryTable is
// typed against the postal-codes `Country` shape, and this dataset's rows
// (AdminBoundaryCountry) don't share it. See types.ts's doc comment on
// AdminBoundaryCountry for why this is a deliberately separate dataset.

const COLUMNS: { key: AdminBoundarySortKey; label: string; title?: string; numeric?: boolean }[] = [
  { key: 'name_en', label: 'Country' },
  { key: 'code', label: 'Code' },
  {
    key: 'max_tier',
    label: 'Tiers',
    title: 'Deepest administrative level with at least one non-blank value (1-6)',
  },
  {
    key: 'total_rows',
    label: 'Leaf records',
    title: 'Rows in the source file -- the deepest populated administrative unit',
    numeric: true,
  },
]

/** Generalized version of CountryTable.tsx's DepthBars for a 1-6 range instead
 *  of postal codes' fixed 1-5 -- South Africa is the one country that reaches
 *  tier 6, so this can't reuse that component's hardcoded [1,2,3,4,5]. */
function TierBars({ maxTier }: { maxTier: number }) {
  return (
    <>
      <span className="depth" aria-hidden="true">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <i key={n} className={n <= maxTier ? '' : 'off'} style={{ height: `${3 + n * 1.5}px` }} />
        ))}
      </span>
      <span className="depth-label">{maxTier > 0 ? `T${maxTier}` : '—'}</span>
    </>
  )
}

/** "24 / 513 / 2,362 / 5,831" -- one compact column rather than up to 6 ragged
 *  ones, since level_counts' length varies per country (1-6) and the sidebar
 *  table is already width-constrained (see index.css's note on table.countries
 *  td keeping every cell to one line). */
function levelCountsLabel(country: AdminBoundaryCountry): string {
  return country.level_counts.map((lvl) => lvl.unit_count.toLocaleString('en-US')).join(' / ')
}

type Props = {
  rows: AdminBoundaryCountry[]
  sort: AdminBoundarySort
  onSort: (key: AdminBoundarySortKey) => void
  focused: string | null
  onFocus: (code: string) => void
  rowRefs: React.RefObject<Record<string, HTMLTableRowElement | null>>
}

export default function AdminBoundaryTable({ rows, sort, onSort, focused, onFocus, rowRefs }: Props) {
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
            <th title="Distinct admin units per tier, tier 1 through the country's deepest -- see the Tiers column">
              Units per tier
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr
              key={c.code}
              ref={(el) => {
                rowRefs.current[c.code] = el
              }}
              className={focused === c.code ? 'selected' : undefined}
            >
              <td>
                <button
                  type="button"
                  className="country-name"
                  onClick={() => onFocus(c.code)}
                  style={{ background: 'none', border: 0, padding: 0, textAlign: 'left' }}
                >
                  <span className="en">{c.name_en}</span>
                  {c.name_lc && c.name_lc !== c.name_en && <span className="lc">{c.name_lc}</span>}
                </button>
              </td>
              <td>
                <span className="iso-badge">{c.code}</span>
              </td>
              <td>
                <TierBars maxTier={c.max_tier} />
              </td>
              <td className="col-num">{c.total_rows.toLocaleString('en-US')}</td>
              <td title={`Tier 1 through tier ${c.max_tier}`}>{levelCountsLabel(c)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: '18px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No countries match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
