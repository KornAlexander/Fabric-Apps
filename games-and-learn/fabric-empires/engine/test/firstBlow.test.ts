/**
 * "Enemies don't die on the first fight, only on the second."
 *
 * ⚠️ **A real bug report, and the arithmetic of it is worth keeping.** The
 * cause was not in combat at all. A correct answer was scoring 0.6 instead of
 * 1.0, because the top score required answering inside half a flat twenty
 * second limit that also had to cover READING the question, and the median
 * DP-600 question needs 19.6 seconds just to read and choose. Measured against
 * the real bank, only 3 percent of questions could earn the bonus and only 54
 * percent could be answered at all.
 *
 * Against an evenly matched defender that difference lands exactly on the
 * boundary between a kill and a survivor:
 *
 *   score 0.6 -> attack 18.8 vs 10 ->  77 damage -> survives with 23
 *   score 1.0 -> attack 26.0 vs 10 -> 126 damage -> capped at 100 -> dies
 *
 * One blow versus two, decided by a stopwatch measuring reading speed. The fix
 * is in `presenter.ts`; these tests pin the combat half so that nobody
 * "rebalances" the damage curve to chase a symptom whose cause was elsewhere.
 */

import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_STRENGTH_SWING,
  MAX_DAMAGE,
  challengeModifier,
  damageFrom,
} from '../src/index.js';

/** An even fight: two scouts, one attacking, both untouched. */
const EQUAL_DEFENDER = 10;
const SCOUT_STRENGTH = 8;

const attackWith = (score: number): number =>
  Math.max(1, SCOUT_STRENGTH + challengeModifier(score));

const blowsToKill = (score: number): number =>
  Math.ceil(100 / damageFrom(attackWith(score), EQUAL_DEFENDER, 1));

describe('⚠️ knowing the answer is what kills things', () => {
  it('kills an evenly matched enemy in one blow', () => {
    expect(blowsToKill(1)).toBe(1);
  });

  it('takes two blows when the answer was right but laboured', () => {
    // 0.6 is the score for a correct answer that used most of the thinking
    // budget. It should still win the fight, just not at once.
    expect(blowsToKill(0.6)).toBe(2);
  });

  it('⚠️ is the whole margin the bug lived in', () => {
    /*
     * The regression this file exists for. If the gap between a confident
     * answer and a laboured one ever stops being the gap between one blow and
     * two, the reported symptom is back, whatever caused it that time.
     */
    expect(damageFrom(attackWith(0.6), EQUAL_DEFENDER, 1)).toBeLessThan(100);
    expect(damageFrom(attackWith(1), EQUAL_DEFENDER, 1)).toBeGreaterThanOrEqual(100);
  });

  it('leaves a wrong answer unable to finish anything quickly', () => {
    expect(blowsToKill(-1)).toBeGreaterThan(4);
  });

  it('makes the answer worth more to a scout than to a titan', () => {
    // The swing is flat, so it is proportionally decisive for a weak unit and
    // merely important for a strong one. That is the intended shape and it is
    // why a scout with a good answer can trouble a line unit at all.
    const scout = (SCOUT_STRENGTH + CHALLENGE_STRENGTH_SWING) / SCOUT_STRENGTH;
    const titan = (60 + CHALLENGE_STRENGTH_SWING) / 60;
    expect(scout).toBeGreaterThan(titan * 2);
  });
});

describe('the damage curve itself is unchanged', () => {
  /*
   * Pinned deliberately. The obvious "fix" for the report was to make every
   * weapon hit harder, which would have buried the real cause under a balance
   * change nobody had time to playtest before a deadline.
   */
  it('deals 30 at parity', () => {
    expect(damageFrom(20, 20, 1)).toBe(30);
  });

  it('never exceeds a single kill', () => {
    expect(damageFrom(1000, 1, 1)).toBe(MAX_DAMAGE);
  });

  it('always costs the winner something', () => {
    expect(damageFrom(1, 1000, 1)).toBeGreaterThan(0);
  });
});
