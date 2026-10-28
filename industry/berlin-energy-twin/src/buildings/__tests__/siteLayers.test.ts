import { describe, expect, it, vi } from 'vitest'

// Six small sites side by side, 0.01° apart, like the BVG depots over Lichtenberg.
const SITES = Array.from({ length: 6 }, (_, i) => ({
  id: `s${i}`,
  bounds: { west: 13.4 + i * 0.01, east: 13.405 + i * 0.01, south: 52.5, north: 52.505 },
}))

const loads: string[] = []
vi.mock('../lod2', () => ({
  loadSiteList: async () => SITES,
  loadBuildings: async (id: string) => {
    loads.push(id)
    return {}
  },
  createBuildingsLayer: (_d: unknown, o: { id: string }) => ({ id: o.id, type: 'custom' }),
  snapToTerrain: () => ({ moved: 0, pending: 0, medianM: 0, spreadM: 0 }),
}))

import { MAX_LOADED_SITES, SiteLayers } from '../siteLayers'

function fakeMap() {
  const layers = new Set<string>()
  let view = { west: 13.39, east: 13.47, south: 52.49, north: 52.51 }
  const m = {
    getBounds: () => ({ getWest: () => view.west, getEast: () => view.east, getSouth: () => view.south, getNorth: () => view.north }),
    getZoom: () => 13.5,
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    addLayer: (l: { id: string }) => void layers.add(l.id),
    removeLayer: (id: string) => void layers.delete(id),
    getSource: () => undefined,
    addSource: () => undefined,
    removeSource: () => undefined,
    queryTerrainElevation: () => 0,
    triggerRepaint: () => undefined,
  }
  return { m, layers, look: (v: typeof view) => (view = v) }
}

describe('site loading cap', () => {
  it('loads at most four sites while six are in view, and does not keep reloading them (re-review 2026-10-28)', async () => {
    loads.length = 0
    const { m } = fakeMap()
    const sl = new SiteLayers(m as never, { getLight: () => [0, 0, 1] as never, beforeId: () => undefined, surveyTerrain: () => true })
    await sl.init([])
    for (let i = 0; i < 20; i++) await sl.update()
    expect(sl.loadedIds()).toHaveLength(MAX_LOADED_SITES)
    // before the fix: one load per idle, each evicting a visible site
    expect(loads).toHaveLength(MAX_LOADED_SITES)
  })

  it('evicts a site out of view to make room for one coming into view', async () => {
    loads.length = 0
    const { m, layers, look } = fakeMap()
    const sl = new SiteLayers(m as never, { getLight: () => [0, 0, 1] as never, beforeId: () => undefined, surveyTerrain: () => true })
    await sl.init([])
    look({ west: 13.39, east: 13.436, south: 52.49, north: 52.51 }) // s0-s3
    for (let i = 0; i < 6; i++) await sl.update()
    expect(sl.loadedIds()).toEqual(['s0', 's1', 's2', 's3'])
    look({ west: 13.425, east: 13.46, south: 52.49, north: 52.51 }) // s3-s5
    for (let i = 0; i < 6; i++) await sl.update()
    expect(sl.loadedIds().sort()).toEqual(['s2', 's3', 's4', 's5'])
    expect(layers.has('lod2-s0')).toBe(false)
    expect(layers.has('lod2-s1')).toBe(false)
  })
})
