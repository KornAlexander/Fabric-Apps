import type { ChargingData, Station } from './charging'

/**
 * Charging per district (PLAN §4 analysis 5, D61): public charge points per 1,000 residents, the
 * Stadtwerke share and the public charging energy per year, for the 12 districts. Pure, from the
 * baked charging.json (stations, Land figures) and context.json (outlines, register residents).
 *
 * ⚠️ TWO DIFFERENT POINT COUNTS, NEVER MIXED: `points` counts the public register stations (7,582,
 * the same set as the map and the lenses); `allPoints` is the Land's own district figure INCLUDING
 * private wallboxes (about 40,900). Only the public count drives the colour and the ranking.
 */
export type ContextDistrict = {
  id: number
  bez: string
  residents: number
  lon: number
  lat: number
  outline: GeoJSON.Polygon | GeoJSON.MultiPolygon
}

export type DistrictStats = {
  id: number
  bez: string
  residents: number
  lon: number
  lat: number
  points: number
  bswPoints: number
  /** Stadtwerke share of the public points, 0..1, null without points */
  bswShare: number | null
  per1000: number
  /** the Land's figure incl. private charge points, null when the district is missing there */
  allPoints: number | null
  /** public charging energy per year, years the Land did not publish are absent */
  kwhByYear: [number, number][]
}

export function districtStats(stations: readonly Station[], charging: ChargingData['districts'], districts: readonly ContextDistrict[]): DistrictStats[] {
  const land = new Map(charging.map((d) => [d.bez, d]))
  return districts.map((d) => {
    const mine = stations.filter((s) => s.bez === d.bez)
    const points = mine.reduce((a, s) => a + s.points, 0)
    const bswPoints = mine.filter((s) => s.bsw).reduce((a, s) => a + s.points, 0)
    const l = land.get(d.bez)
    return {
      id: d.id,
      bez: d.bez,
      residents: d.residents,
      lon: d.lon,
      lat: d.lat,
      points,
      bswPoints,
      bswShare: points ? bswPoints / points : null,
      per1000: d.residents ? (points / d.residents) * 1000 : 0,
      allPoints: l ? l.allPoints : null,
      kwhByYear: l
        ? Object.entries(l.publicKwhByYear)
            .map(([y, v]) => [Number(y), v] as [number, number])
            .sort((a, b) => a[0] - b[0])
        : [],
    }
  })
}

/**
 * A small line of public charging energy per year as an SVG path. A year the Land did not publish
 * BREAKS the line (a new `M`), so a gap never reads as a straight trend through missing data.
 */
export function sparkPath(series: readonly [number, number][], w: number, h: number): string {
  if (series.length < 2) return ''
  const y0 = series[0][0]
  const y1 = series[series.length - 1][0]
  const max = Math.max(...series.map(([, v]) => v)) || 1
  const x = (y: number) => ((y - y0) / Math.max(1, y1 - y0)) * w
  const y = (v: number) => h - (v / max) * h
  return series
    .map(([yr, v], i) => `${i === 0 || yr - series[i - 1][0] > 1 ? 'M' : 'L'}${x(yr).toFixed(1)},${y(v).toFixed(1)}`)
    .join(' ')
}

/** Districts as map features; `popup` is the finished HTML, so the map needs no knowledge of the figures. */
export function districtFeatures(stats: readonly DistrictStats[], outlines: readonly ContextDistrict[], popup: (s: DistrictStats) => string, label: (s: DistrictStats) => string): GeoJSON.FeatureCollection {
  const byId = new Map(outlines.map((o) => [o.id, o]))
  return {
    type: 'FeatureCollection',
    features: stats.flatMap((s) => {
      const o = byId.get(s.id)
      if (!o) return []
      return [
        { type: 'Feature' as const, geometry: o.outline, properties: { id: s.id, per1000: s.per1000, popup: popup(s) } },
        { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] }, properties: { id: s.id, label: label(s) } },
      ]
    }),
  }
}
