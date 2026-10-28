/**
 * Public charging around the degewo estates (PLAN §4 analysis 2, tour stop 4).
 *
 * Distance is **Luftlinie**, straight line from a charge point to the nearest
 * edge of the estate outline (0 inside it), never walking distance; the app
 * names it so. Pure, over the baked charging register and sites.json.
 */
import type { Station } from '../charging/charging'
import type { Estate } from './partners'

export const GAP_RADII_M = [300, 500] as const
const R = 6378137

type Ring = [number, number][]

export type EstateReach = {
  id: string
  name: string
  /** per radius: stations, points and Stadtwerke points within that straight-line distance */
  within: Record<(typeof GAP_RADII_M)[number], { stations: number; points: number; bswPoints: number; ids: string[] }>
  /** no public charge point at all within the first radius */
  gap: boolean
  /**
   * no Stadtwerke point within the first radius. Measured 2026-10-28: every
   * degewo area has public charging within 300 m, so THIS is the gap the tour
   * shows (red, a semantic highlight).
   */
  bswGap: boolean
}

function rings(outline: Estate['outline']): Ring[] {
  if (!outline) return []
  const c = outline.coordinates as unknown
  if (outline.type === 'Polygon') return c as Ring[]
  return (c as Ring[][]).flat()
}

/** Local metres around a reference latitude (equirectangular; error < 0.1 % over a few km). */
function toM(lon: number, lat: number, lat0: number): [number, number] {
  const k = (Math.PI / 180) * R
  return [lon * k * Math.cos((lat0 * Math.PI) / 180), lat * k]
}

function insideRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function segDist(x: number, y: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy))
}

/**
 * Straight-line distance in metres from a point to an outline: 0 inside, else to the nearest edge.
 * Holes are treated as part of the estate (a courtyard is still the estate).
 */
export function distanceToOutline(lon: number, lat: number, outline: Estate['outline']): number {
  const rs = rings(outline)
  if (!rs.length) return Infinity
  const lat0 = rs[0][0][1]
  const [x, y] = toM(lon, lat, lat0)
  const ms = rs.map((r) => r.map(([lo, la]) => toM(lo, la, lat0)))
  // Polygon: first ring is the shell. MultiPolygon flattened: test every ring as a shell is
  // wrong for holes, so only "inside some ring" counts, which is right for shells and
  // treats holes as estate (see above).
  if (ms.some((r) => insideRing(x, y, r))) return 0
  let best = Infinity
  for (const r of ms) for (let i = 1; i < r.length; i++) best = Math.min(best, segDist(x, y, r[i - 1], r[i]))
  return best
}

/**
 * Estates without the ones lying inside a named estate. The cluster around
 * Feuchtwangerweg (12353) sits inside the Gropiusstadt outline, so counting it
 * as an area of its own doubled its charge points and made "10 areas" out of 9
 * (review 2026-10-28). Decided: merge it into Gropiusstadt.
 */
export function mergeNested(estates: readonly Estate[]): Estate[] {
  const named = estates.filter((e) => e.kind === 'named' && e.outline)
  return estates.filter((e) => {
    if (e.kind === 'named' || !e.outline) return true
    const ring = rings(e.outline)[0] ?? []
    if (!ring.length) return true
    const lon = ring.reduce((a, p) => a + p[0], 0) / ring.length
    const lat = ring.reduce((a, p) => a + p[1], 0) / ring.length
    return !named.some((n) => distanceToOutline(lon, lat, n.outline) === 0)
  })
}

export function estateReach(estates: readonly Estate[], stations: readonly Station[]): EstateReach[] {
  const max = GAP_RADII_M[GAP_RADII_M.length - 1]
  return estates
    .filter((e) => e.outline)
    .map((e) => {
      const rs = rings(e.outline)
      let w = Infinity
      let s = Infinity
      let east = -Infinity
      let north = -Infinity
      for (const r of rs)
        for (const [lo, la] of r) {
          w = Math.min(w, lo)
          east = Math.max(east, lo)
          s = Math.min(s, la)
          north = Math.max(north, la)
        }
      // generous box first: ~0.0075° lon and 0.0045° lat are more than 500 m in Berlin
      const pad = { lon: (max / 111320 / Math.cos((s * Math.PI) / 180)) * 1.05, lat: (max / 110540) * 1.05 }
      const within = Object.fromEntries(GAP_RADII_M.map((r) => [r, { stations: 0, points: 0, bswPoints: 0, ids: [] as string[] }])) as EstateReach['within']
      for (const st of stations) {
        if (st.lon < w - pad.lon || st.lon > east + pad.lon || st.lat < s - pad.lat || st.lat > north + pad.lat) continue
        const d = distanceToOutline(st.lon, st.lat, e.outline)
        for (const r of GAP_RADII_M) {
          if (d > r) continue
          within[r].stations += 1
          within[r].ids.push(st.id)
          within[r].points += st.points
          if (st.bsw) within[r].bswPoints += st.points
        }
      }
      const first = within[GAP_RADII_M[0]]
      return { id: e.id, name: e.name, within, gap: first.points === 0, bswGap: first.bswPoints === 0 }
    })
}

export type ReachSummary = { estates: number; gaps: number; bswGaps: number; points: number; bswPoints: number; bswShare: number | null }

/** Across all estates, each charge point counted ONCE even when it is near two estates. */
export function reachSummary(
  reach: readonly EstateReach[],
  stations: readonly Station[],
  radius: (typeof GAP_RADII_M)[number] = 300,
): ReachSummary {
  const near = new Set(reach.flatMap((r) => r.within[radius].ids))
  const hit = stations.filter((s) => near.has(s.id))
  const points = hit.reduce((a, s) => a + s.points, 0)
  const bswPoints = hit.filter((s) => s.bsw).reduce((a, s) => a + s.points, 0)
  return { estates: reach.length, gaps: reach.filter((r) => r.within[radius].points === 0).length, bswGaps: reach.filter((r) => r.within[radius].bswPoints === 0).length, points, bswPoints, bswShare: points ? bswPoints / points : null }
}
