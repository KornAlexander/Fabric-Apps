import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { bswShare, distanceM, latestKwh, summarise, within, type ChargingData, type Station } from '../charging'

const st = (over: Partial<Station>): Station => ({
  id: 'x',
  lon: 13.4,
  lat: 52.52,
  op: 'Someone GmbH',
  bsw: false,
  addr: 'Teststraße 1',
  plz: '10115',
  bez: 'Mitte',
  points: 2,
  kw: 11,
  dc: false,
  year: 2024,
  public: true,
  ...over,
})

describe('charging summary (register data, no live status)', () => {
  it('counts points, DC points, public-space points and installed power', () => {
    const s = summarise([st({}), st({ points: 1, kw: 150, dc: true, public: false }), st({ kw: null })])
    expect(s).toEqual({ stations: 3, points: 5, dcPoints: 1, publicSpacePoints: 4, installedKw: 22 + 150 })
  })

  it('gives BSW share of points, not of stations', () => {
    expect(bswShare([st({ bsw: true, points: 1 }), st({ points: 3 })])).toBe(25)
    expect(bswShare([])).toBeNull()
  })

  it('measures distance as the crow flies', () => {
    // 0.01 deg latitude is about 1.11 km everywhere
    expect(distanceM(13.4, 52.5, 13.4, 52.51)).toBeCloseTo(1112, -1)
    const near = within([st({ lat: 52.5027 }), st({ lat: 52.506 })], 13.4, 52.5, 500)
    expect(near).toHaveLength(1)
  })

  it('takes the latest published year, skipping gaps', () => {
    expect(latestKwh({ bez: 'X', allPoints: 1, allPointsKw: 1, pointsAsOf: '', publicKwhByYear: { '2016': 5, '2024': 9 } }))
      .toEqual({ year: 2024, kwh: 9 })
    expect(latestKwh({ bez: 'X', allPoints: 1, allPointsKw: 1, pointsAsOf: '', publicKwhByYear: {} })).toBeNull()
  })
})

describe('the shipped charging bake', () => {
  const data = JSON.parse(
    readFileSync(new URL('../../../public/data/charging.json', import.meta.url), 'utf-8'),
  ) as ChargingData

  it('lies entirely in Berlin (catches an EPSG:25832/25833 mix-up, review S10)', () => {
    for (const s of data.stations) {
      expect(s.lon, s.id).toBeGreaterThan(13.05)
      expect(s.lon, s.id).toBeLessThan(13.8)
      expect(s.lat, s.id).toBeGreaterThan(52.3)
      expect(s.lat, s.id).toBeLessThan(52.7)
    }
  })

  it('has BSW as a real operator and twelve districts', () => {
    const bsw = data.stations.filter((s) => s.bsw)
    expect(bsw.length).toBeGreaterThan(500)
    expect(new Set(bsw.map((s) => s.op))).toEqual(
      new Set(['Berliner Stadtwerke KommunalPartner GmbH', 'Berliner Stadtwerke EnergiePartner GmbH']),
    )
    expect(data.districts).toHaveLength(12)
  })

  it('carries its licence', () => {
    expect(data.meta.licence).toMatch(/Zero/)
  })
})
