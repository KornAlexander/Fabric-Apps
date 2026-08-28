import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { createWalkRouteLayer } from '@/twin3d/walkRoute';
import type { WorldExtent } from '@/geo/world';

/**
 * The crowd that walks a transfer.
 *
 * ⚠️ THE TEST THAT MATTERS MOST IN THIS FILE IS THE ONE THAT ASSERTS NOTHING IS DRAWN. A crowd
 * states how many people make a transfer, and the project's rule is that such a number may only be
 * shown when the timetable published one. `expectedAttendance` is null on a real Untis export —
 * Untis publishes classes without their sizes — and the layer must fall back to the single figure
 * rather than inventing a convincing crowd. A version that quietly drew "about thirty" for every
 * walk would look better and be a lie, and no screenshot would catch it.
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

/** A straight route roughly 300 m long. */
const ROUTE: [number, number][] = [
  [12.0, 49.0],
  [12.0, 49.0027],
];

function layer() {
  return createWalkRouteLayer(EXTENT, FLAT);
}

/** Every instance's world position, read back out of the instance matrices. */
function instancePositions(group: THREE.Group): THREE.Vector3[] {
  const mesh = group.children.find((c) => c instanceof THREE.InstancedMesh) as
    | THREE.InstancedMesh
    | undefined;
  if (!mesh) return [];
  const matrix = new THREE.Matrix4();
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < mesh.count; i += 1) {
    mesh.getMatrixAt(i, matrix);
    out.push(new THREE.Vector3().setFromMatrixPosition(matrix));
  }
  return out;
}

/** How far the crowd reaches from front to back, in metres along the ground. */
function span(at: THREE.Vector3[]): number {
  if (at.length === 0) return 0;
  const zs = at.map((p) => p.z);
  return Math.max(...zs) - Math.min(...zs);
}

describe('the crowd walking a transfer', () => {
  it('draws nobody when the timetable states no attendance', () => {
    const walk = layer();
    walk.show(ROUTE, undefined, null);
    walk.update(5);

    // The honesty guarantee: no number published, so no number implied.
    expect(walk.crowd()).toBeNull();
    // ...and the walk is still shown, by the single figure it has always used.
    expect(walk.drawn()).toBeGreaterThan(0);
    expect(walk.walker()).not.toBeNull();
    walk.dispose();
  });

  it('draws nobody for zero, a negative count or a non-finite one', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const walk = layer();
      walk.show(ROUTE, undefined, bad);
      expect(walk.crowd(), `attendance ${bad} must not raise a crowd`).toBeNull();
      walk.dispose();
    }
  });

  it('draws one figure per person the plan states', () => {
    const walk = layer();
    walk.show(ROUTE, undefined, 28);
    walk.update(4);

    expect(walk.crowd()).toEqual({ people: 28, drawn: 28 });
    expect(instancePositions(walk.group)).toHaveLength(28);
    walk.dispose();
  });

  it('reports the true number even when it draws fewer', () => {
    const walk = layer();
    walk.show(ROUTE, undefined, 5000);

    const crowd = walk.crowd();
    expect(crowd?.people).toBe(5000);
    // Capped for the renderer's sake, and the gap is stated rather than hidden.
    expect(crowd?.drawn).toBeLessThan(5000);
    expect(crowd?.drawn).toBe(instancePositions(walk.group).length);
    walk.dispose();
  });

  it('spreads the crowd along and across the path instead of stacking it', () => {
    const walk = layer();
    walk.show(ROUTE, undefined, 40);
    // Far enough in that the whole trail is on the path rather than queued at the door.
    walk.update(80);

    const at = instancePositions(walk.group);
    const xs = at.map((p) => p.x);
    const zs = at.map((p) => p.z);

    // Along the route: the tail is well behind the leader.
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(20);
    // Across it: they walk in a band, not in single file.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(2);

    // ⚠️ NEGATIVE CONTROL. Two people standing in the same spot is the failure this guards, so
    // prove no two figures share a position.
    const distinct = new Set(at.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`));
    expect(distinct.size).toBe(at.length);
    walk.dispose();
  });

  it('walks the crowd at the same speed as the lone figure', () => {
    /*
      ⚠️ THE SPEED IS THE ONE NUMBER THE PANEL PRINTS. `walk-routes.json` derives every "6 Minuten"
      from 1.35 m/s, so if a crowd moved at any other rate the picture would contradict the text
      beside it. The leader must cover the same ground in the same time whether it is alone or at
      the head of two hundred.
    */
    const alone = layer();
    alone.show(ROUTE, undefined, null);
    alone.update(30);
    const soloAt = alone.walker();

    const many = layer();
    many.show(ROUTE, undefined, 120);
    many.update(30);
    const leadAt = many.walker();

    expect(soloAt).not.toBeNull();
    expect(leadAt).not.toBeNull();
    expect(leadAt!.progress).toBeCloseTo(soloAt!.progress, 6);
    expect(leadAt!.seconds).toBeCloseTo(soloAt!.seconds, 6);

    alone.dispose();
    many.dispose();
  });

  it('holds the crowd at the start rather than extrapolating it off the path', () => {
    /*
      Each figure trails the leader, so at t=0 most of them are at a negative distance. Clamping is
      what makes that a queue at the door; without it they would be strung out behind the origin,
      inside the building they are supposed to be leaving.
    */
    const walk = layer();
    walk.show(ROUTE, undefined, 60);
    walk.update(0);

    const zs = instancePositions(walk.group).map((p) => p.z);
    const startZ = zs[0];
    // Nobody is beyond the start, in either direction along the route.
    for (const z of zs) expect(Math.abs(z - startZ)).toBeLessThan(1);
    walk.dispose();
  });

  it('lays the same crowd out the same way twice', () => {
    // React re-renders; a layout that used Math.random would shimmer and make measurement a lottery.
    const a = layer();
    a.show(ROUTE, undefined, 25);
    a.update(12);
    const first = instancePositions(a.group).map((p) => `${p.x.toFixed(4)},${p.z.toFixed(4)}`);
    a.dispose();

    const b = layer();
    b.show(ROUTE, undefined, 25);
    b.update(12);
    const second = instancePositions(b.group).map((p) => `${p.x.toFixed(4)},${p.z.toFixed(4)}`);
    b.dispose();

    expect(second).toEqual(first);
  });

  it('never shows a crowd and a lone walker on the same route', () => {
    const walk = layer();
    walk.show(ROUTE, undefined, 30);
    // The single figure is a Group; the crowd is an InstancedMesh. Exactly one may be present.
    const groups = walk.group.children.filter(
      (c) => c instanceof THREE.Group && c.name !== 'walk-route'
    );
    expect(groups).toHaveLength(0);
    expect(walk.crowd()).not.toBeNull();
    walk.dispose();
  });

  it('stretches a bigger cohort further back down the path', () => {
    /*
      ⚠️ THE FIXED-LENGTH TRAIL THIS REPLACED LOOKED FINE UNTIL IT DIDN'T. Every figure used to be
      packed into the same 60 m regardless of how many there were, which read well for a seminar of
      28 and turned a 240-person lecture into a solid marching column — the same path holding eight
      times the bodies. The trail is now the time the cohort takes to clear the door, so density
      stays roughly constant and the model is defensible as well as prettier.
    */
    const small = layer();
    small.show(ROUTE, undefined, 20);
    small.update(200);
    const smallSpan = span(instancePositions(small.group));
    small.dispose();

    const large = layer();
    large.show(ROUTE, undefined, 200);
    large.update(200);
    const largeSpan = span(instancePositions(large.group));
    large.dispose();

    expect(largeSpan).toBeGreaterThan(smallSpan * 3);
  });

  it('never lets the crowd outgrow the route it is walking', () => {
    // A big cohort on a short hop would otherwise have its tail still indoors on every loop.
    const walk = layer();
    walk.show(ROUTE, undefined, 3000);
    walk.update(500);

    const zs = instancePositions(walk.group).map((p) => p.z);
    // The route runs ~300 m; nobody may be strung out beyond it.
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThanOrEqual(300);
    walk.dispose();
  });

  it('draws the largest lecture in the shipped data without truncating it', () => {
    /*
      ⚠️ THE REGRESSION THIS EXISTS FOR IS A COMMENT THAT WAS CONFIDENTLY WRONG. The cap was set to
      320 and justified with "the largest cohort is 240" — measured from `data/synthetic` alone. TUM's
      real TUMonline export states 1 073 for a single session, so the biggest lecture on the site
      would have been drawn at under a third of its size, reported correctly by `crowd().people` and
      wrong on screen. Nothing failed; the number was simply never checked against the other seven
      datasets.
    */
    const walk = layer();
    walk.show(ROUTE, undefined, 1073);

    expect(walk.crowd()).toEqual({ people: 1073, drawn: 1073 });
    walk.dispose();
  });

  it('takes the crowd away again when the walk is cleared', () => {
    const walk = layer();
    walk.show(ROUTE, undefined, 30);
    expect(instancePositions(walk.group).length).toBeGreaterThan(0);

    walk.clear();
    expect(walk.crowd()).toBeNull();
    expect(instancePositions(walk.group)).toHaveLength(0);
    expect(walk.drawn()).toBe(0);
    walk.dispose();
  });

  it('replaces the crowd rather than piling a second one on top', () => {
    const walk = layer();
    walk.show(ROUTE, undefined, 30);
    walk.show(ROUTE, undefined, 12);

    expect(walk.crowd()).toEqual({ people: 12, drawn: 12 });
    expect(instancePositions(walk.group)).toHaveLength(12);
    walk.dispose();
  });
});
