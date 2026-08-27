/**
 * The knowledge duel: what happens when both sides of a fight are people.
 *
 * Against the machine, a battle asks the attacker one question from the
 * defender's topic cluster and the score modifies the blow. That is the right
 * shape for a study game with one student in it, and it is the wrong shape the
 * moment the defender is a person too, because it makes them a spectator at
 * their own defence.
 *
 * So a fight between two humans asks **both of them the same question** and
 * the better answer takes the modifier. Three things follow from that, and all
 * three are the reason to do it this way:
 *
 *   - Both players revise. The defender is no longer punished or saved by
 *     somebody else's recall.
 *   - The question is the same one, so the comparison is fair. Two questions
 *     of different difficulty would make the modifier a measure of the draw
 *     rather than of the players.
 *   - Only one side can profit from a single question, which keeps the swing
 *     the same size as it is in single player. Handing both sides their own
 *     modifier would double the influence of the quiz on a fight.
 *
 * ⚠️ **This module decides who won, and nothing else.** It does not ask the
 * question, does not time it, and does not know what a topic is. The engine
 * stays a pure synchronous function of its inputs (D35), so the app collects
 * two answers and hands in two numbers.
 */

/** One side's answer, in -1..+1, the same scale the single-player quiz uses. */
export interface DuelAnswers {
  readonly attacker: number;
  readonly defender: number;
}

export interface DuelOutcome {
  /** The score to apply to the attacker's blow. */
  readonly attackerScore: number;
  /** The score to apply to the defender's return blow. */
  readonly defenderScore: number;
  readonly winner: 'attacker' | 'defender' | 'draw';
}

/**
 * How close two answers have to be before neither side has won.
 *
 * ⚠️ Without a band, an exact tie is the only draw, and a duel decided by a
 * hundredth of a second of reading speed reads as arbitrary rather than as
 * knowing the answer better. Both sides right and quick should feel like both
 * sides right and quick.
 */
export const DUEL_DRAW_BAND = 0.15;

/**
 * Settle a duel.
 *
 * ⚠️ **Winner takes it; the loser gets nothing, not a penalty.** Zeroing the
 * loser rather than applying their negative score is what keeps a duel from
 * being harsher than the single-player fight it replaces: being outclassed on
 * a question should cost you the advantage, not hand your opponent a second
 * one on top of it.
 *
 * A draw gives neither side anything, which is also what happens when the app
 * asks nobody: the fight is decided on the units alone.
 */
export function resolveDuel(answers: DuelAnswers): DuelOutcome {
  const attacker = clamp(answers.attacker);
  const defender = clamp(answers.defender);
  const margin = attacker - defender;

  if (Math.abs(margin) < DUEL_DRAW_BAND) {
    return { attackerScore: 0, defenderScore: 0, winner: 'draw' };
  }
  if (margin > 0) {
    return { attackerScore: attacker, defenderScore: 0, winner: 'attacker' };
  }
  return { attackerScore: 0, defenderScore: defender, winner: 'defender' };
}

const clamp = (score: number): number => {
  // NaN would survive Math.min/Math.max and poison the modifier downstream.
  if (!Number.isFinite(score)) return 0;
  return Math.min(1, Math.max(-1, score));
};
