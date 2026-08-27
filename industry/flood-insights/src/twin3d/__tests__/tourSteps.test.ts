import { describe, expect, it } from 'vitest';

import { TOUR_LENGTH, TOUR_STEPS, actOf, finalStep } from '../tourSteps';

/**
 * These tests defend the framing, not the feature.
 *
 * PLAN §2.3 says the tour is not complete unless it ends on Act IV, and §13 names the risk it
 * guards against: a presenter who skips the framing, jumps to the water, and turns the evening
 * into a technology show. A tour that quietly gained a ninth step after the what-if, or that
 * finished on the flood, would reintroduce exactly that — and it would do so silently.
 */

describe('the tour', () => {
  // The count was pinned at eight when the tour was the only story. Pinning a length made the
  // test fail for the one change it should not object to — adding story points — while saying
  // nothing about whether the tour was any good. What matters is that it is long enough to be a
  // walk and that it stays in step with the default story.
  it('is the default story, and long enough to be a tour', () => {
    expect(TOUR_LENGTH).toBe(TOUR_STEPS.length);
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(8);
  });

  it('ends on Act IV, which is the whole point of scripting it', () => {
    const last = finalStep();
    expect(last.act).toBe(4);
    expect(last.id).toBe('whatif');
  });

  it('hands over to the closing screen from exactly one step, and that step is the last', () => {
    const finishing = TOUR_STEPS.filter((s) => s.finishes);
    expect(finishing).toHaveLength(1);
    expect(finishing[0]).toBe(finalStep());
  });

  it('never runs the acts backwards', () => {
    for (let i = 1; i < TOUR_STEPS.length; i += 1) {
      expect(TOUR_STEPS[i].act).toBeGreaterThanOrEqual(TOUR_STEPS[i - 1].act);
    }
  });

  it('visits all four acts', () => {
    expect(new Set(TOUR_STEPS.map((s) => s.act))).toEqual(new Set([1, 2, 3, 4]));
  });

  it('gives every step a unique id, because the ids key the copy', () => {
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
  });

  it('moves downstream through the night rather than jumping about', () => {
    // Act II is the wave travelling. Its three steps must advance in time, or the tour would be
    // telling the story of the flood out of order.
    const night = TOUR_STEPS.filter((s) => s.act === 2);
    for (let i = 1; i < night.length; i += 1) {
      expect(night[i].minutes!).toBeGreaterThan(night[i - 1].minutes!);
    }
  });

  it('clamps the act lookup instead of reading past the ends', () => {
    expect(actOf(-5)).toBe(TOUR_STEPS[0].act);
    expect(actOf(99)).toBe(4);
  });
});
