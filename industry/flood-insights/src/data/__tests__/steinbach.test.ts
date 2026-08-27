import { describe, expect, it } from 'vitest';

import {
  ASSUMED_BREAK_MINUTE,
  DAM_BREAK_SCENARIO,
  DAM_BREAK_SCHWEINHEIM_DEPTH_M,
  DAM_BREAK_VELOCITY_MS,
  DAM_BREAK_VOLUME_M3,
  DAM_CREST_M,
  DAM_DESIGN_FLOOD_M3S,
  DAM_EROSION_WIDTH_M,
  DAM_EVACUATED_PEOPLE,
  DAM_FULL_SUPPLY_M,
  DAM_HEIGHT_M,
  DAM_MOMENTS,
  DAM_OVERTOPPING_M,
  DAM_PEAK_OUTFLOW_M3S,
  DAM_STORAGE_M3,
  formatDamClock,
  leadTimeMinutes,
  peakVersusDesignFlood,
} from '../steinbach';

const moment = (id: string) => {
  const found = DAM_MOMENTS.find((m) => m.id === id);
  if (!found) throw new Error(`no documented moment "${id}"`);
  return found.minute;
};

const place = (id: string) => {
  const found = DAM_BREAK_SCENARIO.find((p) => p.id === id);
  if (!found) throw new Error(`no modelled place "${id}"`);
  return found;
};

/** Travel time for a place the study actually published one for. */
const travel = (id: string) => {
  const minutes = place(id).travelMinutes;
  if (minutes === undefined) throw new Error(`no published travel time for "${id}"`);
  return minutes;
};

describe('the documented night', () => {
  it('runs strictly forwards', () => {
    for (let i = 1; i < DAM_MOMENTS.length; i += 1) {
      expect(DAM_MOMENTS[i].minute).toBeGreaterThan(DAM_MOMENTS[i - 1].minute);
    }
  });

  it('places the assumed failure at the moment the crest was actually overtopped', () => {
    // The hypothetical has to hang on the instant a failure first became possible, not on a
    // dramatic hour chosen for effect.
    expect(ASSUMED_BREAK_MINUTE).toBe(moment('overtopping'));
  });

  it('keeps the gap that is the whole point of the module', () => {
    // The civil protection authority knew at 18:10; the evacuation began at 21:00.
    expect(moment('evacuation') - moment('authorityInformed')).toBe(170);
  });
});

describe('leadTimeMinutes', () => {
  it('counts from the warning to the water, not from the failure', () => {
    // Sirens at 18:42, failure assumed 20:00, Schweinheim reached 10 minutes later.
    expect(leadTimeMinutes(moment('sirens'), travel('schweinheim'))).toBe(88);
  });

  it('goes negative once the warning comes after the water', () => {
    // The evacuation actually began at 21:00. Had the dam failed while it was being overtopped,
    // the water would have been in Schweinheim at 20:10 — fifty minutes earlier.
    expect(leadTimeMinutes(moment('evacuation'), travel('schweinheim'))).toBe(-50);
  });

  it('leaves only the travel time when the warning waits for the failure itself', () => {
    // This is the study's conclusion in arithmetic: warn at the break and Schweinheim has ten
    // minutes, which is why the authors said an evacuation has to happen beforehand.
    expect(leadTimeMinutes(ASSUMED_BREAK_MINUTE, travel('schweinheim'))).toBe(10);
  });

  it('grows the further downstream the water has to travel', () => {
    const warning = moment('authorityInformed');
    const times = DAM_BREAK_SCENARIO.filter((p) => p.travelMinutes !== undefined).map((p) =>
      leadTimeMinutes(warning, p.travelMinutes!)
    );
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]).toBeGreaterThan(times[i - 1]);
    }
  });
});

describe('the modelled scenario', () => {
  it('is ordered downstream by arrival', () => {
    const published = DAM_BREAK_SCENARIO.filter((p) => p.travelMinutes !== undefined);
    for (let i = 1; i < published.length; i += 1) {
      expect(published[i].travelMinutes!).toBeGreaterThan(published[i - 1].travelMinutes!);
    }
  });

  it('leaves the arrival time blank where the study published none', () => {
    // Palmersheim has a modelled depth and no modelled time. An earlier draft filled that in with
    // a plausible 30 minutes, which would have been a fabricated figure sitting in a table of
    // sourced ones — the single easiest way for this module to start lying.
    expect(place('palmersheim').travelMinutes).toBeUndefined();
    expect(place('palmersheim').depthM).toEqual([0, 1]);
  });

  it('keeps Heimerzheim marked safe, because the model says the motorway holds', () => {
    expect(place('heimerzheim').safe).toBe(true);
    expect(place('schweinheim').safe).toBeUndefined();
  });

  it('shows the overtopping as the multiple of the design flood that it was', () => {
    expect(peakVersusDesignFlood()).toBeCloseTo(3.4, 1);
    expect(DAM_PEAK_OUTFLOW_M3S.value).toBeGreaterThan(DAM_DESIGN_FLOOD_M3S.value);
  });

  it('keeps the crest above the level the reservoir was allowed to reach', () => {
    expect(DAM_CREST_M.value).toBeGreaterThan(DAM_FULL_SUPPLY_M.value);
  });
});

describe('sourcing', () => {
  it('carries a source on every figure, because an unsourced one renders as a defect', () => {
    const facts = [
      DAM_CREST_M,
      DAM_FULL_SUPPLY_M,
      DAM_HEIGHT_M,
      DAM_STORAGE_M3,
      DAM_DESIGN_FLOOD_M3S,
      DAM_PEAK_OUTFLOW_M3S,
      DAM_OVERTOPPING_M,
      DAM_EROSION_WIDTH_M,
      DAM_EVACUATED_PEOPLE,
      DAM_BREAK_VOLUME_M3,
      DAM_BREAK_SCHWEINHEIM_DEPTH_M,
      DAM_BREAK_VELOCITY_MS,
    ];
    for (const fact of facts) {
      expect(fact.source).not.toBeNull();
      expect(fact.source?.issuer).toBeTruthy();
    }
  });

  it('marks every figure taken from the break study as a model, never as an event', () => {
    // These describe something that did not happen. If that qualifier ever falls off, the app
    // starts stating a catastrophe on real villages as though it had occurred.
    for (const fact of [DAM_BREAK_VOLUME_M3, DAM_BREAK_SCHWEINHEIM_DEPTH_M, DAM_BREAK_VELOCITY_MS]) {
      expect(fact.source?.status).toMatch(/Modellrechnung/);
    }
  });

  it('states the depth the study gave as a range, not as one confident number', () => {
    expect(DAM_BREAK_SCHWEINHEIM_DEPTH_M.range).toEqual([3, 5]);
  });
});

describe('formatDamClock', () => {
  it('reads as a clock', () => {
    expect(formatDamClock(moment('sirens'))).toBe('18:42');
    expect(formatDamClock(ASSUMED_BREAK_MINUTE)).toBe('20:00');
  });

  it('wraps past midnight rather than printing 25:00', () => {
    expect(formatDamClock(25 * 60)).toBe('01:00');
  });
});
