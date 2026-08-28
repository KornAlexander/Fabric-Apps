import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWalkRouteLayer } from '@/twin3d/walkRoute';
import type { WorldExtent } from '@/geo/world';

/**
 * How a big crowd is laid out on the ground, and what colour each figure wears.
 *
 * ⚠️ THIS FILE EXISTS BECAUSE 1 073 FIGURES HAD NEVER BEEN LOOKED AT. The cap was raised to 1 200
 * from a measurement of TUM's largest real cohort (PLAN §58), but the only crowds ever rendered
 * were 28 and 240. At the true maximum the layer drew a solid striped rope: the band width was a
 * constant 7 m, and at `FIGURE_SCALE` each figure covers about sixteen times its real footprint, so
 * a corridor that reads well for a seminar has no room for a lecture hall. Every test in the file
 * below passed on that rope. They are here to keep the repaired version repaired, not to have
 * caught it — only the screenshot could do that.
 */

/** Real `WorldExtent` shape, UTM32 metres — never cast a fixture through `unknown`. */
const EXTENT: WorldExtent = {
  minEasting: 720_000,
  maxNorthing: 5_435_000,
  widthM: 5000,
  depthM: 5000,
  zone: 32,
};

/** Flat ground, so a height difference can never explain a failure. */
const FLAT = () => 0;

/** A straight route roughly 600 m long, long enough to hold a capped crowd. */
const ROUTE: [number, number][] = [
  [12.0, 49.0],
  [12.0, 49.0054],
];

function layer() {
  return createWalkRouteLayer(EXTENT, FLAT);
}

function crowdMesh(group: THREE.Group): THREE.InstancedMesh | undefined {
  return group.children.find((c) => c instanceof THREE.InstancedMesh) as
    | THREE.InstancedMesh
    | undefined;
}

/** Every instance's world position, read back out of the instance matrices. */
function instancePositions(group: THREE.Group): THREE.Vector3[] {
  const mesh = crowdMesh(group);
  if (!mesh) return [];
  const matrix = new THREE.Matrix4();
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < mesh.count; i += 1) {
    mesh.getMatrixAt(i, matrix);
    out.push(new THREE.Vector3().setFromMatrixPosition(matrix));
  }
  return out;
}

/** The colour index of each instance, as an integer per figure. */
function instanceColours(group: THREE.Group): string[] {
  const mesh = crowdMesh(group);
  if (!mesh?.instanceColor) return [];
  const out: string[] = [];
  const colour = new THREE.Color();
  for (let i = 0; i < mesh.count; i += 1) {
    colour.fromBufferAttribute(mesh.instanceColor, i);
    out.push(colour.getHexString());
  }
  return out;
}

/**
 * The direction the crowd is walking, in world XZ, taken from the crowd itself.
 *
 * Every member advances along the path by the same distance between two instants, so the shift in
 * the mean position IS the direction of travel — exactly, with no dependence on the shape of the
 * cloud.
 */
function walkAxis(walk: ReturnType<typeof layer>, at: number, dt = 10): { nx: number; nz: number } {
  const centre = (t: number) => {
    walk.update(t);
    const p = instancePositions(walk.group);
    return {
      x: p.reduce((s, q) => s + q.x, 0) / p.length,
      z: p.reduce((s, q) => s + q.z, 0) / p.length,
    };
  };
  const a = centre(at);
  const b = centre(at + dt);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  return { nx: -dz / len, nz: dx / len }; // normal to the direction of travel
}

/**
 * How far the crowd spreads ACROSS the path, in metres.
 *
 * ⚠️ NOT THE X EXTENT, AND NOT A PCA MINOR AXIS EITHER — both were tried and both overstate it.
 * `max(x) - min(x)` reported 7.32 m for a crowd laid out exactly 7 m wide, because a route drawn
 * along a constant longitude does not run along grid north in UTM (meridian convergence tilts it),
 * so the PATH's own sideways drift got counted as crowd width. Replacing it with the minor
 * principal axis still reported 7.21 m: `trail` and `lateral` are both derived from the same
 * golden-ratio sequence, so at small counts the cloud is faintly diagonal, PCA lands 0.33° off the
 * true axis, and 0.33° of a 24.8 m long crowd is another 0.14 m of phantom width.
 *
 * Taking the axis from the crowd's own motion has neither problem, and needs no tolerance.
 */
function crossSpread(at: THREE.Vector3[], axis: { nx: number; nz: number }): number {
  if (at.length === 0) return 0;
  const across = at.map((p) => p.x * axis.nx + p.z * axis.nz);
  return Math.max(...across) - Math.min(...across);
}

/** Extent along the path, in metres. */
function alongSpread(at: THREE.Vector3[], axis: { nx: number; nz: number }): number {
  if (at.length === 0) return 0;
  // The direction of travel is the normal rotated back by a quarter turn.
  const along = at.map((p) => p.x * axis.nz - p.z * axis.nx);
  return Math.max(...along) - Math.min(...along);
}

/*
  ⚠️ LATE ENOUGH THAT THE TRAIL HAS UNFURLED. At `update(5)` the crowd has walked under seven
  metres and almost every member is still clamped at the door, piled on the origin — a density
  measured there says nothing about how the crowd looks once it is moving.
*/
const DEPLOYED_S = 420;

describe('a crowd at the size the cap actually allows', () => {
  it('fans wider as the cohort grows, instead of packing a fixed corridor', () => {
    const small = layer();
    small.show(ROUTE, undefined, 40);
    const smallAxis = walkAxis(small, DEPLOYED_S);
    small.update(DEPLOYED_S);
    const smallWidth = crossSpread(instancePositions(small.group), smallAxis);
    small.dispose();

    const big = layer();
    big.show(ROUTE, undefined, 1073);
    const bigAxis = walkAxis(big, DEPLOYED_S);
    big.update(DEPLOYED_S);
    const bigWidth = crossSpread(instancePositions(big.group), bigAxis);
    big.dispose();

    /*
      The defect exactly: both of these were 7 m. A thousand people crossing a campus fan across a
      plaza; they do not queue down the same seven-metre strip a seminar group uses.
    */
    expect(bigWidth).toBeGreaterThan(smallWidth * 1.5);
  });

  it('leaves each figure room to stand in at the full cap', () => {
    const walk = layer();
    walk.show(ROUTE, undefined, 5000); // above the cap, so the drawn count is the cap
    const axis = walkAxis(walk, DEPLOYED_S);
    walk.update(DEPLOYED_S);
    const at = instancePositions(walk.group);

    /*
      Areal density, against the footprint a figure covers at FIGURE_SCALE. This is the number that
      decides whether the crowd reads as individuals or as one striped mass, so it is asserted
      rather than left to the next person to rediscover from a screenshot.

      ⚠️ BOUNDED ON BOTH SIDES, AND THE UPPER BOUND IS THE ONE THAT EARNS ITS KEEP. With only the
      lower bound, feeding the width the STATED count instead of the drawn one passed cleanly: a
      5 000-person cohort asks for a 65 m band, the cap still draws 1 200 figures, and they scatter
      across it at 26 m² each — no longer a crowd, just confetti. Too sparse is as wrong as too
      dense, and only the upper bound says so.
    */
    const areaM2 = crossSpread(at, axis) * alongSpread(at, axis);
    const perFigure = areaM2 / at.length;
    expect(perFigure).toBeGreaterThan(2);
    expect(perFigure).toBeLessThan(12);

    walk.dispose();
  });

  it('keeps a small crowd at the width that was already checked by eye', () => {
    // 28 and 240 were rendered and tuned against (PLAN §57.4). Widening them now would be changing
    // pictures that were already approved in order to fix one that was not.
    for (const people of [28, 240]) {
      const walk = layer();
      walk.show(ROUTE, undefined, people);
      const axis = walkAxis(walk, DEPLOYED_S);
      walk.update(DEPLOYED_S);
      // Exactly the floor, with no tolerance for measurement slop — the axis is exact.
      expect(crossSpread(instancePositions(walk.group), axis)).toBeLessThanOrEqual(7);
      walk.dispose();
    }
  });
});

describe('the colours the crowd wears', () => {
  it('does not repeat with the length of the palette', () => {
    /*
      ⚠️ THE TEST THAT WOULD HAVE CAUGHT THE NO-OP REPAIR. The first attempt at de-striping was
      `(index * 7) % 6`, chosen because 7 is coprime with 6. Coprimality only means the multiplier
      permutes the residues — and 7 ≡ 1 (mod 6), so it permutes them by the identity and emits the
      byte-identical sequence. The re-rendered screenshot looked unchanged because it WAS unchanged.

      Asserting "not equal to i % 6" would not have caught it either, since any `(i * k) % 6` still
      has period 6. The defect is the periodicity, so that is what is asserted.
    */
    const walk = layer();
    walk.show(ROUTE, undefined, 600);
    walk.update(5);
    const colours = instanceColours(walk.group);
    walk.dispose();

    expect(colours.length).toBeGreaterThan(100);

    const period = new Set(colours).size;
    let repeats = 0;
    for (let i = 0; i + period < colours.length; i += 1) {
      if (colours[i] === colours[i + period]) repeats += 1;
    }
    const rate = repeats / (colours.length - period);

    // A periodic palette scores 1. Chance alone scores about 1/6.
    expect(rate).toBeLessThan(0.45);
  });

  it('still uses the whole palette, and stays deterministic', () => {
    const first = layer();
    first.show(ROUTE, undefined, 300);
    first.update(5);
    const a = instanceColours(first.group);
    first.dispose();

    const second = layer();
    second.show(ROUTE, undefined, 300);
    second.update(5);
    const b = instanceColours(second.group);
    second.dispose();

    // Scattering the palette must not quietly drop half of it.
    expect(new Set(a).size).toBe(6);
    // This layer may not call Math.random(); the same crowd must draw the same way twice.
    expect(a).toEqual(b);
  });
});
