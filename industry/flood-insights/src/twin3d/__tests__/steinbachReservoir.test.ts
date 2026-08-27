import { describe, expect, it } from 'vitest';

import { DAM_CREST_M, DAM_FULL_SUPPLY_M } from '@/data/steinbach';
import {
  BREAK_CLOCK_MINUTE,
  clockAt,
  CREST_M,
  freeboardUsedM,
  FULL_SUPPLY_CLOCK_MINUTE,
  FULL_SUPPLY_M,
  isOvertopping,
  reservoirLevelM,
  RESERVOIR_START_MINUTES,
} from '../steinbachReservoir';

/**
 * The reservoir half of the corridor timeline.
 *
 * These defend the line between the two halves of that night. Everything at t < 0 happened and is
 * anchored to a published level; everything at t >= 0 is a study's hypothetical. The tests that
 * matter are the ones that stop the first from drifting into the second's habits — inventing a
 * level where none was published, or quoting the interpolation as a figure.
 */

describe('reservoir level', () => {
  it('takes both levels from the sourced facts rather than restating them', () => {
    expect(FULL_SUPPLY_M).toBe(DAM_FULL_SUPPLY_M.value);
    expect(CREST_M).toBe(DAM_CREST_M.value);
    // The freeboard the operator had: 2.3 m between normal and the top.
    expect(CREST_M - FULL_SUPPLY_M).toBeCloseTo(2.3, 5);
  });

  it('anchors the timeline to the documented clock times', () => {
    expect(BREAK_CLOCK_MINUTE).toBe(20 * 60); // overtopping, 20:00
    expect(FULL_SUPPLY_CLOCK_MINUTE).toBe(16 * 60 + 35); // full supply, 16:35
    expect(RESERVOIR_START_MINUTES).toBe(-205);
  });

  it('stands at full supply when the first level was reported', () => {
    expect(reservoirLevelM(RESERVOIR_START_MINUTES)).toBeCloseTo(FULL_SUPPLY_M, 6);
    expect(freeboardUsedM(RESERVOIR_START_MINUTES)).toBeCloseTo(0, 6);
  });

  it('reaches the crest exactly when overtopping was reported', () => {
    expect(reservoirLevelM(0)).toBeCloseTo(CREST_M, 6);
    expect(freeboardUsedM(0)).toBeCloseTo(2.3, 5);
  });

  /**
   * ⚠️ The reservoir held water before 16:35 — it is a reservoir. But no level was published for
   * any earlier time, and a surface drawn there would be a level this app invented. Null, and the
   * scene draws nothing.
   */
  it('publishes no level before the first sourced one', () => {
    expect(reservoirLevelM(RESERVOIR_START_MINUTES - 1)).toBeNull();
    expect(reservoirLevelM(-600)).toBeNull();
  });

  it('rises monotonically and never overshoots either anchor', () => {
    let previous = -Infinity;
    for (let m = RESERVOIR_START_MINUTES; m <= 0; m += 5) {
      const level = reservoirLevelM(m)!;
      expect(level).toBeGreaterThanOrEqual(previous);
      expect(level).toBeGreaterThanOrEqual(FULL_SUPPLY_M - 1e-9);
      expect(level).toBeLessThanOrEqual(CREST_M + 1e-9);
      previous = level;
    }
  });

  /**
   * Once water is going over the crest the crest is a spillway: the excess leaves over the top
   * rather than raising the surface. Claiming a level above it would be claiming a freeboard the
   * structure did not have.
   */
  it('holds at the crest once it is overtopping, and never climbs past it', () => {
    for (const m of [0, 30, 90, 150]) {
      expect(reservoirLevelM(m)).toBeCloseTo(CREST_M, 6);
      expect(isOvertopping(m)).toBe(true);
    }
    expect(isOvertopping(-1)).toBe(false);
  });

  it('reads the evening back as a clock, because minutes-from-a-break is not how a night is remembered', () => {
    expect(clockAt(RESERVOIR_START_MINUTES)).toBe('16:35');
    expect(clockAt(0)).toBe('20:00');
    expect(clockAt(150)).toBe('22:30');
    expect(clockAt(-60)).toBe('19:00');
  });
});
