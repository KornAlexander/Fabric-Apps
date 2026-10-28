import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Station } from '../../charging/charging'
import type { Estate } from '../partners'
import { distanceToOutline, estateReach, mergeNested, reachSummary } from '../chargingGap'

// A 0.002° x 0.002° square in Berlin: about 136 m east-west, 222 m north-south.
const SQUARE: Estate = {
  id: 'sq',
  name: 'Square',
  kind: 'named',
  outline: {
    type: 'Polygon',
    coordinates: [
      [
        [13.4, 52.5],
        [13.402, 52.5],
        [13.402, 52.502],
        [13.4, 52.502],
        [13.4, 52.5],
      ],
    ],
  },
}
const st = (lon: number, lat: number, points: number, bsw: boolean): Station => ({
  id: `${lon},${lat}`,
  lon,
  lat,
  op: bsw ? 'Berliner Stadtwerke' : 'Other',
  bsw,
  addr: '',
  plz: null,
  bez: null,
  points,
  kw: 22,
  dc: false,
  year: 2024,
  public: true,
})

describe('straight-line distance to an estate', () => {
  it('is 0 inside the outline', () => {
    expect(distanceToOutline(13.401, 52.501, SQUARE.outline)).toBe(0)
  })

  it('measures to the nearest edge, in metres', () => {
    // 0.001° north of the north edge = 111 m
    expect(distanceToOutline(13.401, 52.503, SQUARE.outline)).toBeCloseTo(111.3, 0)
    // 0.003° east of the east edge = 0.003 * 111320 * cos(52.5°) ≈ 203 m
    expect(distanceToOutline(13.405, 52.501, SQUARE.outline)).toBeCloseTo(203.3, 0)
  })

  it('is infinite without an outline, so such an estate is never "covered"', () => {
    expect(distanceToOutline(13.4, 52.5, null)).toBe(Infinity)
  })
})

describe('charging around estates', () => {
  it('counts points per radius and flags an area without Stadtwerke points', () => {
    const [r] = estateReach([SQUARE], [st(13.401, 52.501, 2, false), st(13.401, 52.5045, 4, true), st(13.42, 52.5, 9, true)])
    // inside: 2 points; 278 m north: 4 Stadtwerke points; 1.2 km east: ignored
    expect(r.within[300]).toMatchObject({ stations: 2, points: 6, bswPoints: 4 })
    expect(r.within[500]).toMatchObject({ stations: 2, points: 6, bswPoints: 4 })
    expect(r.gap).toBe(false)
    expect(r.bswGap).toBe(false)

    const lone = [st(13.401, 52.501, 2, false)]
    const [none] = estateReach([SQUARE], lone)
    expect(none.bswGap).toBe(true)
    expect(reachSummary([none], lone)).toMatchObject({ estates: 1, gaps: 0, bswGaps: 1, points: 2, bswPoints: 0, bswShare: 0 })
  })

  it('counts a point near two estates once, and folds an area lying inside a named estate into it (review 2026-10-28)', () => {
    const inner: Estate = {
      id: 'inner',
      name: '12345 · Inner',
      kind: 'cluster',
      outline: { type: 'Polygon', coordinates: [[[13.4005, 52.5005], [13.4015, 52.5005], [13.4015, 52.5015], [13.4005, 52.5015], [13.4005, 52.5005]]] },
    }
    const stations = [st(13.401, 52.501, 3, true), st(13.401, 52.5035, 2, false)]
    const both = estateReach([SQUARE, inner], stations)
    // without dedupe the point inside both would count 3 + 3
    expect(reachSummary(both, stations).points).toBe(5)
    expect(mergeNested([SQUARE, inner]).map((e) => e.id)).toEqual(['sq'])
  })

  it.runIf(existsSync('public/data/sites.json') && existsSync('public/data/charging.json'))(
    'on the baked data: every degewo area has public charging within 300 m, the Stadtwerke share there is below the city share',
    () => {
      const sites = JSON.parse(readFileSync('public/data/sites.json', 'utf-8'))
      const stations = JSON.parse(readFileSync('public/data/charging.json', 'utf-8')).stations as Station[]
      const merged = mergeNested(sites.estates)
      const s = reachSummary(estateReach(merged, stations), stations)
      // Feuchtwangerweg (12353) lies inside Gropiusstadt and is folded into it
      expect(merged.some((e) => e.id.includes('12353'))).toBe(false)
      expect(s.estates).toBe(merged.filter((e) => e.outline).length)
      expect(s.points).toBeGreaterThan(0)
      const cityShare = stations.filter((x) => x.bsw).reduce((a, x) => a + x.points, 0) / stations.reduce((a, x) => a + x.points, 0)
      // the tour says "below the city-wide share": keep that sentence honest
      expect(s.bswShare!).toBeLessThan(cityShare)
    },
  )
})
