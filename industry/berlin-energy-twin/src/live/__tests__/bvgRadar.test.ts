import { describe, expect, it } from 'vitest'
import { backoffMs, clampToBerlin, parseRadar, POLL_MS, radarUrl, vehicleFeatures } from '../bvgRadar'

const mv = (product: string, operator: string, id: string, lon = 13.4, lat = 52.5) => ({
  tripId: id,
  direction: 'Ziel',
  location: { latitude: lat, longitude: lon },
  line: { name: 'M10', product, operator: { id: operator } },
})

describe('BVG radar (D55)', () => {
  it('keeps BVG only: S-Bahn and DB trains in the answer are dropped', () => {
    const r = parseRadar({ movements: [mv('tram', 'berliner-verkehrsbetriebe', 'a'), mv('suburban', 's-bahn-berlin-gmbh', 'b'), mv('bus', 'berliner-verkehrsbetriebe', 'c')] })
    expect(r.vehicles.map((v) => v.id)).toEqual(['a', 'c'])
    expect(r.vehicles[0].mode).toBe('tram')
  })

  it('drops movements without a usable position and duplicates', () => {
    const bad = { ...mv('bus', 'berliner-verkehrsbetriebe', 'x'), location: { latitude: null } }
    const r = parseRadar([bad, mv('bus', 'berliner-verkehrsbetriebe', 'y'), mv('bus', 'berliner-verkehrsbetriebe', 'y')])
    expect(r.vehicles.map((v) => v.id)).toEqual(['y'])
  })

  it('says when the answer hit the cap, counting every movement, not just BVG', () => {
    expect(parseRadar([mv('suburban', 'db', 'a'), mv('bus', 'berliner-verkehrsbetriebe', 'b')], 2).capped).toBe(true)
    expect(parseRadar([mv('bus', 'berliner-verkehrsbetriebe', 'b')], 2).capped).toBe(false)
    expect(parseRadar('nonsense').vehicles).toEqual([])
  })

  it('asks for Berlin only and backs off up to five minutes', () => {
    const b = clampToBerlin({ north: 53.5, south: 51.9, west: 12.1, east: 14.9 })
    expect(b).toEqual({ north: 52.7, south: 52.32, west: 13.05, east: 13.8 })
    expect(radarUrl(b)).toContain('north=52.70000')
    expect(backoffMs(1)).toBe(2 * POLL_MS)
    expect(backoffMs(20)).toBe(300_000)
  })

  it('turns vehicles into points for the map', () => {
    const fc = vehicleFeatures(parseRadar([mv('subway', 'berliner-verkehrsbetriebe', 'u')]).vehicles)
    expect(fc.features[0].geometry).toEqual({ type: 'Point', coordinates: [13.4, 52.5] })
    expect(fc.features[0].properties).toMatchObject({ line: 'M10', mode: 'subway' })
  })
})
