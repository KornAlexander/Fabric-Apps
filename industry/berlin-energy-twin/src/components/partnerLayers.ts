import type maplibregl from 'maplibre-gl'
import {
  depotFeatures,
  estateAreas,
  isSolar,
  lensUnits,
  openKw,
  postcodeAggregates,
  postcodeFills,
  roofLabels,
  roofOutlines,
  roofShare,
  unitPoints,
  type Lens,
  type RoofHeights,
  type SitesData,
  type Unit,
} from '../partners/partners'

/**
 * The partners on the map (PLAN §5, D33-D35): estates, BVG sites, ranked degewo
 * roofs with their gap, register units and the postcode aggregates.
 *
 * One accent for whatever the active lens owns, grey for the rest (D35). The
 * lens never removes another partner's assets, it only greys them: the meeting
 * is about the three together, and a vanishing depot would read as missing data.
 */

export const ACCENT = '#2f6f9f'
export const GREY = '#8a94a3'
/** Share-used scale for the roof bands: pale = little of the potential used, deep = most of it. */
export const SHARE_LOW = '#a9cbe6'
export const SHARE_HIGH = '#123d5e'

/** Partner layer ids, bottom to top. Buildings and photos go beneath the first. */
export const PARTNER_LAYERS = [
  'pc-fill',
  'pc-line',
  'estate-fill',
  'estate-line',
  'depot-fill',
  'depot-line',
  'depot-line-build',
  'roof-band',
  'depot-point',
  'unit-dot',
  'roof-label',
] as const

export type PartnerData = { sites: SitesData; units: Unit[]; heights: RoofHeights | null }

const on = (lens: Lens, mine: Lens) => (lens === mine ? ACCENT : GREY)

function source(m: maplibregl.Map, id: string, data: unknown) {
  const s = m.getSource(id) as maplibregl.GeoJSONSource | undefined
  if (s) s.setData(data as never)
  else m.addSource(id, { type: 'geojson', data: data as never })
}

/**
 * The basemap's own upright label font, so a new symbol layer needs no extra glyph
 * download. Italic stacks (water names) are skipped: a number on a roof is not a river.
 */
export function basemapFont(m: maplibregl.Map): string[] {
  for (const l of m.getStyle().layers) {
    if (l.type !== 'symbol') continue
    const f = m.getLayoutProperty(l.id, 'text-font') as unknown
    if (Array.isArray(f) && f.length && f.every((x) => typeof x === 'string') && !/italic/i.test(f[0])) return f as string[]
  }
  return ['Open Sans Regular']
}

/** Add every partner source and layer (idempotent: a style swap calls it again). */
export function installPartnerLayers(m: maplibregl.Map, d: PartnerData, lens: Lens, beforeId?: string) {
  const depots = depotFeatures(d.sites.depots)
  source(m, 'pc', postcodeFills(d.sites.postcodes, postcodeAggregates(lensUnits(d.units, lens), d.sites.placements)))
  source(m, 'estates', estateAreas(d.sites.estates))
  source(m, 'depot-areas', depots.areas)
  source(m, 'depot-points', depots.points)
  source(m, 'roof-bands', roofOutlines(d.sites.buildings, d.heights))
  source(m, 'roof-labels', roofLabels(d.sites.buildings))
  source(m, 'units', unitPoints(d.units, d.sites.placements))

  const add = (layer: maplibregl.LayerSpecification) => {
    if (!m.getLayer(layer.id)) m.addLayer(layer, beforeId)
  }
  add({
    id: 'pc-fill',
    type: 'fill',
    source: 'pc',
    paint: {
      'fill-color': ACCENT,
      'fill-opacity': ['interpolate', ['linear'], ['get', 'kw'], 0, 0.06, 200, 0.22, 1000, 0.4],
    },
  })
  add({ id: 'pc-line', type: 'line', source: 'pc', paint: { 'line-color': ACCENT, 'line-width': 0.8, 'line-dasharray': [2, 2], 'line-opacity': 0.7 } })
  add({
    id: 'estate-fill',
    type: 'fill',
    source: 'estates',
    paint: { 'fill-color': GREY, 'fill-opacity': ['case', ['==', ['get', 'named'], 1], 0.1, 0.06] },
  })
  add({
    id: 'estate-line',
    type: 'line',
    source: 'estates',
    paint: { 'line-color': GREY, 'line-width': ['case', ['==', ['get', 'named'], 1], 2, 1] },
  })
  add({ id: 'depot-fill', type: 'fill', source: 'depot-areas', paint: { 'fill-color': GREY, 'fill-opacity': 0.12 } })
  add({ id: 'depot-line', type: 'line', source: 'depot-areas', filter: ['==', ['get', 'building'], 0], paint: { 'line-color': GREY, 'line-width': 1.6 } })
  // Being built (D23): dashed, so "im Bau" reads on the map before the popup says it.
  add({
    id: 'depot-line-build',
    type: 'line',
    source: 'depot-areas',
    filter: ['==', ['get', 'building'], 1],
    paint: { 'line-color': GREY, 'line-width': 1.6, 'line-dasharray': [3, 2] },
  })
  // The roof band stands ON the roof: base and top from the LoD2 roof height.
  add({
    id: 'roof-band',
    type: 'fill-extrusion',
    source: 'roof-bands',
    paint: {
      'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'share'], 0, SHARE_LOW, 1, SHARE_HIGH],
      'fill-extrusion-base': ['get', 'roofM'],
      'fill-extrusion-height': ['+', ['get', 'roofM'], 0.6],
      'fill-extrusion-opacity': 0.95,
    },
  })
  add({
    id: 'depot-point',
    type: 'circle',
    source: 'depot-points',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4, 14, 8],
      'circle-color': '#ffffff',
      'circle-stroke-color': GREY,
      'circle-stroke-width': 2.5,
    },
  })
  add({
    id: 'unit-dot',
    type: 'circle',
    source: 'units',
    paint: {
      // area, not radius, proportional to kWp
      'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'kw']], 0, 2.5, 10, 7, 23, 13],
      'circle-color': GREY,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.2,
      'circle-opacity': 0.92,
    },
  })
  // Open potential as text on the roof (D53), in the font the basemap already loads.
  add({
    id: 'roof-label',
    type: 'symbol',
    source: 'roof-labels',
    minzoom: 13,
    layout: {
      'text-field': ['concat', ['number-format', ['get', 'open'], { 'max-fraction-digits': 0 }], ' kWp'],
      'text-font': basemapFont(m),
      'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 17, 13],
      'text-allow-overlap': false,
      'text-anchor': 'bottom',
      'text-offset': [0, -0.4],
    },
    paint: { 'text-color': ACCENT, 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
  })
  setPartnerLens(m, d, lens)
}

/** Recolour for a lens (D35) and swap the postcode aggregates to that lens's units (D34). */
export function setPartnerLens(m: maplibregl.Map, d: PartnerData, lens: Lens) {
  if (!m.getLayer('unit-dot')) return
  source(m, 'pc', postcodeFills(d.sites.postcodes, postcodeAggregates(lensUnits(d.units, lens), d.sites.placements)))
  m.setPaintProperty('unit-dot', 'circle-color', ['case', ['==', ['get', lens], 1], ACCENT, GREY])
  m.setLayoutProperty('unit-dot', 'circle-sort-key', ['get', lens])
  m.setPaintProperty('estate-fill', 'fill-color', on(lens, 'degewo'))
  m.setPaintProperty('estate-line', 'line-color', on(lens, 'degewo'))
  for (const id of ['depot-fill', 'depot-line', 'depot-line-build']) {
    m.setPaintProperty(id, id === 'depot-fill' ? 'fill-color' : 'line-color', on(lens, 'bvg'))
  }
  m.setPaintProperty('depot-point', 'circle-stroke-color', on(lens, 'bvg'))
  // The roof gap is degewo's analysis: shown in its lens only, hidden elsewhere.
  for (const id of ['roof-band', 'roof-label']) m.setLayoutProperty(id, 'visibility', lens === 'degewo' ? 'visible' : 'none')
  // Charging is BSW's: full strength in its lens, receding behind the others'.
  const dim = lens === 'bsw' ? 1 : 0.35
  if (m.getLayer('stations-bsw')) m.setPaintProperty('stations-bsw', 'circle-opacity', dim)
  if (m.getLayer('stations-other')) m.setPaintProperty('stations-other', 'circle-opacity', lens === 'bsw' ? 0.65 : 0.25)
}

export type PartnerPopupLabels = {
  operator: string
  power: string
  since: string
  mieterstrom: string
  placement: Record<string, string>
  roofPotential: string
  roofInstalled: string
  roofOpen: string
  roofShare: string
  estimate: string
  depotKind: string
  building: string
  operating: string
  deal2025: string
  aggregated: string
  units: string
  source: string
  carrier: string
  /** MaStR carrier name -> display name */
  carriers: Record<string, string>
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const row = (k: string, v: string) => `<div class="veh-pop-row"><span>${esc(k)}</span><b>${v}</b></div>`

/** Popup HTML for the first partner feature under the cursor, or null. */
export function partnerPopup(
  f: maplibregl.MapGeoJSONFeature,
  d: PartnerData,
  L: PartnerPopupLabels,
  loc: string,
): { html: string; at: [number, number] } | null {
  const n = (v: number, digits = 1) => v.toLocaleString(loc, { maximumFractionDigits: digits })
  const layer = f.layer.id
  if (layer === 'unit-dot') {
    const u = d.units.find((x) => x.id === f.properties.id)
    const p = u && d.sites.placements[u.id]
    if (!u || !p || p.lon === undefined || p.lat === undefined) return null
    return {
      at: [p.lon, p.lat],
      html:
        `<div class="veh-pop" data-testid="unit-popup"><div class="veh-pop-head"><b>${esc(u.name)}</b></div>` +
        row(L.operator, esc(u.operator)) +
        // kWp is a PV unit; wind, CHP and storage are rated in kW
        row(L.power, `${n(u.kwGross ?? 0)} ${isSolar(u) ? 'kWp' : 'kW'}`) +
        (isSolar(u) ? '' : row(L.carrier, esc(L.carriers[u.carrier] ?? u.carrier))) +
        (u.commissioned ? row(L.since, esc(u.commissioned.slice(0, 4))) : '') +
        (u.mieterstrom ? row(L.mieterstrom, '✓') : '') +
        `<div class="veh-pop-op">${esc(L.placement[p.method] ?? p.method)} · MaStR ${esc(u.id)}</div></div>`,
    }
  }
  if (layer === 'roof-band' || layer === 'roof-label') {
    const r = d.sites.buildings.find((x) => x.id === f.properties.id)
    if (!r) return null
    const share = roofShare(r)
    return {
      at: [r.lon, r.lat],
      html:
        `<div class="veh-pop" data-testid="roof-popup"><div class="veh-pop-head"><b>${esc(r.addr)}</b></div>` +
        row(L.roofPotential, `${n(r.potKw)} kWp <span class="badge">${esc(L.estimate)}</span>`) +
        row(L.roofInstalled, `${n(r.installedKw)} kWp`) +
        row(L.roofOpen, `${n(openKw(r))} kWp`) +
        row(L.roofShare, share === null ? '-' : `${n(share * 100, 0)} %`) +
        `<div class="veh-pop-op">${esc(L.source)}: Solarkataster Berlin, MaStR</div></div>`,
    }
  }
  if (layer === 'depot-point' || layer === 'depot-fill') {
    const dep = d.sites.depots.find((x) => x.id === f.properties.id)
    if (!dep) return null
    const link = d.sites.sources[dep.source]
    return {
      at: [dep.lon ?? 0, dep.lat ?? 0],
      html:
        `<div class="veh-pop" data-testid="depot-popup"><div class="veh-pop-head"><b>${esc(dep.name)}</b></div>` +
        row(L.depotKind, esc(dep.status === 'construction' ? L.building : L.operating)) +
        row(L.power, dep.kwGross ? `${n(dep.kwGross)} kWp` : '-') +
        (dep.deal2025 ? row(L.deal2025, '✓') : '') +
        (link ? `<div class="veh-pop-op"><a href="${esc(link)}" target="_blank" rel="noreferrer">${esc(L.source)}</a></div>` : '') +
        `</div>`,
    }
  }
  if (layer === 'pc-fill') {
    const g = f.properties as { plz: string; kw: number; n: number }
    const area = d.sites.postcodes.find((x) => x.plz === g.plz)
    if (!area) return null
    return {
      at: [area.lon, area.lat],
      html:
        `<div class="veh-pop" data-testid="postcode-popup"><div class="veh-pop-head"><b>PLZ ${esc(g.plz)}</b> <span class="badge">${esc(L.aggregated)}</span></div>` +
        row(L.units, String(g.n)) +
        row(L.power, `${n(g.kw)} kWp`) +
        `<div class="veh-pop-op">MaStR</div></div>`,
    }
  }
  return null
}

/** Pure red is reserved for semantic gaps (PLAN §5 style). */
export const GAP_RED = '#FF0000'

/**
 * Tour stop 4: degewo areas outlined by whether a Stadtwerke charging point is
 * within 300 m (red: none). `data` null hides it. Safe to call again after a
 * style swap, which removes runtime layers.
 */
export function setGapOverlay(m: maplibregl.Map, data: GeoJSON.FeatureCollection | null) {
  const src = m.getSource('tour-gap') as maplibregl.GeoJSONSource | undefined
  const empty = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection
  if (!src) {
    if (!data) return
    m.addSource('tour-gap', { type: 'geojson', data })
    // On top of the estate outlines and the charge points: this stop is about the gap.
    const before = undefined
    const area = ['==', ['geometry-type'], 'Polygon'] as never
    m.addLayer(
      {
        id: 'tour-gap-fill',
        type: 'fill',
        source: 'tour-gap',
        filter: area,
        paint: { 'fill-color': ['case', ['get', 'bswGap'], GAP_RED, ACCENT] as never, 'fill-opacity': ['case', ['get', 'bswGap'], 0.16, 0.08] as never },
      },
      before,
    )
    m.addLayer(
      {
        id: 'tour-gap-line',
        type: 'line',
        source: 'tour-gap',
        filter: area,
        paint: { 'line-color': ['case', ['get', 'bswGap'], GAP_RED, ACCENT] as never, 'line-width': ['case', ['get', 'bswGap'], 3, 1.6] as never },
      },
      before,
    )
    m.addLayer({
      id: 'tour-gap-ring',
      type: 'circle',
      source: 'tour-gap',
      filter: ['==', ['geometry-type'], 'Point'] as never,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 11, 14, 4] as never,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': GAP_RED,
        'circle-stroke-width': 3,
      },
    })
    return
  }
  src.setData(data ?? empty)
}
