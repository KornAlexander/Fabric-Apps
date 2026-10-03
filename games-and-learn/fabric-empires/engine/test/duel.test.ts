/**
 * The knowledge duel, and the empire table it feeds.
 *
 * Against the machine, a battle asks the attacker one question and the score
 * modifies the blow. That is right with one student in the game and wrong the
 * moment the defender is a person too, because it makes them a spectator at
 * their own defence.
 *
 * ⚠️ **This is NOT the same rule as the co-op duo modal, and the difference is
 * deliberate.** Co-op AVERAGES two answers, because both people are playing one
 * empire and taking the better of the two would make the weaker player a
 * spectator with a keyboard. A duel is the opposite situation: two empires, one
 * question, and the point is to beat the other person to it.
 */

import { describe, expect, it } from 'vitest';
import { DUEL_DRAW_BAND, resolveDuel } from '../src/index.js';

describe('who profits from the question', () => {
  it('gives the modifier to the better answer', () => {
    const out = resolveDuel({ attacker: 0.9, defender: 0.1 });
    expect(out.winner).toBe('attacker');
    expect(out.attackerScore).toBeCloseTo(0.9);
  });

  it('works the other way round too', () => {
    const out = resolveDuel({ attacker: -0.4, defender: 0.8 });
    expect(out.winner).toBe('defender');
    expect(out.defenderScore).toBeCloseTo(0.8);
  });

  it('⚠️ zeroes the loser rather than applying their score against them', () => {
    /*
     * Winner takes it; the loser gets nothing, not a penalty. Applying the
     * loser's negative score would make a duel harsher than the single-player
     * fight it replaces: being outclassed on a question should cost you the
     * advantage, not hand your opponent a second one on top of it.
     */
    const out = resolveDuel({ attacker: 1, defender: -1 });
    expect(out.defenderScore).toBe(0);
    expect(out.attackerScore).toBe(1);
  });

  it('⚠️ only ever pays ONE side, so a duel does not double the quiz swing', () => {
    for (const pair of [
      { attacker: 1, defender: -1 },
      { attacker: -1, defender: 1 },
      { attacker: 0.5, defender: 0.2 },
      { attacker: 0.2, defender: 0.5 },
    ]) {
      const out = resolveDuel(pair);
      const paid = [out.attackerScore, out.defenderScore].filter((s) => s !== 0);
      expect(paid.length, JSON.stringify(pair)).toBeLessThanOrEqual(1);
    }
  });
});

describe('when neither of them won', () => {
  it('⚠️ treats a near-tie as a draw, not as a photo finish', () => {
    /*
     * Without a band, an exact tie is the only draw, and a duel decided by a
     * hundredth of a second of reading speed reads as arbitrary rather than as
     * knowing the answer better.
     */
    const out = resolveDuel({ attacker: 0.8, defender: 0.8 - DUEL_DRAW_BAND / 2 });
    expect(out.winner).toBe('draw');
    expect(out.attackerScore).toBe(0);
    expect(out.defenderScore).toBe(0);
  });

  it('is what two people both getting it right looks like', () => {
    const out = resolveDuel({ attacker: 1, defender: 1 });
    expect(out.winner).toBe('draw');
  });

  it('and two people both getting it wrong', () => {
    // A draw gives neither side anything, which is also what happens when the
    // app asks nobody: the fight is decided on the units alone.
    const out = resolveDuel({ attacker: -1, defender: -1 });
    expect(out.winner).toBe('draw');
    expect(out.attackerScore).toBe(0);
  });

  it('just outside the band is a win', () => {
    const out = resolveDuel({ attacker: DUEL_DRAW_BAND + 0.01, defender: 0 });
    expect(out.winner).toBe('attacker');
  });
});

describe('rubbish in', () => {
  it('clamps a score from outside the scale', () => {
    const out = resolveDuel({ attacker: 12, defender: -12 });
    expect(out.attackerScore).toBe(1);
  });

  it('⚠️ treats a non-number as no answer, rather than poisoning the fight', () => {
    /*
     * NaN survives Math.min and Math.max, so an unclamped one would reach
     * `challengeModifier` and turn the whole blow into NaN. A timer that fired
     * with nothing entered is a real way to produce one.
     */
    const out = resolveDuel({ attacker: Number.NaN, defender: 0.5 });
    expect(out.winner).toBe('defender');
    expect(Number.isFinite(out.defenderScore)).toBe(true);
  });
});
