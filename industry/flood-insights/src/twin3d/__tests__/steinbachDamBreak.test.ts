import { describe, expect, it } from 'vitest';

import flow from '../../../public/terrain/steinbach-2021/flowfield_16m.json';
import { DAM_BREAK_SCENARIO, DAM_BREAK_VOLUME_M3 } from '@/data/steinbach';
import {
  BREACH_PEAK_M3S,
  FRONT_CELERITY_MS,
  RELEASE_VOLUME_M3,
  breachDischargeAt,
  buildDamBreakWseProfile,
  frontDistanceM,
  releasedVolumeM3,
} from '../steinbachDamBreak';

/**
 * The corridor's dam break, held against the study it comes from.
 *
 * This models a flood that did not happen, so the tests that matter are the ones that stop the
 * model drifting away from its source. The study publishes a volume, an arrival time and a depth.
 * Volume and time go in; **the depth does not** — it has to come out of the released water and the
 * real cross-sections on its own, which is what makes it a check instead of a knob.
 */

const bed = flow.bedProfileM as number[];
const releaseIndex = flow.release!.chainageIndex;
const step = flow.chainageStepM;

/** Schweinheim's chainage index, measured off the flow field by tools/geodata (index 243). */
const SCHWEINHEIM_INDEX = 243;

function profileAt(minutes: number): Float64Array {
  return buildDamBreakWseProfile({
    minutes,
    bedProfileM: bed,
    ratingDischargeM3s: flow.ratingDischargeM3s as number[],
    ratingStageM: flow.ratingStageM as number[][],
    releaseIndex,
    chainageStepM: step,
  });
}

describe('the released volume', () => {
  it('is the study\'s figure, not a rounder one', () => {
    expect(RELEASE_VOLUME_M3).toBe(DAM_BREAK_VOLUME_M3.value);
  });

  it('all of it eventually passes the wall, and none before the failure', () => {
    expect(releasedVolumeM3(-1)).toBe(0);
    expect(releasedVolumeM3(0)).toBe(0);
    // The recession is exponential, so this approaches rather than reaches the total.
    expect(releasedVolumeM3(120)).toBeGreaterThan(RELEASE_VOLUME_M3 * 0.999);
    expect(releasedVolumeM3(120)).toBeLessThanOrEqual(RELEASE_VOLUME_M3);
  });

  it('integrates to the volume, which is what fixes the peak', () => {
    // Rectangle rule over two hours at one-second steps.
    let sum = 0;
    for (let s = 0; s < 7_200; s++) sum += breachDischargeAt(s / 60);
    expect(sum).toBeGreaterThan(RELEASE_VOLUME_M3 * 0.99);
    expect(sum).toBeLessThan(RELEASE_VOLUME_M3 * 1.01);
  });

  it('peaks immediately, because the study assumes failure within seconds', () => {
    expect(breachDischargeAt(0.01)).toBeGreaterThan(BREACH_PEAK_M3S * 0.99);
    expect(breachDischargeAt(30)).toBeLessThan(breachDischargeAt(10));
  });
});

describe('the front', () => {
  it('outruns the water it carries', () => {
    // The study's 3 m/s is the flow velocity through Schweinheim. A front slower than its own
    // water would be the wrong physics, and it is also how the first attempt at this went wrong.
    const flowVelocity = DAM_BREAK_SCENARIO.find((p) => p.id === 'schweinheim')!.velocityMs!;
    expect(FRONT_CELERITY_MS).toBeGreaterThan(flowVelocity);
  });

  it('reaches Schweinheim when the study says it does', () => {
    const published = DAM_BREAK_SCENARIO.find((p) => p.id === 'schweinheim')!.travelMinutes!;
    const path = (SCHWEINHEIM_INDEX - releaseIndex) * step;
    const modelled = path / FRONT_CELERITY_MS / 60;
    expect(modelled).toBeCloseTo(published, 0);
  });

  it('starts at the dam, not at the top of the line', () => {
    // ⚠️ Chainage 0 is 1.8 km ABOVE the wall, in the stream feeding the reservoir. A break
    // released at 0 would run the flood down through the reservoir it came out of.
    expect(releaseIndex).toBeGreaterThan(0);
    const early = profileAt(2);
    for (let i = 0; i < releaseIndex; i++) {
      expect(early[i], `chainage ${i} is above the dam and must stay dry`).toBe(bed[i]);
    }
  });

  it('has not reached the far end of the reach in the first minutes', () => {
    expect(frontDistanceM(1)).toBeLessThan((bed.length - releaseIndex) * step);
    expect(frontDistanceM(1)).toBeGreaterThan(0);
  });
});

describe('the water surface', () => {
  it('is the bare bed before the failure', () => {
    const dry = profileAt(-5);
    for (let i = 0; i < bed.length; i++) expect(dry[i]).toBe(bed[i]);
  });

  it('never stands below its own bed', () => {
    for (const minutes of [1, 5, 10, 20, 45, 90]) {
      const wse = profileAt(minutes);
      for (let i = 0; i < bed.length; i++) {
        expect(wse[i], `chainage ${i} at ${minutes} min`).toBeGreaterThanOrEqual(bed[i]);
      }
    }
  });

  it('leaves everything ahead of the front dry', () => {
    const minutes = 5;
    const wse = profileAt(minutes);
    const reachedIndex = releaseIndex + frontDistanceM(minutes) / step;
    for (let i = Math.ceil(reachedIndex) + 1; i < bed.length; i++) {
      expect(wse[i], `chainage ${i} is ahead of the front`).toBe(bed[i]);
    }
  });

  /**
   * The check the whole module exists to pass.
   *
   * The study says 3–5 m at Schweinheim after 10 minutes. That depth is never fed in: it comes out
   * of 1.5 Mm³ on an exponential recession, attenuated down the reach, standing in a cross-section
   * cut from DGM1 and solved with Manning. If this fails, the model and its source disagree and
   * the model is wrong — not the assertion.
   */
  it("reproduces the study's published depth at Schweinheim", () => {
    const place = DAM_BREAK_SCENARIO.find((p) => p.id === 'schweinheim')!;
    const [lo, hi] = place.depthM!;
    const wse = profileAt(place.travelMinutes!);
    const depth = wse[SCHWEINHEIM_INDEX] - bed[SCHWEINHEIM_INDEX];
    expect(depth).toBeGreaterThanOrEqual(lo);
    expect(depth).toBeLessThanOrEqual(hi);
  });

  it('drains: the reach is shallower long after the peak than at it', () => {
    const atPeak = profileAt(10);
    const later = profileAt(90);
    const i = SCHWEINHEIM_INDEX;
    expect(later[i] - bed[i]).toBeLessThan(atPeak[i] - bed[i]);
  });
});
