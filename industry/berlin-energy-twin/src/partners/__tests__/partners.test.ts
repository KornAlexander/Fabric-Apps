import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  lensBounds,
  lensSummary,
  lensUnits,
  openKw,
  postcodeAggregates,
  postcodeFills,
  rankRoofs,
  roofBars,
  roofShare,
  unitPoints,
  BAR_M_PER_KW,
  type SitesData,
  type Unit,
} from '../partners'

const read = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../public/data/${name}`, import.meta.url), 'utf-8'))
const units: Unit[] = read('units.json').units
const sites: SitesData = read('sites.json')

describe('roof gap (D33)', () => {
  it('caps the share used at 100 % where more is installed than the atlas estimates', () => {
    // Bismarckstrasse 17: 81.5 kWp installed on a roof the atlas puts at 45.2
    expect(roofShare({ potKw: 45.2, installedKw: 81.5 })).toBe(1)
    expect(openKw({ potKw: 45.2, installedKw: 81.5 })).toBe(0)
  })

  it('has no share without a potential, rather than dividing by zero', () => {
    expect(roofShare({ potKw: 0, installedKw: 10 })).toBeNull()
  })

  it('ranks the hero first-tier: largest open potential first', () => {
    const top = rankRoofs(sites.buildings)
    expect(openKw(top[0])).toBeGreaterThanOrEqual(openKw(top[1]))
    // Waldsassener Strasse 31 (the hero car park) is among the three biggest gaps
    expect(top.slice(0, 3).map((r) => r.addr)).toContain('Waldsassener Straße 31')
  })

  it('stands a bar on its roof, as tall as the open potential at the stated scale', () => {
    const r = { ...sites.buildings[0], potKw: 100, installedKw: 40 }
    const bar = roofBars([r], { roofs: { [String(r.id)]: { site: 'x', groundM: 40, roofM: 12 } } }).features[0]
    expect(bar.properties.base).toBe(12)
    expect(bar.properties.top).toBe(12 + 60 * BAR_M_PER_KW)
  })
})

describe('lens figures match the register', () => {
  it('sums each partner from its own units, so the three lenses add up to the fleet (review S1)', () => {
    const kw = (us: Unit[]) => us.reduce((a, u) => a + (u.kwGross ?? 0), 0)
    const byLens = (['degewo', 'bvg', 'bsw'] as const).map((l) => lensSummary(l, units, sites).allKw)
    expect(byLens.reduce((a, b) => a + b, 0)).toBeCloseTo(kw(units), 3)
  })

  const kw = (us: Unit[]) => us.reduce((a, u) => a + (u.kwGross ?? 0), 0)

  it('calls only photovoltaics "solar"; wind, gas, biomass and storage are listed apart (review 2026-10-28)', () => {
    for (const l of ['degewo', 'bvg', 'bsw'] as const) {
      const s = lensSummary(l, units, sites)
      const pv = units.filter((u) => u.queries.includes(l) && u.carrier === 'Solare Strahlungsenergie')
      expect(s.kw, l).toBeCloseTo(kw(pv), 3)
      expect(s.units, l).toBe(pv.length)
      expect(s.kw + s.other.reduce((a, o) => a + o.kw, 0), l).toBeCloseTo(s.allKw, 3)
      expect(s.other.some((o) => o.carrier === 'Solare Strahlungsenergie'), l).toBe(false)
    }
    // the case that was caught: degewo PV is well under half of its all-carrier total
    const d = lensSummary('degewo', units, sites)
    expect(d.kw).toBeLessThan(d.allKw * 0.6)
  })

  it('splits every unit into located or postcode-only, nothing in between', () => {
    for (const l of ['degewo', 'bvg', 'bsw'] as const) {
      const s = lensSummary(l, units, sites)
      expect(s.located + s.postcodeOnly, l).toBe(s.units)
    }
  })

  it('knows the BVG sites being built and the 2025 agreement', () => {
    const s = lensSummary('bvg', units, sites)
    expect(s.depots?.construction).toBe(3)
    expect(s.depots?.deal2025).toBe(8)
  })
})

describe('postcode aggregates (D18, D34)', () => {
  it('aggregates only units without a position, and every one of them', () => {
    const bsw = lensUnits(units, 'bsw')
    const agg = postcodeAggregates(bsw, sites.placements)
    const n = agg.reduce((a, g) => a + g.n, 0)
    expect(n).toBe(lensSummary('bsw', units, sites).postcodeOnly)
    // and none of them is drawn as a point
    const pts = unitPoints(bsw, sites.placements).features.map((f) => f.properties.id)
    for (const u of bsw) if (sites.placements[u.id]?.method === 'postcode') expect(pts).not.toContain(u.id)
  })

  it('shades only postcodes that have an aggregate', () => {
    const agg = postcodeAggregates(lensUnits(units, 'bsw'), sites.placements)
    const f = postcodeFills(sites.postcodes, agg)
    expect(f.features.length).toBeGreaterThan(0)
    expect(f.features.length).toBeLessThanOrEqual(agg.length)
  })
})

describe('lens camera', () => {
  it('frames every lens inside Berlin', () => {
    for (const l of ['degewo', 'bvg', 'bsw'] as const) {
      const b = lensBounds(l, units, sites)!
      expect(b[0][0]).toBeGreaterThan(13.05)
      expect(b[1][0]).toBeLessThan(13.8)
      expect(b[0][1]).toBeGreaterThan(52.3)
      expect(b[1][1]).toBeLessThan(52.7)
    }
  })
})
