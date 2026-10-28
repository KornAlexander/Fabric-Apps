import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Invariants of the shipped bakes (PLAN §6, review S1/S3/S7/S10). These read the
 * real files, so a bake that drifts fails here before it reaches the app.
 */
const read = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../public/data/${name}`, import.meta.url), 'utf-8'))

type Unit = { id: string; queries: string[]; kwGross: number | null; carrier: string; located: boolean; city: string }
type Placement = { method: string; lon?: number; lat?: number; plz?: string; depot?: string; buildings?: string[] }

const units: Unit[] = read('units.json').units
const sites = read('sites.json')
const placements: Record<string, Placement> = sites.placements

describe('register units', () => {
  it('has one row per MaStR unit number (review S1)', () => {
    expect(new Set(units.map((u) => u.id)).size).toBe(units.length)
  })

  it('never double counts: the partner totals add up to the fleet total', () => {
    const kw = (us: Unit[]) => us.reduce((a, u) => a + (u.kwGross ?? 0), 0)
    const byPartner = ['bsw', 'degewo', 'bvg'].map((p) => kw(units.filter((u) => u.queries.includes(p))))
    expect(byPartner.reduce((a, b) => a + b, 0)).toBeCloseTo(kw(units), 3)
  })

  it('stores legal entities only (the bake drops natural persons before writing)', () => {
    expect(read('units.json').meta.notes).toMatch(/Legal entities only/)
  })
})

describe('placements', () => {
  it('places every unit, by a named method', () => {
    for (const u of units) {
      expect(placements[u.id], u.id).toBeDefined()
      expect(['register', 'address', 'address-osm', 'depot', 'postcode'], u.id).toContain(placements[u.id].method)
    }
  })

  it('never invents a point: postcode placements carry no coordinates (D18)', () => {
    for (const [id, p] of Object.entries(placements)) {
      if (p.method === 'postcode') expect(p.lon, id).toBeUndefined()
      else expect(typeof p.lon, id).toBe('number')
    }
  })

  it('puts every derived point inside Berlin (review S10)', () => {
    for (const [id, p] of Object.entries(placements)) {
      if (p.method === 'address' || p.method === 'address-osm' || p.method === 'depot') {
        expect(p.lon! > 13.05 && p.lon! < 13.8 && p.lat! > 52.3 && p.lat! < 52.7, id).toBe(true)
      }
    }
  })
})

describe('sites', () => {
  it('gives context buildings no address (review S7)', () => {
    for (const c of sites.context) expect(c.addr, c.id).toBeUndefined()
  })

  it('names a source for every estate and depot (D19, D24)', () => {
    for (const e of sites.estates) expect(sites.sources[e.source], e.id).toMatch(/^https:/)
    for (const d of sites.depots) expect(sites.sources[d.source], d.id).toMatch(/^https:/)
  })

  it('marks the depots under construction', () => {
    const building = sites.depots.filter((d: { status: string }) => d.status === 'construction').map((d: { id: string }) => d.id)
    expect(building.sort()).toEqual(['rummelsburger', 'saentis', 'treptow'])
  })
})

describe('context', () => {
  const ctx = read('context.json')

  it('has today\'s twelve districts and puts every resident in one of them', () => {
    expect(ctx.districts).toHaveLength(12)
    const total = ctx.districts.reduce((a: number, d: { residents: number }) => a + d.residents, 0)
    // Residents register (main residence), about 3.9 million: not the census-based 3.70 million.
    expect(total).toBeGreaterThan(3_800_000)
    expect(total).toBeLessThan(4_000_000)
  })

  it('labels the heat areas as buffered network areas with their operator', () => {
    expect(ctx.meta.source).toMatch(/250 m buffer/)
    for (const h of ctx.heat) expect(h.operator).toBeTruthy()
  })
})
