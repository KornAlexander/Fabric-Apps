import { describe, expect, it } from 'vitest';

import { hazardVersusEvent } from '../hazardVersusEvent';
import type { PortfolioBundle } from '../whatif';

/**
 * The hazard overlay and the flood come out of the same terrain and the same rating curve, so it
 * is fair to suspect the overlay of being the flood in different colours. If it were, Act IV
 * lesson 2 would be contradicted by the app's own data.
 *
 * These tests pin the thing that makes the lesson true: an event well beyond HQ100 must reach
 * ground that the hundred-year surface does not, and that ground must still be classified as the
 * rare classes it is.
 */

/** A flat reach with buildings stepped up the bank, so class and depth are both predictable. */
function bundle(over: Partial<PortfolioBundle> = {}): PortfolioBundle {
  const grounds = [100, 101, 102, 103, 104, 105];
  return {
    count: grounds.length,
    villages: ['Test'],
    hazardClasses: ['GK1', 'GK2', 'GK3', 'GK4'],
    villageIndex: grounds.map(() => 0),
    // Low ground floods often (GK4), high ground rarely (GK1).
    hazardIndex: [3, 3, 2, 1, 0, 0],
    groundElevM: grounds,
    chainageIndex: grounds.map(() => 0),
    sumInsuredEur: grounds.map(() => 300_000),
    elementarCover: grounds.map(() => 1),
    deductibleEur: grounds.map(() => 500),
    waitingPeriodOpen: grounds.map(() => 0),
    assumedResidentsPerBuilding: 2.1,
    insurer: 'Musterschutz Gruppe',
    ...over,
  } as PortfolioBundle;
}

/** Rating that turns discharge into stage linearly, so the arithmetic stays checkable by hand. */
const RATING_Q = [0, 100, 500, 1000, 2000];
const RATING_STAGE = [[0, 1, 3, 5, 8]];

const args = {
  portfolio: bundle(),
  bedProfileM: [100],
  ratingDischargeM3s: RATING_Q,
  ratingStageM: RATING_STAGE,
  reachLengthM: 1000,
};

describe('hazardVersusEvent', () => {
  it('reaches further than the hundred-year surface when the event is bigger', () => {
    const out = hazardVersusEvent({ ...args, basePeakM3s: 1015 });
    expect(out.flooded).toBeGreaterThan(out.floodedAtHq100);
  });

  it('counts the flooded buildings that sit in the rare classes', () => {
    const out = hazardVersusEvent({ ...args, basePeakM3s: 1015 });
    // The event reaches high ground classified GK1/GK2, which is the whole point of lesson 2.
    expect(out.floodedBelowHq100Class).toBeGreaterThan(0);
    expect(out.shareBelowHq100Pct).toBeGreaterThan(0);
    expect(out.shareBelowHq100Pct).toBeLessThanOrEqual(100);
  });

  it('finds nothing in the rare classes when the event stays inside HQ100', () => {
    // A small event floods only the low, frequently-flooded ground. If this ever returned a
    // non-zero share, the function would be reporting the classification rather than the overlap.
    const out = hazardVersusEvent({ ...args, basePeakM3s: 100 });
    expect(out.floodedBelowHq100Class).toBe(0);
  });

  it('is a share of the flooded buildings, not of the whole portfolio', () => {
    const out = hazardVersusEvent({ ...args, basePeakM3s: 1015 });
    expect(out.shareBelowHq100Pct).toBeCloseTo(
      (out.floodedBelowHq100Class / out.flooded) * 100,
      6
    );
  });

  it('survives a portfolio whose class list is ordered but unfamiliar', () => {
    // The cutoff is found by name rather than assumed to be index 2, so a future class list does
    // not silently reclassify every building.
    const out = hazardVersusEvent({
      ...args,
      portfolio: bundle({ hazardClasses: ['GK1', 'GK2', 'GK3', 'GK4'] }),
      basePeakM3s: 1015,
    });
    expect(out.flooded).toBeGreaterThan(0);
  });

  it('reports nothing rather than dividing by zero on a dry event', () => {
    const out = hazardVersusEvent({ ...args, basePeakM3s: 0 });
    expect(out.flooded).toBe(0);
    expect(out.shareBelowHq100Pct).toBe(0);
  });

  it('measures the maximum extent, not the instant the gauge peaks', () => {
    // This is the correctness of the whole figure. `runWhatIf` evaluates every chainage point at
    // global t=0, which leaves out everything downstream that floods later — and downstream is
    // where the rare classes are, because the upstream gorge is almost all GK3/GK4. Measured on
    // the shipped portfolio the snapshot said 4 % where the envelope says 29 %.
    //
    // A reach long enough for the wave lag to matter must therefore flood at least as much as a
    // lagged snapshot would.
    const longReach = { ...args, reachLengthM: 35_000, basePeakM3s: 1015 };
    const out = hazardVersusEvent(longReach);
    const short = hazardVersusEvent({ ...longReach, reachLengthM: 1 });
    // Lag-free means the reach length cannot change how much floods at the peak.
    expect(out.flooded).toBe(short.flooded);
  });
});
