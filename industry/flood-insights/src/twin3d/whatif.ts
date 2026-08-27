import { HQ100 } from '@/data/facts';

import { dischargeAt, stageFromRating } from './hydrograph';

/**
 * Act IV — the what-if engine (PLAN §7.4).
 *
 * Six levers, each attached to one of the six lessons. The levers are the argument, not a
 * sandbox: each one exists to make a specific finding visible, and the tooltips name the lesson.
 *
 * Everything runs client-side over the packed portfolio bundle so a slider drag updates the KPIs
 * immediately. The same logic is the server-side UDF surface for the assistant (§10.4) — one
 * logic, three surfaces.
 */

export interface PortfolioBundle {
  count: number;
  villages: string[];
  hazardClasses: string[];
  villageIndex: number[];
  hazardIndex: number[];
  groundElevM: number[];
  chainageIndex: number[];
  sumInsuredEur: number[];
  elementarCover: number[];
  deductibleEur: number[];
  waitingPeriodOpen: number[];
  /**
   * The whole portfolio, including the buildings this bundle leaves out.
   *
   * The bundle ships only hydraulically connected buildings, so its own `count` is the exposed
   * subset rather than the portfolio. Dividing by it made the app state a different
   * Elementar-Quote from the report over the same event. Optional because bundles written before
   * this existed are still readable.
   */
  portfolioTotal?: number;
  elementarTotal?: number;
  assumedResidentsPerBuilding: number;
  insurer: string;
}

export interface Levers {
  /** Lesson 1 — hours of additional warning, 0…12. */
  warningHours: number;
  /** Lesson 2 — peak stage offset in metres, −1.0…+1.0. */
  stageOffsetM: number;
  /** Lesson 3 — Elementar penetration, 0…1. Null keeps the portfolio as it is. */
  elementarShare: number | null;
  /** Lesson 3 — flat deductible in EUR, or null to keep each policy's own. */
  deductibleEur: number | null;
  /** Lesson 5 — share of the hydrograph peak removed by retention, 0…0.4. */
  retentionShare: number;
  /** Lesson 5 — share of buildings built flood-adapted, 0…1. */
  resilientShare: number;
}

export const DEFAULT_LEVERS: Levers = {
  warningHours: 0,
  stageOffsetM: 0,
  elementarShare: null,
  deductibleEur: null,
  retentionShare: 0,
  resilientShare: 0,
};

export interface WhatIfResult {
  floodedBuildings: number;
  peopleInAffectedArea: number;
  estimatedLossEur: number;
  coveredEur: number;
  uncoveredEur: number;
  elementarSharePct: number;
  meanDepthM: number;
  peakDischargeM3s: number;
  timesHq100: number;
}

/** JRC depth–damage curve for European residential buildings (Huizinga et al. 2017). */
const JRC_DEPTH = [0, 0.5, 1, 1.5, 2, 3, 4, 5, 6];
const JRC_RATIO = [0, 0.25, 0.4, 0.5, 0.6, 0.75, 0.85, 0.95, 1];

/**
 * A flood-adapted building takes the same water and less damage: no living space or services at
 * ground level, wet-proofed materials, no oil tank to rupture. It does not stop the water, which
 * is precisely lesson 5 — resilience beats prediction.
 */
const RESILIENT_DAMAGE_FACTOR = 0.45;

function interpolate(x: number, xs: number[], ys: number[]): number {
  if (x <= xs[0]) return ys[0];
  const last = xs.length - 1;
  if (x >= xs[last]) return ys[last];
  let i = 1;
  while (i < last && xs[i] < x) i++;
  const span = xs[i] - xs[i - 1];
  const f = span > 0 ? (x - xs[i - 1]) / span : 0;
  return ys[i - 1] + (ys[i] - ys[i - 1]) * f;
}

/**
 * Deterministic pseudo-random in [0,1) from an index.
 *
 * Used so that "60 % of buildings are flood-adapted" always picks the *same* 60 %. Without a
 * stable choice the KPIs would jitter on every recompute and the comparison between two lever
 * settings would be meaningless.
 */
function stableUnit(index: number): number {
  const x = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function runWhatIf(options: {
  portfolio: PortfolioBundle;
  levers: Levers;
  bedProfileM: number[];
  ratingDischargeM3s: number[];
  ratingStageM: number[][];
  basePeakM3s: number;
  reachLengthM: number;
}): WhatIfResult {
  const {
    portfolio,
    levers,
    bedProfileM,
    ratingDischargeM3s,
    ratingStageM,
    basePeakM3s,
    reachLengthM,
  } = options;

  const peakM3s = basePeakM3s * (1 - levers.retentionShare);
  const count = bedProfileM.length;

  // Water surface at the peak, per chainage point, with the levers applied.
  const wse = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const fraction = count > 1 ? i / (count - 1) : 0;
    const localPeak = peakM3s * (1 + 0.25 * fraction);
    const lagMinutes = (fraction * reachLengthM) / 3.0 / 60;
    const q = dischargeAt(-lagMinutes, localPeak);
    const stage = stageFromRating(q, ratingDischargeM3s, ratingStageM[i]);
    wse[i] = bedProfileM[i] + Math.max(0, stage + levers.stageOffsetM);
  }

  let flooded = 0;
  let depthSum = 0;
  let loss = 0;
  let covered = 0;
  let elementarCount = 0;

  for (let b = 0; b < portfolio.count; b++) {
    const chain = Math.min(portfolio.chainageIndex[b], count - 1);
    const depth = wse[chain] - portfolio.groundElevM[b];

    // Cover: either the portfolio as it stands, or a counterfactual penetration. When a share is
    // set, the *same* buildings are chosen for any given share, so results are comparable.
    const hasElementar =
      levers.elementarShare === null
        ? portfolio.elementarCover[b] === 1
        : stableUnit(b) < levers.elementarShare;
    if (hasElementar) elementarCount++;

    if (depth <= 0) continue;

    flooded++;
    depthSum += depth;

    const resilient = levers.resilientShare > 0 && stableUnit(b + 7919) < levers.resilientShare;
    const ratio =
      interpolate(depth, JRC_DEPTH, JRC_RATIO) * (resilient ? RESILIENT_DAMAGE_FACTOR : 1);
    const buildingLoss = portfolio.sumInsuredEur[b] * ratio;
    loss += buildingLoss;

    if (hasElementar && portfolio.waitingPeriodOpen[b] !== 1) {
      const excess = levers.deductibleEur ?? portfolio.deductibleEur[b];
      covered += Math.max(0, buildingLoss - excess);
    }
  }

  /**
   * People in the affected area, reduced by warning time.
   *
   * This is the KPI that carries lesson 1, and it is deliberately the only one that warning time
   * moves. Damage is physics — the water arrives either way. Getting people out is logistics.
   * The curve saturates because the last few percent are always the hardest to reach.
   */
  const evacuated = 1 - Math.exp(-levers.warningHours / 3.2);
  const people = flooded * portfolio.assumedResidentsPerBuilding * (1 - 0.92 * evacuated);

  return {
    floodedBuildings: flooded,
    peopleInAffectedArea: Math.round(people),
    estimatedLossEur: loss,
    coveredEur: covered,
    uncoveredEur: loss - covered,
    // Stated over the whole portfolio, not over the buildings that happen to be exposed, so the
    // app, the report and the PLAN calibration gate all quote the same number. Falls back to the
    // exposed subset for bundles written before the totals were carried.
    elementarSharePct:
      portfolio.portfolioTotal && portfolio.elementarTotal !== undefined
        ? (portfolio.elementarTotal / portfolio.portfolioTotal) * 100
        : (elementarCount / portfolio.count) * 100,
    meanDepthM: flooded > 0 ? depthSum / flooded : 0,
    peakDischargeM3s: peakM3s,
    timesHq100: peakM3s / HQ100.value,
  };
}
