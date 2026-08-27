import { describe, expect, it } from 'vitest';

import { DEFAULT_LEVERS, runWhatIf, type Levers, type PortfolioBundle } from '../whatif';

/**
 * Unit-level counterparts to the Act IV browser tests. These pin the *arguments* the application
 * makes (PLAN §3), independently of anything rendering: what each lever changes, and — the part
 * that is easy to break by accident — what it must leave alone.
 */

const CHAINAGE = 4;

function bundle(overrides: Partial<PortfolioBundle> = {}): PortfolioBundle {
  const count = 4;
  return {
    count,
    villages: ['Testdorf'],
    hazardClasses: ['GK1', 'GK2', 'GK3', 'GK4'],
    villageIndex: [0, 0, 0, 0],
    hazardIndex: [0, 1, 2, 3],
    // Two low buildings that flood, two high ones that do not.
    groundElevM: [100, 101, 130, 140],
    chainageIndex: [0, 1, 2, 3],
    sumInsuredEur: [400_000, 400_000, 400_000, 400_000],
    elementarCover: [1, 0, 1, 0],
    deductibleEur: [1000, 1000, 1000, 1000],
    waitingPeriodOpen: [0, 0, 0, 0],
    assumedResidentsPerBuilding: 2,
    insurer: 'Musterschutz Gruppe',
    ...overrides,
  };
}

const SCENARIO = {
  bedProfileM: Array(CHAINAGE).fill(99),
  // Flat rating: every discharge level yields the same generous stage, so the tests exercise the
  // lever logic rather than the hydraulics.
  ratingDischargeM3s: [1, 500, 1000, 2000],
  ratingStageM: Array.from({ length: CHAINAGE }, () => [0.5, 4, 6, 8]),
  basePeakM3s: 1000,
  reachLengthM: 1000,
};

function run(levers: Partial<Levers> = {}, portfolio = bundle()) {
  return runWhatIf({
    portfolio,
    levers: { ...DEFAULT_LEVERS, ...levers },
    ...SCENARIO,
  });
}

describe('Act IV what-if', () => {
  it('floods the low buildings and leaves the high ones dry', () => {
    const result = run();
    expect(result.floodedBuildings).toBe(2);
    expect(result.estimatedLossEur).toBeGreaterThan(0);
  });

  it('lesson 1 — warning time reduces people without touching damage', () => {
    const base = run();
    const warned = run({ warningHours: 6 });

    expect(warned.peopleInAffectedArea).toBeLessThan(base.peopleInAffectedArea);
    // The water does not care that anybody was warned.
    expect(warned.estimatedLossEur).toBeCloseTo(base.estimatedLossEur, 6);
    expect(warned.floodedBuildings).toBe(base.floodedBuildings);
  });

  it('lesson 3 — cover changes who pays, not the size of the loss', () => {
    const base = run();
    const insured = run({ elementarShare: 1 });

    expect(insured.estimatedLossEur).toBeCloseTo(base.estimatedLossEur, 6);
    expect(insured.uncoveredEur).toBeLessThan(base.uncoveredEur);
    expect(insured.coveredEur).toBeGreaterThan(base.coveredEur);
  });

  it('lesson 3 — the loss is always covered plus uncovered', () => {
    for (const share of [0, 0.37, 1]) {
      const result = run({ elementarShare: share });
      expect(result.coveredEur + result.uncoveredEur).toBeCloseTo(result.estimatedLossEur, 6);
    }
  });

  it('lesson 5 — flood-adapted building lowers damage at unchanged depth', () => {
    const base = run();
    const resilient = run({ resilientShare: 1 });

    expect(resilient.floodedBuildings).toBe(base.floodedBuildings);
    expect(resilient.meanDepthM).toBeCloseTo(base.meanDepthM, 6);
    expect(resilient.estimatedLossEur).toBeLessThan(base.estimatedLossEur);
  });

  it('lesson 5 — retention lowers the peak discharge', () => {
    const held = run({ retentionShare: 0.3 });
    expect(held.peakDischargeM3s).toBeCloseTo(700, 6);
    expect(held.timesHq100).toBeLessThan(run().timesHq100);
  });

  it('a counterfactual share always selects the same buildings', () => {
    // Without a stable choice the KPIs jitter between recomputes and two lever settings cannot be
    // compared, which would make the whole act meaningless.
    const first = run({ elementarShare: 0.5 });
    const second = run({ elementarShare: 0.5 });
    expect(second.coveredEur).toBe(first.coveredEur);
    expect(second.elementarSharePct).toBe(first.elementarSharePct);
  });

  it('states the Elementar-Quote over the whole portfolio, not just the exposed part', () => {
    // The bundle carries only hydraulically connected buildings, so dividing by its own `count`
    // answers "how many exposed buildings have cover" while the report and the calibration gate
    // both answer "how many policies have cover". Those differed by 2.6 points on the real
    // portfolio — the same headline number, two values, depending which surface you read.
    const exposedOnly = bundle({ elementarCover: [1, 1, 1, 0] }); // 75 % of what is shipped
    const withTotals = {
      ...exposedOnly,
      portfolioTotal: 8,
      elementarTotal: 3, // 37.5 % of the whole portfolio
    };

    expect(run({}, exposedOnly).elementarSharePct).toBeCloseTo(75, 6);
    expect(run({}, withTotals).elementarSharePct).toBeCloseTo(37.5, 6);
  });

  it('falls back to the exposed subset when a bundle predates the portfolio totals', () => {
    const legacy = bundle({ elementarCover: [1, 1, 0, 0] });
    expect(run({}, legacy).elementarSharePct).toBeCloseTo(50, 6);
  });

  it('a waiting period leaves an otherwise covered loss uncovered', () => {
    const withWaiting = run({}, bundle({ waitingPeriodOpen: [1, 0, 0, 0], elementarCover: [1, 1, 1, 1] }));
    const without = run({}, bundle({ waitingPeriodOpen: [0, 0, 0, 0], elementarCover: [1, 1, 1, 1] }));
    expect(withWaiting.coveredEur).toBeLessThan(without.coveredEur);
  });

  it('deeper water never produces less damage', () => {
    const shallow = run({ stageOffsetM: -1 });
    const deep = run({ stageOffsetM: 1 });
    expect(deep.estimatedLossEur).toBeGreaterThanOrEqual(shallow.estimatedLossEur);
    expect(deep.meanDepthM).toBeGreaterThan(shallow.meanDepthM);
  });
});
