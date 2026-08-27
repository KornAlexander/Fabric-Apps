/**
 * Scattered ground cover: trees, scrub and boulders.
 *
 * This is the cheapest large gain in perceived realism available here. Bare
 * shaded ground reads as a model of a landscape; the same ground with things
 * standing on it reads as a place, because the props give the eye a sense of
 * scale that a smooth surface cannot.
 *
 * Everything is instanced. One draw call per prop type covers the whole map,
 * so several thousand objects cost roughly what one costs.
 */

import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hexKey, type GameMap, type TerrainId } from '@fabric-empires/engine';
import { hexToWorld, type Terrain } from './terrain.js';
import { fbm2 } from './noise.js';

/**
 * How much of each terrain is covered, and by what.
 *
 * Density is props per tile. The numbers are deliberately uneven: an evenly
 * vegetated world looks synthetic, and the contrast between a wooded plain
 * and a bare quarry is what makes the biomes legible from the air.
 */
interface Cover {
  readonly trees: number;
  readonly rocks: number;
}

const COVER: Readonly<Record<TerrainId, Cover>> = Object.freeze({
  onelake: { trees: 0, rocks: 0 },
  rawFilePlains: { trees: 2.4, rocks: 0.3 },
  deltaHighlands: { trees: 0.55, rocks: 1.1 },
  parquetQuarry: { trees: 0.12, rocks: 2.2 },
  legacySwamp: { trees: 1.9, rocks: 0.12 },
  semanticPeaks: { trees: 0, rocks: 2.6 },
  geothermalVent: { trees: 0, rocks: 1.4 },
  ungovernedWastes: { trees: 0.15, rocks: 0.9 },
});

/** Deterministic per-tile, per-index random in 0..1. */
function rand(q: number, r: number, salt: number): number {
  let n = (Math.imul(q, 374761393) + Math.imul(r, 668265263) + Math.imul(salt, 2246822519)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** A conifer: trunk plus three stacked skirts. */
function treeGeometry(): BufferGeometry {
  const trunk = new CylinderGeometry(0.022, 0.032, 0.16, 5);
  trunk.translate(0, 0.08, 0);

  const parts: BufferGeometry[] = [trunk];
  const skirts = [
    { r: 0.12, h: 0.2, y: 0.19 },
    { r: 0.095, h: 0.18, y: 0.3 },
    { r: 0.065, h: 0.16, y: 0.4 },
  ];
  for (const s of skirts) {
    const cone = new ConeGeometry(s.r, s.h, 7);
    cone.translate(0, s.y, 0);
    parts.push(cone);
  }
  return mergeGeometries(parts, false)!;
}

/** A boulder: one lumpy solid, squashed so it does not read as a ball. */
function rockGeometry(): BufferGeometry {
  const rock = new DodecahedronGeometry(0.1, 0);
  rock.scale(1, 0.62, 0.85);
  rock.translate(0, 0.045, 0);
  return rock;
}

export interface Scatter {
  readonly group: Group;
  readonly counts: { trees: number; rocks: number };
  /**
   * Collapse every prop standing on a hex in `hidden`.
   *
   * ⚠️ **Fog cannot hide a forest by lying on the ground.** The fog lid sits
   * a tenth of a unit above the tallest terrain vertex in its hex, which is
   * enough to cover the ground and nothing like enough to cover a tree: trees
   * here are up to about two units tall. Measured, every one of 6,150 lids had
   * positive clearance over the terrain and the map still looked unfogged,
   * because what was showing through was 4,199 trees and 1,652 rocks.
   *
   * Raising the lid above the canopy instead would have left the fog visibly
   * floating at any low camera angle. Collapsing the instances is exact.
   */
  setHidden(hidden: ReadonlySet<string>): void;
  dispose(): void;
}

export function buildScatter(map: GameMap, terrain: Terrain): Scatter {
  const group = new Group();

  const trunkMaterial = new MeshStandardMaterial({
    color: new Color('#ffffff'),
    roughness: 0.95,
    metalness: 0,
  });
  const rockMaterial = new MeshStandardMaterial({
    color: new Color('#ffffff'),
    roughness: 0.92,
    metalness: 0,
  });

  const treeSlots: Matrix4[] = [];
  const treeTints: Color[] = [];
  const rockSlots: Matrix4[] = [];
  const rockTints: Color[] = [];
  /** The hex each prop stands on, parallel to the slot arrays. */
  const treeHexes: string[] = [];
  const rockHexes: string[] = [];

  // Two ends of a plausible conifer range, plus a sickly tone for the swamp.
  const darkNeedle = new Color('#33482c');
  const lightNeedle = new Color('#6f8a49');
  const sourNeedle = new Color('#5b6330');
  // Stone, light and dark. These must be built from colours, not from raw
  // numbers: an instance colour multiplies a white base material directly in
  // linear space, so a plausible-looking 0.7 to 1.2 is roughly five times an
  // ordinary rock albedo and every boulder on the map glows.
  //
  // ⚠️ Warm and dark, and the pale end is barely used. Neutral grey boulders
  // in full sun read as polystyrene: real stone in a landscape is stained by
  // the soil it sits in and by lichen, so it carries the ground's hue rather
  // than standing out against it. Being too light is what made them look like
  // props dropped on the map instead of rock coming out of it.
  const paleStone = new Color('#8a8073');
  const darkStone = new Color('#4b453c');

  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const up = new Vector3(0, 1, 0);

  for (const tile of map.tiles.values()) {
    const cover = COVER[tile.terrain];
    if (cover.trees <= 0 && cover.rocks <= 0) continue;
    // Water tiles and anything below the waterline get nothing.
    if (terrain.heightAt(tile.hex) < 0.06) continue;

    const centre = hexToWorld(tile.hex);
    const key = hexKey(tile.hex);

    // A slow noise field modulates density, so woodland forms patches rather
    // than an even sprinkle at exactly the tile rate.
    const clump = fbm2(centre.x * 0.09, centre.z * 0.09, { octaves: 3, seed: 77 });

    const place = (count: number, slots: Matrix4[], tints: Color[], salt: number, isTree: boolean) => {
      const homes = isTree ? treeHexes : rockHexes;
      const scaled = count * (isTree ? 0.35 + clump * 1.5 : 0.6 + clump * 0.8);
      const whole = Math.floor(scaled);
      const extra = rand(tile.hex.q, tile.hex.r, salt) < scaled - whole ? 1 : 0;
      for (let i = 0; i < whole + extra; i++) {
        const a = rand(tile.hex.q, tile.hex.r, salt + i * 17);
        const b = rand(tile.hex.q, tile.hex.r, salt + i * 17 + 5);
        const c = rand(tile.hex.q, tile.hex.r, salt + i * 17 + 11);
        // Rejection-free disc sampling, inset so nothing straddles an edge.
        const radius = 0.78 * Math.sqrt(a);
        const angle = b * Math.PI * 2;
        const x = centre.x + radius * Math.cos(angle);
        const z = centre.z + radius * Math.sin(angle);
        const y = terrain.sampleHeight(x, z);
        if (y < 0.05) continue;

        position.set(x, y - 0.02, z);
        quaternion.setFromAxisAngle(up, c * Math.PI * 2);
        // Wide size spread on purpose. Uniform trees read as a texture or a
        // moss mat rather than as a wood, because a real canopy is broken up
        // by the height difference between old trees and young ones.
        const size = isTree ? 0.55 + c * 1.5 : 0.5 + c * 1.3;
        scale.set(size, isTree ? size * (0.8 + a * 0.85) : size * (0.7 + a * 0.6), size);
        slots.push(new Matrix4().compose(position, quaternion, scale));
        // Which hex this prop belongs to, so fog can collapse it later.
        homes.push(key);

        if (isTree) {
          const base = tile.terrain === 'legacySwamp' ? sourNeedle : darkNeedle;
          tints.push(base.clone().lerp(lightNeedle, b * 0.85));
        } else {
          tints.push(darkStone.clone().lerp(paleStone, b * 0.7));
        }
      }
    };

    place(cover.trees, treeSlots, treeTints, 101, true);
    place(cover.rocks, rockSlots, rockTints, 811, false);
  }

  const treeGeo = treeGeometry();
  const rockGeo = rockGeometry();
  let treeMesh: InstancedMesh | undefined;
  let rockMesh: InstancedMesh | undefined;

  if (treeSlots.length > 0) {
    const trees = new InstancedMesh(treeGeo, trunkMaterial, treeSlots.length);
    trees.castShadow = true;
    trees.receiveShadow = true;
    for (let i = 0; i < treeSlots.length; i++) {
      trees.setMatrixAt(i, treeSlots[i]!);
      trees.setColorAt(i, treeTints[i]!);
    }
    trees.instanceMatrix.needsUpdate = true;
    if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
    // Instanced meshes have no useful bounding sphere until it is computed,
    // and without one three culls the whole batch as soon as the origin
    // leaves the frustum: the forest vanishes when the camera pans.
    trees.computeBoundingSphere();
    group.add(trees);
    treeMesh = trees;
  }

  if (rockSlots.length > 0) {
    const rocks = new InstancedMesh(rockGeo, rockMaterial, rockSlots.length);
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    for (let i = 0; i < rockSlots.length; i++) {
      rocks.setMatrixAt(i, rockSlots[i]!);
      rocks.setColorAt(i, rockTints[i]!);
    }
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    rocks.computeBoundingSphere();
    group.add(rocks);
    rockMesh = rocks;
  }

  /*
   * Collapsing rather than removing.
   *
   * An instanced batch is one draw call over a fixed count, so a prop is
   * hidden by writing it a zero scale: it still runs through the vertex
   * shader and occupies no pixels. Rebuilding the batch per fog change would
   * mean re-running the noise and the placement for six thousand props every
   * time a unit takes a step.
   */
  const collapsed = new Matrix4().makeScale(0, 0, 0);

  function applyHidden(
    mesh: InstancedMesh | undefined,
    slots: readonly Matrix4[],
    homes: readonly string[],
    hidden: ReadonlySet<string>,
  ): void {
    if (!mesh) return;
    for (let i = 0; i < slots.length; i++) {
      mesh.setMatrixAt(i, hidden.has(homes[i]!) ? collapsed : slots[i]!);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  return {
    group,
    counts: { trees: treeSlots.length, rocks: rockSlots.length },
    setHidden(hidden) {
      applyHidden(treeMesh, treeSlots, treeHexes, hidden);
      applyHidden(rockMesh, rockSlots, rockHexes, hidden);
    },
    dispose() {
      treeGeo.dispose();
      rockGeo.dispose();
      trunkMaterial.dispose();
      rockMaterial.dispose();
    },
  };
}
