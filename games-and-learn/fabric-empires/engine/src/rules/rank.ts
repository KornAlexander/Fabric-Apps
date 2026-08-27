/**
 * Settlements rising.
 *
 * ⚠️ **Called by the app, not by the turn pipeline, and that is on purpose.**
 * Promotion needs to know how well each topic is retained, and that lives in
 * the spaced-repetition data on the other side of the D35 line. Threading a
 * knowledge callback down through `runUpkeep` would put a certification-shaped
 * hole in the middle of the engine's turn loop for the sake of one rule. So
 * the caller, which already holds the mastery tracker, hands in a plain
 * function of an opaque topic id and calls this after upkeep.
 */

import {
  nextRankNeed,
  promotionFor,
  rankInfo,
  type CityRankInfo,
  type StrengthOf,
} from '../entities/rank.js';
import type { City } from '../entities/index.js';
import { cityKind } from '../entities/index.js';
import type { GameState } from '../state/index.js';

export interface Promotion {
  readonly cityId: string;
  readonly cityName: string;
  readonly from: CityRankInfo;
  readonly to: CityRankInfo;
}

export interface PromotionResult {
  readonly state: GameState;
  readonly promoted: readonly Promotion[];
}

/**
 * The hit points this city has when undamaged.
 *
 * ⚠️ **The ceiling was implied by the rules but never stated anywhere**, which
 * is why nothing could report a city's health as a fraction. `promoteCities`
 * below moves it by adding the *difference* between two rank bonuses, so the
 * total `baseHp + bonusHp` was never written down and any caller wanting it
 * had to rediscover the formula. One place, as `maxWallHp` already is.
 *
 * ⚠️ **A city's HP is never restored.** Nothing in the engine heals one, and
 * promotion deliberately grants the difference rather than topping up, so
 * damage taken in turn twelve is still there at the end of the game. That is
 * what makes showing the number worth doing at all: it is a permanent record,
 * not a bar that quietly refills while you are not looking.
 */
export function maxCityHp(city: City): number {
  return cityKind(city.kind).baseHp + rankInfo(city.rank).bonusHp;
}

/** How much of the city is still standing, 0 to 1. */
export function cityIntegrity(city: City): number {
  const full = maxCityHp(city);
  if (full <= 0) return 1;
  return Math.max(0, Math.min(1, city.hp / full));
}

/**
 * Raise every settlement that has earned it.
 *
 * Returns the same state object when nothing changed, so a caller can skip a
 * redraw cheaply and so this is safe to run every turn.
 */
export function promoteCities(
  state: GameState,
  strengthOf: StrengthOf,
  factionId: string = state.activeFactionId,
): PromotionResult {
  const promoted: Promotion[] = [];
  let cities: Map<string, City> | undefined;

  for (const [id, city] of state.cities) {
    if (city.factionId !== factionId) continue;
    const next = promotionFor(city, strengthOf);
    if (!next) continue;

    promoted.push({
      cityId: id,
      cityName: city.name,
      from: rankInfo(city.rank),
      to: next,
    });
    cities ??= new Map(state.cities);
    cities.set(id, {
      ...city,
      rank: next.id,
      // A bigger place is harder to take. Granted rather than healed: the
      // ceiling moves up and the current damage is kept.
      hp: city.hp + (next.bonusHp - rankInfo(city.rank).bonusHp),
    });
  }

  if (!cities) return { state, promoted: [] };
  return { state: { ...state, cities }, promoted };
}

/**
 * Settlements that have the citizens but not the knowledge.
 *
 * The interesting list, and the one worth putting in front of a player: these
 * are the towns held back purely by revision. Everything else is waiting on
 * food, which time fixes on its own.
 */
export function stalledOnKnowledge(
  state: GameState,
  strengthOf: StrengthOf,
  factionId: string = state.activeFactionId,
): readonly City[] {
  const out: City[] = [];
  for (const city of state.cities.values()) {
    if (city.factionId !== factionId) continue;
    if (nextRankNeed(city, strengthOf)?.blockedByKnowledge) out.push(city);
  }
  return out;
}
