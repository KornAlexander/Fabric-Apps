/**
 * The grade, and the air.
 *
 * ⚠️ **None of this can check that the picture looks better.** A shader is not
 * inspectable from a test and beauty is not a unit test. What is checkable is
 * the thing that actually went wrong: a setting that reads as deliberate,
 * sits in the source looking tuned, and is expressed in a unit the world
 * never reaches.
 *
 * That is exactly what the fog was. `new Fog(colour, 150, 900)` on a map
 * about 78 units in radius meant the entire playable world sat inside the
 * fog's near plane. Measured against a photoreal aerial, the game kept 0.92
 * of its saturation from the foreground to the horizon where a photograph
 * keeps 0.68: no atmosphere at all, from code that looked like atmosphere.
 */

import { describe, expect, it } from 'vitest';
import { FOG_DENSITY, hazeAt } from '../src/three/world.js';
import { createGrade } from '../src/three/grade.js';

/**
 * The map is 45 hexes of radius and hex centres sit 2*cos(30) = 1.732 apart,
 * so the world reaches roughly this far from the middle and is twice this
 * across.
 */
const MAP_RADIUS = 45 * 1.732;

describe('⚠️ the air', () => {
  it('leaves the tiles under the cursor alone', () => {
    // Whatever else it does, haze must not touch the hexes somebody is
    // reading. Fog on the working area is not atmosphere, it is a white sheet.
    expect(hazeAt(4)).toBeLessThan(0.01);
    expect(hazeAt(10)).toBeLessThan(0.02);
  });

  it('⚠️ actually reaches the far side of the world', () => {
    // The regression test for the real defect. The old linear fog scored
    // under 0.01 here, from a line of code that looked entirely reasonable.
    expect(hazeAt(MAP_RADIUS)).toBeGreaterThan(0.1);
    expect(hazeAt(MAP_RADIUS * 2)).toBeGreaterThan(0.35);
  });

  it('never becomes a wall, even at the far plane', () => {
    // Total extinction at any distance the camera can see means a horizon
    // that is a flat sheet of fog colour, which is worse than no fog.
    expect(hazeAt(MAP_RADIUS * 2)).toBeLessThan(0.85);
  });

  it('grows with distance, monotonically', () => {
    let previous = -1;
    for (let d = 0; d <= 400; d += 20) {
      const haze = hazeAt(d);
      expect(haze).toBeGreaterThanOrEqual(previous);
      previous = haze;
    }
  });

  it('⚠️ would fail if the old linear fog came back', () => {
    /*
     * Written as an explicit statement of the bug rather than a comment about
     * it. A linear fog from 150 to 900 delivers this much haze at the far
     * shore of the island, and the number is the whole story.
     */
    const oldLinearHaze = Math.max(0, (MAP_RADIUS - 150) / (900 - 150));
    expect(oldLinearHaze).toBe(0);
    expect(hazeAt(MAP_RADIUS)).toBeGreaterThan(oldLinearHaze);
  });

  it('keeps the density in a range somebody has actually looked at', () => {
    expect(FOG_DENSITY).toBeGreaterThan(0.002);
    expect(FOG_DENSITY).toBeLessThan(0.02);
  });
});

describe('the grade', () => {
  /** Read a uniform without repeating the non-null dance five times. */
  const u = (grade: ReturnType<typeof createGrade>, name: string): number =>
    grade.pass.uniforms[name]!.value as number;

  it('starts on the playing look, not the cinematic one', () => {
    const grade = createGrade(1920, 1080);
    expect(u(grade, 'saturation')).toBeCloseTo(0.66, 3);
    expect(u(grade, 'vignette')).toBeCloseTo(0.26, 3);
  });

  it('⚠️ walks to the cinematic look rather than cutting to it', () => {
    /*
     * The reason this is tested: a grade that snaps is a cut, and the
     * cinematics are meant to read as one continuous camera move. A single
     * frame is not enough to arrive, and enough frames must be.
     */
    const grade = createGrade();
    const before = u(grade, 'vignette');
    grade.setCinematic(true);

    grade.tick(1 / 60);
    const afterOneFrame = u(grade, 'vignette');
    expect(afterOneFrame).toBeGreaterThan(before);
    expect(afterOneFrame).toBeLessThan(0.42);

    for (let i = 0; i < 60; i += 1) grade.tick(1 / 60);
    expect(u(grade, 'vignette')).toBeCloseTo(0.42, 3);
  });

  it('comes back again when the film ends', () => {
    const grade = createGrade();
    grade.setCinematic(true);
    for (let i = 0; i < 60; i += 1) grade.tick(1 / 60);
    grade.setCinematic(false);
    for (let i = 0; i < 60; i += 1) grade.tick(1 / 60);
    expect(u(grade, 'saturation')).toBeCloseTo(0.66, 3);
    expect(u(grade, 'vignette')).toBeCloseTo(0.26, 3);
  });

  it('⚠️ never overshoots either end, however coarse the frames are', () => {
    // A slow machine delivers one enormous delta rather than many small ones,
    // and a blend that multiplies by it would sail past the target and stay
    // there, leaving the game permanently graded like a film.
    const grade = createGrade();
    grade.setCinematic(true);
    grade.tick(10);
    expect(u(grade, 'vignette')).toBeCloseTo(0.42, 3);
    grade.setCinematic(false);
    grade.tick(10);
    expect(u(grade, 'vignette')).toBeCloseTo(0.26, 3);
  });

  it('desaturates and darkens rather than the reverse', () => {
    /*
     * The direction is the entire measured finding: the game was 1.77 times
     * more saturated than a photograph and had no true blacks. A grade that
     * added saturation would be a change, not a fix.
     */
    const grade = createGrade();
    expect(u(grade, 'saturation')).toBeLessThan(1);
    expect(u(grade, 'contrast')).toBeGreaterThan(1);
    expect(u(grade, 'lift')).toBeGreaterThan(0);
  });

  it('films are graded further than play, not differently', () => {
    // A cinematic that looks like another game is a cut. Same direction on
    // every dial, further along it.
    const play = createGrade();
    const film = createGrade();
    film.setCinematic(true);
    film.tick(10);
    expect(u(film, 'saturation')).toBeLessThan(u(play, 'saturation'));
    expect(u(film, 'contrast')).toBeGreaterThan(u(play, 'contrast'));
    expect(u(film, 'vignette')).toBeGreaterThan(u(play, 'vignette'));
  });

  it('keeps the grain moving, or it is a dirty lens rather than grain', () => {
    const grade = createGrade();
    const before = u(grade, 'time');
    grade.tick(1 / 60);
    expect(u(grade, 'time')).toBeGreaterThan(before);
  });
});
