/**
 * Berlin's public charging infrastructure, as baked from the Geoportal
 * (`tools/bake_charging.py`).
 *
 * ⚠️ REGISTER DATA, NO LIVE STATUS. No open feed reports occupancy for Berlin,
 * so nothing here may be called "free", "available" or "in use". The summary
 * counts what exists: stations, charge points, power and who operates them
 * (PLAN §5, review S8).
 */

export type Station = {
  id: string
  lon: number
  lat: number
  /** Operator as registered. */
  op: string
  /** Operated by Berliner Stadtwerke (KommunalPartner or EnergiePartner). */
  bsw: boolean
  addr: string
  plz: string | null
  bez: string | null
  points: number
  /** Highest connector power in kW, null when not registered. */
  kw: number | null
  dc: boolean
  year: number | null
  /** On public street space (Berliner Modell) rather than publicly accessible private ground. */
  public: boolean
}

export type DistrictCharging = {
  bez: string
  /** All charge points incl. private wallboxes, as the Land counts them. */
  allPoints: number
  allPointsKw: number
  pointsAsOf: string
  /** kWh charged at public points per year; years the Land did not publish are absent. */
  publicKwhByYear: Record<string, number>
}

export type ChargingData = {
  meta: { source: string; attribution: string; licence: string; url: string; bakedUtc: string; notes?: string }
  stations: Station[]
  districts: DistrictCharging[]
}

export type ChargingSummary = {
  stations: number
  points: number
  dcPoints: number
  publicSpacePoints: number
  /** Sum of each station's highest connector power times its points: installed power, not load. */
  installedKw: number
}

export function summarise(stations: readonly Station[]): ChargingSummary {
  let points = 0
  let dcPoints = 0
  let publicSpacePoints = 0
  let installedKw = 0
  for (const s of stations) {
    points += s.points
    if (s.dc) dcPoints += s.points
    if (s.public) publicSpacePoints += s.points
    installedKw += (s.kw ?? 0) * s.points
  }
  return { stations: stations.length, points, dcPoints, publicSpacePoints, installedKw: Math.round(installedKw) }
}

/** BSW's share of all public charge points in Berlin, in percent; null without data. */
export function bswShare(stations: readonly Station[]): number | null {
  const all = summarise(stations).points
  if (!all) return null
  return (summarise(stations.filter((s) => s.bsw)).points / all) * 100
}

/** Stations within `radiusM` metres as the crow flies (Luftlinie, review S6). */
export function within(stations: readonly Station[], lon: number, lat: number, radiusM: number): Station[] {
  return stations.filter((s) => distanceM(lon, lat, s.lon, s.lat) <= radiusM)
}

/** Great-circle distance in metres (haversine). Exact enough for walking-scale radii. */
export function distanceM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6_371_008.8
  const toRad = Math.PI / 180
  const dLat = (lat2 - lat1) * toRad
  const dLon = (lon2 - lon1) * toRad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Latest year with a published public-charging kWh figure, and the figure. */
export function latestKwh(d: DistrictCharging): { year: number; kwh: number } | null {
  const years = Object.keys(d.publicKwhByYear).map(Number).sort((a, b) => b - a)
  return years.length ? { year: years[0], kwh: d.publicKwhByYear[String(years[0])] } : null
}
