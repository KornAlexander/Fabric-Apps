import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';

import { approachShot, descendShot, orbitShot } from '../src/three/cinematic.js';

/**
 * Camera choreography.
 *
 * ⚠️ A shot is a pure function of normalised time precisely so it can be
 * checked here rather than by watching it. The assertions worth having are the
 * ones a screenshot would not settle: that the camera never ends up under the
 * ground, that it actually travels, and that a skip to t = 1 lands somewhere
 * sane rather than at whatever the last eased frame happened to be.
 */

const centre = new Vector3(10, 2, -6);

describe('every shot', () => {
  const shots = [
    orbitShot({
      id: 'a',
      title: 'a',
      subtitle: 'a',
      centre,
      radius: 13,
      fromHeight: 3,
      toHeight: 9,
      sweepRad: Math.PI * 0.75,
    }),
    approachShot({
      id: 'b',
      title: 'b',
      subtitle: 'b',
      focus: centre,
      from: new Vector3(1, 0, 0),
      startDistance: 26,
      endDistance: 7,
      startHeight: 14,
      endHeight: 2.6,
    }),
    descendShot({
      id: 'c',
      title: 'c',
      subtitle: 'c',
      centre,
      startHeight: 34,
      endHeight: 6,
      radius: 20,
    }),
  ];

  it('always looks at its subject', () => {
    for (const shot of shots) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        expect(shot.frame(t).target.distanceTo(centre)).toBeCloseTo(0, 6);
      }
    }
  });

  it('never puts the camera below its subject', () => {
    // Under the terrain the scene renders the inside of the world, which
    // looks like a crash rather than a shot.
    for (const shot of shots) {
      for (let t = 0; t <= 1; t += 0.05) {
        expect(shot.frame(t).position.y, `${shot.id} at ${t}`).toBeGreaterThan(centre.y);
      }
    }
  });

  it('actually travels', () => {
    for (const shot of shots) {
      const moved = shot.frame(0).position.distanceTo(shot.frame(1).position);
      expect(moved, shot.id).toBeGreaterThan(5);
    }
  });

  it('clamps outside its own duration, so a skip lands on the last frame', () => {
    for (const shot of shots) {
      expect(shot.frame(2).position.distanceTo(shot.frame(1).position)).toBeCloseTo(0, 6);
      expect(shot.frame(-1).position.distanceTo(shot.frame(0).position)).toBeCloseTo(0, 6);
    }
  });

  it('produces finite numbers throughout', () => {
    for (const shot of shots) {
      for (let t = 0; t <= 1; t += 0.1) {
        const { position } = shot.frame(t);
        expect(Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z)).toBe(true);
      }
    }
  });

  it('lasts long enough to read the title and not long enough to annoy', () => {
    for (const shot of shots) {
      expect(shot.durationMs).toBeGreaterThanOrEqual(3000);
      expect(shot.durationMs).toBeLessThanOrEqual(6000);
    }
  });
});

describe('the orbit', () => {
  const shot = orbitShot({
    id: 'orbit',
    title: 't',
    subtitle: 's',
    centre,
    radius: 12,
    fromHeight: 3,
    toHeight: 9,
    sweepRad: Math.PI / 2,
    startAngleRad: 0,
  });

  it('keeps its distance while it rises', () => {
    const flat = (t: number) => {
      const p = shot.frame(t).position;
      return Math.hypot(p.x - centre.x, p.z - centre.z);
    };
    expect(flat(0)).toBeCloseTo(12, 5);
    expect(flat(1)).toBeCloseTo(12, 5);
    expect(shot.frame(0).position.y).toBeCloseTo(centre.y + 3, 5);
    expect(shot.frame(1).position.y).toBeCloseTo(centre.y + 9, 5);
  });

  it('sweeps the angle it was asked for', () => {
    const angle = (t: number) => {
      const p = shot.frame(t).position;
      return Math.atan2(p.z - centre.z, p.x - centre.x);
    };
    expect(angle(1) - angle(0)).toBeCloseTo(Math.PI / 2, 5);
  });
});

describe('the approach', () => {
  const shot = approachShot({
    id: 'approach',
    title: 't',
    subtitle: 's',
    focus: centre,
    from: new Vector3(3, 0, 0),
    startDistance: 26,
    endDistance: 7,
    startHeight: 14,
    endHeight: 3,
  });

  it('closes in, and only ever closes in', () => {
    const flat = (t: number) => {
      const p = shot.frame(t).position;
      return Math.hypot(p.x - centre.x, p.z - centre.z);
    };

    let previous = Infinity;
    for (let step = 0; step <= 20; step++) {
      // Stepped by an integer rather than by accumulating 0.05, which never
      // lands exactly on 1 and left the final assertion checking t = 0.95.
      const distance = flat(step / 20);
      expect(distance).toBeLessThanOrEqual(previous + 1e-6);
      previous = distance;
    }
    expect(flat(0)).toBeCloseTo(26, 5);
    expect(flat(1)).toBeCloseTo(7, 5);
  });

  it('survives a degenerate direction rather than producing NaN', () => {
    // Two units on the same tile would give a zero-length vector, and a
    // normalised zero vector is NaN in every component.
    const degenerate = approachShot({
      id: 'd',
      title: 't',
      subtitle: 's',
      focus: centre,
      from: new Vector3(0, 0, 0),
      startDistance: 20,
      endDistance: 6,
      startHeight: 10,
      endHeight: 3,
    });
    const p = degenerate.frame(0.5).position;
    expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
  });
});

describe('the descent', () => {
  const shot = descendShot({
    id: 'descend',
    title: 't',
    subtitle: 's',
    centre,
    startHeight: 34,
    endHeight: 6,
    radius: 20,
  });

  it('drops and closes at the same time, so the subject grows in frame', () => {
    const start = shot.frame(0).position;
    const end = shot.frame(1).position;
    expect(end.y).toBeLessThan(start.y);
    expect(Math.hypot(end.x - centre.x, end.z - centre.z)).toBeLessThan(
      Math.hypot(start.x - centre.x, start.z - centre.z),
    );
  });
});
