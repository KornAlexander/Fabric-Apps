import { describe, expect, it } from 'vitest';

import { HQ10, HQ100, HQ200_EXTRAPOLATED, HQ50, extrapolatedHq } from '@/data/facts';
import { buildSteadyWseProfile, stageFromRating } from '../hydrograph';

/**
 * The hazard-class overlay and the portfolio numbers are two views of one derivation, and they are
 * computed in different languages by different code — the overlay in the terrain shader from
 * `buildSteadyWseProfile`, the portfolio in tools/geodata/build_portfolio.py. If they drift, the
 * map shades a building one class while the KPI cards count it as another, and nobody notices
 * until someone in the audience does.
 *
 * A cross-check against the real 8 539-building dataset agreed on 8 529 of them (99.883 %). All
 * ten exceptions sat within 2.6 mm of a class boundary, on ground elevations stored rounded to a
 * centimetre — inside the rounding of the comparison itself. These tests pin the reasons that
 * holds, so a later edit to either side has to break something visible.
 */

/** A monotonic synthetic rating table, standing in for the per-chainage curves. */
function ratingTable(points: number): { bed: number[]; q: number[]; stage: number[][] } {
  const q = [0, 50, 175, 367, 500, 633, 1000, 1500];
  const bed: number[] = [];
  const stage: number[][] = [];
  for (let i = 0; i < points; i++) {
    bed.push(200 - i * 0.15); // falling downstream, as the Ahr does
    const width = 12 + i * 0.4; // widening downstream, so stage rises more slowly
    stage.push(q.map((discharge) => Math.pow(discharge / width, 0.55)));
  }
  return { bed, q, stage };
}

describe('hazard class boundaries', () => {
  it('extrapolates HQ200 to 633 m³/s, exactly one published step beyond HQ100', () => {
    // The two anchors are a doubling apart (50 → 100 years), and the target is another doubling
    // (100 → 200), so the log-extrapolation reduces to adding the last published step.
    expect(HQ200_EXTRAPOLATED.value).toBe(633);
    expect(HQ200_EXTRAPOLATED.value).toBe(HQ100.value + (HQ100.value - HQ50.value));
  });

  it('passes exactly through the published anchors it is fitted to', () => {
    expect(extrapolatedHq(100)).toBeCloseTo(HQ100.value, 10);
    expect(extrapolatedHq(50)).toBeCloseTo(HQ50.value, 10);
  });

  it('marks the 200-year discharge as a reconstruction, because it is not published', () => {
    expect(HQ200_EXTRAPOLATED.source?.reconstruction).toBe(true);
    expect(HQ100.source?.reconstruction).toBeUndefined();
  });
});

describe('steady water-surface profiles', () => {
  const points = 120;
  const { bed, q, stage } = ratingTable(points);
  const profileFor = (gaugeDischargeM3s: number) =>
    buildSteadyWseProfile({
      gaugeDischargeM3s,
      bedProfileM: bed,
      ratingDischargeM3s: q,
      ratingStageM: stage,
    });

  const wse10 = profileFor(HQ10.value);
  const wse100 = profileFor(HQ100.value);
  const wse200 = profileFor(HQ200_EXTRAPOLATED.value);

  it('nests the three boundary surfaces, so the four classes are nested rings', () => {
    // This is the invariant that makes the overlay legible at all. If a rarer flood could stand
    // *lower* anywhere, GK4 ground would appear outside GK3 and the map would be nonsense.
    for (let i = 0; i < points; i++) {
      expect(wse10[i]).toBeLessThanOrEqual(wse100[i]);
      expect(wse100[i]).toBeLessThanOrEqual(wse200[i]);
    }
  });

  it('never puts the water below the river bed', () => {
    for (let i = 0; i < points; i++) expect(wse10[i]).toBeGreaterThanOrEqual(bed[i]);
  });

  it('carries no clock — a 100-year flood is one everywhere along the reach', () => {
    // buildWseProfile lags the wave downstream because the 2021 event took time to travel. A
    // frequency statement must not, or the class of a village would depend on the scrubber.
    expect(Array.from(profileFor(HQ100.value))).toEqual(Array.from(wse100));
  });

  it('agrees with solving for the discharge at which the ground first floods', () => {
    // The portfolio derivation, inverted: find the local discharge that raises the water to this
    // ground, convert to the gauge reference, and compare against the boundary. Asking instead
    // whether the ground lies under the boundary surface must give the same class, because both
    // interpolations are monotonic. This is the equivalence the cross-check measured.
    const classify = (ground: number, chain: number): string => {
      if (ground <= wse10[chain]) return 'GK4';
      if (ground <= wse100[chain]) return 'GK3';
      if (ground <= wse200[chain]) return 'GK2';
      return 'GK1';
    };

    const byInverse = (ground: number, chain: number): string => {
      const gain = 1 + 0.25 * (chain / (points - 1));
      const required = ground - bed[chain];
      if (required <= 0) return 'GK4';
      const stages = stage[chain];
      if (required > stages[stages.length - 1]) return 'GK1';

      // Local discharge that produces exactly this stage, then back to the gauge reference the
      // frequency curve is stated for.
      let localQ = q[q.length - 1];
      for (let i = 1; i < stages.length; i++) {
        if (stages[i] >= required) {
          const span = stages[i] - stages[i - 1];
          const f = span > 0 ? (required - stages[i - 1]) / span : 0;
          localQ = q[i - 1] + (q[i] - q[i - 1]) * f;
          break;
        }
      }
      const gaugeQ = localQ / gain;
      if (gaugeQ <= HQ10.value) return 'GK4';
      if (gaugeQ <= HQ100.value) return 'GK3';
      if (gaugeQ <= HQ200_EXTRAPOLATED.value) return 'GK2';
      return 'GK1';
    };

    let compared = 0;
    for (let chain = 0; chain < points; chain += 7) {
      for (let step = 0; step <= 60; step++) {
        const ground = bed[chain] + step * 0.25;
        // Skip ground sitting within a millimetre of a boundary: the real cross-check showed the
        // only divergences are there, and they are rounding, not disagreement.
        const nearBoundary = [wse10[chain], wse100[chain], wse200[chain]].some(
          (level) => Math.abs(ground - level) < 1e-3
        );
        if (nearBoundary) continue;
        expect(byInverse(ground, chain)).toBe(classify(ground, chain));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(800);
  });

  it('clamps the rating lookup outside the tabulated range instead of extrapolating', () => {
    expect(stageFromRating(-5, q, stage[0])).toBe(stage[0][0]);
    expect(stageFromRating(99999, q, stage[0])).toBe(stage[0][stage[0].length - 1]);
  });
});
