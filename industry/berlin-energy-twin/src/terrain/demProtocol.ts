/**
 * One terrain source for the whole map, made of three parts (PLAN D21):
 *
 *   1. baked Berlin DGM1 tiles (tools/bake_terrain.py): the city at zoom 8-13,
 *      the photo-textured sites at zoom 14-16;
 *   2. deeper tiles inside Berlin that were not baked: resampled here from the
 *      nearest baked ancestor at zoom >= 13, so the ground between two sites is
 *      the same survey, just coarser, and never AWS;
 *   3. everything outside Berlin: AWS terrarium tiles, as before.
 *
 * MapLibre sees a single `raster-dem` source with the URL `twindem://{z}/{x}/{y}`.
 * Terrarium heights are R*256 + G + B/256 - 32768, which cannot be interpolated
 * per colour channel, so resampling decodes to metres, interpolates and encodes
 * again.
 */
import maplibregl from 'maplibre-gl'

export const DEM_URL = 'twindem://{z}/{x}/{y}'
const AWS = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
const AWS_MAX_ZOOM = 15
const TILE = 256

export type TerrainManifest = {
  minzoom: number
  maxzoom: number
  city: { zooms: [number, number] }
  tiles: Record<string, string[]>
}

/** Where a tile's heights come from. Pure, so the routing is testable without a browser. */
export type DemRoute =
  | { kind: 'baked'; z: number; x: number; y: number }
  | { kind: 'resample'; from: { z: number; x: number; y: number; baked: boolean }; z: number; x: number; y: number }
  | { kind: 'aws'; z: number; x: number; y: number }

export function makeLookup(m: TerrainManifest): (z: number, x: number, y: number) => boolean {
  const sets = new Map<number, Set<string>>()
  for (const [z, list] of Object.entries(m.tiles)) sets.set(Number(z), new Set(list))
  return (z, x, y) => sets.get(z)?.has(`${x}/${y}`) ?? false
}

export function route(m: TerrainManifest, baked: (z: number, x: number, y: number) => boolean, z: number, x: number, y: number): DemRoute {
  if (baked(z, x, y)) return { kind: 'baked', z, x, y }
  const cityTop = m.city.zooms[1]
  // Deeper than the city layer: the nearest baked ancestor down to the city
  // layer's finest zoom. Not lower: a zoom 8 tile also covers Brandenburg.
  if (z > cityTop) {
    for (let a = z - 1; a >= cityTop; a--) {
      const d = z - a
      const ax = x >> d
      const ay = y >> d
      if (baked(a, ax, ay)) return { kind: 'resample', from: { z: a, x: ax, y: ay, baked: true }, z, x, y }
    }
  }
  if (z <= AWS_MAX_ZOOM) return { kind: 'aws', z, x, y }
  const d = z - AWS_MAX_ZOOM
  return { kind: 'resample', from: { z: AWS_MAX_ZOOM, x: x >> d, y: y >> d, baked: false }, z, x, y }
}

export function decodeTerrarium(rgba: Uint8ClampedArray): Float32Array {
  const h = new Float32Array(rgba.length / 4)
  for (let i = 0; i < h.length; i++) h[i] = rgba[i * 4] * 256 + rgba[i * 4 + 1] + rgba[i * 4 + 2] / 256 - 32768
  return h
}

export function encodeTerrarium(h: Float32Array): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(h.length * 4)
  for (let i = 0; i < h.length; i++) {
    const v = h[i] + 32768
    const whole = Math.floor(v)
    out[i * 4] = Math.floor(whole / 256)
    out[i * 4 + 1] = whole % 256
    out[i * 4 + 2] = Math.round((v - whole) * 256)
    out[i * 4 + 3] = 255
  }
  return out
}

/** Bilinear crop of an ancestor tile's heights to one descendant tile (pixel centres, edges clamped). */
export function resample(src: Float32Array, from: { z: number; x: number; y: number }, z: number, x: number, y: number): Float32Array {
  const k = 2 ** (z - from.z)
  const ox = (x - from.x * k) * (TILE / k)
  const oy = (y - from.y * k) * (TILE / k)
  const out = new Float32Array(TILE * TILE)
  for (let j = 0; j < TILE; j++) {
    const sy = Math.min(TILE - 1, Math.max(0, oy + (j + 0.5) / k - 0.5))
    const y0 = Math.floor(sy)
    const y1 = Math.min(TILE - 1, y0 + 1)
    const fy = sy - y0
    for (let i = 0; i < TILE; i++) {
      const sx = Math.min(TILE - 1, Math.max(0, ox + (i + 0.5) / k - 0.5))
      const x0 = Math.floor(sx)
      const x1 = Math.min(TILE - 1, x0 + 1)
      const fx = sx - x0
      const a = src[y0 * TILE + x0] * (1 - fx) + src[y0 * TILE + x1] * fx
      const b = src[y1 * TILE + x0] * (1 - fx) + src[y1 * TILE + x1] * fx
      out[j * TILE + i] = a * (1 - fy) + b * fy
    }
  }
  return out
}

// --- browser side ------------------------------------------------------------

let survey = false
/** True once the baked DGM1 is in use: inside Berlin the terrain is the LoD2's own survey. */
export const terrainIsSurvey = () => survey

let manifest: Promise<{ m: TerrainManifest; baked: (z: number, x: number, y: number) => boolean } | null> | null = null
/** Decoded ancestors, reused by the up to 64 tiles under each. */
const heights = new Map<string, Promise<Float32Array>>()
const HEIGHT_CACHE = 48

function loadManifest() {
  manifest ??= fetch('data/terrain.json')
    .then((r) => (r.ok ? (r.json() as Promise<TerrainManifest>) : null))
    .then((m) => {
      survey = !!m
      return m ? { m, baked: makeLookup(m) } : null
    })
    // No baked terrain (an old build, a failed fetch): the map still gets AWS terrain everywhere.
    .catch(() => null)
  return manifest
}

const bakedUrl = (z: number, x: number, y: number) => `data/terrain/${z}/${x}/${y}.webp`
const awsUrl = (z: number, x: number, y: number) => AWS.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))

/**
 * ⚠️ A 200 is not a tile. Fabric static hosting answers a missing file with
 * index.html and status 200 (SPA fallback), so a tile lost in an upload would
 * reach MapLibre as HTML and leave a hole (review 2026-10-28). HTML is refused
 * here and the caller falls back to AWS for that tile.
 */
async function okResponse(url: string, signal?: AbortSignal): Promise<Response> {
  const r = await fetch(url, { signal })
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  if ((r.headers.get('content-type') ?? '').includes('text/html')) throw new Error(`${url}: HTML instead of a tile`)
  return r
}

async function bytes(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  return (await okResponse(url, signal)).arrayBuffer()
}

async function decodeUrl(url: string): Promise<Float32Array> {
  // Not tied to one tile's abort: other descendants may be waiting on it.
  const blob = await (await okResponse(url)).blob()
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  const c = new OffscreenCanvas(TILE, TILE)
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(bmp, 0, 0)
  bmp.close()
  return decodeTerrarium(g.getImageData(0, 0, TILE, TILE).data)
}

function ancestorHeights(url: string): Promise<Float32Array> {
  let p = heights.get(url)
  if (!p) {
    p = decodeUrl(url)
    p.catch(() => heights.delete(url))
    heights.set(url, p)
    if (heights.size > HEIGHT_CACHE) heights.delete(heights.keys().next().value!)
  }
  return p
}

async function encodePng(h: Float32Array): Promise<ArrayBuffer> {
  const c = new OffscreenCanvas(TILE, TILE)
  const g = c.getContext('2d')!
  g.putImageData(new ImageData(encodeTerrarium(h), TILE, TILE), 0, 0)
  return (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()
}

/** Routing without a manifest: AWS everywhere, resampled past its finest zoom. */
const NO_BAKE: TerrainManifest = { minzoom: 0, maxzoom: 0, city: { zooms: [99, 99] }, tiles: {} }

let registered = false
let warned = false
function warnOnce(err: unknown) {
  if (warned) return
  warned = true
  console.warn('baked terrain tile unavailable, using AWS for it', err)
}

/** Register the `twindem://` protocol once per page. */
export function registerDemProtocol(): void {
  if (registered) return
  registered = true
  const serve = async (r: DemRoute, signal: AbortSignal): Promise<ArrayBuffer> => {
    if (r.kind === 'baked') return bytes(bakedUrl(r.z, r.x, r.y), signal)
    if (r.kind === 'aws') return bytes(awsUrl(r.z, r.x, r.y), signal)
    const f = r.from
    const src = await ancestorHeights(f.baked ? bakedUrl(f.z, f.x, f.y) : awsUrl(f.z, f.x, f.y))
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    return encodePng(resample(src, f, r.z, r.x, r.y))
  }
  maplibregl.addProtocol('twindem', async (params, abort) => {
    const [z, x, y] = params.url.replace('twindem://', '').split('/').map(Number)
    const man = await loadManifest()
    const r = man ? route(man.m, man.baked, z, x, y) : route(NO_BAKE, () => false, z, x, y)
    try {
      return { data: await serve(r, abort.signal) }
    } catch (err) {
      const fromBake = r.kind === 'baked' || (r.kind === 'resample' && r.from.baked)
      if (abort.signal.aborted || !fromBake) throw err
      // A baked tile that is missing or broken: AWS for this one tile beats a hole.
      warnOnce(err)
      return { data: await serve(route(NO_BAKE, () => false, z, x, y), abort.signal) }
    }
  })
}
