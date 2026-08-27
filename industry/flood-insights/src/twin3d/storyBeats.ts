import {
  LAST_MEASURED_STAGE_CM,
  PEAK_DISCHARGE_2021,
  PEAK_STAGE_2021_CM,
} from '@/data/facts';

import { dischargeAt, stageFromRating, waveLagMinutes } from './hydrograph';
import type { PortfolioBundle } from './whatif';

/**
 * Story beats along the timeline — the annotations shown as playback runs (PLAN §3 Act II).
 *
 * ⚠️ Read §2.2 and §4.8 before adding a beat.
 *
 * Every beat here is either **derived** — computed from the app's own simulation, and labelled as
 * modelled — or **sourced**, carrying an official citation. There are deliberately no hand-written
 * narrative moments ("the first house collapsed at 23:40"), because the app has no source for them
 * and inventing a timeline for a night in which 134 people died is exactly what §2 forbids.
 *
 * Deriving the beats rather than hard-coding times has a second benefit: improve the hydrograph or
 * point the app at another AOI and the annotations follow the data instead of quietly going stale.
 */

export type BeatKind = 'derived' | 'sourced';

export interface StoryBeat {
  /** Matches the i18n key `story.beats.<id>`. */
  id: string;
  /** Minutes relative to the peak. */
  tMinutes: number;
  kind: BeatKind;
  /** Buildings standing in simulated water at that moment. */
  buildingsInWater: number;
  /** Total buildings affected at any point, for "x of y" phrasing. */
  totalAffected: number;
  /**
   * Settlements with at least one building in water at that moment.
   *
   * Buildings and settlements are two different stories, and only the second one needed the map to
   * grow. Buildings cluster downstream where the valley opens out, so counting them says where the
   * damage is; settlements are strung along the whole reach, so counting them says how far the
   * wave has travelled. The two halfway points are not the same moment.
   */
  villagesInWater: number;
  /** How many settlements the flood reaches at all, for "x of y" phrasing. */
  totalVillages: number;
}

export interface BeatInputs {
  portfolio: PortfolioBundle;
  bedProfileM: number[];
  ratingDischargeM3s: number[];
  ratingStageM: number[][];
  peakM3s: number;
  reachLengthM: number;
}

/**
 * Water-surface elevation per chainage point at one instant.
 *
 * Downstream points peak later — the wave has to travel — and carry more water as tributaries
 * join. That lag is the reason "largest extent" and "peak at the gauge" are two different moments,
 * which is one of the more interesting things the timeline shows.
 */
export function wseAtTime(tMinutes: number, inputs: BeatInputs): Float64Array {
  const { bedProfileM, ratingDischargeM3s, ratingStageM, peakM3s, reachLengthM } = inputs;
  const count = bedProfileM.length;
  const wse = new Float64Array(count);

  for (let i = 0; i < count; i++) {
    const fraction = count > 1 ? i / (count - 1) : 0;
    const localPeak = peakM3s * (1 + 0.25 * fraction);
    const q = dischargeAt(tMinutes - waveLagMinutes(fraction, reachLengthM), localPeak);
    const stage = stageFromRating(q, ratingDischargeM3s, ratingStageM[i]);
    wse[i] = bedProfileM[i] + Math.max(0, stage);
  }
  return wse;
}

/** How many buildings stand in simulated water at one instant. */
export function buildingsInWaterAt(tMinutes: number, inputs: BeatInputs): number {
  return floodStateAt(tMinutes, inputs).buildings;
}

/**
 * Buildings and settlements in water at one instant.
 *
 * A settlement counts as reached as soon as one of its buildings stands in water — the question
 * the beat answers is "has the wave got there yet", not "how badly", and PLAN §2.2 rules out
 * ranking places by severity anyway.
 */
export function floodStateAt(
  tMinutes: number,
  inputs: BeatInputs
): { buildings: number; villages: number } {
  const wse = wseAtTime(tMinutes, inputs);
  const { portfolio } = inputs;
  const wet = new Set<number>();
  let flooded = 0;
  for (let b = 0; b < portfolio.count; b++) {
    const chain = Math.min(portfolio.chainageIndex[b], wse.length - 1);
    if (wse[chain] - portfolio.groundElevM[b] > 0) {
      flooded++;
      wet.add(portfolio.villageIndex[b]);
    }
  }
  return { buildings: flooded, villages: wet.size };
}

/**
 * Work out the beats by walking the timeline and watching what the model does.
 *
 * `minGapMinutes` keeps two beats from landing on top of each other in the UI; where they collide,
 * the sourced one wins, because an official figure is worth more than a derived milestone.
 */
export function buildStoryBeats(
  inputs: BeatInputs,
  options: { tMin: number; tMax: number; stepMinutes?: number; minGapMinutes?: number }
): StoryBeat[] {
  const { tMin, tMax, stepMinutes = 15, minGapMinutes = 60 } = options;

  const samples: { t: number; flooded: number; villages: number }[] = [];
  for (let t = tMin; t <= tMax; t += stepMinutes) {
    const state = floodStateAt(t, inputs);
    samples.push({ t, flooded: state.buildings, villages: state.villages });
  }
  if (samples.length === 0) return [];

  const peakSample = samples.reduce((a, b) => (b.flooded > a.flooded ? b : a));
  const totalAffected = peakSample.flooded;
  if (totalAffected === 0) return [];
  const totalVillages = samples.reduce((most, s) => Math.max(most, s.villages), 0);

  const firstAtLeast = (threshold: number, from = 0) =>
    samples.slice(from).find((s) => s.flooded >= threshold);
  const firstVillagesAtLeast = (threshold: number) =>
    samples.find((s) => s.villages >= threshold);
  const peakIndex = samples.indexOf(peakSample);

  const candidates: (StoryBeat | null)[] = [];

  const push = (
    id: string,
    kind: BeatKind,
    sample?: { t: number; flooded: number; villages: number }
  ) => {
    if (!sample) return;
    candidates.push({
      id,
      kind,
      tMinutes: sample.t,
      buildingsInWater: sample.flooded,
      totalAffected,
      villagesInWater: sample.villages,
      totalVillages,
    });
  };

  // The water reaches the valley floor.
  push('firstWater', 'derived', firstAtLeast(1));
  // Half of everything that will be affected, already is.
  push('halfExtent', 'derived', firstAtLeast(totalAffected * 0.5));

  // Half the settlements on the reach have water. A different moment from half the buildings, and
  // a more honest answer to "how far has it got": the buildings are concentrated in the wide lower
  // valley, so half of them can be wet while most of the villages are still dry, or the reverse.
  push('halfVillages', 'derived', firstVillagesAtLeast(Math.ceil(totalVillages / 2)));

  // The peak at the gauge. This one is not derived — it is the officially published figure, and it
  // is anchored to t = 0 by the AOI config.
  const atZero = samples.reduce((a, b) => (Math.abs(b.t) < Math.abs(a.t) ? b : a));
  push('peak', 'sourced', atZero);

  // The wave has reached every settlement it will reach — the far end of the journey the place
  // list spells out. Only tellable since the map runs the whole reach to the mouth.
  push('allVillages', 'derived', firstVillagesAtLeast(totalVillages));

  // Largest extent, which downstream lag puts after the peak at the gauge.
  push('maxExtent', 'derived', peakSample);
  // Falling limb: back below half.
  push(
    'receding',
    'derived',
    samples.slice(peakIndex).find((s) => s.flooded <= totalAffected * 0.5)
  );
  // Where the record ends.
  push('dayAfter', 'derived', samples[samples.length - 1]);

  const beats = candidates.filter((b): b is StoryBeat => b !== null);
  beats.sort((a, b) => a.tMinutes - b.tMinutes);

  // Collapse collisions by rank, then by time. A later beat that outranks its neighbour replaces
  // it rather than being discarded, so the spine of the story survives new annotations.
  const spaced: StoryBeat[] = [];
  for (const beat of beats) {
    const previous = spaced[spaced.length - 1];
    if (previous && beat.tMinutes - previous.tMinutes < minGapMinutes) {
      if (priorityOf(beat) > priorityOf(previous)) spaced[spaced.length - 1] = beat;
      continue;
    }
    spaced.push(beat);
  }
  return spaced;
}

/**
 * How hard a beat fights for its place when two land close together.
 *
 * Before this existed, collisions were resolved by "sourced wins, otherwise the earlier one wins",
 * which was fine while there were six beats and became a trap the moment there were eight: adding
 * a supporting annotation could push `maxExtent` — the moment the flood is at its largest — off
 * the timeline entirely, silently, because it happened to arrive a few minutes later. Rank first,
 * time second.
 */
const BEAT_PRIORITY: Record<string, number> = {
  // The one documented moment on the timeline.
  peak: 4,
  // The shape of the event: when it starts, when it is worst, where the record ends.
  firstWater: 3,
  maxExtent: 3,
  dayAfter: 3,
  // Useful milestones, but not the spine.
  halfExtent: 2,
  receding: 2,
  // Supporting detail. These may be dropped without the story losing its shape.
  halfVillages: 1,
  allVillages: 1,
};

function priorityOf(beat: StoryBeat): number {
  return BEAT_PRIORITY[beat.id] ?? 1;
}

/** The beat in force at a given moment: the most recent one at or before it. */
export function activeBeat(beats: StoryBeat[], tMinutes: number): StoryBeat | null {
  let active: StoryBeat | null = null;
  for (const beat of beats) {
    if (beat.tMinutes <= tMinutes) active = beat;
    else break;
  }
  return active;
}

/**
 * When the peak passes each village, in minutes relative to the peak at the gauge.
 *
 * The wave is staggered along the reach — about 105 minutes between Altenahr and Ahrweiler — but
 * that is under 5 % of a 36-hour timeline, so scrubbing makes the villages look like they flood
 * together. Stating each village's own time is what makes the lag legible rather than merely true.
 *
 * The village's position is taken as the median chainage of its buildings, which is robust to the
 * few outliers that sit at the edge of a settlement.
 */
export function localPeakMinutesByVillage(
  portfolio: PortfolioBundle,
  reachLengthM: number,
  chainageCount: number
): Map<string, number> {
  const byVillage: number[][] = portfolio.villages.map(() => []);
  for (let b = 0; b < portfolio.count; b++) {
    byVillage[portfolio.villageIndex[b]]?.push(portfolio.chainageIndex[b]);
  }

  const chainByName = new Map<string, number>();
  portfolio.villages.forEach((name, index) => {
    const chains = byVillage[index];
    if (!chains || chains.length === 0) return;
    const sorted = [...chains].sort((a, b) => a - b);
    chainByName.set(name, sorted[Math.floor(sorted.length / 2)]);
  });
  return peakMinutesByChainage(chainByName, reachLengthM, chainageCount);
}

/**
 * When the wave reaches each of a set of points on the reach, keyed however the caller likes.
 *
 * This is the whole of the lag calculation: a point's own position along the river decides when
 * its water arrives, and nothing else does. Splitting it out lets the map derive a time for every
 * village it draws, rather than only for the handful that a nearest-name pass once grouped
 * buildings under.
 */
export function peakMinutesByChainage(
  chainageByKey: Map<string, number>,
  reachLengthM: number,
  chainageCount: number
): Map<string, number> {
  const result = new Map<string, number>();
  for (const [key, chainage] of chainageByKey) {
    const fraction = chainageCount > 1 ? chainage / (chainageCount - 1) : 0;
    result.set(key, waveLagMinutes(fraction, reachLengthM));
  }
  return result;
}

/** The officially sourced figures shown on the peak beat. */
export const PEAK_BEAT_SOURCES = [
  PEAK_DISCHARGE_2021,
  PEAK_STAGE_2021_CM,
  LAST_MEASURED_STAGE_CM,
] as const;
