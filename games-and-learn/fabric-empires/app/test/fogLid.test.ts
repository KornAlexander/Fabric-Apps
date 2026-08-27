import { describe, expect, it } from 'vitest';
import { hex, hexNeighbours, type Hex } from '@fabric-empires/engine';
import { hexLid, hexToWorld, type Terrain } from '../src/three/terrain.js';

/*
  Fog lids, and the two properties that fight each other.

  ⚠️ These are written down because the fog has now failed BOTH ways, and
  fixing either one by itself caused the other.

  1. **Neighbouring lids must agree along their shared edge.** When each lid
     was a flat plate at its own hex's peak, two neighbours at different
     heights left a vertical step, and a deep skirt was added to close the
     resulting slot. On steep ground that wall is not hidden, it IS the
     picture: unexplored mountains rendered as a flight of dark slate bands,
     one per tile boundary.

  2. **A lid must never dip below the ground it hides.** The first fix sampled
     the rim with `surfaceAt`, which sits ON the surface. Neighbours agreed
     perfectly and the banding vanished, but every bump and erosion ridge
     breached the lid and the map filled with bright slivers of terrain
     showing through the fog.

  Only taking the highest PEAK among the hexes meeting at a rim point
  satisfies both at once, which is what `peakAt`'s own documentation says it
  is for: "the only safe height for anything that must OCCLUDE the ground".
*/

/** A terrain whose peaks vary sharply, so a step between neighbours is real. */
function steppedTerrain(peaks: ReadonlyMap<string, number>): Terrain {
  const key = (h: Hex) => `${h.q},${h.r}`;
  const peakOf = (h: Hex) => peaks.get(key(h)) ?? 0;
  return {
    heightAt: peakOf,
    peakAt: peakOf,
    // Deliberately far BELOW the peaks: a rim built from this would dip into
    // the ground, which is the failure this file exists to prevent.
    surfaceAt: () => -5,
    sampleHeight: () => -5,
    setGridVisible: () => {},
    triangleCount: 0,
  } as unknown as Terrain;
}

function vertices(geometry: ReturnType<typeof hexLid>): { x: number; y: number; z: number }[] {
  const p = geometry.getAttribute('position').array as ArrayLike<number>;
  const out = [];
  for (let i = 0; i < p.length; i += 3) out.push({ x: p[i]!, y: p[i + 1]!, z: p[i + 2]! });
  return out;
}

const LIFT = 0.12;

describe('fog lids', () => {
  const centre = hex(0, 0);
  const neighbours = hexNeighbours(centre);

  // A steep world: the centre is low, its neighbours tower over it. If rim
  // heights came from the hex's own peak, every shared edge would be a wall.
  const peaks = new Map<string, number>([[`${centre.q},${centre.r}`, 0.5]]);
  neighbours.forEach((n, i) => peaks.set(`${n.q},${n.r}`, 1 + i * 1.3));
  const terrain = steppedTerrain(peaks);

  it('⚠️ agrees with every neighbour along the shared edge, so there is no wall', () => {
    const mine = vertices(hexLid(centre, terrain, LIFT));
    const mismatches: string[] = [];

    for (const n of neighbours) {
      const theirs = vertices(hexLid(n, terrain, LIFT));
      for (const a of mine) {
        for (const b of theirs) {
          const samePlace = Math.hypot(a.x - b.x, a.z - b.z) < 1e-6;
          if (samePlace && Math.abs(a.y - b.y) > 1e-6) {
            mismatches.push(
              `at (${a.x.toFixed(3)}, ${a.z.toFixed(3)}): ` +
                `${a.y.toFixed(4)} vs ${b.y.toFixed(4)}`,
            );
          }
        }
      }
    }

    expect(mismatches, [
      'Two lids disagree about the height of a point they share, which draws',
      'a vertical wall along that edge. On steep ground those walls are the',
      'dark banding the fog is not supposed to have.',
      '',
      ...mismatches.slice(0, 8),
    ].join('\n')).toEqual([]);
  });

  it('⚠️ never dips below the ground of any hex it touches', () => {
    // A lid that sinks lets terrain show through as bright slivers.
    for (const h of [centre, ...neighbours]) {
      const own = terrain.peakAt(h);
      const lowest = Math.min(...vertices(hexLid(h, terrain, LIFT)).map((v) => v.y));
      expect(lowest, `lid for ${h.q},${h.r} sank below its own peak`)
        .toBeGreaterThanOrEqual(own + LIFT - 1e-6);
    }
  });

  it('⚠️ ignores surfaceAt entirely, because it sits ON the ground', () => {
    // `surfaceAt` here returns -5. If any vertex were built from it the lid
    // would be metres underground, so this pins the rule rather than the
    // current arithmetic.
    const lowest = Math.min(...vertices(hexLid(centre, terrain, LIFT)).map((v) => v.y));
    expect(lowest).toBeGreaterThan(0);
  });

  it('is a closed fan around the hex centre', () => {
    const verts = vertices(hexLid(centre, terrain, LIFT));
    // Twelve rim points, one triangle each, three vertices per triangle.
    expect(verts.length).toBe(12 * 3);
    const { x, z } = hexToWorld(centre);
    const centres = verts.filter((v) => Math.hypot(v.x - x, v.z - z) < 1e-6);
    expect(centres.length).toBe(12);
  });
});
