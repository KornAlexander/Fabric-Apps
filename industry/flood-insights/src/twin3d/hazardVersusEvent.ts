import { HQ100 } from '@/data/facts';
import { dischargeAt, stageFromRating } from './hydrograph';
import type { PortfolioBundle } from './whatif';

/**
 * How the 2021 event compares with the hazard classification of the ground it flooded.
 *
 * This exists because of a fair challenge: the hazard overlay and the flood are derived from the
 * same terrain and the same rating curve, so it is reasonable to suspect the overlay of being a
 * re-render of the flood. If it were, Act IV lesson 2 — "a hazard class is a statement about
 * frequency, not a guarantee of safety" — would be asserted by the app and contradicted by its
 * own data.
 *
 * It is not. Measured over the shipped portfolio: the 2021 peak floods buildings the HQ100 surface
 * never reaches, and close to a third of everything it floods is classified as flooding **more
 * rarely than once in a hundred years**. That is the lesson, in the app's own numbers, and this
 * function is what puts the number on screen instead of a claim.
 *
 * ⚠️ Deliberately computed live rather than baked into the portfolio export. A hand-copied share
 * would drift the moment the terrain, the rating or the class boundaries changed — and the whole
 * point of the figure is that it is the app checking itself.
 */

export interface HazardVersusEvent {
  /** Buildings the modelled 2021 peak reaches at its maximum extent, over the whole event. */
  flooded: number;
  /** Of those, how many are classified GK1 or GK2 — rarer than HQ100. */
  floodedBelowHq100Class: number;
  /** The same as a percentage, which is the figure worth showing. */
  shareBelowHq100Pct: number;
  /** Buildings the steady HQ100 surface reaches, for the "the flood went past the line" point. */
  floodedAtHq100: number;
}

/** Water surface per chainage point for a steady discharge, matching `runWhatIf`'s convention. */
function steadyWse(
  peakM3s: number,
  bedProfileM: number[],
  ratingDischargeM3s: number[],
  ratingStageM: number[][],
  reachLengthM: number,
  withLag: boolean
): Float64Array {
  const count = bedProfileM.length;
  const wse = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const fraction = count > 1 ? i / (count - 1) : 0;
    const localPeak = peakM3s * (1 + 0.25 * fraction);
    // The event travels; a steady boundary surface does not. Applying the wave lag to HQ100 would
    // compare a moving flood against a moving hazard map, which is not what a hazard map is.
    const q = withLag ? dischargeAt(-((fraction * reachLengthM) / 3.0 / 60), localPeak) : localPeak;
    wse[i] = bedProfileM[i] + Math.max(0, stageFromRating(q, ratingDischargeM3s, ratingStageM[i]));
  }
  return wse;
}

export function hazardVersusEvent(args: {
  portfolio: PortfolioBundle;
  bedProfileM: number[];
  ratingDischargeM3s: number[];
  ratingStageM: number[][];
  basePeakM3s: number;
  reachLengthM: number;
}): HazardVersusEvent {
  const { portfolio, bedProfileM, ratingDischargeM3s, ratingStageM, basePeakM3s, reachLengthM } =
    args;
  const count = bedProfileM.length;

  const event = steadyWse(
    basePeakM3s,
    bedProfileM,
    ratingDischargeM3s,
    ratingStageM,
    reachLengthM,
    // ⚠️ No wave lag, and this is the whole correctness of the figure.
    //
    // `runWhatIf` evaluates every chainage point at global t=0 — the instant the gauge peaks —
    // which is a snapshot, not the event. At that instant the water is still high in the gorge,
    // and the gorge is almost entirely GK3/GK4, so the snapshot reported 4 % where the event
    // reaches 29 %. "Which buildings did the 2021 flood reach" is a question about the maximum
    // extent over the night, so every point is evaluated at its own local peak — the same
    // envelope `validate_simulation.py` compares against Copernicus.
    false
  );
  const hq100 = steadyWse(
    HQ100.value,
    bedProfileM,
    ratingDischargeM3s,
    ratingStageM,
    reachLengthM,
    false
  );

  // GK1 and GK2 are the classes rarer than a hundred-year flood; the class list is ordered
  // GK1..GK4, so "index below 2" is the low half without hard-coding the names.
  const lowClassCutoff = Math.max(0, portfolio.hazardClasses.indexOf('GK3'));

  let flooded = 0;
  let floodedLow = 0;
  let floodedAtHq100 = 0;

  for (let b = 0; b < portfolio.count; b++) {
    const chain = Math.min(portfolio.chainageIndex[b], count - 1);
    const ground = portfolio.groundElevM[b];
    if (hq100[chain] - ground > 0) floodedAtHq100++;
    if (event[chain] - ground <= 0) continue;
    flooded++;
    if (portfolio.hazardIndex[b] < lowClassCutoff) floodedLow++;
  }

  return {
    flooded,
    floodedBelowHq100Class: floodedLow,
    shareBelowHq100Pct: flooded > 0 ? (floodedLow / flooded) * 100 : 0,
    floodedAtHq100,
  };
}
