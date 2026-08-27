import { HQ100, PEAK_DISCHARGE_2021 } from '@/data/facts';

/**
 * Water-surface-elevation (WSE) profile generator — PLAN §6.2.
 *
 * ⚠️ HONESTY NOTE, read before changing anything here.
 * The measured 15-minute gauge series for 12–16 July 2021 is not publicly available (the Altenahr
 * gauge failed during the night, and the LfU portal only publishes 90-day and 3-year windows —
 * see docs/gauge-data-sources.md). This is therefore a **modelled hydrograph shape**, anchored to
 * officially sourced values:
 *
 *   - peak discharge 800–1230 m³/s   (LfU, explicitly published as a range)
 *   - HQ100 500 m³/s, HQ10 175 m³/s  (LfU Jährlichkeiten)
 *   - bed profile from DGM1
 *
 * The *shape* between those anchors is a model, not a measurement, and every surface that shows it
 * must say so. It is never presented as observed data.
 */

export interface HydrographPoint {
  /** Minutes relative to the peak. Negative is before. */
  tMinutes: number;
  dischargeM3s: number;
}

/** Peak of the event, in minutes from the timeline origin. */
export const PEAK_MINUTES = 0;

/**
 * Flood-wave celerity along the reach, in metres per second.
 *
 * This is what staggers the villages: at 3 m/s the wave needs about 137 minutes to cross the
 * 24.6 km reach, so the peak passes Ahrweiler roughly an hour and three quarters after Altenahr.
 */
export const WAVE_CELERITY_MS = 3.0;

/** Minutes the wave takes to reach a point a given fraction of the way down the reach. */
export function waveLagMinutes(
  fraction: number,
  reachLengthM: number,
  celerityMs = WAVE_CELERITY_MS
): number {
  return (fraction * reachLengthM) / celerityMs / 60;
}

/**
 * A flashy catchment hydrograph: fast rise, slower recession. The Ahr catchment is small (748 km²)
 * and steep, which is exactly why the rise was so abrupt.
 */
export function dischargeAt(tMinutes: number, peakM3s: number, baseM3s = 6.75): number {
  const riseMinutes = 420; // ~7 h from the start of the sharp rise to the peak
  const recessionMinutes = 1500; // ~25 h falling limb

  if (tMinutes <= -riseMinutes) return baseM3s;

  if (tMinutes <= 0) {
    // Convex rise — discharge accelerates as the catchment saturates.
    const f = (tMinutes + riseMinutes) / riseMinutes;
    return baseM3s + (peakM3s - baseM3s) * Math.pow(f, 2.4);
  }

  // Exponential recession towards base flow.
  const f = Math.exp(-tMinutes / (recessionMinutes / 3));
  return baseM3s + (peakM3s - baseM3s) * f;
}

/**
 * Stage above bed, interpolated from the per-chainage rating table.
 *
 * Replaces an earlier constant-stage model that used the sourced 980 cm everywhere. That was wrong
 * physics and it showed: validation against Copernicus scored IoU 0.078, flooding the wide
 * downstream valley far beyond anything observed. Stage is a property of the flood *and* the
 * cross-section, so it is solved per chainage point offline (tools/geodata/build_rating.py) and
 * only looked up here. See PLAN §6.5.
 */
export function stageFromRating(
  dischargeM3s: number,
  // `readonly` because this only ever reads them, and the rating table arrives from a JSON import
  // where the arrays are readonly. Requiring mutable arrays here forced a copy at every call site
  // that had one, for a function that never writes.
  levels: readonly number[],
  stages: readonly number[]
): number {
  if (dischargeM3s <= levels[0]) return stages[0];
  const last = levels.length - 1;
  if (dischargeM3s >= levels[last]) return stages[last];

  let i = 1;
  while (i < last && levels[i] < dischargeM3s) i++;
  const span = levels[i] - levels[i - 1];
  const f = span > 0 ? (dischargeM3s - levels[i - 1]) / span : 0;
  return stages[i - 1] + (stages[i] - stages[i - 1]) * f;
}

/**
 * Build the WSE profile for one instant: one value per chainage point.
 *
 * Downstream propagation is a kinematic lag — the flood wave takes time to travel the reach, so
 * the peak reaches Ahrweiler later than Altenahr. Discharge also grows downstream as tributaries
 * join, approximated as a linear gain along the reach.
 */
export function buildWseProfile(options: {
  tMinutes: number;
  bedProfileM: number[];
  ratingDischargeM3s: number[];
  ratingStageM: number[][];
  peakM3s: number;
  /** Flood-wave celerity in metres per second. */
  celerityMs?: number;
  /** River length in metres, used with celerity to derive the lag. */
  reachLengthM: number;
  /** Fractional discharge gain from the top of the reach to the bottom. */
  downstreamGain?: number;
  /** Act IV lever: shift every stage by this many metres. */
  stageOffsetM?: number;
}): Float32Array {
  const {
    tMinutes,
    bedProfileM,
    ratingDischargeM3s,
    ratingStageM,
    peakM3s,
    celerityMs = WAVE_CELERITY_MS,
    reachLengthM,
    downstreamGain = 0.25,
    stageOffsetM = 0,
  } = options;

  const count = bedProfileM.length;
  const profile = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const fraction = count > 1 ? i / (count - 1) : 0;
    const lagMinutes = waveLagMinutes(fraction, reachLengthM, celerityMs);

    const localPeak = peakM3s * (1 + downstreamGain * fraction);
    const q = dischargeAt(tMinutes - lagMinutes, localPeak);
    const stage = stageFromRating(q, ratingDischargeM3s, ratingStageM[i]);
    profile[i] = bedProfileM[i] + Math.max(0, stage + stageOffsetM);
  }

  return profile;
}

/**
 * The water surface a *steady* discharge would stand at, one value per chainage point.
 *
 * This is deliberately not `buildWseProfile`. That function answers "where is the water at minute
 * t of the 2021 event", so it carries a hydrograph and a travel-time lag. A hazard class asks a
 * different question — "how rare is the flood that first reaches this ground" — which has no clock
 * in it at all. The wave passes each village at a different moment, but a 100-year flood is a
 * 100-year flood everywhere along the reach.
 *
 * The downstream gain is kept, because it is a property of the reach rather than of the event:
 * tributaries join going down the valley, so the same gauge reading at Altenahr means more water
 * at Ahrweiler.
 *
 * ⚠️ This must stay equivalent to the per-building derivation in
 * tools/geodata/build_portfolio.py. That code asks the inverse question — it solves for the
 * discharge at which a building's ground first floods, then converts to a return period. Asking
 * instead whether the ground lies under the water at a boundary discharge gives the same answer,
 * because both interpolations are monotonic:
 *
 *     ground ≤ bed + stage(Q·gain)  ⟺  requiredStage ≤ stage(Q·gain)  ⟺  localQ ≤ Q·gain
 *
 * If the two ever diverge, the terrain will shade a building one class while the portfolio counts
 * it as another. A unit test holds them together.
 */
export function buildSteadyWseProfile(options: {
  /** Discharge at the Altenahr reference gauge, which is what the frequency curve is stated for. */
  gaugeDischargeM3s: number;
  bedProfileM: number[];
  ratingDischargeM3s: number[];
  ratingStageM: number[][];
  downstreamGain?: number;
}): Float32Array {
  const {
    gaugeDischargeM3s,
    bedProfileM,
    ratingDischargeM3s,
    ratingStageM,
    downstreamGain = 0.25,
  } = options;

  const count = bedProfileM.length;
  const profile = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const fraction = count > 1 ? i / (count - 1) : 0;
    const localQ = gaugeDischargeM3s * (1 + downstreamGain * fraction);
    const stage = stageFromRating(localQ, ratingDischargeM3s, ratingStageM[i]);
    profile[i] = bedProfileM[i] + Math.max(0, stage);
  }

  return profile;
}

/** The peak discharge actually used by the simulation, and where it sits in the sourced range. */export function peakDischargeForScenario(scale = 1): number {
  const [low, high] = PEAK_DISCHARGE_2021.range ?? [
    PEAK_DISCHARGE_2021.value,
    PEAK_DISCHARGE_2021.value,
  ];
  const mid = (low + high) / 2;
  return mid * scale;
}

/** How many times HQ100 a given discharge is — the comparison that makes the event legible. */
export function timesHq100(dischargeM3s: number): number {
  return dischargeM3s / HQ100.value;
}
