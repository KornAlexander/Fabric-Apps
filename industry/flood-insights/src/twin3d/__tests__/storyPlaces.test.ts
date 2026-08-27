import { describe, expect, it } from 'vitest';

import { buildStoryBeats, floodStateAt, type BeatInputs } from '../storyBeats';
import type { PortfolioBundle } from '../whatif';

/**
 * Counting settlements, not just buildings.
 *
 * This only became worth doing when the map grew from four places to twenty. Buildings cluster in
 * the wide lower valley, so counting them answers "where is the damage"; settlements are strung
 * along the whole reach, so counting them answers "how far has the wave got". The two are
 * different questions with different answers, and the beats now say both.
 *
 * ⚠️ PLAN §2.2 rules out ranking places by severity, so a settlement is either reached or not.
 * There is deliberately no "worst affected" anywhere in this file.
 */

const CHAINAGE = 8;
const REACH_LENGTH_M = 34_900;

/**
 * A valley with settlements strung along it.
 *
 * Village 0 sits low at the top of the reach, the rest climb gently downstream — so the wave
 * arrives everywhere eventually, but not at once, which is the whole point.
 */
function valley(): BeatInputs {
  const villages = ['A', 'B', 'C', 'D'];
  const buildings: { village: number; chain: number; ground: number }[] = [];

  villages.forEach((_, v) => {
    // Two buildings per village near the top of the reach, and a dense cluster in the last one
    // to mimic the real portfolio's downstream concentration.
    const count = v === villages.length - 1 ? 12 : 2;
    for (let i = 0; i < count; i += 1) {
      buildings.push({ village: v, chain: v * 2, ground: 100 + v * 0.4 + i * 0.02 });
    }
  });

  const portfolio = {
    count: buildings.length,
    villages,
    hazardClasses: ['GK1'],
    villageIndex: buildings.map((b) => b.village),
    hazardIndex: buildings.map(() => 0),
    groundElevM: buildings.map((b) => b.ground),
    chainageIndex: buildings.map((b) => b.chain),
    sumInsuredEur: buildings.map(() => 300_000),
    elementarCover: buildings.map(() => 1),
    deductibleEur: buildings.map(() => 1000),
    waitingPeriodOpen: buildings.map(() => 0),
    assumedResidentsPerBuilding: 2.1,
    insurer: 'Musterschutz',
  } satisfies PortfolioBundle;

  return {
    portfolio,
    bedProfileM: Array.from({ length: CHAINAGE }, () => 100),
    ratingDischargeM3s: [0, 100, 500, 1500],
    ratingStageM: Array.from({ length: CHAINAGE }, () => [0, 1, 3, 6]),
    peakM3s: 1000,
    reachLengthM: REACH_LENGTH_M,
  };
}

const OPTIONS = { tMin: -720, tMax: 1440, stepMinutes: 15, minGapMinutes: 30 };

describe('floodStateAt', () => {
  it('counts a settlement once, however many of its buildings are wet', () => {
    const inputs = valley();
    const state = floodStateAt(0, inputs);
    expect(state.villages).toBeLessThanOrEqual(inputs.portfolio.villages.length);
    // The last village alone holds twelve buildings, so buildings must outrun settlements.
    expect(state.buildings).toBeGreaterThan(state.villages);
  });

  it('has fewer settlements in the water before the wave than at its height', () => {
    // Not "zero at the start": this synthetic valley sits almost on its own bed, so base flow
    // already wets the lowest buildings. What must hold is the direction — the count climbs as
    // the wave arrives and is highest around the peak.
    const early = floodStateAt(-720, valley());
    const atPeak = floodStateAt(0, valley());
    expect(early.villages).toBeLessThan(atPeak.villages);
    expect(early.buildings).toBeLessThan(atPeak.buildings);
  });
});

describe('beats that count settlements', () => {
  const beats = buildStoryBeats(valley(), OPTIONS);

  it('never reports more settlements in water than exist', () => {
    for (const beat of beats) {
      expect(beat.villagesInWater).toBeLessThanOrEqual(beat.totalVillages);
      expect(beat.totalVillages).toBeGreaterThan(0);
    }
  });

  it('carries the counts on every beat, not only the new ones', () => {
    // The story panel interpolates {{places}} into whichever beat is in force, so a beat without
    // the figure would render the placeholder.
    for (const beat of beats) {
      expect(Number.isFinite(beat.villagesInWater)).toBe(true);
      expect(Number.isFinite(beat.totalVillages)).toBe(true);
    }
  });

  it('reaches half the settlements before it reaches all of them', () => {
    const half = beats.find((b) => b.id === 'halfVillages');
    const all = beats.find((b) => b.id === 'allVillages');
    if (half && all) expect(all.tMinutes).toBeGreaterThanOrEqual(half.tMinutes);
  });

  it('only calls it the whole valley once every settlement has water', () => {
    const all = beats.find((b) => b.id === 'allVillages');
    if (all) expect(all.villagesInWater).toBe(all.totalVillages);
  });

  it('keeps the four anchors that carry the narrative', () => {
    // Adding beats must not push the sourced peak or the endpoints out through the collision
    // collapse — that is how a new annotation quietly deletes an old one.
    const ids = new Set(beats.map((b) => b.id));
    for (const id of ['firstWater', 'peak', 'maxExtent', 'dayAfter']) {
      expect(ids.has(id), `the ${id} beat disappeared`).toBe(true);
    }
  });

  it('still runs forwards in time', () => {
    for (let i = 1; i < beats.length; i += 1) {
      expect(beats[i].tMinutes).toBeGreaterThan(beats[i - 1].tMinutes);
    }
  });
});
