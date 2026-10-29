/**
 * BVG vehicles in the camera view (PLAN §5 "BVG live", D7, D55).
 *
 * Source: the community HAFAS wrapper `v6.bvg.transport.rest`, endpoint `/radar`
 * (CORS *, no key). It is NOT an official BVG feed and the positions are not GPS:
 * HAFAS interpolates them from the timetable and real-time delays. The app says
 * both on the badge ("berechnete Position, inoffizielle Quelle").
 *
 * ⚠️ The radar also returns S-Bahn and DB trains, so only operator
 * `berliner-verkehrsbetriebe` is kept. And it CAPS the result count: when the
 * cap is hit the badge says so, because a full-city view then shows a sample.
 */

export const RADAR_BASE = 'https://v6.bvg.transport.rest/radar'
/** Result cap asked for; the API answers at most this many movements. */
export const RADAR_RESULTS = 256
export const POLL_MS = 30_000
export const BVG_OPERATOR = 'berliner-verkehrsbetriebe'

export type Bbox = { north: number; west: number; south: number; east: number }
export type Mode = 'bus' | 'tram' | 'subway' | 'ferry' | 'other'
export type Vehicle = { id: string; line: string; mode: Mode; direction: string; lon: number; lat: number }
export type RadarResult = { vehicles: Vehicle[]; capped: boolean }

export function radarUrl(b: Bbox, results = RADAR_RESULTS): string {
  const q = new URLSearchParams({
    north: b.north.toFixed(5),
    west: b.west.toFixed(5),
    south: b.south.toFixed(5),
    east: b.east.toFixed(5),
    results: String(results),
    duration: '30',
    frames: '1',
    polylines: 'false',
    language: 'de',
  })
  return `${RADAR_BASE}?${q}`
}

/** Clamp the camera view to Berlin plus a margin, so a zoomed-out view never asks for Brandenburg. */
export function clampToBerlin(b: Bbox): Bbox {
  return {
    north: Math.min(b.north, 52.7),
    south: Math.max(b.south, 52.32),
    west: Math.max(b.west, 13.05),
    east: Math.min(b.east, 13.8),
  }
}

const MODES: Record<string, Mode> = { bus: 'bus', tram: 'tram', subway: 'subway', ferry: 'ferry' }

type RawMovement = {
  tripId?: string
  direction?: string | null
  location?: { latitude?: number; longitude?: number }
  line?: { name?: string; product?: string; operator?: { id?: string } | null }
}

/** BVG vehicles only, with a usable position; `capped` when the answer filled the cap. */
export function parseRadar(json: unknown, results = RADAR_RESULTS): RadarResult {
  const raw: RawMovement[] = Array.isArray(json)
    ? json
    : Array.isArray((json as { movements?: unknown })?.movements)
      ? (json as { movements: RawMovement[] }).movements
      : []
  const vehicles: Vehicle[] = []
  const seen = new Set<string>()
  for (const m of raw) {
    if (m.line?.operator?.id !== BVG_OPERATOR) continue
    const lat = m.location?.latitude
    const lon = m.location?.longitude
    if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const id = m.tripId ?? `${m.line?.name}-${lon}-${lat}`
    if (seen.has(id)) continue
    seen.add(id)
    vehicles.push({
      id,
      line: m.line?.name ?? '',
      mode: MODES[m.line?.product ?? ''] ?? 'other',
      direction: m.direction ?? '',
      lon,
      lat,
    })
  }
  return { vehicles, capped: raw.length >= results }
}

/** Next wait after a failure: doubles from the poll interval up to five minutes. */
export function backoffMs(failures: number): number {
  return Math.min(300_000, POLL_MS * 2 ** Math.max(0, failures))
}

export function vehicleFeatures(vs: readonly Vehicle[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: vs.map((v) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
      properties: { id: v.id, line: v.line, mode: v.mode, direction: v.direction },
    })),
  }
}
