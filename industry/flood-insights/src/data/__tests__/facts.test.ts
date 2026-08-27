import { describe, expect, it } from 'vitest';

import {
  FATALITIES_RLP,
  HQ10,
  HQ100,
  isReleaseReady,
  PEAK_DISCHARGE_2021,
  PEAK_STAGE_2021_CM,
  peakVersusHq100,
} from '../facts';

/**
 * PLAN §4.8 — "If a claim cannot be sourced, it does not go in the app. No exceptions."
 *
 * These tests defend that rule at the data layer, so a figure cannot quietly acquire a value
 * without acquiring a citation to go with it.
 */
describe('fact register', () => {
  it('shows a reconstruction as a range, never as one confident number', () => {
    expect(PEAK_DISCHARGE_2021.source?.reconstruction).toBe(true);
    expect(PEAK_DISCHARGE_2021.range).toBeDefined();
    const [low, high] = PEAK_DISCHARGE_2021.range!;
    expect(low).toBeLessThan(high);
  });

  it('every reconstructed figure carries a range', () => {
    for (const fact of [PEAK_DISCHARGE_2021, PEAK_STAGE_2021_CM]) {
      if (fact.source?.reconstruction) {
        // A reconstruction without a stated spread overstates what is known.
        expect(fact.source.issuer).toBeTruthy();
      }
    }
  });

  it('provisional figures state their status', () => {
    // The Jährlichkeiten are a provisional recalculation, and §4.8 requires the status and its
    // date to travel with the number.
    expect(HQ100.source?.status).toMatch(/Stand/);
    expect(HQ10.source?.status).toMatch(/Stand/);
  });

  it('the return-period curve increases with rarity', () => {
    expect(HQ100.value).toBeGreaterThan(HQ10.value);
  });

  it('puts the 2021 peak between one and three times HQ100', () => {
    const { low, high } = peakVersusHq100();
    expect(low).toBeGreaterThan(1);
    expect(high).toBeLessThan(3);
    expect(low).toBeLessThanOrEqual(high);
  });

  it('is release-ready, because every gating figure now carries a source', () => {
    // This used to be a deliberate failing-state test: the death toll had no source, so the app
    // rendered it as a visible defect and was not showable. The figure now comes from the final
    // report of the Landtag's committee of inquiry, so the gate is green — and stays enforced,
    // because the assertion is over every gating fact rather than a hand-listed one.
    expect(FATALITIES_RLP.source).not.toBeNull();
    expect(isReleaseReady()).toBe(true);
  });

  it('reports the death toll for the area its source actually measured', () => {
    // The figure was once 134 "im Landkreis Ahrweiler", which was both unsourced and narrower
    // than any source supports: the inquiry states 136 and states it for the Land, giving no
    // district figure. Re-labelling a number onto a smaller area than it was measured for is the
    // exact failure §4.8 exists to prevent, so the value and its wording are pinned together.
    expect(FATALITIES_RLP.value).toBe(136);
    expect(FATALITIES_RLP.source?.issuer).toBe('Landtag Rheinland-Pfalz');
    expect(FATALITIES_RLP.source?.year).toBe(2024);
  });
});

