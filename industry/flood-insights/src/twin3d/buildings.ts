import * as THREE from 'three';

import type { DetailRect } from './drapeDetail';
import { HAZE_COLOUR, HAZE_FAR_M, HAZE_NEAR_M } from './haze';
import { StageTracker, type ProgressReporter } from './terrainLoader';

/**
 * LoD2 buildings — real geometry from the Rheinland-Pfalz 3D-Gebäudemodell.
 *
 * Colour carries the SIMULATED water depth, never a verdict about the building. PLAN §2.3: the
 * app says "simulierte Wassertiefe", not "zerstört". The Copernicus observed grade exists in the
 * metadata and is surfaced only on explicit inspection, attributed to its source.
 *
 * Depth is looked up per fragment from a small data texture keyed by building index, so scrubbing
 * the timeline recolours 4 000 buildings without touching the geometry.
 */

/**
 * What the browser needs per building, which is deliberately less than the pipeline knows.
 *
 * Ground rings and the per-building Copernicus grade stay in `buildings_lod2_footprints.json` and
 * never reach the client: they are most of the bytes, and PLAN §2.2 allows the observed grading to
 * be reported in aggregate but never attached to an individual real address in the interface.
 *
 * This shape is a contract with `tools/geodata/build_lod2_mesh.py` that TypeScript cannot check,
 * because the fetched JSON is asserted into it. Trimming a field here to save bytes is therefore
 * not free — `easting`/`northing` were once dropped from the writer and the app kept compiling,
 * kept loading and quietly painted the whole valley as submerged. Anything removed from the
 * writer must be removed here too, and `resolveBuildingChainage` will say so at runtime.
 */
export interface Lod2Building {
  village: string;
  groundElevM: number;
  vertexStart: number;
  vertexCount: number;
  /**
   * First vertex of this building's ROOF. Walls and ground are emitted before it, so every roof
   * triangle sits in one contiguous run and the shader needs no per-triangle flag to tell them
   * apart. Absent in builds written before the mesh preserved CityGML's surface semantics.
   */
  roofVertexStart?: number;
  /** Wall treatment class — see `tools/geodata/building_class.py`. */
  wall?: number;
  /** UTM32 centroid. Used once at load to find the building's chainage point on the river. */
  easting: number;
  northing: number;
}

export interface Lod2Meta {
  count: number;
  vertexCount: number;
  perVillage: Record<string, number>;
  attribution: string;
  buildings: Lod2Building[];
  /** Present once roof colour has been measured; absent on a build that ran before the drape. */
  roofColour?: {
    measured: number;
    total: number;
    fallback: [number, number, number];
    surfaceVariants: number;
    drapeResolutionM: number;
    source: string;
    note: string;
  };
  wallClasses?: Record<string, string>;
  wallCounts?: Record<string, number>;
  /** Absent in builds written before the vertices were quantised. */
  quantisation?: {
    xzScaleM: number;
    yScaleM: number;
    yOffsetM: number;
  };
  observedDamage?: {
    source: string;
    method: string;
    attribution: string;
    matched: number;
    counts: Record<string, number>;
    note: string;
  };
}

/**
 * Width of the per-building depth texture.
 *
 * The depths used to be a single row, one texel per building, which is the obvious shape for a
 * flat lookup and works right up until the row is longer than the GPU will allocate. Extending
 * the area of interest to the Rhine took the count past 30 000, and MAX_TEXTURE_SIZE on a
 * mainstream integrated GPU is 16 384: the upload failed with GL_INVALID_VALUE, every sample
 * came back 0, and the whole valley rendered as dry. Wrapping into rows keeps both dimensions
 * far below any plausible limit — 2048 columns covers four million buildings in 2048 rows.
 */
const DEPTH_TEXTURE_WIDTH = 2048;

/**
 * What each wall class is painted, and the one place in this file that is NOT a measurement.
 *
 * The roof colours come from the orthophoto; these do not. A wall is barely visible from the air,
 * so there is nothing to measure, and the class the colour is chosen from — see
 * `tools/geodata/building_class.py` — is the measured part. The colours themselves are a
 * convention: Rhineland render, a greyer shed, a lighter church. NOTICE.md says so in as many
 * words, and it must keep saying so.
 *
 * Deliberately kept close to neutral. The flood ramp below is the only saturated thing on a
 * building, and it has to stay that way or a wall starts arguing with the water.
 */
export const WALL_COLOURS: Record<number, readonly [number, number, number]> = {
  0: [205, 201, 193], // render — warm off-white masonry
  1: [168, 167, 162], // outbuilding — greyer, flatter, no render warmth
  2: [231, 229, 223], // whitewash — church and chapel lime
  3: [199, 201, 200], // civic — render, but cooler and flatter
};

const FALLBACK_WALL = WALL_COLOURS[0];

/**
 * Per-vertex colour: measured roof over conventional wall, as a `vec4` of bytes.
 *
 * Three passes, each allowed to overpaint the last — walls, then each building's own roof, then
 * the few roof surfaces different enough from their building to deserve their own colour. Alpha
 * carries the roof flag rather than opacity, which is what lets the shader shade a roof and a
 * wall differently without a second attribute.
 *
 * ⚠️ **Both binaries are validated by SHAPE, not by `response.ok`.** A single-page app answers a
 * request for a file that does not exist with `index.html` and HTTP 200, so a missing optional
 * file arrives looking like a successful download. Parsed as vertex offsets, HTML repaints
 * triangles at random — and the failure looks like a rendering bug, not a missing file.
 */
export function buildColourAttribute(
  meta: Lod2Meta,
  vertexCount: number,
  roofBytes: Uint8Array | null,
  spanBytes: Uint8Array | null
): Uint8Array {
  const colours = new Uint8Array(vertexCount * 4);
  const roofs = roofBytes && roofBytes.length === meta.count * 4 ? roofBytes : null;
  const spans = spanBytes && spanBytes.length % 7 === 0 ? spanBytes : null;

  const paint = (from: number, to: number, r: number, g: number, b: number, roof: number) => {
    const start = Math.max(0, Math.min(from, vertexCount));
    const end = Math.max(0, Math.min(to, vertexCount));
    for (let v = start; v < end; v++) {
      colours[v * 4] = r;
      colours[v * 4 + 1] = g;
      colours[v * 4 + 2] = b;
      colours[v * 4 + 3] = roof;
    }
  };

  // Pass 1 — walls, ground, and anything with no roof semantics.
  meta.buildings.forEach((b) => {
    const wall = WALL_COLOURS[b.wall ?? 0] ?? FALLBACK_WALL;
    paint(b.vertexStart, b.vertexStart + b.vertexCount, wall[0], wall[1], wall[2], 0);
  });

  // Pass 2 — each building's roof, measured from the drape.
  if (roofs) {
    meta.buildings.forEach((b, i) => {
      if (b.roofVertexStart === undefined) return;
      paint(
        b.roofVertexStart,
        b.vertexStart + b.vertexCount,
        roofs[i * 4],
        roofs[i * 4 + 1],
        roofs[i * 4 + 2],
        255
      );
    });
  }

  // Pass 3 — individual roof surfaces that differ from their own building: a copper spire on a
  // tiled nave, a solar array on one pitch.
  if (spans && roofs) {
    // ⚠️ A span carries a start and no length, so it runs to the next span — but only within its
    // OWN building. Without the clip, the last span of one building bleeds across the gap into
    // the next, which is a whole house wearing its neighbour's roof.
    const ends = meta.buildings.map((b) => b.vertexStart + b.vertexCount);
    const view = new DataView(spans.buffer, spans.byteOffset, spans.byteLength);
    const total = spans.length / 7;
    for (let s = 0; s < total; s++) {
      const start = view.getUint32(s * 7, true);
      const next = s + 1 < total ? view.getUint32((s + 1) * 7, true) : vertexCount;
      // First building ending strictly after this span starts. `>=` would drop a span beginning
      // exactly on a building boundary.
      let lo = 0;
      let hi = ends.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (ends[mid] > start) hi = mid;
        else lo = mid + 1;
      }
      paint(
        start,
        Math.min(next, ends[lo]),
        spans[s * 7 + 4],
        spans[s * 7 + 5],
        spans[s * 7 + 6],
        255
      );
    }
  }

  return colours;
}

const vertexShader = /* glsl */ `
precision highp float;

attribute float aBuilding;
attribute float aGround;
attribute vec4 aColour;

uniform sampler2D uDepth;
uniform vec2 uDepthSize;
uniform float uVerticalExaggeration;
/** Grid extent in metres, so a vertex can be turned into the uv the drape is sampled by. */
uniform vec2 uExtentM;

out float vDepth;
out float vHeightAboveGround;
out float vViewDist;
out vec3 vAlbedo;
out float vIsRoof;
out vec2 vGridUv;

void main() {
  // The depth strip is wrapped into rows, so the building index is a row and a column.
  float column = mod(aBuilding, uDepthSize.x);
  float row = floor(aBuilding / uDepthSize.x);
  vDepth = texture(uDepth, (vec2(column, row) + 0.5) / uDepthSize).r;

  vAlbedo = aColour.rgb;
  vIsRoof = aColour.a;

  // Plan position, in the same uv as the heightmap and the drape. A vertex's x and z are metres
  // from the centre of the grid, and the drape is aligned to that grid, so this is the pixel of
  // the orthophoto that was taken looking straight down at this vertex.
  vGridUv = vec2(position.x / uExtentM.x + 0.5, position.z / uExtentM.y + 0.5);

  float heightAboveGround = position.y - aGround;
  vHeightAboveGround = heightAboveGround;

  vec3 p = position;
  // Exaggerate where the building SITS, not how tall it is. Scaling the whole y turned every
  // house into a 25 m tower and made villages read as spikes on the hillside. The base has to
  // follow the exaggerated terrain; the building itself stays close to its real height.
  p.y = aGround * uVerticalExaggeration + heightAboveGround * 1.35;

  vec4 viewPos = modelViewMatrix * vec4(p, 1.0);
  vViewDist = -viewPos.z;

  gl_Position = projectionMatrix * viewPos;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

in float vDepth;
in float vHeightAboveGround;
in float vViewDist;
in vec3 vAlbedo;
in float vIsRoof;
in vec2 vGridUv;

// The high-resolution aerial window, when one is loaded. See src/twin3d/drapeDetail.ts.
uniform sampler2D uDetail;
uniform float uHasDetail;
uniform vec4  uDetailRect;
uniform float uDetailGamma;
// Per-flight exposure match, same as the terrain's. A roof has to be lit like the ground it
// stands on, and both are cut from the same mosaic.
uniform vec3  uCampaigns[4];
uniform int   uCampaignCount;

float campaignGamma(float u) {
  for (int i = 0; i < uCampaignCount; i++) {
    if (u >= uCampaigns[i].x && u <= uCampaigns[i].y) return uCampaigns[i].z;
  }
  return 1.0;
}

// Buildings sit on the ground, so they have to fade with it or distant villages stay sharp against
// hillsides that have already dissolved. Same constants as the terrain, from haze.ts.
uniform float uHazeNearM;
uniform float uHazeFarM;
uniform vec3  uHazeColour;

out vec4 fragColor;

void main() {
  // The building's own colour: its roof measured from the orthophoto this app already ships, its
  // walls painted by the convention its cadastral class earns.
  //
  // This was one flat neutral grey for every building in the valley, chosen so that an untouched
  // building would read as unmistakably untouched and never drift towards the flood's family. The
  // reasoning was right and the remedy was too blunt: a whole valley of identical grey boxes reads
  // as a model of a valley rather than a valley, and the thing it was protecting — that the eye
  // can tell flooded from dry at a glance — is protected far better by real roofs, because the
  // flood ramp below is the only cool, saturated thing in the scene and now it is the only one.
  //
  // ⚠️ The ramp still OVERRIDES this completely above 0.2 m. Colour on a building means water
  // depth first and material second; the roof is what is left when there is no water to report.
  vec3 dry = vAlbedo;

  // With a detail tile loaded, a roof stops being one measured colour and becomes its own pixels.
  //
  // The measured colour is a 0.25 m photograph averaged down to a single RGB triple, because at
  // 2.878 m/px — the finest a whole-AOI drape can be — a median roof covers about 32 pixels and
  // there is nothing else it could honestly be. Where the sharp window applies there are hundreds
  // per roof, so the dormers, the solar array, the patched half of the slate and the rebuilt
  // half are all there to be shown. This is the whole reason the tiles exist.
  //
  // ⚠️ Roofs only. A wall is not in a nadir photograph at all — sampling one would paint each
  // facade with whatever ground or roof happens to lie at its plan position, which is worse than
  // the class colour it replaces, and confidently wrong rather than obviously flat.
  //
  // ⚠️ This does NOT undo the sun the way roof_colour.py's albedo transform does. That transform
  // exists so that a whole valley of measured colours does not encode which way each pitch faced
  // on the flight day; here the pixels are shown as flown, which is what makes them read as a
  // photograph rather than as paint.
  //
  // 🔴 The fetch is UNCONDITIONAL. Guarding it with vIsRoof would put it in non-uniform control
  // flow, where GLSL leaves the mipmap derivatives undefined — which cost a long hunt in the
  // terrain shader for exactly the same mistake. Gate with mix(), never with a branch.
  vec2 local = (vGridUv - uDetailRect.xy) / (uDetailRect.zw - uDetailRect.xy);
  vec2 toEdge = min(local, 1.0 - local);
  float roofPhoto = smoothstep(0.0, 0.03, min(toEdge.x, toEdge.y)) * uHasDetail * vIsRoof;
  vec3 fine = pow(texture(uDetail, clamp(local, 0.0, 1.0)).rgb,
                  vec3(uDetailGamma * campaignGamma(vGridUv.x)));
  dry = mix(dry, fine, roofPhoto);

  // Five stops matching the inundation classes in §6.4: contact, ground floor, above ground
  // floor, submerged.
  //
  // These were ochre through to the water's own turbid brown, so that a flooded building read as
  // continuous with the flood. That was the wrong call: continuity is exactly what makes the
  // damage unreadable, because the eye cannot tell a submerged house from the mud it stands in,
  // and every warm roof on a dry hillside looked implicated. The scale is now cool — pale
  // blue-grey at first contact, deepening to indigo when the building is under — which is the
  // one hue family nothing else in the scene occupies: the water is brown, the terrain ochre and
  // olive, the roads neutral. Cool also stays sober; this is not a red alarm ramp.
  //
  // The ramp must also *darken* from the first millimetre. The first cool stop was once lighter
  // than dry, on the theory that a rising scale should start soft; on screen that bleached every
  // shallow-flooded house to near white, which is the brightest thing in the frame and therefore
  // reads as untouched. Depth is now monotonically darker and more saturated, so more water is
  // always visibly more, never less.
  vec3 contact = vec3(0.56, 0.63, 0.72);
  vec3 ground  = vec3(0.38, 0.51, 0.68);
  vec3 upper   = vec3(0.22, 0.36, 0.59);
  vec3 deep    = vec3(0.11, 0.19, 0.40);

  vec3 colour = dry;
  if (vDepth > 0.0) {
    if (vDepth < 0.2)      colour = mix(dry, contact, vDepth / 0.2);
    else if (vDepth < 1.0) colour = mix(contact, ground, (vDepth - 0.2) / 0.8);
    else if (vDepth < 2.5) colour = mix(ground, upper, (vDepth - 1.0) / 1.5);
    else                   colour = mix(upper, deep, clamp((vDepth - 2.5) / 3.0, 0.0, 1.0));
  }

  // Contact shading: darken where a wall meets the ground so buildings sit in the terrain rather
  // than float on it, and lift the roof a little so the built form still reads at a distance.
  //
  // This used to lighten by height over nine metres, which was the only thing distinguishing a
  // roof from a wall when both were the same grey. The roof is now a different COLOUR from the
  // wall, so the job is done by the measurement and this can go back to what it should always
  // have been: a short contact gradient, and no second lighting model on top of the sun the
  // orthophoto was already taken in.
  colour *= mix(0.74, 1.0, clamp(vHeightAboveGround / 2.5, 0.0, 1.0)) + 0.06 * vIsRoof;

  float haze = smoothstep(uHazeNearM, uHazeFarM, vViewDist);
  colour = mix(colour, uHazeColour, haze * haze);

  fragColor = vec4(colour, 1.0);
}
`;

export interface BuildingLayer {
  mesh: THREE.Mesh;
  meta: Lod2Meta;
  /** Update every building's water depth from a water-surface-elevation profile. */
  setDepths(depthPerBuilding: Float32Array): void;
  setVerticalExaggeration(factor: number): void;
  /**
   * Point the roofs at a high-resolution aerial window, or at nothing.
   *
   * The layer does not own the texture and must not dispose it: `DetailTileCache` keeps exactly
   * one resident and hands the same one to the terrain. Passing null goes back to the measured
   * colours, which is also what happens when the camera leaves the window.
   */
  setDetailTile(texture: THREE.Texture | null, rect: DetailRect | null, gamma: number): void;
  /** Match the roofs to the ground: same per-flight exposure correction as the terrain. */
  setDrapeCampaigns(campaigns: readonly { u0: number; u1: number; gamma: number }[]): void;
  dispose(): void;
}

/**
 * Texel layout of the per-building depth texture, wrapped so neither side can outgrow the GPU.
 *
 * Exported only so a test can pin the invariant: a one-row strip is the natural shape and it is
 * the shape that broke, silently, once the valley held more buildings than MAX_TEXTURE_SIZE.
 */
export function depthTextureShape(count: number): { width: number; height: number } {
  const width = Math.max(1, Math.min(count, DEPTH_TEXTURE_WIDTH));
  return { width, height: Math.max(1, Math.ceil(count / width)) };
}

export async function loadBuildings(
  aoiId: string,
  verticalExaggeration: number,
  base = '/terrain',
  report?: ProgressReporter,
  /**
   * Grid extent in metres. Supplied only by a scene that also feeds detail tiles — without it a
   * vertex cannot be turned into a drape uv, so the roofs keep their measured colours.
   */
  extentM?: { widthM: number; depthM: number }
): Promise<BuildingLayer> {
  const root = `${base}/${aoiId}`;
  const [metaResponse, binResponse] = await Promise.all([
    fetch(`${root}/buildings_lod2.json`),
    fetch(`${root}/buildings_lod2.bin`),
  ]);
  if (!metaResponse.ok || !binResponse.ok) throw new Error('buildings not available');

  const meta: Lod2Meta = await metaResponse.json();
  // By far the largest single download in the app, so it is read as a stream: this is the stretch
  // of the wait where a static indicator looks like a hang. The size is derived from the mesh
  // itself — quantised vertices are int16 x, uint16 y, int16 z, so six bytes each; older builds
  // without a `quantisation` block wrote interleaved float32 at twelve.
  const tracker = new StageTracker('buildings', 2, report);
  const vertexCount = meta.buildings.reduce(
    (highest, b) => Math.max(highest, b.vertexStart + b.vertexCount),
    0
  );
  tracker.addExpected(vertexCount * (meta.quantisation ? 6 : 12));
  const buffer = await tracker.read(binResponse);

  // Vertices arrive quantised and planar: int16 x, uint16 y, int16 z, each in its own block.
  // float32 was more precision than a cadastral building corner carries, and at valley scale the
  // difference was tens of megabytes. Older builds wrote interleaved float32 and carry no
  // `quantisation` block, so they are still read the old way.
  let positions: Float32Array;
  if (meta.quantisation) {
    const { xzScaleM, yScaleM, yOffsetM } = meta.quantisation;
    const n = meta.vertexCount;
    const qx = new Int16Array(buffer, 0, n);
    const qy = new Uint16Array(buffer, n * 2, n);
    const qz = new Int16Array(buffer, n * 4, n);
    positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = qx[i] * xzScaleM;
      positions[i * 3 + 1] = yOffsetM + qy[i] * yScaleM;
      positions[i * 3 + 2] = qz[i] * xzScaleM;
    }
  } else {
    positions = new Float32Array(buffer);
  }

  // One index per vertex, so the shader can look this building's depth up.
  const buildingIndex = new Float32Array(positions.length / 3);
  const groundElev = new Float32Array(positions.length / 3);
  meta.buildings.forEach((building, i) => {
    buildingIndex.fill(i, building.vertexStart, building.vertexStart + building.vertexCount);
    groundElev.fill(
      building.groundElevM,
      building.vertexStart,
      building.vertexStart + building.vertexCount
    );
  });

  // The colour binaries are OPTIONAL: a mesh built before the drape existed has none, and the
  // valley should render in its fallback grey rather than fail. They are small enough (a few tens
  // of kilobytes against sixty megabytes of mesh) not to be worth a progress stage.
  const optional = async (name: string): Promise<Uint8Array | null> => {
    try {
      const response = await fetch(`${root}/${name}`);
      if (!response.ok) return null;
      return new Uint8Array(await response.arrayBuffer());
    } catch {
      return null;
    }
  };
  const [roofBytes, spanBytes] = await Promise.all([
    optional('buildings_colour.bin'),
    optional('buildings_roof_spans.bin'),
  ]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aBuilding', new THREE.BufferAttribute(buildingIndex, 1));
  geometry.setAttribute('aGround', new THREE.BufferAttribute(groundElev, 1));
  geometry.setAttribute(
    'aColour',
    new THREE.BufferAttribute(
      buildColourAttribute(meta, positions.length / 3, roofBytes, spanBytes),
      4,
      true
    )
  );
  geometry.computeBoundingSphere();

  const { width: depthWidth, height: depthHeight } = depthTextureShape(meta.count);
  const depths = new Float32Array(depthWidth * depthHeight);
  const depthTexture = new THREE.DataTexture(
    depths,
    depthWidth,
    depthHeight,
    THREE.RedFormat,
    THREE.FloatType
  );
  depthTexture.internalFormat = 'R32F';
  depthTexture.minFilter = THREE.NearestFilter;
  depthTexture.magFilter = THREE.NearestFilter;
  depthTexture.needsUpdate = true;

  // A sampler2D left unbound reads texture unit 0, which is whatever was bound last — here that
  // would be the depth strip, and roofs would take their colour from water depths. One black
  // pixel, bound and never sampled while uHasDetail is 0. Same reasoning as the terrain's.
  const detailFallback = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  detailFallback.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    uniforms: {
      uDepth: { value: depthTexture },
      uDepthSize: { value: new THREE.Vector2(depthWidth, depthHeight) },
      uVerticalExaggeration: { value: verticalExaggeration },
      // (1,1) is a harmless placeholder: without a grid extent there is no detail tile either, so
      // `vGridUv` is never sampled. The scene supplies both together or neither.
      uExtentM: { value: new THREE.Vector2(extentM?.widthM ?? 1, extentM?.depthM ?? 1) },
      uDetail: { value: detailFallback },
      uHasDetail: { value: 0 },
      uDetailRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uDetailGamma: { value: 1 },
      uCampaigns: { value: Array.from({ length: 4 }, () => new THREE.Vector3(0, 0, 1)) },
      uCampaignCount: { value: 0 },
      uHazeNearM: { value: HAZE_NEAR_M },
      uHazeFarM: { value: HAZE_FAR_M },
      uHazeColour: { value: new THREE.Color(HAZE_COLOUR) },
    },
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  return {
    mesh,
    meta,
    setDetailTile(texture, rect, gamma) {
      const usable = texture !== null && rect !== null && extentM !== undefined;
      material.uniforms.uDetail.value = texture ?? detailFallback;
      material.uniforms.uHasDetail.value = usable ? 1 : 0;
      if (rect) {
        (material.uniforms.uDetailRect.value as THREE.Vector4).set(
          rect.u0,
          rect.v0,
          rect.u1,
          rect.v1
        );
      }
      material.uniforms.uDetailGamma.value = gamma;
    },
    setDrapeCampaigns(campaigns) {
      const slots = material.uniforms.uCampaigns.value as THREE.Vector3[];
      campaigns.slice(0, slots.length).forEach((c, i) => slots[i].set(c.u0, c.u1, c.gamma));
      material.uniforms.uCampaignCount.value = Math.min(campaigns.length, slots.length);
    },
    setDepths(next: Float32Array) {
      depths.set(next.subarray(0, meta.count));
      depthTexture.needsUpdate = true;
    },
    setVerticalExaggeration(factor: number) {
      material.uniforms.uVerticalExaggeration.value = factor;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      depthTexture.dispose();
      detailFallback.dispose();
    },
  };
}
