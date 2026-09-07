import { useEffect, useMemo, useRef, useState } from 'react'
import { geoNaturalEarth1, geoPath, geoGraticule10 } from 'd3-geo'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom'
// Side-effect import: teaches d3 selections the .transition() method used below.
import 'd3-transition'
import { feature } from 'topojson-client'
import type { AdminBoundaryCountry } from './types'
import { RAMP_VARS, binOfAdminBoundary } from './mapScale'

// A sibling of WorldMap.tsx, not a shared component -- see this feature's note
// in types.ts. It reuses the same d3-geo/topojson-client setup and world
// topology file, but the fill logic is different (whole-country shading by
// total_rows; there are no per-row coordinates to plot here) and the row type
// is AdminBoundaryCountry, not Country, so folding this into WorldMap would
// mean threading postal-code-specific fields through with optional/unused
// branches. Kept deliberately parallel instead: change one, remember to check
// the other, but neither has to bend around the other's shape.

const WIDTH = 960
const HEIGHT = 480

type GeoFeature = {
  type: 'Feature'
  id?: string | number
  properties: { name?: string }
  geometry: unknown
}

/** Same fixup WorldMap.tsx needs: world-atlas has no ISO numeric id for
 *  Northern Cyprus, and our CY file covers the whole island. No admin-
 *  boundaries source for CY exists (not one of the 91), so this is a no-op
 *  today -- kept only so the two maps' lookup logic stays visibly identical. */
const NAME_TO_ISO2: Record<string, string> = { 'N. Cyprus': 'CY' }

type Props = {
  countries: AdminBoundaryCountry[]
  selected: string | null
  onSelect: (code: string) => void
}

export default function AdminBoundaryMap({ countries, selected, onSelect }: Props) {
  const [features, setFeatures] = useState<GeoFeature[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hovered, setHovered] = useState<{ code: string; x: number; y: number } | null>(null)
  const [transform, setTransform] = useState(zoomIdentity)

  const svgRef = useRef<SVGSVGElement | null>(null)
  const holderRef = useRef<HTMLDivElement | null>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`${import.meta.env.BASE_URL}vendor/countries-110m.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return r.json()
      })
      .then((topo) => {
        if (!alive) return
        const collection = feature(topo, topo.objects.countries) as unknown as {
          features: GeoFeature[]
        }
        setFeatures(collection.features)
      })
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [])

  const byNumeric = useMemo(() => {
    const map = new Map<string, AdminBoundaryCountry>()
    for (const c of countries) if (c.iso_numeric) map.set(c.iso_numeric, c)
    return map
  }, [countries])

  const byCode = useMemo(() => new Map(countries.map((c) => [c.code, c])), [countries])

  const lookup = (f: GeoFeature): AdminBoundaryCountry | undefined => {
    const numeric = f.id != null ? String(f.id) : null
    const named = NAME_TO_ISO2[f.properties.name ?? '']
    return (numeric ? byNumeric.get(numeric) : undefined) ?? (named ? byCode.get(named) : undefined)
  }

  const { path, graticule, sphere } = useMemo(() => {
    const projection = geoNaturalEarth1().fitExtent(
      [
        [4, 4],
        [WIDTH - 4, HEIGHT - 4],
      ],
      { type: 'Sphere' },
    )
    const p = geoPath(projection)
    return {
      path: p,
      graticule: p(geoGraticule10()) ?? '',
      sphere: p({ type: 'Sphere' }) ?? '',
    }
  }, [])

  useEffect(() => {
    if (!svgRef.current) return
    const svg = select(svgRef.current)
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 14])
      .translateExtent([
        [0, 0],
        [WIDTH, HEIGHT],
      ])
      .on('zoom', (event) => setTransform(event.transform))
    svg.call(behavior)
    svg.on('dblclick.zoom', null)
    zoomRef.current = behavior
    return () => {
      svg.on('.zoom', null)
    }
  }, [])

  const zoomBy = (k: number) => {
    if (!svgRef.current || !zoomRef.current) return
    select(svgRef.current).transition().duration(200).call(zoomRef.current.scaleBy, k)
  }

  const resetZoom = () => {
    if (!svgRef.current || !zoomRef.current) return
    select(svgRef.current).transition().duration(220).call(zoomRef.current.transform, zoomIdentity)
  }

  const hoveredCountry = hovered ? byCode.get(hovered.code) : undefined

  const tooltipStyle = (): React.CSSProperties => {
    if (!hovered || !holderRef.current) return { display: 'none' }
    const box = holderRef.current.getBoundingClientRect()
    const flipX = hovered.x > box.width - 260
    const flipY = hovered.y > box.height - 130
    return {
      left: flipX ? undefined : hovered.x + 12,
      right: flipX ? box.width - hovered.x + 12 : undefined,
      top: flipY ? undefined : hovered.y + 12,
      bottom: flipY ? box.height - hovered.y + 12 : undefined,
    }
  }

  if (error) {
    return (
      <div className="state error">
        <div>
          Could not load the map geometry ({error}).
          <br />
          Expected <code>web/public/vendor/countries-110m.json</code>.
        </div>
      </div>
    )
  }

  return (
    <div className="map-holder" ref={holderRef}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="World map of admin-boundary data coverage"
      >
        <g transform={transform.toString()}>
          <path className="graticule" d={graticule} />
          <path className="sphere" d={sphere} />
          {features?.map((f, i) => {
            const country = lookup(f)
            const d = path(f as never) ?? ''
            const fill = !country
              ? 'var(--map-absent)'
              : `var(${RAMP_VARS[binOfAdminBoundary(country.total_rows)]})`
            // Guard on `country` first: two undefined codes compare equal, which
            // would give every country we hold no data for a hover outline.
            const isSelected = !!country && country.code === selected
            const isHovered = !!country && country.code === hovered?.code
            return (
              <path
                // Index, not country.code: Cyprus is matched twice in world-atlas
                // (the numeric-id feature and the "N. Cyprus" name fallback both
                // resolve to CY), so a code-based key collides for that one
                // country. `features` is a fixed array for the life of this
                // component, so the index is a perfectly stable React key here.
                key={`geo-${i}`}
                className={[
                  'country',
                  country ? 'interactive' : '',
                  isSelected ? 'selected' : '',
                  isHovered ? 'hovered' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                d={d}
                fill={fill}
                onMouseMove={(e) => {
                  if (!country || !holderRef.current) return
                  const box = holderRef.current.getBoundingClientRect()
                  setHovered({
                    code: country.code,
                    x: e.clientX - box.left,
                    y: e.clientY - box.top,
                  })
                }}
                onMouseLeave={() => setHovered(null)}
                onClick={() => country && onSelect(country.code)}
              />
            )
          })}
        </g>
      </svg>

      <div className="map-controls">
        <button type="button" onClick={() => zoomBy(1.6)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={resetZoom} aria-label="Reset zoom">
          ⤾
        </button>
      </div>

      {hoveredCountry && (
        <div className="map-tooltip" style={tooltipStyle()}>
          <div className="tt-name">
            {hoveredCountry.name_en} <span className="iso-badge">{hoveredCountry.code}</span>
          </div>
          <dl>
            <dt>Leaf records</dt>
            <dd>{hoveredCountry.total_rows.toLocaleString('en-US')}</dd>
            <dt>Deepest tier</dt>
            <dd>{hoveredCountry.max_tier}</dd>
            <dt>Top-level units</dt>
            <dd>{hoveredCountry.level_counts[0]?.unit_count.toLocaleString('en-US') ?? '—'}</dd>
          </dl>
        </div>
      )}

      <div className="sr-only" aria-live="polite">
        {hoveredCountry
          ? `${hoveredCountry.name_en}: ${hoveredCountry.total_rows.toLocaleString('en-US')} leaf records across ${hoveredCountry.max_tier} admin tiers`
          : ''}
      </div>
    </div>
  )
}
