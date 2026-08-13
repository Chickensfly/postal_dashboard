import { useEffect, useMemo, useRef, useState } from 'react'
import { geoNaturalEarth1, geoPath, geoGraticule10 } from 'd3-geo'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom'
// Side-effect import: teaches d3 selections the .transition() method used below.
import 'd3-transition'
import { feature } from 'topojson-client'
import type { Country } from './types'
import { compactRows, prettyDate } from './format'
import { RAMP_VARS, binOf } from './mapScale'

const WIDTH = 960
const HEIGHT = 480

type GeoFeature = {
  type: 'Feature'
  id?: string | number
  properties: { name?: string }
  geometry: unknown
}

/** The three geometries in world-atlas with no ISO numeric id are disputed
 *  territories. Northern Cyprus is the only one that overlaps a country we hold
 *  data for, and the CY file covers the whole island, so it is mapped by name. */
const NAME_TO_ISO2: Record<string, string> = { 'N. Cyprus': 'CY' }

type Props = {
  countries: Country[]
  selected: string | null
  onSelect: (iso2: string) => void
}

export default function WorldMap({ countries, selected, onSelect }: Props) {
  const [features, setFeatures] = useState<GeoFeature[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hovered, setHovered] = useState<{ iso2: string; x: number; y: number } | null>(null)
  const [transform, setTransform] = useState(zoomIdentity)

  const svgRef = useRef<SVGSVGElement | null>(null)
  const holderRef = useRef<HTMLDivElement | null>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/vendor/countries-110m.json')
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
    const map = new Map<string, Country>()
    for (const c of countries) if (c.iso_numeric) map.set(c.iso_numeric, c)
    return map
  }, [countries])

  const byIso2 = useMemo(
    () => new Map(countries.map((c) => [c.iso2, c])),
    [countries],
  )

  const lookup = (f: GeoFeature): Country | undefined => {
    const numeric = f.id != null ? String(f.id) : null
    const named = NAME_TO_ISO2[f.properties.name ?? '']
    return (numeric ? byNumeric.get(numeric) : undefined) ?? (named ? byIso2.get(named) : undefined)
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

  // d3-zoom owns the gesture; React owns the rendering. The transform is applied
  // to a single <g>, so 177 paths are not re-diffed on every wheel tick.
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

  const hoveredCountry = hovered ? byIso2.get(hovered.iso2) : undefined

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
        aria-label="World map of postal-code data coverage"
      >
        <defs>
          {/* The texture channel: 'delivered, no postal data' carries a hatch as well
              as a hue, so the state does not depend on colour alone. */}
          <pattern
            id="hatch-nodata"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill="var(--status-warning)" opacity="0.5" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--status-warning)" strokeWidth="3" />
          </pattern>
        </defs>


        <g transform={transform.toString()}>
          <path className="graticule" d={graticule} />
          <path className="sphere" d={sphere} />
          {features?.map((f, i) => {
            const country = lookup(f)
            const d = path(f as never) ?? ''
            const fill = !country
              ? 'var(--map-absent)'
              : country.status === 'covered'
                ? `var(${RAMP_VARS[binOf(country.rows)]})`
                : 'url(#hatch-nodata)'
            // Guard on `country` first: two undefined ISO2s compare equal, which
            // would give every country we hold no data for a hover outline.
            const isSelected = !!country && country.iso2 === selected
            const isHovered = !!country && country.iso2 === hovered?.iso2
            return (
              <path
                key={country?.iso2 ?? `geo-${i}`}
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
                    iso2: country.iso2,
                    x: e.clientX - box.left,
                    y: e.clientY - box.top,
                  })
                }}
                onMouseLeave={() => setHovered(null)}
                onClick={() => country && onSelect(country.iso2)}
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
            {hoveredCountry.name_en} <span className="iso-badge">{hoveredCountry.iso2}</span>
          </div>
          {hoveredCountry.status === 'covered' ? (
            <dl>
              <dt>Postal codes</dt>
              <dd>{hoveredCountry.rows.toLocaleString('en-US')}</dd>
              <dt>Admin levels</dt>
              <dd>{hoveredCountry.admin_depth}</dd>
              <dt>Updated</dt>
              <dd>{prettyDate(hoveredCountry.last_updated)}</dd>
              <dt>Region</dt>
              <dd>{hoveredCountry.continent_name ?? '—'}</dd>
            </dl>
          ) : (
            <dl>
              <dt>Postal codes</dt>
              <dd>none</dd>
              <dt>Source rows</dt>
              <dd>{hoveredCountry.source_rows.toLocaleString('en-US')}</dd>
              <dt>Admin levels</dt>
              <dd>{hoveredCountry.admin_depth}</dd>
              <dt>Updated</dt>
              <dd>{prettyDate(hoveredCountry.last_updated)}</dd>
            </dl>
          )}
        </div>
      )}

      <div className="sr-only" aria-live="polite">
        {hoveredCountry
          ? `${hoveredCountry.name_en}: ${
              hoveredCountry.status === 'covered'
                ? `${compactRows(hoveredCountry.rows)} postal codes`
                : `no postal codes, ${hoveredCountry.admin_depth} admin levels in the raw source`
            }`
          : ''}
      </div>
    </div>
  )
}
