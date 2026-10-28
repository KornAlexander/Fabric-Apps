import { describe, expect, it } from 'vitest'
import { snapToTerrain, type BuildingsData } from '../lod2'

/** Three buildings, two vertices each, standing at 100 m in the model. */
function fixture(): BuildingsData {
  const n = 6
  const positions = new Int16Array(n * 3)
  for (let v = 0; v < n; v++) positions[v * 3 + 2] = 400 // 100 m at 0.25 m units
  return {
    meta: {
      aoi: 'test',
      source: '',
      attribution: '',
      buildings: 3,
      vertexCount: n,
      origin: { lon: 9, lat: 48 },
      quantisation: { xyScaleM: 0.25, zScaleM: 0.25, zBaseM: 0 },
      indexStride: 16,
      wallClasses: [],
      wallSpread: {},
      roofColour: { measured: 3, total: 3, method: '' },
    },
    positions,
    colours: new Uint8Array(n * 4),
    normals: new Int8Array(n * 3),
    heights: new Uint16Array(n),
    vertexCount: n,
    trees: 0,
    treeVertexCount: 0,
    probes: [],
    index: {
      start: new Uint32Array([0, 2, 4]),
      // Second vertex of each building is its roof, which is what the exploded
      // depot view lifts.
      roofStart: new Uint32Array([1, 3, 5]),
      end: new Uint32Array([2, 4, 6]),
      lon: new Float32Array([9.0, 9.1, 9.2]),
      lat: new Float32Array([48.0, 48.1, 48.2]),
      groundM: new Float32Array([100, 100, 100]),
      applied: new Int16Array(3),
      lifted: new Int16Array(3),
      placed: new Uint8Array(3),
    },
  }
}

describe('terrain snapping', () => {
  it('moves each building by its own difference, not by one global figure', () => {
    // The whole point: a single offset leaves buildings on steep ground proud
    // or sunk, because the cadastre and the DEM disagree by different amounts
    // in the flat centre than on the Weinsteige slope.
    const d = fixture()
    const terrain: Record<string, number> = { '9': 104, '9.1': 106, '9.2': 110 }
    const res = snapToTerrain(d, (lon) => terrain[String(+lon.toFixed(1))])
    expect(res.moved).toBe(3)
    expect(res.pending).toBe(0)
    expect(d.positions[0 * 3 + 2]).toBe(400 + 16) // +4 m at 0.25 m units
    expect(d.positions[2 * 3 + 2]).toBe(400 + 24) // +6 m
    expect(d.positions[4 * 3 + 2]).toBe(400 + 40) // +10 m
    expect(res.medianM).toBeCloseTo(6, 5)
    expect(res.spreadM).toBeGreaterThan(0)
  })

  it('is idempotent, because it re-runs every time the map goes idle', () => {
    // It applies the delta against what it already did. Applying the absolute
    // offset each time would walk every building into the sky.
    const d = fixture()
    const sample = () => 106
    snapToTerrain(d, sample)
    const after = Array.from(d.positions)
    const again = snapToTerrain(d, sample)
    expect(again.moved).toBe(0)
    expect(Array.from(d.positions)).toEqual(after)
  })

  it('falls back to the median where the terrain cannot answer yet', () => {
    // MapLibre only holds DEM tiles for places the camera has been, and the
    // Zacke corridor is a kilometre outside the Kessel view.
    const d = fixture()
    const res = snapToTerrain(d, (lon) => (lon < 9.15 ? 108 : null))
    expect(res.pending).toBe(1)
    expect(d.positions[4 * 3 + 2]).toBe(400 + 32) // the median, 8 m
    // and once the tiles arrive it corrects itself
    const res2 = snapToTerrain(d, () => 120)
    expect(res2.pending).toBe(0)
    expect(d.positions[4 * 3 + 2]).toBe(400 + 80)
  })

  it('reports no movement when there is no terrain at all', () => {
    const d = fixture()
    const res = snapToTerrain(d, () => null)
    expect(res).toEqual({ moved: 0, pending: 3, medianM: 0, spreadM: 0 })
    expect(d.positions[2]).toBe(400)
  })

  it('refuses to move a building somewhere absurd', () => {
    // A DEM tile that is mid-reload answers with whatever it has. Measured on
    // the deployed build after a WebGL context restore: the offset spread went
    // from 4 m to 51 m, which would have flung buildings into the hillside.
    // Real disagreement between the two surveys is bounded; artefacts are not.
    const d = fixture()
    const res = snapToTerrain(d, (lon) => (lon > 9.15 ? 900 : 104))
    expect(res.pending).toBe(1)
    expect(d.positions[4 * 3 + 2]).toBe(400 + 16) // held at the sane median, not +800 m
    expect(res.spreadM).toBeLessThan(40)

    // and it still corrects itself once the tile is really there
    const ok = snapToTerrain(d, () => 104)
    expect(ok.pending).toBe(0)
    expect(d.positions[4 * 3 + 2]).toBe(400 + 16)
  })

  it('leaves a placed building alone even if its terrain goes missing', () => {
    // Once a building sits on real ground it is finished. Re-querying it makes
    // it twitch, because queryTerrainElevation answers from whichever DEM tile
    // happens to be loaded - measured as ~300 ms frame hitches every few
    // seconds, for ever.
    const d = fixture()
    snapToTerrain(d, (lon) => (lon < 9.05 ? 130 : 104))
    const placed = d.positions[0 * 3 + 2]
    expect(placed).toBe(400 + 120) // +30 m, its own real difference

    const res = snapToTerrain(d, () => null)
    expect(res.moved).toBe(0)
    expect(res.pending).toBe(0) // nothing is waiting any more
    expect(d.positions[0 * 3 + 2]).toBe(placed)
  })
})
