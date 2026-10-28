/**
 * LoD2 buildings as a MapLibre custom WebGL layer.
 *
 * MapLibre's own `fill-extrusion` can only raise a footprint into a flat-topped
 * box. Berlin outside the Ring is a city of pitched roofs, and boxes would
 * read as a different place - so the real LoD2 surfaces are drawn instead:
 * every gable, hip and tower the survey recorded, with each roof wearing the
 * colour measured from the orthophoto.
 *
 * Coordinates arrive as Web Mercator metres from an origin, quantised to
 * decimetres. That is deliberate: mercator metres are exactly linear in
 * MapLibre's world space, so the whole transform is one constant matrix and no
 * per-vertex projection maths - and no drift between the buildings and the map.
 *
 * Normals, per-vertex colour and height-above-base are all derived on load
 * rather than downloaded. They would have tripled the payload for information
 * the geometry already contains.
 */
import type { CustomRenderMethodInput, CustomLayerInterface, Map as MlMap } from 'maplibre-gl'
import { fetchFile } from '../lib/fetchBaked'

export type BuildingsMeta = {
  aoi: string
  source: string
  attribution: string
  buildings: number
  vertexCount: number
  origin: { lon: number; lat: number }
  quantisation: { xyScaleM: number; zScaleM: number; zBaseM: number }
  indexStride: number
  wallClasses: string[]
  wallSpread: Record<string, number>
  roofColour: { measured: number; total: number; method: string }
}

export type BuildingsData = {
  meta: BuildingsMeta
  positions: Int16Array
  colours: Uint8Array
  normals: Int8Array
  /** decimetres above the building's own lowest point */
  heights: Uint16Array
  vertexCount: number
  /** how many of the vertices are trees, at the end of the buffers */
  trees: number
  /** vertex count of the tree geometry, which never moves after load */
  treeVertexCount: number
  /** a spread of buildings for measuring the terrain offset */
  probes: { lon: number; lat: number; groundM: number }[]
  /** per building, for snapping each one onto the terrain under it */
  index: {
    start: Uint32Array
    /** first ROOF vertex; everything from `start` to here is wall */
    roofStart: Uint32Array
    end: Uint32Array
    lon: Float32Array
    lat: Float32Array
    groundM: Float32Array
    /** vertical shift already applied, in quantised units */
    applied: Int16Array
    /** roof lift already applied, in quantised units */
    lifted: Int16Array
    /** 1 once a building has been placed on real terrain and is final */
    placed: Uint8Array
  }
}

/**
 * Wall colours are a CONVENTION, not a measurement - the orthophoto sees roofs,
 * not facades. The class each building is put in is evidence (the cadastre's own
 * function code plus its measured size); the colour attached to that class is a
 * regional palette, and the app says so.
 */
const WALL_COLOURS: Record<string, [number, number, number]> = {
  render: [214, 203, 186],
  utility: [176, 175, 168],
  civic: [221, 214, 197],
  commercial: [183, 188, 195],
  sacred: [214, 190, 158],
}

const EARTH_CIRCUMFERENCE = 40075016.686

/**
 * Check the binaries against the metadata before a byte is interpreted.
 *
 * Static hosting answers a missing file with index.html and HTTP 200, so the
 * status code proves nothing - HTML read as int16 vertex offsets would draw
 * confetti. This also caught a real mismatch: the metadata claimed a 15-byte
 * index record while the writer emitted 16, which would have mis-parsed every
 * building's colour and roof boundary.
 */
export function validatePayload(
  meta: Pick<BuildingsMeta, 'vertexCount' | 'buildings' | 'indexStride'>,
  positionBytes: number,
  indexBytes: number,
): string | null {
  if (positionBytes !== meta.vertexCount * 6) {
    return `buildings.bin: expected ${meta.vertexCount * 6} bytes, got ${positionBytes}`
  }
  if (indexBytes !== meta.buildings * meta.indexStride) {
    return `buildings_index.bin: expected ${meta.buildings * meta.indexStride} bytes, got ${indexBytes}`
  }
  return null
}

/**
 * Build crown geometry for the trees found in the nDOM.
 *
 * The download is a list of trees - position, height, crown radius, measured
 * colour - and the mesh is made here: 14 000 trees cost 155 kB rather than the
 * many megabytes the same geometry would take as vertices.
 *
 * Each tree is a trunk plus a two-ring crown. Three things earn their vertices:
 *  - **The trunk.** The first version drew only a crown, starting at a third of
 *    the tree's height with nothing beneath it, so every tree floated above the
 *    ground with a visible gap.
 *  - **A second ring.** A single-waist solid reads as a diamond; two rings give
 *    a silhouette that passes for a canopy.
 *  - **A rotation per tree**, hashed from its own position. Without it every
 *    crown faces the same way and an avenue turns into a repeating pattern.
 *
 * Conifer or broadleaf is decided by the measured crown radius against height:
 * narrow crowns get a cone, wide ones get a dome. The survey does not record
 * species, but it does record shape, and shape is most of what you see.
 */
function buildTreeMesh(buf: ArrayBuffer, meta: TreesMeta, unitsPerM: number) {
  const stride = meta.stride
  const n = Math.floor(buf.byteLength / stride)
  const dv = new DataView(buf)
  const SIDES = 6
  // crown: base fan + two bands + apex fan; trunk: a 4-sided prism
  const CROWN_TRIS = SIDES * 4
  const TRUNK_TRIS = 8
  const per = (CROWN_TRIS + TRUNK_TRIS) * 3
  const positions = new Int16Array(n * per * 3)
  const colours = new Uint8Array(n * per * 4)
  const normals = new Int8Array(n * per * 3)
  const heights = new Uint16Array(n * per)

  /** Deterministic per-tree jitter: same tree, same shape, every run. */
  const hash = (a: number, b: number) => {
    let h = (a * 73856093) ^ (b * 19349663)
    h = (h ^ (h >>> 13)) * 1274126177
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }

  let v = 0
  for (let t = 0; t < n; t++) {
    const o = t * stride
    const x = dv.getInt16(o, true)
    const y = dv.getInt16(o + 2, true)
    const z = dv.getInt16(o + 4, true)
    const hM = dv.getUint8(o + 6) * 0.25
    const rM = dv.getUint8(o + 7) * 0.125
    let r = dv.getUint8(o + 8)
    let g = dv.getUint8(o + 9)
    let b = dv.getUint8(o + 10)

    const rnd = hash(x, y)
    const rnd2 = hash(y, x)
    // A stand of trees is never one flat colour, even of one species.
    const shade = 0.9 + rnd2 * 0.22
    r = Math.min(255, Math.round(r * shade))
    g = Math.min(255, Math.round(g * shade))
    b = Math.min(255, Math.round(b * shade))

    const conifer = rM / Math.max(hM, 1) < 0.22
    const trunkFrac = conifer ? 0.16 : 0.3
    const trunkH = hM * trunkFrac
    const crownH = hM - trunkH
    // ring heights (fraction of crown) and radii (fraction of crown radius)
    const r1h = conifer ? 0.1 : 0.28
    const r1r = conifer ? 1.0 : 0.82
    const r2h = conifer ? 0.5 : 0.62
    const r2r = conifer ? 0.55 : 1.0

    // Exactly the register's (or estimated) crown: strict 1:1, no size jitter (decided 2026-10-28).
    const rQ = rM * unitsPerM * MERC_STRETCH
    const zBase = z + trunkH * unitsPerM
    const zR1 = zBase + crownH * r1h * unitsPerM
    const zR2 = zBase + crownH * r2h * unitsPerM
    const zTop = z + hM * unitsPerM

    const push = (px: number, py: number, pz: number, cr: number, cg: number, cb: number) => {
      positions[v * 3] = px
      positions[v * 3 + 1] = py
      positions[v * 3 + 2] = pz
      colours[v * 4] = cr
      colours[v * 4 + 1] = cg
      colours[v * 4 + 2] = cb
      colours[v * 4 + 3] = 0
      heights[v] = Math.max(0, Math.min(65535, ((pz - z) / unitsPerM) * 10))
      v++
    }

    // --- crown ---
    const spin = rnd * Math.PI * 2
    const ang = (i: number) => spin + (i / SIDES) * Math.PI * 2
    const ring = (i: number, radius: number): [number, number] => [
      x + Math.cos(ang(i)) * radius,
      y + Math.sin(ang(i)) * radius,
    ]

    for (let i = 0; i < SIDES; i++) {
      const j = (i + 1) % SIDES
      const [a1x, a1y] = ring(i, rQ * r1r)
      const [b1x, b1y] = ring(j, rQ * r1r)
      const [a2x, a2y] = ring(i, rQ * r2r)
      const [b2x, b2y] = ring(j, rQ * r2r)

      // underside, closing the crown so it is solid from below
      push(x, y, zBase, r, g, b)
      push(b1x, b1y, zR1, r, g, b)
      push(a1x, a1y, zR1, r, g, b)
      // band between the two rings
      push(a1x, a1y, zR1, r, g, b)
      push(b1x, b1y, zR1, r, g, b)
      push(b2x, b2y, zR2, r, g, b)
      push(a1x, a1y, zR1, r, g, b)
      push(b2x, b2y, zR2, r, g, b)
      push(a2x, a2y, zR2, r, g, b)
      // cap to the apex
      push(a2x, a2y, zR2, r, g, b)
      push(b2x, b2y, zR2, r, g, b)
      push(x, y, zTop, r, g, b)
    }

    // --- trunk ---
    // Bark, darkened towards the canopy's own hue so a stand still reads as one
    // planting rather than as brown poles under green blobs.
    const tr = Math.round(58 + r * 0.16)
    const tg = Math.round(44 + g * 0.14)
    const tb = Math.round(34 + b * 0.12)
    const tQ = Math.max(1, rQ * (conifer ? 0.1 : 0.13))
    const tAng = (i: number) => spin + (i / 4) * Math.PI * 2
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4
      const ax = x + Math.cos(tAng(i)) * tQ
      const ay = y + Math.sin(tAng(i)) * tQ
      const bx = x + Math.cos(tAng(j)) * tQ
      const by = y + Math.sin(tAng(j)) * tQ
      push(ax, ay, z, tr, tg, tb)
      push(bx, by, z, tr, tg, tb)
      push(bx, by, zR1, tr, tg, tb)
      push(ax, ay, z, tr, tg, tb)
      push(bx, by, zR1, tr, tg, tb)
      push(ax, ay, zR1, tr, tg, tb)
    }
  }

  // Flat normals, same as the buildings.
  for (let tri = 0; tri + 2 < n * per; tri += 3) {
    const i0 = tri * 3
    const i1 = (tri + 1) * 3
    const i2 = (tri + 2) * 3
    const ax = (positions[i1] - positions[i0]) / MERC_STRETCH
    const ay = (positions[i1 + 1] - positions[i0 + 1]) / MERC_STRETCH
    const az = positions[i1 + 2] - positions[i0 + 2]
    const bx = (positions[i2] - positions[i0]) / MERC_STRETCH
    const by = (positions[i2 + 1] - positions[i0 + 1]) / MERC_STRETCH
    const bz = positions[i2 + 2] - positions[i0 + 2]
    let nx = ay * bz - az * by
    let ny = az * bx - ax * bz
    let nz = ax * by - ay * bx
    const len = Math.hypot(nx, ny, nz) || 1
    nx = (nx / len) * 127
    ny = (ny / len) * 127
    nz = (nz / len) * 127
    for (let k = 0; k < 3; k++) {
      normals[(tri + k) * 3] = nx
      normals[(tri + k) * 3 + 1] = ny
      normals[(tri + k) * 3 + 2] = nz
    }
  }

  return { positions, colours, normals, heights, vertexCount: n * per, trees: n }
}

export type TreesMeta = {
  source: string
  count: number
  stride: number
  heightStats: { min: number; median: number; max: number }
}

/** x/y are stored in mercator metres, z in real metres; see the builder. */
let MERC_STRETCH = 1

export type SnapResult = {
  /** buildings whose height changed on this pass */
  moved: number
  /** buildings still waiting for terrain under them */
  pending: number
  medianM: number
  /** how much the two surveys disagree across the scene, p10..p90 */
  spreadM: number
}

/**
 * Sit every building on the terrain under **itself**.
 *
 * The cadastre and the DEM are different surveys and they do not disagree by a
 * constant: across this scene the median gap is about 6 m, but the Weinsteige
 * slope and the flat city centre are not the same place, and one global shift
 * leaves buildings on steep ground visibly proud or sunk. So each building is
 * moved by its own difference, with the median as the fallback for any building
 * the terrain cannot answer for yet.
 *
 * Safe to call repeatedly: it applies the *delta* against what it already did,
 * so it can be re-run as more DEM tiles arrive without drifting.
 */
/**
 * How far a building may be moved from the scene's median before the sample is
 * treated as nonsense rather than as disagreement.
 *
 * Measured: the two surveys really do differ by up to about ±9 m here. But a
 * DEM tile that is mid-reload answers with whatever it has - right after a
 * WebGL context restore the spread jumped from ±4 m to ±51 m, which would have
 * flung buildings tens of metres into the hillside. Real disagreement is
 * bounded; loading artefacts are not.
 */
const MAX_PLAUSIBLE_OFFSET_M = 40

export function snapToTerrain(
  data: BuildingsData,
  sample: (lon: number, lat: number) => number | null | undefined,
): SnapResult {
  const { index, positions } = data
  const step = data.meta.quantisation.zScaleM
  const n = index.start.length
  const want = new Float64Array(n)
  const known: number[] = []

  for (let i = 0; i < n; i++) {
    // A building that has been placed on real terrain is finished. Re-querying
    // it wastes the pass and, worse, makes it twitch: queryTerrainElevation
    // answers from whichever DEM tile is loaded, so the same building gets
    // slightly different ground as MapLibre swaps tiles, and the scene never
    // stops rewriting and re-uploading itself. Measured as ~300 ms hitches
    // every few seconds, indefinitely.
    if (index.placed[i]) continue
    const t = sample(index.lon[i], index.lat[i])
    if (t === null || t === undefined) {
      want[i] = NaN
      continue
    }
    want[i] = t - index.groundM[i]
    known.push(want[i])
  }

  if (known.length === 0) {
    // Nothing new could be measured. Anything already placed is finished, so
    // only the unplaced ones are still waiting.
    let unplaced = 0
    for (let i = 0; i < n; i++) if (!index.placed[i]) unplaced++
    return { moved: 0, pending: unplaced, medianM: 0, spreadM: 0 }
  }
  known.sort((a, b) => a - b)
  const median = known[Math.floor(known.length / 2)]

  // Drop the implausible ones and recompute the statistics without them, so a
  // reloading DEM cannot widen the reported spread either.
  const sane = known.filter((v) => Math.abs(v - median) <= MAX_PLAUSIBLE_OFFSET_M)
  const p10 = sane[Math.floor(sane.length * 0.1)] ?? median
  const p90 = sane[Math.floor(sane.length * 0.9)] ?? median

  let moved = 0
  let pending = 0
  for (let i = 0; i < n; i++) {
    if (index.placed[i]) continue
    let target = want[i]
    let real = true
    if (Number.isNaN(target) || Math.abs(target - median) > MAX_PLAUSIBLE_OFFSET_M) {
      // Leave it where it is and try again on a later pass, rather than moving
      // it somewhere absurd now.
      target = index.applied[i] !== 0 ? index.applied[i] * step : median
      real = false
      pending++
    }
    const q = Math.round(target / step)
    if (real) index.placed[i] = 1
    const delta = q - index.applied[i]
    if (delta === 0) continue
    for (let v = index.start[i]; v < index.end[i]; v++) {
      positions[v * 3 + 2] += delta
    }
    index.applied[i] = q
    moved++
  }
  return { moved, pending, medianM: median, spreadM: p90 - p10 }
}

/**
 * Lift the roofs off a handful of buildings, as an exploded view.
 *
 * The same idea as the campus twin's exploded storeys (`Campus-Scheduler/
 * src/twin3d/rooms.ts`), reduced to what this survey actually contains. LoD2
 * gives walls and roofs and nothing else - there is no interior here, and
 * inventing rooms for a depot would be a claim about a building nobody has
 * surveyed. So the roof comes off, and what the depot model knows goes inside.
 *
 * ⚠️ Applies the DELTA against what it already lifted, exactly like
 * `snapToTerrain`, so it is idempotent and can be driven straight from a
 * slider. Applying the absolute lift each pass walks the roofs into orbit.
 *
 * Returns the vertex range touched, so the caller can re-upload that slice
 * instead of the whole 10 MB position buffer on every frame of a drag.
 */
export function explodeRoofs(
  data: BuildingsData,
  ids: readonly number[],
  liftM: number,
): { from: number; to: number } | null {
  const { index, positions, meta } = data
  const step = meta.quantisation.zScaleM
  const q = Math.round(liftM / step)
  let from = Infinity
  let to = -Infinity

  for (const b of ids) {
    if (b < 0 || b >= index.start.length) continue
    const delta = q - index.lifted[b]
    if (delta === 0) continue
    // Only the roof moves. The walls stay standing, which is what makes it
    // read as a building being opened rather than a building being deleted.
    for (let v = index.roofStart[b]; v < index.end[b]; v++) {
      positions[v * 3 + 2] += delta
    }
    index.lifted[b] = q
    if (index.roofStart[b] < from) from = index.roofStart[b]
    if (index.end[b] > to) to = index.end[b]
  }
  return to > from ? { from, to } : null
}

/** One site of the per-site bake (D29): `data/buildings.json` lists them. */
export type BuildingSite = {
  id: string
  bounds: { west: number; east: number; south: number; north: number }
  buildings: number
  vertexCount: number
  bytes: number
}

export async function loadSiteList(signal?: AbortSignal): Promise<BuildingSite[]> {
  return (await fetchJson<{ sites: BuildingSite[] }>('data/buildings.json', signal)).sites
}

/** One site's buildings, plus its register trees when the site has any (D31). */
export async function loadBuildings(site: string, signal?: AbortSignal): Promise<BuildingsData> {
  const [meta, posBuf, idxBuf] = await Promise.all([
    fetchJson<BuildingsMeta>(`data/buildings-${site}.json`, signal),
    fetchBin(`data/buildings-${site}.bin`, signal),
    fetchBin(`data/buildings-${site}_index.bin`, signal),
  ])

  const n = meta.vertexCount
  const problem = validatePayload(meta, posBuf.byteLength, idxBuf.byteLength)
  if (problem) throw new Error(problem)
  const stride = meta.indexStride

  const positions = new Int16Array(posBuf)
  const colours = new Uint8Array(n * 4)
  const normals = new Int8Array(n * 3)
  const heights = new Uint16Array(n)
  const idx = new DataView(idxBuf)
  const probes: BuildingsData['probes'] = []
  const index = {
    start: new Uint32Array(meta.buildings),
    roofStart: new Uint32Array(meta.buildings),
    end: new Uint32Array(meta.buildings),
    lon: new Float32Array(meta.buildings),
    lat: new Float32Array(meta.buildings),
    groundM: new Float32Array(meta.buildings),
    applied: new Int16Array(meta.buildings),
    lifted: new Int16Array(meta.buildings),
    placed: new Uint8Array(meta.buildings),
  }

  const cosLat = Math.cos((meta.origin.lat * Math.PI) / 180)
  const zBase = meta.quantisation.zBaseM
  const toDm = meta.quantisation.zScaleM * 10

  for (let b = 0; b < meta.buildings; b++) {
    const o = b * stride
    const start = idx.getUint32(o, true)
    const roofStart = idx.getUint32(o + 4, true)
    const end = idx.getUint32(o + 8, true)
    const wall = idx.getUint8(o + 12)
    const roof: [number, number, number] = [
      idx.getUint8(o + 13),
      idx.getUint8(o + 14),
      idx.getUint8(o + 15),
    ]
    const wallRgb = WALL_COLOURS[meta.wallClasses[wall]] ?? WALL_COLOURS.render

    let minZ = Infinity
    for (let v = start; v < end; v++) {
      const z = positions[v * 3 + 2]
      if (z < minZ) minZ = z
    }

    for (let v = start; v < end; v++) {
      const isRoof = v >= roofStart
      const rgb = isRoof ? roof : wallRgb
      colours[v * 4] = rgb[0]
      colours[v * 4 + 1] = rgb[1]
      colours[v * 4 + 2] = rgb[2]
      colours[v * 4 + 3] = isRoof ? 255 : 0
      // decimetres above this building's own base, whatever the storage step is:
      // the shader's contact shading is written in metres.
      heights[v] = Math.min(65535, (positions[v * 3 + 2] - minZ) * toDm)
    }

    const here = lonLatOf(
      positions[start * 3],
      positions[start * 3 + 1],
      meta.origin,
      meta.quantisation.xyScaleM,
    )
    index.start[b] = start
    index.roofStart[b] = roofStart
    index.end[b] = end
    index.lon[b] = here.lon
    index.lat[b] = here.lat
    index.groundM[b] = zBase + minZ * meta.quantisation.zScaleM

    if (b % 24 === 0) {
      probes.push({ ...here, groundM: index.groundM[b] })
    }
  }

  // Flat normals per triangle. The mesh is a triangle soup, so every three
  // consecutive vertices are one face - and LoD2 faces are genuinely planar,
  // which is why flat shading looks right rather than faceted.
  for (let t = 0; t + 2 < n; t += 3) {
    const i0 = t * 3
    const i1 = (t + 1) * 3
    const i2 = (t + 2) * 3
    // x/y are mercator metres and z is real metres; undo the stretch before
    // taking the cross product or every roof pitch reads shallower than it is.
    const ax = (positions[i1] - positions[i0]) * cosLat
    const ay = (positions[i1 + 1] - positions[i0 + 1]) * cosLat
    const az = positions[i1 + 2] - positions[i0 + 2]
    const bx = (positions[i2] - positions[i0]) * cosLat
    const by = (positions[i2 + 1] - positions[i0 + 1]) * cosLat
    const bz = positions[i2 + 2] - positions[i0 + 2]
    let nx = ay * bz - az * by
    let ny = az * bx - ax * bz
    let nz = ax * by - ay * bx
    const len = Math.hypot(nx, ny, nz) || 1
    nx = (nx / len) * 127
    ny = (ny / len) * 127
    nz = (nz / len) * 127
    for (let k = 0; k < 3; k++) {
      normals[(t + k) * 3] = nx
      normals[(t + k) * 3 + 1] = ny
      normals[(t + k) * 3 + 2] = nz
    }
  }

  // --- trees ---------------------------------------------------------------
  // Optional on purpose: the buildings are the point, and a missing or
  // mis-sized tree file must not cost the city.
  MERC_STRETCH = 1 / cosLat
  let trees: ReturnType<typeof buildTreeMesh> | null = null
  try {
    const [tMeta, tBuf] = await Promise.all([
      fetchJson<TreesMeta>(`data/trees-${site}.json`, signal),
      fetchBin(`data/trees-${site}.bin`, signal),
    ])
    if (tBuf.byteLength === tMeta.count * tMeta.stride) {
      trees = buildTreeMesh(tBuf, tMeta, 1 / meta.quantisation.xyScaleM)
    } else {
      console.warn('trees.bin: unexpected size, skipping')
    }
  } catch (e) {
    console.warn('trees unavailable', e)
  }

  if (!trees) {
    return {
      meta,
      positions,
      colours,
      normals,
      heights,
      vertexCount: n,
      trees: 0,
      treeVertexCount: 0,
      probes,
      index,
    }
  }

  // One buffer, one draw call: the tree crowns simply follow the buildings.
  const total = n + trees.vertexCount
  const allPos = new Int16Array(total * 3)
  const allCol = new Uint8Array(total * 4)
  const allNrm = new Int8Array(total * 3)
  const allHgt = new Uint16Array(total)
  allPos.set(positions)
  allPos.set(trees.positions, n * 3)
  allCol.set(colours)
  allCol.set(trees.colours, n * 4)
  allNrm.set(normals)
  allNrm.set(trees.normals, n * 3)
  allHgt.set(heights)
  allHgt.set(trees.heights, n)

  return {
    meta,
    positions: allPos,
    colours: allCol,
    normals: allNrm,
    heights: allHgt,
    vertexCount: total,
    trees: trees.trees,
    treeVertexCount: trees.vertexCount,
    probes,
    index,
  }
}

function lonLatOf(
  xQ: number,
  yQ: number,
  origin: { lon: number; lat: number },
  stepM: number,
): { lon: number; lat: number } {
  const R = 6378137
  const x = ((origin.lon * Math.PI) / 180) * R + xQ * stepM
  const y0 = Math.log(Math.tan(Math.PI / 4 + (origin.lat * Math.PI) / 360)) * R
  const y = y0 + yQ * stepM
  return {
    lon: ((x / R) * 180) / Math.PI,
    lat: ((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180) / Math.PI,
  }
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  return (await (await fetchFile(url, signal)).json()) as T
}

/**
 * The binaries ship gzipped as well (tools/gzip_data.mjs), because Fabric static
 * hosting compresses nothing. Whether the bytes still ARRIVE gzipped depends on
 * the server (verbatim, inflated by the browser via content-encoding, or
 * inflated by `vite preview`), so the content decides: 1f 8b is the gzip magic.
 * Any failure falls back to the plain file.
 */
async function fetchBin(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === 'function') {
    try {
      const r = await fetch(`${url}.gz`, { signal })
      if (r.ok && !(r.headers.get('content-type') ?? '').includes('text/html')) {
        const buf = await r.arrayBuffer()
        const b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength))
        if (b[0] !== 0x1f || b[1] !== 0x8b) return buf
        return await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
    }
  }
  return await (await fetchFile(url, signal)).arrayBuffer()
}

const VERT = `
precision highp float;
attribute vec3 aPos;
attribute vec4 aColour;
attribute vec3 aNormal;
attribute float aHeight;
uniform mat4 uMatrix;
varying vec3 vColour;
varying vec3 vNormal;
varying float vHeight;
varying float vIsRoof;
varying vec2 vLocal;
void main() {
  vLocal = aPos.xy;
  vColour = aColour.rgb;
  vIsRoof = aColour.a;
  vNormal = aNormal;
  vHeight = aHeight * 0.1;
  gl_Position = uMatrix * vec4(aPos, 1.0);
}
`

const FRAG = `
precision highp float;
uniform vec3 uSun;
uniform vec3 uSunTint;
uniform vec3 uShadowTint;
uniform vec2 uRamp;
uniform sampler2D uPhoto;
uniform vec4 uPhotoRect;
uniform float uHasPhoto;
varying vec3 vColour;
varying vec3 vNormal;
varying float vHeight;
varying float vIsRoof;
varying vec2 vLocal;
void main() {
  vec3 n = normalize(vNormal);
  float lam = clamp(abs(dot(n, normalize(uSun))), 0.0, 1.0);
  /* Roofs inside a site patch wear the TrueDOP photo itself (D26). The photo is
     linear in mercator, and so are these positions, so the lookup is one affine
     map. Nearly unlit: a photograph already carries its sun and its shadows, and
     lighting it again darkens every north slope twice. */
  if (uHasPhoto > 0.5 && vIsRoof > 0.5) {
    vec2 uv = (vLocal - uPhotoRect.xy) / (uPhotoRect.zw - uPhotoRect.xy);
    if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
      vec3 p = texture2D(uPhoto, vec2(uv.x, 1.0 - uv.y)).rgb;
      gl_FragColor = vec4(p * (0.9 + 0.1 * lam), 1.0);
      return;
    }
  }
  vec3 c = vColour;
  /* Contact shading: the street is darker than the eaves. Cheap, and it is what
     stops a city of untextured solids reading as a pile of blocks. */
  c *= mix(0.74, 1.0, clamp(vHeight / 3.0, 0.0, 1.0)) + 0.22 * vIsRoof;
  c *= mix(uShadowTint, uSunTint, lam) * (uRamp.x + uRamp.y * lam);
  gl_FragColor = vec4(c, 1.0);
}
`

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(`shader: ${gl.getShaderInfoLog(s)}`)
  }
  return s
}

export type BuildingsLayerOptions = {
  /** layer id, one per site: `lod2-<site>` */
  id: string
  getZOffset: () => number
  onBuffersReady?: (refreshPositions: (from?: number, to?: number) => void) => void
  /** the real sun for the scene's clock: direction (x east, y north, z up) + tints */
  getLight: () => {
    dir: [number, number, number]
    sunTint: [number, number, number]
    shadowTint: [number, number, number]
    ramp: [number, number]
  }
  /** the site orthophoto the roofs are draped with (D26); the sharpest patch wins */
  roofPhoto?: RoofPhoto
}

export type RoofPhoto = {
  url: string
  bounds: { west: number; east: number; south: number; north: number }
}

/**
 * A photo's bounds in the payload's own units: quantised mercator metres from
 * the origin, y north. The shader compares vertex positions against this.
 */
export function photoRect(
  bounds: RoofPhoto['bounds'],
  origin: { lon: number; lat: number },
  stepM: number,
): [number, number, number, number] {
  const R = 6378137
  const mx = (lon: number) => ((lon * Math.PI) / 180) * R
  const my = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * R
  return [
    (mx(bounds.west) - mx(origin.lon)) / stepM,
    (my(bounds.south) - my(origin.lat)) / stepM,
    (mx(bounds.east) - mx(origin.lon)) / stepM,
    (my(bounds.north) - my(origin.lat)) / stepM,
  ]
}

/**
 * Below this zoom the buildings are not drawn at all.
 *
 * At overview zoom the two survey patches are a few hundred pixels across, and
 * 1.2 million vertices crushed into that space render as grey static - two
 * rectangles of noise pasted onto the region, which reads as a broken layer
 * rather than as a city. They only say anything from close enough to see a
 * roof, and the aerial imagery fades in over the same range.
 */
export const MIN_BUILDING_ZOOM = 12.8

export function createBuildingsLayer(
  data: BuildingsData,
  opts: BuildingsLayerOptions,
): CustomLayerInterface {
  let program: WebGLProgram | null = null
  let posBuf: WebGLBuffer | null = null
  let colBuf: WebGLBuffer | null = null
  let nrmBuf: WebGLBuffer | null = null
  let hgtBuf: WebGLBuffer | null = null
  let loc: Record<string, number> = {}
  let uni: Record<string, WebGLUniformLocation | null> = {}
  let host: MlMap | null = null
  let photo: WebGLTexture | null = null
  const rect = opts.roofPhoto
    ? photoRect(opts.roofPhoto.bounds, data.meta.origin, data.meta.quantisation.xyScaleM)
    : null

  return {
    id: opts.id,
    type: 'custom',
    renderingMode: '3d',

    onAdd(_map: MlMap, gl: WebGLRenderingContext) {
      host = _map
      const vs = compile(gl, gl.VERTEX_SHADER, VERT)
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
      const p = gl.createProgram()!
      gl.attachShader(p, vs)
      gl.attachShader(p, fs)
      gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error(`link: ${gl.getProgramInfoLog(p)}`)
      }
      program = p
      loc = {
        aPos: gl.getAttribLocation(p, 'aPos'),
        aColour: gl.getAttribLocation(p, 'aColour'),
        aNormal: gl.getAttribLocation(p, 'aNormal'),
        aHeight: gl.getAttribLocation(p, 'aHeight'),
      }
      uni = {
        uMatrix: gl.getUniformLocation(p, 'uMatrix'),
        uSun: gl.getUniformLocation(p, 'uSun'),
        uSunTint: gl.getUniformLocation(p, 'uSunTint'),
        uShadowTint: gl.getUniformLocation(p, 'uShadowTint'),
        uRamp: gl.getUniformLocation(p, 'uRamp'),
        uPhoto: gl.getUniformLocation(p, 'uPhoto'),
        uPhotoRect: gl.getUniformLocation(p, 'uPhotoRect'),
        uHasPhoto: gl.getUniformLocation(p, 'uHasPhoto'),
      }

      // The roof photo arrives after the geometry; until then the measured
      // colours stand in, so a slow JPEG never leaves the roofs blank.
      if (opts.roofPhoto) {
        const img = new Image()
        img.onload = () => {
          if (!program) return
          const t = gl.createTexture()!
          gl.bindTexture(gl.TEXTURE_2D, t)
          // MapLibre leaves pixel-store state behind; row 0 must be the north edge.
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img)
          // 4096 px is a power of two on the long side only, so no mipmaps in
          // WebGL1: linear filtering and clamped edges.
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
          photo = t
          host?.triggerRepaint()
        }
        img.onerror = () => console.warn('roof photo unavailable', opts.roofPhoto?.url)
        img.src = opts.roofPhoto.url
      }

      const upload = (data8: ArrayBufferView) => {
        const b = gl.createBuffer()!
        gl.bindBuffer(gl.ARRAY_BUFFER, b)
        gl.bufferData(gl.ARRAY_BUFFER, data8, gl.STATIC_DRAW)
        return b
      }
      posBuf = upload(data.positions)
      colBuf = upload(data.colours)
      nrmBuf = upload(data.normals)
      hgtBuf = upload(data.heights)

      opts.onBuffersReady?.((from?: number, to?: number) => {
        if (!posBuf) return
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
        // Only the buildings ever move, and they sit at the START of the
        // buffer. Re-uploading the trees as well meant pushing 15 MB to the GPU
        // on every snapping pass for geometry that had not changed - measured
        // as half-second frame hitches.
        const buildingVerts = data.vertexCount - data.treeVertexCount
        // A range re-uploads just those vertices, which is what makes an
        // explode slider affordable: a few thousand vertices instead of ten
        // million bytes, sixty times a second.
        const lo = from === undefined ? 0 : Math.max(0, Math.min(from, buildingVerts))
        const hi = to === undefined ? buildingVerts : Math.max(lo, Math.min(to, buildingVerts))
        gl.bufferSubData(
          gl.ARRAY_BUFFER,
          lo * 3 * data.positions.BYTES_PER_ELEMENT,
          data.positions.subarray(lo * 3, hi * 3),
        )
      })
    },

    onRemove(_map: MlMap, gl: WebGLRenderingContext) {
      for (const b of [posBuf, colBuf, nrmBuf, hgtBuf]) if (b) gl.deleteBuffer(b)
      if (photo) gl.deleteTexture(photo)
      photo = null
      if (program) gl.deleteProgram(program)
      program = null
    },

    render(gl: WebGLRenderingContext, args: CustomRenderMethodInput) {
      if (!program) return
      if (host && host.getZoom() < MIN_BUILDING_ZOOM) return
      const { origin, quantisation } = data.meta
      const lat = (origin.lat * Math.PI) / 180

      // origin in MapLibre world units (mercator, 0..1)
      const ox = (origin.lon + 180) / 360
      const oy =
        (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + lat / 2))) / 360

      const sxy = quantisation.xyScaleM / EARTH_CIRCUMFERENCE
      // altitude uses the circumference AT THIS LATITUDE, as MapLibre does
      const sz = quantisation.zScaleM / (EARTH_CIRCUMFERENCE * Math.cos(lat))
      const zBase = (quantisation.zBaseM + opts.getZOffset()) / (EARTH_CIRCUMFERENCE * Math.cos(lat))

      // model: quantised units -> world. Mercator y grows southwards, local y northwards.
      const model = [
        sxy, 0, 0, 0,
        0, -sxy, 0, 0,
        0, 0, sz, 0,
        ox, oy, zBase, 1,
      ]
      // ⚠️ Use defaultProjectionData.mainMatrix, NOT modelViewProjectionMatrix.
      // Both are handed to a custom layer and only one takes mercator world
      // coordinates: feeding the map centre through mainMatrix lands at NDC
      // (0, 0) - dead centre - while modelViewProjectionMatrix puts it at
      // (-8.8, 1.3), far off screen. The layer drew perfectly, just nowhere
      // visible, with no GL error to say so.
      const world = (args.defaultProjectionData?.mainMatrix ??
        args.modelViewProjectionMatrix) as unknown as number[]
      const m = multiply(world, model)

      gl.useProgram(program)
      gl.uniformMatrix4fv(uni.uMatrix, false, new Float32Array(m))
      // The actual sun over Berlin at the scene's own clock, so the light
      // agrees with the time in the corner instead of being a pleasant guess.
      const light = opts.getLight()
      gl.uniform3f(uni.uSun, light.dir[0], light.dir[1], light.dir[2])
      gl.uniform3f(uni.uSunTint, light.sunTint[0], light.sunTint[1], light.sunTint[2])
      gl.uniform3f(
        uni.uShadowTint,
        light.shadowTint[0],
        light.shadowTint[1],
        light.shadowTint[2],
      )
      gl.uniform2f(uni.uRamp, light.ramp[0], light.ramp[1])
      gl.uniform1f(uni.uHasPhoto, photo && rect ? 1 : 0)
      if (photo && rect) {
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, photo)
        gl.uniform1i(uni.uPhoto, 0)
        gl.uniform4f(uni.uPhotoRect, rect[0], rect[1], rect[2], rect[3])
      }

      bind(gl, posBuf!, loc.aPos, 3, gl.SHORT, false)
      bind(gl, colBuf!, loc.aColour, 4, gl.UNSIGNED_BYTE, true)
      bind(gl, nrmBuf!, loc.aNormal, 3, gl.BYTE, true)
      bind(gl, hgtBuf!, loc.aHeight, 1, gl.UNSIGNED_SHORT, false)

      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.depthMask(true)
      gl.disable(gl.BLEND)
      // LoD2 winding is not reliably consistent across surface types, and the
      // lighting uses |dot| for exactly that reason.
      gl.disable(gl.CULL_FACE)
      gl.drawArrays(gl.TRIANGLES, 0, data.vertexCount)

      for (const l of Object.values(loc)) if (l >= 0) gl.disableVertexAttribArray(l)
    },
  }
}

function bind(
  gl: WebGLRenderingContext,
  buf: WebGLBuffer,
  location: number,
  size: number,
  type: number,
  normalized: boolean,
) {
  if (location < 0) return
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.enableVertexAttribArray(location)
  gl.vertexAttribPointer(location, size, type, normalized, 0, 0)
}

/** column-major 4x4 multiply: a * b */
function multiply(a: number[] | Float32Array, b: number[]): number[] {
  const out = new Array<number>(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3]
    }
  }
  return out
}
