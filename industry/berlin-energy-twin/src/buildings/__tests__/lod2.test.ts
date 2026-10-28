import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { photoRect, validatePayload } from '../lod2'

const data = (name: string) => new URL(`../../../public/data/${name}`, import.meta.url)
const json = (name: string) => JSON.parse(readFileSync(data(name), 'utf-8'))

describe('roof photo (D26)', () => {
  it('maps the photo bounds into the payload frame: origin at 0, north up, mercator metres', () => {
    const origin = { lon: 13.35, lat: 52.41 }
    const [x0, y0, x1, y1] = photoRect({ west: 13.35, east: 13.36, south: 52.41, north: 52.42 }, origin, 0.25)
    expect(x0).toBeCloseTo(0, 6)
    expect(y0).toBeCloseTo(0, 6)
    // 0.01 degree of longitude is 1113.2 mercator metres anywhere: 4452.8 quarter metres
    expect(x1).toBeCloseTo(4452.8, 0)
    // north is +y, and a degree of mercator latitude is longer than one of longitude here
    expect(y1).toBeGreaterThan(x1)
  })
})

describe('shipped Berlin LoD2 sites and aerials (D29)', () => {
  const manifest = json('buildings.json')
  const aerial = json('aerial.json')
  type Site = { id: string; bounds: { west: number; east: number; south: number; north: number }; trees: number }
  const sites: Site[] = manifest.sites

  it('ships every site with byte counts that match its own metadata', () => {
    expect(sites.length).toBeGreaterThanOrEqual(15)
    for (const s of sites) {
      const meta = json(`buildings-${s.id}.json`)
      const pos = readFileSync(data(`buildings-${s.id}.bin`)).byteLength
      const idx = readFileSync(data(`buildings-${s.id}_index.bin`)).byteLength
      expect(validatePayload(meta, pos, idx), s.id).toBeNull()
      expect(meta.source).toMatch(/Geoportal Berlin.*LoD2.*DL-DE-Zero/)
    }
  })

  it('measures roof colour for nearly every building', () => {
    let measured = 0
    let total = 0
    for (const s of sites) {
      const meta = json(`buildings-${s.id}.json`)
      measured += meta.roofColour.measured
      total += meta.roofColour.total
    }
    expect(measured / total).toBeGreaterThan(0.95)
  })

  it('never puts a building in two sites: site boxes do not overlap', () => {
    for (let i = 0; i < sites.length; i++) {
      for (let j = i + 1; j < sites.length; j++) {
        const a = sites[i].bounds
        const b = sites[j].bounds
        const overlap = a.west < b.east && b.west < a.east && a.south < b.north && b.south < a.north
        expect(overlap, `${sites[i].id} / ${sites[j].id}`).toBe(false)
      }
    }
  })

  it('gives every site its own sharp photo, under the 4096 px texture ceiling', () => {
    const photos = new Map(aerial.patches.map((p: { id: string }) => [p.id, p]))
    expect(aerial.patches[0].id).toBe('base')
    for (const s of sites) expect(photos.has(s.id), s.id).toBe(true)
    for (const p of aerial.patches) expect(Math.max(...p.shippedPx)).toBeLessThanOrEqual(4096)
  })

  it('covers the hero, Waldsassener Strasse 31, with register trees (D28, D31)', () => {
    const hero = sites.find((s) => s.id === 'marienfelde')!
    const b = hero.bounds
    expect(13.35128 > b.west && 13.35128 < b.east && 52.409205 > b.south && 52.409205 < b.north).toBe(true)
    const trees = json('trees-marienfelde.json')
    expect(trees.count).toBeGreaterThan(1000)
    expect(trees.source).toMatch(/Baumbestand/)
    // estimates are counted, not hidden
    expect(trees.estimated.crown).toBeGreaterThan(0)
    expect(readFileSync(data('trees-marienfelde.bin')).byteLength).toBe(trees.count * trees.stride)
  })
})

describe('LoD2 payload', () => {
  it('rejects a payload whose size disagrees with the metadata', () => {
    // Static hosting returns index.html with HTTP 200 for a missing file, so
    // response.ok proves nothing and HTML would be read as vertex coordinates.
    expect(validatePayload({ vertexCount: 10, buildings: 2, indexStride: 16 }, 60, 32)).toBeNull()
    expect(validatePayload({ vertexCount: 10, buildings: 2, indexStride: 16 }, 59, 32)).toMatch(
      /buildings\.bin/,
    )
    expect(validatePayload({ vertexCount: 10, buildings: 2, indexStride: 15 }, 60, 32)).toMatch(
      /index/,
    )
  })
})
