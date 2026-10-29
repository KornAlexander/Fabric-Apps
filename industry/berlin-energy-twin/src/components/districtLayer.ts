import type maplibregl from 'maplibre-gl'

/**
 * Charging per district on the map (D61): the 12 districts shaded by public charge points per
 * 1,000 residents, a thin outline, and the value as a label. Shaded UNDER the charge points and
 * partner marks, so the stations stay clickable on top; the label sits above everything.
 */
export const DISTRICT_LOW = '#eef2f7'
export const DISTRICT_HIGH = '#2f6f9f'
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

export function setDistricts(m: maplibregl.Map, data: GeoJSON.FeatureCollection | null, range: [number, number], font: string[], beforeId?: string) {
  const src = m.getSource('districts') as maplibregl.GeoJSONSource | undefined
  const hi = range[1] > range[0] ? range[1] : range[0] + 1 // equal values would give non-ascending stops
  const fill = ['interpolate', ['linear'], ['get', 'per1000'], range[0], DISTRICT_LOW, hi, DISTRICT_HIGH]
  if (src) {
    src.setData(data ?? EMPTY)
    if (m.getLayer('districts-fill')) m.setPaintProperty('districts-fill', 'fill-color', fill as never)
    return
  }
  if (!data) return
  m.addSource('districts', { type: 'geojson', data })
  const anyArea = ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']] as never
  m.addLayer({ id: 'districts-fill', type: 'fill', source: 'districts', filter: anyArea, paint: { 'fill-color': fill as never, 'fill-opacity': 0.55 } }, beforeId)
  m.addLayer({ id: 'districts-line', type: 'line', source: 'districts', filter: anyArea, paint: { 'line-color': '#5c6470', 'line-width': 1.1 } }, beforeId)
  m.addLayer({
    id: 'districts-label',
    type: 'symbol',
    source: 'districts',
    filter: ['==', ['geometry-type'], 'Point'] as never,
    layout: {
      'text-field': ['get', 'label'] as never,
      'text-font': font,
      'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 12, 13] as never,
      'text-max-width': 9,
      'text-allow-overlap': false,
    },
    paint: { 'text-color': '#14161a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
  })
}
