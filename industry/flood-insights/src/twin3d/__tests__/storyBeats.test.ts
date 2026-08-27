import { describe, expect, it } from 'vitest';

import {
  activeBeat,
  buildStoryBeats,
  buildingsInWaterAt,
  localPeakMinutesByVillage,
  type BeatInputs,
} from '../storyBeats';
import type { PortfolioBundle } from '../whatif';

const CHAINAGE = 5;
const REACH_LENGTH_M = 24_590;

/** A small synthetic valley: flat bed, buildings sitting at increasing heights above it. */
function makeInputs(groundOffsets: number[], chainageIndex?: number[]): BeatInputs {
  const bedProfileM = Array.from({ length: CHAINAGE }, () => 100);
  const ratingDischargeM3s = [0, 100, 500, 1500];
  const ratingStageM = Array.from({ length: CHAINAGE }, () => [0, 1, 3, 6]);

  const portfolio = {
    count: groundOffsets.length,
    villages: ['test'],
    hazardClasses: ['GK1'],
    villageIndex: groundOffsets.map(() => 0),
    hazardIndex: groundOffsets.map(() => 0),
    groundElevM: groundOffsets.map((offset) => 100 + offset),
    chainageIndex: chainageIndex ?? groundOffsets.map((_, i) => i % CHAINAGE),
    sumInsuredEur: groundOffsets.map(() => 300_000),
    elementarCover: groundOffsets.map(() => 1),
    deductibleEur: groundOffsets.map(() => 1000),
    waitingPeriodOpen: groundOffsets.map(() => 0),
    assumedResidentsPerBuilding: 2.1,
    insurer: 'Musterschutz',
  } satisfies PortfolioBundle;

  return {
    portfolio,
    bedProfileM,
    ratingDischargeM3s,
    ratingStageM,
    peakM3s: 1000,
    reachLengthM: REACH_LENGTH_M,
  };
}

const BOUNDS = { tMin: -720, tMax: 1440 };

/**
 * The annotations are claims about the event, so PLAN §4.8 applies to them. These tests defend the
 * two properties that keep them honest: the beats are derived from the simulation rather than
 * written by hand, and exactly one of them — the peak — is presented as sourced.
 */
describe('story beats', () => {
  const inputs = makeInputs([0.2, 0.8, 1.5, 2.2, 3.0, 0.4, 1.1, 2.6]);

  it('returns beats in chronological order', () => {
    const beats = buildStoryBeats(inputs, BOUNDS);
    const times = beats.map((b) => b.tMinutes);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(beats.length).toBeGreaterThan(2);
  });

  it('marks exactly one beat as sourced, and it is the peak', () => {
    const beats = buildStoryBeats(inputs, BOUNDS);
    const sourced = beats.filter((b) => b.kind === 'sourced');
    expect(sourced).toHaveLength(1);
    expect(sourced[0].id).toBe('peak');
    // The peak is anchored to t = 0 by the AOI config, not discovered in the data.
    expect(Math.abs(sourced[0].tMinutes)).toBeLessThanOrEqual(15);
  });

  it('never invents a beat when nothing floods', () => {
    // Buildings far above any modelled water level. Silence is the correct output — a narrative
    // that fires regardless of the data would be fiction.
    const dry = makeInputs([50, 60, 70]);
    expect(buildStoryBeats(dry, BOUNDS)).toEqual([]);
  });

  it('puts the largest extent at the true maximum', () => {
    const beats = buildStoryBeats(inputs, BOUNDS);
    const most = Math.max(...beats.map((b) => b.buildingsInWater));
    for (const beat of beats) {
      expect(beat.totalAffected).toBeGreaterThanOrEqual(most);
    }
    // Whichever beat reports the most buildings must genuinely be the peak of the curve.
    const busiest = beats.find((b) => b.buildingsInWater === most)!;
    const earlier = buildingsInWaterAt(busiest.tMinutes - 240, inputs);
    expect(earlier).toBeLessThanOrEqual(busiest.buildingsInWater);
  });

  it('has water rising before the peak and falling after it', () => {
    const rising = buildingsInWaterAt(-300, inputs);
    const atPeak = buildingsInWaterAt(0, inputs);
    const later = buildingsInWaterAt(1200, inputs);
    expect(atPeak).toBeGreaterThan(rising);
    expect(later).toBeLessThan(atPeak);
  });

  it('keeps beats far enough apart to be readable, preferring the sourced one', () => {
    const beats = buildStoryBeats(inputs, { ...BOUNDS, minGapMinutes: 300 });
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i].tMinutes - beats[i - 1].tMinutes).toBeGreaterThanOrEqual(300);
    }
    expect(beats.some((b) => b.kind === 'sourced')).toBe(true);
  });

  it('reports no active beat before the first one', () => {
    const beats = buildStoryBeats(inputs, BOUNDS);
    expect(activeBeat(beats, beats[0].tMinutes - 1)).toBeNull();
    expect(activeBeat(beats, beats[0].tMinutes)).toEqual(beats[0]);
  });

  it('holds the most recent beat as time advances', () => {
    const beats = buildStoryBeats(inputs, BOUNDS);
    const last = beats[beats.length - 1];
    expect(activeBeat(beats, last.tMinutes + 10_000)).toEqual(last);
    if (beats.length > 1) {
      const midpoint = (beats[0].tMinutes + beats[1].tMinutes) / 2;
      expect(activeBeat(beats, midpoint)).toEqual(beats[0]);
    }
  });

  it('places downstream buildings in water later than upstream ones', () => {
    // The wave has to travel, which is why "largest extent" and "peak at the gauge" are two
    // different moments. If this collapses, that distinction in the copy becomes untrue.
    const upstream = makeInputs([1.5], [0]);
    const downstream = makeInputs([1.5], [CHAINAGE - 1]);
    const firstWet = (input: BeatInputs) => {
      for (let t = -720; t <= 1440; t += 15) {
        if (buildingsInWaterAt(t, input) > 0) return t;
      }
      return Infinity;
    };
    expect(firstWet(downstream)).toBeGreaterThan(firstWet(upstream));
  });

  it('gives each village its own peak time, ordered downstream', () => {
    // A village's position is the median chainage of its buildings. Upstream villages must peak
    // first: the app states these times on the village buttons, so a sign error here would put a
    // wrong, confident number in front of the viewer.
    const portfolio = {
      ...makeInputs([1, 1, 1, 1, 1, 1]).portfolio,
      villages: ['Upstream', 'Middle', 'Downstream'],
      villageIndex: [0, 0, 1, 1, 2, 2],
      chainageIndex: [0, 0, 2, 2, 4, 4],
    } satisfies PortfolioBundle;

    const peaks = localPeakMinutesByVillage(portfolio, REACH_LENGTH_M, CHAINAGE);
    expect([...peaks.keys()]).toEqual(['Upstream', 'Middle', 'Downstream']);
    expect(peaks.get('Upstream')!).toBeLessThan(peaks.get('Middle')!);
    expect(peaks.get('Middle')!).toBeLessThan(peaks.get('Downstream')!);

    // The far end of the reach is the full travel time: 24.59 km at 3 m/s is about 137 minutes.
    expect(peaks.get('Downstream')!).toBeCloseTo(REACH_LENGTH_M / 3 / 60, 0);
    expect(peaks.get('Upstream')!).toBe(0);
  });

  it('skips villages with no buildings rather than placing them at the origin', () => {
    const portfolio = {
      ...makeInputs([1, 1]).portfolio,
      villages: ['Populated', 'Empty'],
      villageIndex: [0, 0],
      chainageIndex: [3, 3],
    } satisfies PortfolioBundle;

    const peaks = localPeakMinutesByVillage(portfolio, REACH_LENGTH_M, CHAINAGE);
    expect(peaks.has('Empty')).toBe(false);
    expect(peaks.get('Populated')).toBeGreaterThan(0);
  });
});
