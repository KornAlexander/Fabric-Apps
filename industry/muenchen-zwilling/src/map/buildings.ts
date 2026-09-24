import * as THREE from 'three';

import { StageTracker, type ProgressReporter } from './terrainLoader';
import { AMBIENT, SHADOW_TINT, SUN_DIRECTION, SUN_GAIN, SUN_TINT } from './terrainMaterial';
import type { MapAssetReader } from '../assets/types';

/**
 * LoD2 buildings — real geometry from the Bavarian 3D-Gebäudemodell.
 *
 * Munich buildings retain surveyed positions and dimensions. Roof colours come from imagery;
 * wall colours are conventional treatments associated with the cadastral class.
 */

/**
 * What the browser needs per building, which is deliberately less than the pipeline knows.
 *
 * Ground rings stay in `buildings_lod2_footprints.json` and never reach the client: they are most
 * of the bytes and nothing on screen uses them.
 */
export interface Lod2Building {
  village: string;
  groundElevM: number;
  vertexStart: number;
  vertexCount: number;
  easting: number;
  northing: number;
  /**
   * Where this building's ROOF triangles begin. Walls and ground are emitted first, so one index
   * per building replaces a roof flag per vertex. Absent in builds made before the split.
   */
  roofVertexStart?: number;
  /** Wall treatment from `building_class.py` — index into `WALL_COLOURS`. */
  wall?: number;
}

export interface Lod2Meta {
  count: number;
  vertexCount: number;
  perVillage: Record<string, number>;
  attribution: string;
  buildings: Lod2Building[];
  /** Absent in builds written before the vertices were quantised. */
  quantisation?: {
    xzScaleM: number;
    yScaleM: number;
    yOffsetM: number;
  };
}

const vertexShader = /* glsl */ `
precision highp float;

attribute float aGround;
/**
 * Measured roof colour and conventional wall colour, plus a roof flag in w.
 *
 * One vec4 of bytes per vertex, built on the client from four bytes per BUILDING — the mesh
 * emits walls and ground first, then roofs, and roofVertexStart says where the split is. Sending
 * a colour per vertex instead would have cost megabytes for the same picture.
 */
attribute vec4 aColour;

out float vHeightAboveGround;
out vec3  vWorld;
out vec3  vAlbedo;
out float vIsRoof;

void main() {
  float heightAboveGround = position.y - aGround;
  vHeightAboveGround = heightAboveGround;
  vAlbedo = aColour.rgb;
  vIsRoof = aColour.a;

  // Survey coordinates are already in metres on all three axes.
  //
  // ⚠️ World space, not object space. The airfield core's building mesh is offset 28 km from the
  // world origin. The fragment shader takes its surface normal from screen-space derivatives of
  // this value, which a translation does not change — but keeping it in world space means the
  // value means the same thing here as it does in the terrain and shell shaders, where distance
  // from the camera IS measured from it.
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

uniform vec3 uSunDirection;
uniform vec3 uSunTint;
uniform vec3 uShadowTint;
uniform vec2 uLightRamp;

in float vHeightAboveGround;
in vec3  vWorld;
in vec3  vAlbedo;
in float vIsRoof;

out vec4 fragColor;

void main() {
  // Roof colour comes from aerial imagery; wall colour follows the cadastral class.
  vec3 colour = vAlbedo;

  // Contact shading: a wall darkens towards the ground where light does not reach, and roofs sit
  // a step brighter than walls because they face the sky. Driven by the semantic roof flag rather
  // than by height, so a low flat roof is still a roof.
  colour *= mix(0.72, 1.0, clamp(vHeightAboveGround / 2.5, 0.0, 1.0)) + 0.28 * vIsRoof;

  // Per-face normal from screen-space derivatives of the world position.
  //
  // The mesh carries positions only — the pipeline fan-triangulates CityGML polygons and never
  // computes normals, and adding them would inflate the download by half. Derivatives give exact
  // flat-shaded normals for free, which is all a LoD2 building needs: its faces ARE flat. Without
  // this the buildings are unlit blocks of constant colour, which looked acceptable against grey
  // terrain and looks pasted-on against sunlit terrain.
  vec3 normal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  float lambert = clamp(abs(dot(normal, normalize(uSunDirection))), 0.0, 1.0);
  colour *= mix(uShadowTint, uSunTint, lambert) * (uLightRamp.x + uLightRamp.y * lambert);

  fragColor = vec4(colour, 1.0);
}
`;

export interface BuildingLayer {
  mesh: THREE.Mesh;
  meta: Lod2Meta;
  /**
   * How varied the paint on this layer actually is, counted off the built attribute.
   *
  * This counts the distinct colours that reached the buffer the shader reads. Metadata and pixels differ
   * exactly when it matters — a colour file rejected by the shape check (see
   * `buildColourAttribute`) leaves every roof wearing its wall colour while the JSON still says
   * 99.9 % measured. One flat city is the failure this layer exists to end, so it is the failure
   * worth being able to see from a test.
   */
  colourSpread(): { roofColours: number; wallColours: number };
  dispose(): void;
}

/**
 * Wall colours, one per class from `building_class.py`.
 *
 * ⚠️ THESE ARE A CONVENTION AND THE ONLY PART OF THIS LAYER THAT IS. A wall is not visible in a
 * vertical aerial photograph, so unlike the roofs it cannot be measured; what IS measured is what
 * the building is: its ALKIS function code, its own footprint, height, and operator tag.
 * These are chosen to match Bavarian urban practice
 * and are not a claim about any individual wall. Indexed by the integer the pipeline writes.
 */
export const WALL_COLOURS: readonly [number, number, number][] = [
  [209, 199, 183], // render — warm off-white, the urban default
  [158, 156, 150], // utility — grey blockwork: bin stores, garages, substations
  [231, 228, 220], // whitewash — church, chapel, synagogue, monastery
  [193, 190, 184], // civic — institutional render, flatter and cooler
  [148, 148, 146], // concrete — parking decks and transport works
];

/**
 * Per-vertex colour, expanded on the client from per-building bytes.
 *
 * Three passes, each allowed to overpaint the last: every vertex starts as its building's wall
 * class, roof vertices take the building's measured roof colour, and the few roof SURFACES that
 * are a different material to the rest of their own roof take theirs.
 *
 * ⚠️ VALIDATE THE OPTIONAL FILES BY SHAPE, NOT BY `response.ok`. A static host that falls back to
 * index.html for a missing file answers 200 with HTML, and HTML parsed as vertex offsets repaints
 * random triangles somewhere in the city.
 */
function buildColourAttribute(
  meta: Lod2Meta,
  vertexCount: number,
  roofBytes: ArrayBuffer | null,
  spanBytes: ArrayBuffer | null
): THREE.BufferAttribute {
  const colours = new Uint8Array(vertexCount * 4);
  const roofs = roofBytes && roofBytes.byteLength === meta.buildings.length * 4
    ? new Uint8Array(roofBytes)
    : null;

  meta.buildings.forEach((building, index) => {
    const wall = WALL_COLOURS[building.wall ?? 0] ?? WALL_COLOURS[0];
    const end = building.vertexStart + building.vertexCount;
    const roofStart = building.roofVertexStart ?? end;
    // With no colour file the roof simply takes the wall colour — the building still renders, and
    // the pipeline's own metadata says how many roofs were measured.
    const roof: readonly [number, number, number] = roofs
      ? [roofs[index * 4], roofs[index * 4 + 1], roofs[index * 4 + 2]]
      : wall;

    for (let v = building.vertexStart; v < end; v++) {
      const isRoof = v >= roofStart;
      const source = isRoof ? roof : wall;
      colours[v * 4] = source[0];
      colours[v * 4 + 1] = source[1];
      colours[v * 4 + 2] = source[2];
      // The alpha channel is a roof FLAG, not opacity — the shader shades roofs differently.
      colours[v * 4 + 3] = isRoof ? 255 : 0;
    }
  });

  if (spanBytes && spanBytes.byteLength % 7 === 0 && spanBytes.byteLength > 0) {
    const view = new DataView(spanBytes);
    // Each span runs to the end of its own building, never past it. Binary search for the first
    // building ending STRICTLY after the span starts: `>=` silently drops a span that begins
    // exactly on a boundary.
    const ends = meta.buildings.map((b) => b.vertexStart + b.vertexCount);
    for (let i = 0; i < spanBytes.byteLength; i += 7) {
      const start = view.getUint32(i, true);
      let lo = 0;
      let hi = ends.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (ends[mid] > start) hi = mid;
        else lo = mid + 1;
      }
      const limit = Math.min(ends[lo] ?? vertexCount, i + 7 < spanBytes.byteLength ? view.getUint32(i + 7, true) : vertexCount);
      const r = view.getUint8(i + 4);
      const g = view.getUint8(i + 5);
      const b = view.getUint8(i + 6);
      for (let v = start; v < limit; v++) {
        colours[v * 4] = r;
        colours[v * 4 + 1] = g;
        colours[v * 4 + 2] = b;
      }
    }
  }

  return new THREE.BufferAttribute(colours, 4, true);
}

export async function loadBuildings(
  reader: MapAssetReader,
  report?: ProgressReporter
): Promise<BuildingLayer> {
  const meta: Lod2Meta = await reader.json('buildings_lod2.json');
  // By far the largest single download in the app, so it is read as a stream: this is the stretch
  // of the wait where a static indicator looks like a hang. The size is derived from the mesh
  // itself — quantised vertices are int16 x, uint16 y, int16 z, so six bytes each; older builds
  // without a `quantisation` block wrote interleaved float32 at twelve.
  const tracker = new StageTracker('buildings', 3, report);
  const vertexCount = meta.buildings.reduce(
    (highest, b) => Math.max(highest, b.vertexStart + b.vertexCount),
    0
  );
  if (!Number.isSafeInteger(meta.vertexCount) || meta.vertexCount < 1 || meta.vertexCount > 4_000_000 || vertexCount !== meta.vertexCount || meta.buildings.length !== meta.count) throw new Error('Invalid building metadata.');
  tracker.addExpected(reader.size('buildings_lod2.bin'));
  const bytes = await reader.bytes('buildings_lod2.bin', tracker.track());
  if (!bytes || bytes.byteLength !== vertexCount * (meta.quantisation ? 6 : 12)) throw new Error('Building payload shape mismatch.');
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

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

  // Ground elevation per vertex, so the shader can lift the building onto the terrain without
  // stretching the building itself.
  const groundElev = new Float32Array(positions.length / 3);
  meta.buildings.forEach((building) => {
    groundElev.fill(
      building.groundElevM,
      building.vertexStart,
      building.vertexStart + building.vertexCount
    );
  });

  const [roofData, spanData] = await Promise.all([reader.bytes('buildings_colour.bin'), reader.bytes('buildings_roof_spans.bin')]);
  if (!roofData || roofData.byteLength !== meta.count * 4 || !spanData || spanData.byteLength % 7) throw new Error('Required building colour data invalid.');
  const roofBytes = roofData.buffer.slice(roofData.byteOffset, roofData.byteOffset + roofData.byteLength) as ArrayBuffer;
  const spanBytes = spanData.buffer.slice(spanData.byteOffset, spanData.byteOffset + spanData.byteLength) as ArrayBuffer;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aGround', new THREE.BufferAttribute(groundElev, 1));
  const colourAttribute = buildColourAttribute(meta, positions.length / 3, roofBytes, spanBytes);
  geometry.setAttribute('aColour', colourAttribute);
  geometry.computeBoundingSphere();

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    uniforms: {
      uSunDirection: { value: new THREE.Vector3(...SUN_DIRECTION) },
      uSunTint: { value: new THREE.Vector3(...SUN_TINT) },
      uShadowTint: { value: new THREE.Vector3(...SHADOW_TINT) },
      uLightRamp: { value: new THREE.Vector2(AMBIENT, SUN_GAIN) },
    },
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  return {
    mesh,
    meta,
    colourSpread() {
      // Counted off the attribute the shader reads, one sample per building rather than per
      // vertex: a building is one wall colour and one roof colour, so walking 1.6 M vertices to
      // learn one answer per building would only make the test slow.
      const bytes = colourAttribute.array as Uint8Array;
      const roofColours = new Set<number>();
      const wallColours = new Set<number>();
      const key = (v: number) =>
        (bytes[v * 4] << 16) | (bytes[v * 4 + 1] << 8) | bytes[v * 4 + 2];
      for (const building of meta.buildings) {
        const end = building.vertexStart + building.vertexCount;
        if (end <= building.vertexStart) continue;
        wallColours.add(key(building.vertexStart));
        const roofStart = building.roofVertexStart;
        if (roofStart !== undefined && roofStart < end) roofColours.add(key(roofStart));
      }
      return { roofColours: roofColours.size, wallColours: wallColours.size };
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
