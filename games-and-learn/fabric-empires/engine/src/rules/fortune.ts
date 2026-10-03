/**
 * Fortune: the map offering you something, and you deciding whether to bother.
 *
 * ⚠️ **This is the answer to a complaint about the whole game: every question
 * was compulsory.** A raid arrives and you are asked; a chest is dug and you
 * are asked; a topic falls due and you are asked. All of them are good reasons
 * to be asked, and all of them happen TO the player. Nothing in the game was a
 * question somebody chose to attempt.
 *
 * So a fortune is an offer. Something happens on the map, the player is told
 * what is on the table, and they say yes or no. Two kinds, and the pair matters
 * more than either half:
 *
 *   - **gold**: a seam, a cache, a windfall. Answer and take it.
 *   - **mire**: a unit is bogged down. Answer and it walks out this turn.
 *
 * ⚠️ **Answering can only ever help, and this is the rule the module exists to
 * enforce.** Declining and failing land in exactly the same place. There is no
 * arrangement of answers that leaves a player worse off than never having been
 * offered anything, which is what makes it safe to say yes to a question you
 * are not sure about, which is the entire behaviour a revision tool wants.
 *
 * The cost of attempting is the player's attention, and that is the only cost.
 * A player in a hurry declines and loses nothing but the upside; a player who
 * wants to revise says yes. That choice IS the feature.
 *
 * ⚠️ The mire is jeopardy that is not an attack. Losing a turn's movement is a
 * real setback that costs no health, threatens no town, and cannot compound:
 * it is the mildest adversity the game has, which is why it can be handed out
 * to somebody who is already losing.
 */

import { hexKey, type Hex } from '../hex/index.js';
import { RESOURCE_IDS, isPassableByLand, type ResourceId } from '../map/terrain.js';
import { unitType, type Unit } from '../entities/index.js';
import type { Rng } from '../rng/index.js';
import type { GameState } from '../state/gameState.js';

export type FortuneKind = 'gold' | 'mire';

export interface FortuneOffer {
  readonly kind: FortuneKind;
  /** Whose luck this is. */
  readonly factionId: string;
  /** The unit it happened to. */
  readonly unitId: string;
  readonly hex: Hex;
  /** What is on the table, for `gold`. Zero for a mire. */
  readonly resource: ResourceId;
  readonly amount: number;
}

/**
 * How often a turn brings an offer at all.
 *
 * ⚠️ Low, and low on purpose. These are voluntary, so a player who wants the
 * practice will say yes to every one, and a prompt every single turn stops
 * being an opportunity and becomes the compulsory thing it was meant to
 * replace. Roughly one turn in four leaves it feeling like luck.
 */
export const FORTUNE_CHANCE = 0.25;

/** How likely an offer is a windfall rather than a bog. */
export const FORTUNE_GOLD_SHARE = 0.6;

/** The smallest and largest windfall. Deliberately modest next to a chest. */
export const FORTUNE_MIN_AMOUNT = 10;
export const FORTUNE_MAX_AMOUNT = 30;

/**
 * Roll this turn's offer, if there is one.
 *
 * ⚠️ Pure, and seeded by the caller. Two players on the same seed get the same
 * luck on the same turn and a replay asks the same things (D39). A fortune
 * rolled from `Math.random` would make a saved game unreproducible and would
 * quietly make the seed a lie.
 *
 * Returns undefined far more often than not, which is the intended cadence.
 */
export function rollFortune(
  state: GameState,
  rng: Rng,
  factionId: string,
): FortuneOffer | undefined {
  if (rng.float(0, 1) > FORTUNE_CHANCE) return undefined;

  /*
   * ⚠️ Only units that can actually move. Handing a mire to a fortified
   * garrison that was not going anywhere is not a setback, it is a message
   * saying nothing happened, and handing one to a unit with no moves left is
   * indistinguishable from no event at all.
   */
  const candidates: Unit[] = [];
  for (const unit of state.units.values()) {
    if (unit.factionId !== factionId) continue;
    if (unit.fortified) continue;
    if (unitType(unit.typeId).movement <= 0) continue;
    candidates.push(unit);
  }
  if (candidates.length === 0) return undefined;

  // ⚠️ Sorted before picking. Map iteration order is insertion order, which is
  // stable, but sorting by id makes the choice independent of how the units
  // came to exist, so a save and a reload roll the same unit.
  candidates.sort((a, b) => a.id.localeCompare(b.id));
  const unit = candidates[Math.floor(rng.float(0, 1) * candidates.length)]!;

  const gold = rng.float(0, 1) < FORTUNE_GOLD_SHARE;
  if (!gold) {
    /*
     * ⚠️ A mire needs ground that could plausibly bog somebody. Being told
     * your Architect sank into a mountain reads as a bug, and the game already
     * has terrain that says otherwise on screen.
     */
    const tile = state.map.tiles.get(hexKey(unit.hex));
    if (!tile || !isPassableByLand(tile.terrain)) return undefined;
    return {
      kind: 'mire',
      factionId,
      unitId: unit.id,
      hex: unit.hex,
      resource: 'data',
      amount: 0,
    };
  }

  const resource = RESOURCE_IDS[Math.floor(rng.float(0, 1) * RESOURCE_IDS.length)]!;
  const spread = FORTUNE_MAX_AMOUNT - FORTUNE_MIN_AMOUNT;
  return {
    kind: 'gold',
    factionId,
    unitId: unit.id,
    hex: unit.hex,
    resource,
    amount: Math.round(FORTUNE_MIN_AMOUNT + rng.float(0, 1) * spread),
  };
}

/**
 * Whether an answer was good enough to collect.
 *
 * A single threshold rather than a sliding scale: a windfall is a yes or a no,
 * and scaling the haul by the score would make a half-remembered answer pay
 * something, which is the shape that teaches people to guess.
 */
export const FORTUNE_PASS_MARK = 0.35;

export function fortuneTaken(score: number): boolean {
  // NaN would compare false here anyway, but saying so is cheaper than
  // learning it from a bug report.
  return Number.isFinite(score) && score >= FORTUNE_PASS_MARK;
}

/**
 * Apply what the player decided.
 *
 * `answered` is the score when they attempted, and undefined when they walked
 * away. The two are deliberately NOT the same argument: "declined" and "got it
 * wrong" reach the same outcome, and a caller that had to encode a refusal as a
 * score of -1 would be one refactor away from making refusals cost something.
 */
export function applyFortune(
  state: GameState,
  offer: FortuneOffer,
  answered: number | undefined,
): GameState {
  const won = answered !== undefined && fortuneTaken(answered);

  if (offer.kind === 'gold') {
    // ⚠️ Nothing happens on a decline or a miss. Not a smaller pile: nothing.
    if (!won) return state;
    const faction = state.factions.get(offer.factionId);
    if (!faction) return state;
    const factions = new Map(state.factions);
    factions.set(offer.factionId, {
      ...faction,
      resources: {
        ...faction.resources,
        [offer.resource]: faction.resources[offer.resource] + offer.amount,
      },
    });
    return { ...state, factions };
  }

  /*
   * A mire that is answered costs nothing at all: the unit keeps the moves it
   * already had. Only a decline or a miss actually bogs it, and even then it
   * is one turn of walking, never health.
   */
  if (won) return state;
  const unit = state.units.get(offer.unitId);
  if (!unit || unit.movesLeft === 0) return state;
  const units = new Map(state.units);
  units.set(unit.id, { ...unit, movesLeft: 0 });
  return { ...state, units };
}
