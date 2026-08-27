import * as THREE from 'three';

export interface TerrainFocusPlace {
  id: string;
  name: string;
  u: number;
  v: number;
  groundM: number;
}

/**
 * One flight campaign of the orthophoto mosaic, and what it takes to render like the others.
 *
 * An orthophoto product is flown region by region, so a large AOI can straddle two campaigns and
 * step in brightness where they meet — the Ahr's box does, by 20 %, at a tile column just west of
 * Altenahr. `tools/geodata/match_drape_campaigns.py` measures each flight on comparable ground and
 * solves an exponent that makes it render like the reference one. The imagery itself is untouched.
 */
export interface DrapeCampaign {
  acquired: string;
  /** Span along the drape's u axis. */
  u0: number;
  u1: number;
  /** Exponent composed with the AOI-wide `drapeGamma`. Exactly 1 for the reference campaign. */
  gamma: number;
}

/** How many campaigns the shader can carry. Two AOIs, two flights each so far; four is slack. */
export const MAX_DRAPE_CAMPAIGNS = 4;

/**
 * The exposure exponent at a point along the drape, or 1 where no campaign claims it.
 *
 * Pure so the semantics can be pinned without a GPU: the reference campaign must come back exactly
 * 1, and a gap between campaigns must come back 1 rather than the nearest neighbour's correction —
 * guessing there would apply one flight's exposure to another flight's pixels.
 */
export function campaignGammaAt(campaigns: readonly DrapeCampaign[], u: number): number {
  if (!Number.isFinite(u)) return 1;
  for (const c of campaigns) {
    if (u >= c.u0 && u <= c.u1) return c.gamma;
  }
  return 1;
}

export interface TerrainMeta {
  width: number;
  height: number;
  resolutionM: number;
  heightMinM: number;
  heightMaxM: number;
  heightScale: number;
  origin: { easting: number; northing: number };
  /** Geographic extent, for placing lon/lat features on the grid. */
  boundsWgs84: { west: number; south: number; east: number; north: number };
  coveragePct: number;
  focusPlaces: TerrainFocusPlace[];
  attribution: string;
  sourceAcquisition: string;
}

export interface FlowFieldMeta {
  width: number;
  height: number;
  resolutionM: number;
  chainagePoints: number;
  /** Spacing of the chainage points, metres. */
  chainageStepM: number;
  riverLengthKm: number;
  notConnected: number;
  bedProfileM: number[];
  connectedPct: number;
  /**
   * Where the water enters, when that is not the top of the line.
   *
   * Null for the Ahr, whose flood arrives from upstream so chainage 0 IS the release point. The
   * Steinbach's line starts 1.8 km above the dam, in the stream feeding the reservoir.
   */
  release: {
    placeId: string;
    chainageIndex: number;
    chainageM: number;
    offsetM: number;
    bedM: number;
  } | null;
  /** Discharge levels the rating is tabulated at. */
  ratingDischargeM3s: number[];
  /** Stage above bed per chainage point, one row per point, one column per discharge level. */
  ratingStageM: number[][];
  manningN: number;
  riverCentroid: {
    u: number;
    v: number;
    uMin: number;
    uMax: number;
    vMin: number;
    vMax: number;
  };
}

export interface LanduseMeta {
  /** Raster filename, taken from the descriptor so the resolution is not baked into the app. */
  file: string;
  /** Inflated size, and the number of cells: width × height. */
  bytes: number;
  /** Size on the wire — the raster is stored gzipped. */
  compressedBytes: number;
  width: number;
  height: number;
  resolutionM: number;
  classes: Record<string, string>;
  coveragePct: number;
}

export interface TerrainAssets {
  terrain: TerrainMeta;
  flow: FlowFieldMeta;
  heightTexture: THREE.DataTexture;
  chainTexture: THREE.DataTexture;
  maskTexture: THREE.DataTexture;
  /** Surface colour only, and optional — an older build without it still runs. */
  landuse: LanduseMeta | null;
  landuseTexture: THREE.DataTexture | null;
  /**
   * The aerial photograph, aligned to the heightmap grid. Null when the AOI has no drape built.
   *
   * Optional in the same way the buildings are: a scene without it is cartographic rather than
   * photographic, which is a different picture, not a broken one.
   */
  drapeTexture: THREE.Texture | null;
  /**
   * Exposure correction for the drape, measured from its own pixels. 1.0 means "leave it alone",
   * which is both the default and what an already-bright drape gets.
   */
  drapeGamma: number;
  /**
   * Ground resolution of that photograph, in metres per pixel.
   *
   * The whole AOI in one texture is as coarse as WebGL2's guaranteed 8192 px side makes it —
   * 2.878 m/px over the Ahr's 23.6 km box — and that number is what decides whether a
   * high-resolution window is worth fetching at the current camera distance. Infinity when there
   * is no drape, so "is the base enough" is answered with "no" rather than by a special case.
   */
  drapeMetresPerPixel: number;
  /**
   * Per-campaign exposure match for the drape. Empty when the AOI is one flight, or was built
   * before this existed — both of which must render exactly as they did.
   */
  drapeCampaigns: DrapeCampaign[];
}

/**
 * Thrown when the generated terrain is missing.
 *
 * The pipeline output is ~31 MB and is deliberately not committed, so a fresh clone has no
 * terrain until `npm run data:build` has run. That is a normal first-run state, not a crash, and
 * the UI treats it as such.
 */
export class TerrainNotBuiltError extends Error {
  constructor(public readonly missing: string) {
    super(`Terrain assets not built: ${missing}`);
    this.name = 'TerrainNotBuiltError';
  }
}

/** Which part of the scene is being fetched, and how far along it is. */
export interface LoadStageProgress {
  stage: 'terrain' | 'buildings' | 'vegetation';
  /** 1-based, for "step 2 of 3". */
  step: number;
  stepCount: number;
  loadedBytes: number;
  /** 0 when the server does not say — see the note on content-encoding in `StageTracker`. */
  totalBytes: number;
}

export type ProgressReporter = (progress: LoadStageProgress) => void;

export const LOAD_STEP_COUNT = 3;

/**
 * Byte-level progress for one loading stage.
 *
 * Stage-level progress is not enough here. The building mesh alone is 26 MB of a roughly 47 MB
 * load, so a three-step indicator would sit motionless on "buildings" for most of the wait —
 * which is the exact impression this is meant to remove.
 *
 * ⚠️ The total does **not** come from Content-Length. The Fabric static host answers these assets
 * with `Transfer-Encoding: chunked` and no length at all, so a header-driven bar renders perfectly
 * against the Vite dev server and is permanently indeterminate once deployed — the one place it
 * matters. It would also be wrong behind gzip, where the declared length describes the compressed
 * body while the stream delivers decompressed bytes.
 *
 * Instead each stage declares what it is about to fetch, computed from metadata that has already
 * arrived: width × height × bytes-per-cell for the rasters, vertices × 6 for the quantised mesh,
 * count × stride for the trees. Verified exact against all six binaries.
 */
export class StageTracker {
  private loaded = 0;
  private expected = 0;
  private lastEmitMs = 0;

  constructor(
    private readonly stage: LoadStageProgress['stage'],
    private readonly step: number,
    private readonly report?: ProgressReporter
  ) {}

  /** Declare bytes this stage will fetch, derived from metadata rather than from headers. */
  addExpected(bytes: number): void {
    if (bytes > 0) this.expected += bytes;
    this.emit(true);
  }

  /** Read a response to completion, reporting as the bytes arrive. */
  async read(response: Response): Promise<ArrayBuffer> {
    if (!this.report || !response.body) return response.arrayBuffer();

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      this.loaded += value.byteLength;
      this.emit();
    }

    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.emit(true);
    return merged.buffer;
  }

  /** Throttled: a 26 MB body arrives in hundreds of chunks, and each one would re-render React. */
  private emit(force = false): void {
    if (!this.report) return;
    const now = Date.now();
    if (!force && now - this.lastEmitMs < 100) return;
    this.lastEmitMs = now;
    this.report({
      stage: this.stage,
      step: this.step,
      stepCount: LOAD_STEP_COUNT,
      loadedBytes: this.loaded,
      totalBytes: this.expected,
    });
  }
}

async function fetchBinary(url: string, tracker?: StageTracker): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new TerrainNotBuiltError(url);
  return tracker ? tracker.read(response) : response.arrayBuffer();
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new TerrainNotBuiltError(url);
  // A dev server with SPA fallback answers a missing asset with index.html, so a 200 is not
  // enough on its own.
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('json')) throw new TerrainNotBuiltError(url);
  return response.json() as Promise<T>;
}

/**
 * Load the precomputed terrain and flow field for an AOI.
 *
 * Everything here is generated offline by tools/geodata/build_terrain.py and build_flowfield.py.
 * The browser does no hydrology — it only resolves `depth = WSE[chain] - terrainZ` per fragment
 * (PLAN §6.3).
 */
export async function loadTerrain(
  aoiId: string,
  base = '/terrain',
  report?: ProgressReporter,
  // ⚠️ The heightmap basename is per AOI — the Ahr is built at 4 m, the Steinbach corridor at 2 m.
  // No default: a generic loader that quietly assumes one AOI's filename is the same mistake as a
  // provenance note that names one AOI's survey authority, and it fails as a 404 rather than as a
  // wrong answer only because the other file happens not to exist.
  terrainName = 'heightmap_4m',
  // ⚠️ The flow-field basename is per AOI too, and for a harder reason than the heightmap's. The
  // builder refuses a flow field finer than the terrain it is derived from, so Castel Bolognese —
  // whose DTM is 20 m — cannot have a 16 m field at all. Horta Sud is 10 m. Assuming 16 m here
  // would 404 for half the AOIs in the app.
  flowName = 'flowfield_16m'
): Promise<TerrainAssets> {
  const root = `${base}/${aoiId}`;
  const tracker = new StageTracker('terrain', 1, report);

  // All three descriptors first, then every size is declared before a single byte of payload is
  // fetched. Reading the land-cover descriptor lazily instead made the stage total grow from
  // 15.6 MB to 17.4 MB partway through, which showed up as the progress bar falling back from
  // 100 % to 90 % — a bar that runs backwards is worse than no bar.
  const [terrain, flow, landuse] = await Promise.all([
    fetchJson<TerrainMeta>(`${root}/${terrainName}.json`),
    fetchJson<FlowFieldMeta>(`${root}/${flowName}.json`),
    // Decoration, and older builds predate it, so its absence must not fail the load.
    fetchJson<LanduseMeta>(`${root}/landuse.json`).catch(() => null),
  ]);

  // uint16 heightmap, uint16 chainage grid, uint8 connectivity mask, gzipped land-cover raster.
  // The land-cover figure is its *compressed* size, because that is what actually crosses the
  // wire; counting the 28.6 MB it inflates to would stall the bar at a number the network never
  // has to deliver.
  tracker.addExpected(terrain.width * terrain.height * 2);
  tracker.addExpected(flow.width * flow.height * 3);
  if (landuse) tracker.addExpected(landuse.compressedBytes);

  const [heightBuffer, chainBuffer, maskBuffer] = await Promise.all([
    fetchBinary(`${root}/${terrainName}.u16`, tracker),
    fetchBinary(`${root}/${flowName}.u16`, tracker),
    fetchBinary(`${root}/${flowName}.u8`, tracker),
  ]);

  // R16UI-style data delivered as unsigned short, read in the shader as a normalised value.
  const heightTexture = new THREE.DataTexture(
    new Uint16Array(heightBuffer),
    terrain.width,
    terrain.height,
    THREE.RedIntegerFormat,
    THREE.UnsignedShortType
  );
  heightTexture.internalFormat = 'R16UI';
  heightTexture.minFilter = THREE.NearestFilter;
  heightTexture.magFilter = THREE.NearestFilter;
  heightTexture.needsUpdate = true;

  const chainTexture = new THREE.DataTexture(
    new Uint16Array(chainBuffer),
    flow.width,
    flow.height,
    THREE.RedIntegerFormat,
    THREE.UnsignedShortType
  );
  chainTexture.internalFormat = 'R16UI';
  chainTexture.minFilter = THREE.NearestFilter;
  chainTexture.magFilter = THREE.NearestFilter;
  chainTexture.needsUpdate = true;

  const maskTexture = new THREE.DataTexture(
    new Uint8Array(maskBuffer),
    flow.width,
    flow.height,
    THREE.RedFormat,
    THREE.UnsignedByteType
  );
  maskTexture.minFilter = THREE.LinearFilter;
  maskTexture.magFilter = THREE.LinearFilter;
  maskTexture.needsUpdate = true;

  const { landuseTexture } = await loadLanduse(root, landuse, tracker);
  const { drapeTexture, drapeGamma, drapeMetresPerPixel } = await loadDrape(root);
  const drapeCampaigns = await loadDrapeCampaigns(root);

  return {
    terrain,
    flow,
    heightTexture,
    chainTexture,
    maskTexture,
    landuse,
    landuseTexture,
    drapeTexture,
    drapeGamma,
    drapeMetresPerPixel,
    drapeCampaigns,
  };
}

/**
 * The per-campaign exposure match, or an empty list.
 *
 * Absent is the ordinary case — most AOIs are one flight, and the correction is only meaningful
 * where a survey's own metadata says otherwise. Never fatal.
 */
async function loadDrapeCampaigns(root: string): Promise<DrapeCampaign[]> {
  try {
    const response = await fetch(`${root}/drape_campaigns.json`);
    if (!response.ok) return [];
    const body = (await response.json()) as { campaigns?: DrapeCampaign[] };
    if (!Array.isArray(body?.campaigns)) return [];
    return body.campaigns
      .filter((c) => Number.isFinite(c.u0) && Number.isFinite(c.u1) && Number.isFinite(c.gamma))
      .slice(0, MAX_DRAPE_CAMPAIGNS);
  } catch {
    return [];
  }
}

/**
 * Apply this project's one texture orientation convention to an image-loaded texture.
 *
 * ⚠️ **`flipY` is the whole point of this function.** Every other raster in the terrain material —
 * height, chainage, mask, land cover — is a `THREE.DataTexture`, where `flipY` defaults to FALSE,
 * and the shader's `gridUv()` flips v exactly once to turn "row 0 is north" into a texture
 * coordinate. The drape arrives through `TextureLoader`, where `flipY` defaults to TRUE. So it was
 * flipped by the loader and then again by `gridUv`, and rendered NORTH-SOUTH MIRRORED over a
 * terrain that was not.
 *
 * It survived because a mirror is much quieter than an offset: the Ahr runs roughly east-west
 * through the middle of its own box, so reflecting it about that middle puts the valley back near
 * the valley and the towns back near the towns. It reads as a plausible aerial view of somewhere
 * very slightly wrong.
 *
 * It also survived a registration check that could not possibly have caught it. That check sampled
 * the JPEG in Python and proved the BUILD-TIME sampler was aligned — which it was, and which is
 * why the measured roof colours are unaffected. The renderer is a different code path, and only
 * the renderer was mirrored. Verify the thing being complained about, through the path it is seen.
 */
export function configureDrapeTexture(texture: THREE.Texture): THREE.Texture {
  // Match the DataTextures: row 0 of the image is north, and `gridUv` does the one and only flip.
  texture.flipY = false;
  // The drape is sampled by the same uv as the heightmap, so it must not wrap: a fragment at
  // u = 1.0 would otherwise pick up the far edge of the photograph.
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The aerial photograph, as a GPU texture, with the exposure correction measured from its own
 * pixels by `tools/geodata/measure_drape_exposure.py`.
 *
 * Fetched through the browser's own image decoder rather than as bytes: it is a JPEG of several
 * thousand pixels a side and decoding that by hand would block the main thread while the scene is
 * already building. Returns null rather than throwing — `tools/geodata/fetch_drape.py` has not
 * necessarily been run for every AOI, and the app is fully usable without it.
 */
async function loadDrape(
  root: string
): Promise<{
  drapeTexture: THREE.Texture | null;
  drapeGamma: number;
  drapeMetresPerPixel: number;
}> {
  const absent = { drapeTexture: null, drapeGamma: 1, drapeMetresPerPixel: Infinity };
  try {
    const response = await fetch(`${root}/drape.json`);
    if (!response.ok) return absent;
    const meta = (await response.json()) as {
      file: string;
      renderGamma?: number;
      metresPerPixel?: number;
    };
    const texture = configureDrapeTexture(
      await new THREE.TextureLoader().loadAsync(`${root}/${meta.file}`)
    );
    // A drape built before the exposure was measured has no gamma, and 1.0 is exactly the old
    // behaviour — so an older build looks no worse than it did, rather than wrong.
    return {
      drapeTexture: texture,
      drapeGamma: meta.renderGamma ?? 1,
      // Infinity, not a guess: an older sidecar without the figure should make a detail window look
      // unconditionally worthwhile rather than silently disable it on a made-up number.
      drapeMetresPerPixel: meta.metresPerPixel ?? Infinity,
    };
  } catch {
    return absent;
  }
}

/**
 * Land cover classes, for surface colour.
 *
 * Deliberately non-fatal: the raster is decoration, so a build made before this step existed
 * should still render a valley rather than an error. The shader falls back to the elevation
 * palette when it is absent.
 */
async function loadLanduse(
  root: string,
  landuse: LanduseMeta | null,
  tracker?: StageTracker
): Promise<{ landuseTexture: THREE.DataTexture | null }> {
  if (!landuse) return { landuseTexture: null };
  try {
    const response = await fetch(`${root}/${landuse.file}`);
    if (!response.ok) throw new TerrainNotBuiltError(landuse.file);
    const delivered = tracker ? await tracker.read(response) : await response.arrayBuffer();

    // The raster ships gzipped — 28.6 MB of class ids travel as about 1 MB — because the static
    // host compresses nothing itself. Whether it still *arrives* gzipped depends on the server:
    // anything that decides to set Content-Encoding will have inflated it already. So the check
    // is on the content rather than on a header or a filename: 1f 8b is the gzip magic number.
    const head = new Uint8Array(delivered, 0, Math.min(2, delivered.byteLength));
    const stillCompressed = head.length === 2 && head[0] === 0x1f && head[1] === 0x8b;
    const buffer = stillCompressed
      ? await new Response(
          new Blob([delivered]).stream().pipeThrough(new DecompressionStream('gzip'))
        ).arrayBuffer()
      : delivered;

    // A truncated or half-written raster would otherwise reach the GPU and paint the valley with
    // whatever happened to follow it in memory.
    if (buffer.byteLength !== landuse.width * landuse.height) {
      throw new Error(
        `land cover is ${buffer.byteLength} bytes, expected ${landuse.width * landuse.height}`
      );
    }

    const landuseTexture = new THREE.DataTexture(
      new Uint8Array(buffer),
      landuse.width,
      landuse.height,
      THREE.RedIntegerFormat,
      THREE.UnsignedByteType
    );
    landuseTexture.internalFormat = 'R8UI';
    // Class ids must never be interpolated — a blend of vineyard and forest is a road.
    landuseTexture.minFilter = THREE.NearestFilter;
    landuseTexture.magFilter = THREE.NearestFilter;
    landuseTexture.needsUpdate = true;

    return { landuseTexture };
  } catch {
    return { landuseTexture: null };
  }
}

/** Texture holding the per-frame WSE profile: one texel per chainage point. */
export function createWseTexture(count: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    new Float32Array(count),
    count,
    1,
    THREE.RedFormat,
    THREE.FloatType
  );
  texture.internalFormat = 'R32F';
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Texture holding the three hazard-class boundary water surfaces, packed one per channel.
 *
 * Unlike the WSE texture this is written once at load and never changes — a hazard class is a
 * statement about frequency, so it has nothing to do with where the clock is.
 */
export function createHazardWseTexture(count: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    new Float32Array(count * 4),
    count,
    1,
    THREE.RGBAFormat,
    THREE.FloatType
  );
  texture.internalFormat = 'RGBA32F';
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}
