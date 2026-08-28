import { describe, expect, it } from 'vitest';

import {
  azimuthFromHeading,
  headingDegFromForward,
  headingFromAzimuth,
  headingRadFromForward,
  isFacingNorth,
  normaliseAngle,
  roseRotationDeg,
  shortestTurnToNorth,
} from '../compass';

const deg = (radians: number) => (radians * 180) / Math.PI;
const rad = (degrees: number) => (degrees * Math.PI) / 180;

describe('normaliseAngle', () => {
  it('brings any angle into (-pi, pi]', () => {
    expect(normaliseAngle(0)).toBe(0);
    expect(deg(normaliseAngle(rad(370)))).toBeCloseTo(10, 6);
    expect(deg(normaliseAngle(rad(-370)))).toBeCloseTo(-10, 6);
    // 190 degrees and -170 degrees point the same way; only one of them reads as a bearing.
    expect(deg(normaliseAngle(rad(190)))).toBeCloseTo(-170, 6);
    expect(deg(normaliseAngle(rad(3 * 360 + 45)))).toBeCloseTo(45, 6);
  });

  it('does not return negative zero', () => {
    // `-0` points due north exactly as `0` does, and then propagates into "-0deg" rotations and
    // "-0 rad" turns that read as a bug to whoever meets them next.
    expect(Object.is(normaliseAngle(-0), 0)).toBe(true);
    expect(Object.is(normaliseAngle(-2 * Math.PI), 0)).toBe(true);
  });
});

describe('headingFromForward', () => {
  /**
   * ⚠️ THE CARDINALS ARE THE WHOLE TEST, and they are pinned to the WORLD, not to the formula.
   *
   * `scene.ts` puts east on +x and south on +z (see `worldFromMeta`), so these four rows are facts
   * about the terrain, and any heading function has to agree with them. The shipped drone
   * telemetry did not: it answered 270 for due east — west — while its own doc comment claimed
   * "degrees clockwise from north". A test written from the formula would have blessed that.
   */
  it.each([
    ['north', 0, -1, 0],
    ['east', 1, 0, 90],
    ['south', 0, 1, 180],
    ['west', -1, 0, 270],
  ])('reads %s as %s', (_name, x, z, expected) => {
    expect(headingDegFromForward(x, z)).toBeCloseTo(expected, 6);
  });

  it('ignores the length of the direction vector', () => {
    expect(headingDegFromForward(500, -500)).toBeCloseTo(45, 6);
    expect(headingDegFromForward(0.001, -0.001)).toBeCloseTo(45, 6);
  });

  it('reports in (-pi, pi] in radians and 0..360 in degrees', () => {
    expect(deg(headingRadFromForward(-1, 0))).toBeCloseTo(-90, 6);
    expect(headingDegFromForward(-1, 0)).toBeCloseTo(270, 6);
  });
});

describe('headingFromAzimuth', () => {
  /**
   * OrbitControls puts the camera AT the azimuth and points it back at the target, so the view
   * looks the opposite way round the circle. Getting this backwards is invisible in a screenshot
   * and obvious the moment you drag: the rose would turn the wrong way.
   */
  it('is the azimuth negated: azimuth 0 looks north, azimuth +90 looks west', () => {
    expect(headingFromAzimuth(0)).toBe(0);
    expect(deg(headingFromAzimuth(rad(90)))).toBeCloseTo(-90, 6); // = 270, west
    expect(deg(headingFromAzimuth(rad(180)))).toBeCloseTo(180, 6);
  });

  it('round-trips through azimuthFromHeading', () => {
    for (const degrees of [0, 17, 90, 179, -45, -170]) {
      expect(deg(headingFromAzimuth(azimuthFromHeading(rad(degrees))))).toBeCloseTo(degrees, 6);
    }
  });
});

describe('shortestTurnToNorth', () => {
  it('takes the short way round', () => {
    // The case the whole function exists for: from 350 the camera swings 10 forwards, not 350 back.
    expect(deg(shortestTurnToNorth(rad(350)))).toBeCloseTo(10, 6);
    expect(deg(shortestTurnToNorth(rad(10)))).toBeCloseTo(-10, 6);
    expect(deg(shortestTurnToNorth(rad(179)))).toBeCloseTo(-179, 6);
    expect(deg(shortestTurnToNorth(rad(181)))).toBeCloseTo(179, 6);
  });

  it('never turns more than half a circle', () => {
    for (let degrees = -720; degrees <= 720; degrees += 7) {
      expect(Math.abs(deg(shortestTurnToNorth(rad(degrees))))).toBeLessThanOrEqual(180.000001);
    }
  });

  it('lands on north from anywhere', () => {
    for (let degrees = -350; degrees <= 350; degrees += 13) {
      const from = rad(degrees);
      expect(deg(normaliseAngle(from + shortestTurnToNorth(from)))).toBeCloseTo(0, 6);
    }
  });
});

describe('roseRotationDeg', () => {
  /**
   * The rose COUNTER-rotates the view. Looking east, north is to the LEFT of the screen, so the
   * rose — drawn with N up — has to turn anticlockwise to point that way.
   */
  it('turns the opposite way to the heading', () => {
    expect(roseRotationDeg(0)).toBe(0);
    expect(roseRotationDeg(rad(90))).toBeCloseTo(-90, 6);
    expect(roseRotationDeg(rad(-90))).toBeCloseTo(90, 6);
  });

  it('stays within half a turn either way, so the rose never spins the long way', () => {
    for (let degrees = -720; degrees <= 720; degrees += 11) {
      expect(Math.abs(roseRotationDeg(rad(degrees)))).toBeLessThanOrEqual(180.000001);
    }
  });
});

describe('isFacingNorth', () => {
  it('is true only within the tolerance, either side of the wrap', () => {
    expect(isFacingNorth(0)).toBe(true);
    expect(isFacingNorth(rad(0.5))).toBe(true);
    expect(isFacingNorth(rad(-0.5))).toBe(true);
    expect(isFacingNorth(rad(5))).toBe(false);
    // 359.5 degrees is half a degree from north, not 359.5 degrees from it.
    expect(isFacingNorth(rad(359.9))).toBe(true);
  });
});
