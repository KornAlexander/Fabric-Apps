import { describe, expect, it } from 'vitest';

import {
  isFacingNorth,
  normaliseAngle,
  roseRotationDeg,
  shortestTurnToNorth,
} from '../compass';

const deg = (d: number) => (d * Math.PI) / 180;

describe('normaliseAngle', () => {
  it('leaves an angle already in range alone', () => {
    expect(normaliseAngle(0)).toBe(0);
    expect(normaliseAngle(deg(90))).toBeCloseTo(deg(90), 10);
  });

  it('brings a wrapped angle back into (-pi, pi]', () => {
    expect(normaliseAngle(deg(190))).toBeCloseTo(deg(-170), 10);
    expect(normaliseAngle(deg(-190))).toBeCloseTo(deg(170), 10);
    expect(normaliseAngle(deg(720))).toBeCloseTo(0, 10);
  });
});

describe('shortestTurnToNorth', () => {
  it('turns nothing when already facing north', () => {
    expect(shortestTurnToNorth(0)).toBe(0);
  });

  it('takes the short arc, not the long one', () => {
    // From 350° the compass must turn 10° forwards, not 350° backwards. Getting this wrong shows
    // up as a camera sweeping the whole way round the horizon to reach a heading it was almost at.
    expect(shortestTurnToNorth(deg(350))).toBeCloseTo(deg(10), 10);
    expect(shortestTurnToNorth(deg(10))).toBeCloseTo(deg(-10), 10);
  });

  it('never asks for more than half a turn', () => {
    for (let d = -720; d <= 720; d += 7) {
      expect(Math.abs(shortestTurnToNorth(deg(d)))).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });

  it('lands on north from anywhere', () => {
    for (let d = -350; d <= 350; d += 13) {
      const from = deg(d);
      expect(isFacingNorth(from + shortestTurnToNorth(from))).toBe(true);
    }
  });
});

describe('roseRotationDeg', () => {
  it('leaves the rose upright when the camera looks north', () => {
    expect(roseRotationDeg(0)).toBe(0);
  });

  it('swings north to the right of the screen as the view turns west', () => {
    expect(roseRotationDeg(deg(90))).toBeCloseTo(90, 6);
  });

  it('reports the wrapped angle rather than a number that reads as broken', () => {
    // 190° and −170° point the same way; only one of them looks like a compass.
    expect(roseRotationDeg(deg(190))).toBeCloseTo(-170, 6);
  });
});

describe('isFacingNorth', () => {
  it('tolerates the last fraction of a degree', () => {
    expect(isFacingNorth(deg(0.5))).toBe(true);
    expect(isFacingNorth(deg(5))).toBe(false);
  });

  it('treats a full turn as north', () => {
    expect(isFacingNorth(deg(360))).toBe(true);
  });
});
