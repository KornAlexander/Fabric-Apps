import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { STRINGS, type StringKey } from '../../i18n/strings'
import { buildTour, centroid, flightMs, gapFeatures, type TourStop } from '../tour'
import { districtStats } from '../../charging/districts'
import { estateReach, mergeNested, reachSummary } from '../../partners/chargingGap'
import { LENSES, lensSummary } from '../../partners/partners'

const FILES = ['public/data/sites.json', 'public/data/units.json', 'public/data/charging.json', 'public/data/aerial.json']
const baked = FILES.every((f) => existsSync(f))
const read = (f: string) => JSON.parse(readFileSync(f, 'utf-8'))
const fmt = {
  n: (v: number) => v.toLocaleString('de-DE'),
  kw: (v: number) => `${Math.round(v)} kW`,
  pct: (x: number) => `${Math.round(x * 100)} %`,
  carrier: (c: string) => c,
  dec1: (v: number) => v.toFixed(1),
}

function tour(lang: 'de' | 'en', full = true): TourStop[] {
  const charging = read(FILES[2])
  const districts = full && existsSync('public/data/context.json')
    ? districtStats(charging.stations, charging.districts, read('public/data/context.json').districts)
    : null
  return buildTour({ units: read(FILES[1]).units, sites: read(FILES[0]), stations: charging.stations, districts, hasReport: full }, fmt, lang)
}

describe('centroid', () => {
  it('averages the outer ring', () => {
    expect(centroid({ type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2]]] })).toEqual([1, 1])
    expect(centroid(null)).toBeNull()
  })
})

describe('flight time (D54)', () => {
  const at = (lon: number, lat: number, zoom = 12) => ({ center: [lon, lat] as [number, number], zoom, pitch: 0, bearing: 0 })
  it('is quick for a short hop, longer across the city, and bounded', () => {
    const near = flightMs(at(13.4, 52.5), at(13.41, 52.5))
    const far = flightMs(at(13.2, 52.4), at(13.6, 52.6, 16))
    expect(near).toBeLessThan(far)
    expect(near).toBeGreaterThanOrEqual(2200)
    expect(far).toBeLessThanOrEqual(5200)
    expect(flightMs(null, at(13.4, 52.5))).toBe(3000)
  })
})

describe.runIf(baked)('guided tour on the baked data', () => {
  it('has the ten decided stops in story order (D62), and drops the two that need data it lacks', () => {
    expect(tour('de').map((s) => s.id)).toEqual(['overview', 'now', 'districts', 'charging', 'hero', 'roofs', 'bvg', 'live', 'report', 'close'])
    expect(tour('de', false).map((s) => s.id)).toEqual(['overview', 'now', 'charging', 'hero', 'roofs', 'bvg', 'live', 'close'])
  })

  it('marks the live stops and what each stop switches on', () => {
    const by = Object.fromEntries(tour('de').map((s) => [s.id, s]))
    expect(by.now.live).toBe('solar')
    expect(by.live.live).toBe('vehicles')
    expect(by.live.bvgLive).toBe(true)
    expect(by.live.badges).toContain('unofficial')
    expect(by.districts.overlay).toBe('districts')
    expect(by.report.report).toBe('stadtwerke')
    expect(by.hero.realism).toBe(true)
    expect(by.districts.params.top).toBe('Spandau')
  })

  it('fills every placeholder of every caption, in both languages', () => {
    for (const lang of ['de', 'en'] as const) {
      for (const s of tour(lang)) {
        for (const key of [s.title, s.body, s.figureLabel, s.source] as StringKey[]) {
          const tpl: string = STRINGS[lang][key]
          for (const [, name] of tpl.matchAll(/\{(\w+)\}/g)) {
            expect(s.params[name], `${lang} ${s.id} ${key} {${name}}`).toBeTruthy()
          }
        }
        expect(s.figure).not.toMatch(/NaN|undefined/)
      }
    }
  })

  it('flies only to Berlin, and every 3D stop lands inside a photo-textured site', () => {
    const patches = read(FILES[3]).patches.filter((p: { imageryOnly?: boolean }) => !p.imageryOnly)
    for (const s of tour('de')) {
      const [lon, lat] = s.camera.center
      expect(lon).toBeGreaterThan(13.08)
      expect(lon).toBeLessThan(13.77)
      expect(lat).toBeGreaterThan(52.33)
      expect(lat).toBeLessThan(52.68)
      expect(Object.values(s.camera).every((v) => v !== undefined)).toBe(true)
      if (s.realism) {
        const inside = patches.some((p: { bounds: { west: number; east: number; south: number; north: number } }) => lon > p.bounds.west && lon < p.bounds.east && lat > p.bounds.south && lat < p.bounds.north)
        expect(inside, s.id).toBe(true)
      }
    }
  })

  it('badges what it must: estimates, aggregates and straight-line distance', () => {
    const by = Object.fromEntries(tour('de').map((s) => [s.id, s]))
    expect(by.roofs.badges).toContain('estimate')
    expect(by.hero.badges).toContain('estimate')
    expect(by.now.badges).toContain('estimate')
    expect(by.close.badges).toContain('estimate')
    expect(by.charging.badges).toContain('airline')
    expect(by.charging.overlay).toBe('gap')
    expect(by.close.badges).toContain('aggregated')
  })

  it('outlines the gap areas for the map, red only where no Stadtwerke point is within 300 m', () => {
    const sites = read(FILES[0])
    const reach = estateReach(mergeNested(sites.estates), read(FILES[2]).stations)
    const g = gapFeatures(sites.estates, reach)
    const areas = g.features.filter((f) => (f.geometry as { type: string }).type !== 'Point')
    const rings = g.features.filter((f) => (f.geometry as { type: string }).type === 'Point')
    expect(areas.length).toBe(reach.length)
    expect(areas.filter((f) => f.properties.bswGap).length).toBe(reach.filter((r) => r.bswGap).length)
    // one ring marker per gap area, so a small area still reads at city zoom
    expect(rings.length).toBe(reach.filter((r) => r.bswGap).length)
  })

  // The tour speaks these numbers. A re-bake that moves them must fail here
  // and get the captions re-read, not shift the story silently (re-review 2026-10-28).
  it('keeps the headline figures the tour was checked with', () => {
    const sites = read(FILES[0])
    const units = read(FILES[1]).units
    const stations = read(FILES[2]).stations
    const mw = (kw: number) => Math.round(kw / 100) / 10
    const s = Object.fromEntries(LENSES.map((l) => [l, lensSummary(l, units, sites)]))
    expect(mw(s.bsw.kw)).toBe(19.4)
    expect(s.bsw.units).toBe(248)
    expect(mw(s.degewo.kw)).toBe(2.2)
    expect(mw(s.bvg.kw)).toBe(2.1)
    expect(mw(LENSES.reduce((a, l) => a + s[l].other.reduce((b, o) => b + o.kw, 0), 0))).toBe(6.6)

    const reach = estateReach(mergeNested(sites.estates), stations)
    expect(reachSummary(reach, stations)).toMatchObject({ estates: 9, points: 464, bswPoints: 71 })
    expect(reach.filter((r) => r.bswGap).map((r) => r.name)).toEqual([expect.stringContaining('Himbeersteig')])
  })
})
