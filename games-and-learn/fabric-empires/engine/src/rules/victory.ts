import type { GameState } from '../state/index.js';

/**
 * Winning and losing.
 *
 * The app has been able to tell when the player was wiped out for a while, by
 * counting units and cities itself. That was fine as far as it went and wrong
 * in principle: whether a game is over is a rule, it is the same question for
 * every faction, and a rule the interface computes is a rule nothing tests.
 *
 * ⚠️ **Two of the plan's three victories are here; the third is not, and that
 * is deliberate.** Conquest and Mastery are statements about units, cities
 * and topics, all of which the engine already owns. The Exam victory is a
 * statement about *exam readiness*, which is a weighted percentage of a real
 * certification outline, and the engine is not allowed to know that such a
 * thing exists (D35). It belongs to the learning layer and is scored there.
 *
 * ⚠️ The two kinds were called `domination` and `science` until they were
 * renamed. Both are the standard vocabulary of the genre rather than anything
 * borrowed, but they are also the two words a reader would recognise fastest
 * from one particular series, and the cost of not using them is a find and
 * replace. Nothing persists an outcome, so there is no migration.
 */

export type OutcomeKind = 'defeat' | 'conquest' | 'mastery';

export interface Outcome {
  readonly kind: OutcomeKind;
  /** One line, written from the losing or winning faction's point of view. */
  readonly summary: string;
}

/** Whether a faction still holds anything at all. */
function stillStanding(state: GameState, factionId: string): boolean {
  for (const unit of state.units.values()) {
    if (unit.factionId === factionId) return true;
  }
  for (const city of state.cities.values()) {
    if (city.factionId === factionId) return true;
  }
  return false;
}

/**
 * How the game stands for one faction, or undefined while it is still being
 * played.
 *
 * ⚠️ **Defeat is checked first.** An empire with nothing left to command
 * cannot claim a victory in the same breath, even in the edge case where the
 * last topic completes on the turn the last unit dies. Losing is the more
 * definite state and reads better than a win announced over an empty map.
 */
export function checkOutcome(state: GameState, factionId: string): Outcome | undefined {
  if (!stillStanding(state, factionId)) {
    return {
      kind: 'defeat',
      summary: 'Your empire has fallen. Nothing of it remains on the map.',
    };
  }

  /*
   * Conquest needs there to have been somebody to conquer.
   *
   * A sandbox started with `spawnAntagonists: false` has no rivals at all, and
   * without this check it would declare victory on turn one, which is both
   * absurd and exactly the kind of thing that only shows up in a demo.
   */
  const rivals = [...state.factions.keys()].filter((id) => id !== factionId);
  if (rivals.length > 0 && rivals.every((id) => !stillStanding(state, id))) {
    return {
      kind: 'conquest',
      summary: 'Every rival has been driven from the map. The region is yours.',
    };
  }

  const total = state.topics.nodes.length;
  if (total > 0 && state.research.known.length >= total) {
    return {
      kind: 'mastery',
      summary: `All ${total} skills researched. There is nothing left in the tree to learn.`,
    };
  }

  return undefined;
}
