import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('maplibre-gl', () => ({ default: { addProtocol: vi.fn() } }))

import { decodeTerrarium, encodeTerrarium, makeLookup, resample, route, type TerrainManifest } from '../demProtocol'

const M: TerrainManifest = {
  minzoom: 8,
  maxzoom: 16,
  city: { zooms: [8, 13] },
  tiles: { '13': ['4400/2685'], '16': ['35200/21480'] },
}
const baked = makeLookup(M)

describe('terrain routing', () => {
  it('serves baked tiles as they are', () => {
    expect(route(M, baked, 13, 4400, 2685).kind).toBe('baked')
    expect(route(M, baked, 16, 35200, 21480).kind).toBe('baked')
  })

  it('resamples deeper tiles inside Berlin from the baked city tile, never AWS', () => {
    const r = route(M, baked, 15, 4400 * 4 + 1, 2685 * 4 + 3)
    expect(r).toMatchObject({ kind: 'resample', from: { z: 13, x: 4400, y: 2685, baked: true } })
  })

  it('takes AWS outside Berlin, and resamples AWS past its zoom 15', () => {
    expect(route(M, baked, 12, 1, 1).kind).toBe('aws')
    expect(route(M, baked, 16, 2, 2)).toMatchObject({ kind: 'resample', from: { z: 15, x: 1, y: 1, baked: false } })
  })

  it('does not fall back to a coarse zoom 8 tile for deep tiles outside the city', () => {
    const wide: TerrainManifest = { ...M, tiles: { '8': ['137/83'] } }
    expect(route(wide, makeLookup(wide), 15, 137 * 128, 83 * 128).kind).toBe('aws')
  })
})

describe('terrarium encoding', () => {
  it('round-trips heights to 1/256 m, Berlin to Teufelsberg', () => {
    const h = new Float32Array([0, 34.6, 115.0625, -1.5])
    const back = decodeTerrarium(encodeTerrarium(h))
    for (let i = 0; i < h.length; i++) expect(Math.abs(back[i] - h[i])).toBeLessThanOrEqual(1 / 512)
  })
})

describe('resampling', () => {
  it('keeps a plane a plane, so slopes do not step at tile borders', () => {
    const src = new Float32Array(256 * 256)
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) src[j * 256 + i] = 40 + 0.1 * i + 0.05 * j
    const out = resample(src, { z: 13, x: 10, y: 20 }, 14, 21, 40)
    // child (1, 0) of the parent covers source columns 128-255, rows 0-127
    // first pixel centre lands on source column 127.75; row -0.25 is clamped to the edge row 0
    expect(out[0]).toBeCloseTo(40 + 0.1 * 127.75, 4)
    expect(out[255 * 256 + 255] - out[0]).toBeCloseTo(0.1 * 127.5 + 0.05 * 127.5, 1)
  })
})

describe('baked terrain (tools/bake_terrain.py)', () => {
  const path = 'public/data/terrain.json'
  it.runIf(existsSync(path))('covers the city to zoom 13 and the hero site to zoom 16', () => {
    const m = JSON.parse(readFileSync(path, 'utf-8')) as TerrainManifest & { licence: string }
    expect(m.licence).toContain('Zero')
    expect(m.city.zooms).toEqual([8, 13])
    expect(m.tiles['13'].length).toBeGreaterThan(80)
    // Waldsassener Str. 31, the hero (D28)
    const lon = 13.3497
    const lat = 52.4097
    const n = 2 ** 16
    const x = Math.floor(((lon + 180) / 360) * n)
    const y = Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n)
    expect(makeLookup(m)(16, x, y)).toBe(true)
    // every listed tile, not a sample: a missing one would reach the browser as HTML on Fabric
    const missing = Object.entries(m.tiles).flatMap(([z, list]) => list.filter((k) => !existsSync(`public/data/terrain/${z}/${k}.webp`)).map((k) => `${z}/${k}`))
    expect(missing).toEqual([])
  })
})
