import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadShuttle } from '@/twin3d/shuttle';
import type { WorldExtent } from '@/geo/world';

/**
 * The on-demand bus replay: it must be fast, it must be honest about being fast, and it must not
 * disturb the ambient shuttle it borrows.
 *
 * ⚠️ THE POINT OF THIS FILE IS THE THIRD ONE. A replay that fast-forwards the shared clock would
 * look perfect on screen for ten seconds and then teleport the bus five minutes into its cycle the
 * moment it handed back. That is invisible in a screenshot, invisible in a typecheck, and obvious
 * only to somebody watching the exact frame of the handover.
 */

/**
 * ⚠️ THIS IS THE REAL `WorldExtent` SHAPE, IN UTM32 METRES, AND THE FIRST VERSION WAS NOT.
 * That one carried `west`/`east`/`centreLat` and friends, cast through `unknown`, so `toWorld`
 * read `undefined` for `minEasting` and every position came out NaN. Five of six tests failed with
 * "expected false to be true" and none of them said "your fixture is the wrong type", because the
 * cast had told the compiler not to look. A fixture that lies about a type tests nothing.
 *
 * The numbers only have to bracket the leg below; a scene-space offset is not what is under test.
 */
const EXTENT: WorldExtent = {
  minEasting: 720_000,
  maxNorthing: 5_435_000,
  widthM: 5000,
  depthM: 5000,
  zone: 32,
};

/** A straight 3 km leg that takes 300 s, so the arithmetic is checkable by hand. */
const DOC = {
  legs: [
    {
      from: 'seyboth',
      to: 'pruefening',
      distanceM: 3000,
      driveSeconds: 300,
      points: [
        [12.0, 49.0],
        [12.02, 49.02],
      ],
    },
  ],
};

function mockFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => DOC })) as unknown as typeof fetch
  );
}

const ground = () => 0;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the bus replay', () => {
  it('crosses in the wall-clock time it was given, not the road time', async () => {
    mockFetch();
    const shuttle = await loadShuttle('oth-regensburg', '/terrain', EXTENT, ground);
    expect(shuttle).not.toBeNull();

    const start = { ...shuttle!.position()! };
    shuttle!.setVisible(true);
    shuttle!.playJourney(10);

    // Half way through ten seconds it must be roughly half way along a 3 km road, which at the
    // ambient speed would take 150 s and would have moved it a fiftieth of that.
    for (let i = 0; i < 5; i += 1) shuttle!.tick(1);
    const half = shuttle!.journey();
    expect(half).not.toBeNull();
    expect(half!.progress).toBeGreaterThan(0.45);
    expect(half!.progress).toBeLessThan(0.55);

    for (let i = 0; i < 5; i += 1) shuttle!.tick(1);
    // ⚠️ The journey ENDS rather than looping: one more tick must not restart it.
    expect(shuttle!.journey()).toBeNull();

    const end = shuttle!.position()!;
    const moved = Math.hypot(end.x - start.x, end.z - start.z);
    expect(moved).toBeGreaterThan(100);
  });

  it('reports the compression so the interface can show it', async () => {
    mockFetch();
    const shuttle = await loadShuttle('oth-regensburg', '/terrain', EXTENT, ground);
    shuttle!.playJourney(10);
    const j = shuttle!.journey()!;
    expect(j.realSeconds).toBe(300);
    expect(j.shownSeconds).toBe(10);
    expect(j.factor).toBe(30);
  });

  it('runs backwards when the transfer does', async () => {
    mockFetch();
    const shuttle = await loadShuttle('oth-regensburg', '/terrain', EXTENT, ground);
    const forward = await loadShuttle('oth-regensburg', '/terrain', EXTENT, ground);

    shuttle!.playJourney(10, true);
    forward!.playJourney(10, false);
    shuttle!.tick(1);
    forward!.tick(1);

    // One second in, the two must be at opposite ends of the same road.
    const a = shuttle!.position()!;
    const b = forward!.position()!;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(100);
    expect(shuttle!.journey()!.reverse).toBe(true);
  });

  it('clamps at the far end instead of wrapping', async () => {
    mockFetch();
    const shuttle = await loadShuttle('oth-regensburg', '/terrain', EXTENT, ground);
    shuttle!.setVisible(true);
    const start = { ...shuttle!.position()! };

    shuttle!.playJourney(10);
    for (let i = 0; i < 9; i += 1) shuttle!.tick(1);
    const nearlyThere = shuttle!.position()!;
    const at90 = Math.hypot(nearlyThere.x - start.x, nearlyThere.z - start.z);

    // Overshoot hard. A wrapping implementation puts it back on the start line.
    shuttle!.tick(5);
    const after = shuttle!.position()!;
    const atEnd = Math.hypot(after.x - start.x, after.z - start.z);

    /*
     * ⚠️ THE FIRST VERSION OF THIS ASSERTION WAS WRONG AND WOULD HAVE BEEN "FIXED" BY LOOSENING IT.
     * It required the last tick to move the bus less than 200 m, which is not the property at all:
     * going from 90% to 100% of a 3 km road is legitimately ~266 m, so the test failed on correct
     * behaviour. What actually distinguishes clamping from wrapping is the DIRECTION of travel,
     * so that is what is asserted: the bus must end further from the start than it was at 90%,
     * never nearer.
     */
    expect(atEnd).toBeGreaterThan(at90);
    expect(atEnd).toBeGreaterThan(1000);
  });

  it('⚠️ hands back at the arrival instead of snapping across town', async () => {
    mockFetch();
    const shuttle = await loadShuttle('oth-regensburg', '/terrain', EXTENT, ground);
    shuttle!.setVisible(true);
    shuttle!.playJourney(10);

    for (let i = 0; i < 10; i += 1) shuttle!.tick(1);
    expect(shuttle!.journey()).toBeNull();
    const arrived = { ...shuttle!.position()! };

    /*
     * This is the assertion the first implementation failed, and it failed silently: the bus drove
     * the whole road in ten seconds and then jumped back to within ~100 m of its start, because
     * the ambient clock had been running underneath the whole time. On screen the replay looked
     * like it had never happened. Ticking on must now move it by metres, not by kilometres.
     */
    for (let i = 0; i < 3; i += 1) shuttle!.tick(1);
    const next = shuttle!.position()!;
    expect(Math.hypot(next.x - arrived.x, next.z - arrived.z)).toBeLessThan(50);
  });

  it('refuses a zero duration rather than dividing by it', async () => {
    mockFetch();
    const shuttle = await loadShuttle('oth-regensburg', '/terrain', EXTENT, ground);
    shuttle!.playJourney(0);
    const p = shuttle!.position()!;
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.z)).toBe(true);
    expect(shuttle!.journey()!.shownSeconds).toBeGreaterThan(0);
  });
});
