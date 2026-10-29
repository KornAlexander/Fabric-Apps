import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { districtFeatures, districtStats, sparkPath, type ContextDistrict } from '../districts'
import type { ChargingData } from '../charging'

const FILES = ['public/data/charging.json', 'public/data/context.json']
const baked = FILES.every((f) => existsSync(f))
const read = (f: string) => JSON.parse(readFileSync(f, 'utf-8'))

describe('sparkline (D61)', () => {
  it('breaks the line where a year is missing instead of bridging it', () => {
    const p = sparkPath([[2015, 1], [2016, 2], [2020, 3], [2021, 4]], 100, 10)
    expect(p.match(/M/g)).toHaveLength(2)
    expect(p.startsWith('M0.0,')).toBe(true)
    expect(sparkPath([[2020, 1]], 100, 10)).toBe('')
  })
})

describe.runIf(baked)('charging per district on the baked data (D61)', () => {
  const charging = read(FILES[0]) as ChargingData
  const ctx = read(FILES[1]) as { districts: ContextDistrict[] }
  const stats = districtStats(charging.stations, charging.districts, ctx.districts)

  it('covers the 12 districts and adds up to the public register, never the Land total', () => {
    expect(stats).toHaveLength(12)
    expect(stats.reduce((a, s) => a + s.points, 0)).toBe(7582)
    expect(stats.reduce((a, s) => a + s.bswPoints, 0)).toBe(1764)
    expect(stats.every((s) => s.allPoints !== null && s.allPoints >= s.points)).toBe(true)
  })

  it('gives plausible points per 1,000 residents and shares', () => {
    for (const s of stats) {
      expect(s.per1000).toBeGreaterThan(0)
      expect(s.per1000).toBeLessThan(10)
      expect(s.bswShare).not.toBeNull()
      expect(s.bswShare!).toBeLessThanOrEqual(1)
    }
  })

  it('carries the kWh years the Land published, 2017 to 2019 absent', () => {
    const years = stats[0].kwhByYear.map(([y]) => y)
    expect(years).toContain(2024)
    expect(years).not.toContain(2018)
  })

  it('makes one area and one label point per district', () => {
    const fc = districtFeatures(stats, ctx.districts, (s) => s.bez, (s) => s.bez)
    expect(fc.features.filter((f) => f.geometry.type === 'Point')).toHaveLength(12)
    expect(fc.features).toHaveLength(24)
  })
})
