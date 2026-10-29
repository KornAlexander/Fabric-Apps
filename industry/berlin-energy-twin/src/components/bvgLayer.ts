import type maplibregl from 'maplibre-gl'

/**
 * Live BVG vehicles on the map (D55): a dot per vehicle, coloured by mode in the
 * neutral palette (D9: no company colours), the line name beside it from street
 * level. Drawn on top of everything else, like the charge points.
 */
export const MODE_COLOURS: Record<string, string> = {
  bus: '#6b4c9a',
  tram: '#b0603a',
  subway: '#2f6f9f',
  ferry: '#2f8f8a',
  other: '#5c6470',
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

export function setVehicles(m: maplibregl.Map, data: GeoJSON.FeatureCollection | null, font: string[]) {
  const src = m.getSource('bvg-live') as maplibregl.GeoJSONSource | undefined
  if (src) {
    src.setData(data ?? EMPTY)
    return
  }
  if (!data) return
  m.addSource('bvg-live', { type: 'geojson', data, attribution: 'BVG live: v6.bvg.transport.rest (HAFAS, inoffiziell / unofficial)' })
  m.addLayer({
    id: 'bvg-live-dot',
    type: 'circle',
    source: 'bvg-live',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 14, 5, 17, 7] as never,
      'circle-color': ['match', ['get', 'mode'], ...Object.entries(MODE_COLOURS).flat(), MODE_COLOURS.other] as never,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.2,
    },
  })
  m.addLayer({
    id: 'bvg-live-label',
    type: 'symbol',
    source: 'bvg-live',
    minzoom: 13.5,
    layout: {
      'text-field': ['get', 'line'] as never,
      'text-font': font,
      'text-size': 11,
      'text-offset': [0.9, 0],
      'text-anchor': 'left',
    },
    paint: { 'text-color': '#1f2328', 'text-halo-color': '#ffffff', 'text-halo-width': 1.3 },
  })
}
