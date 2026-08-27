/**
 * Council reviews: retrieval practice as the economy.
 *
 * Every city is bound to a small number of the tech nodes whose buildings
 * stand in it. When the learning layer says one of those topics has fallen
 * due, that city can hold a council review: answer a question about it and
 * the city is better off for several turns.
 *
 * The framing is the whole design (D49). An earlier version had overdue
 * skills riot cities into defecting, which teaches "you neglected your
 * homework, now suffer" and is a reason to stop playing rather than a reason
 * to review. Here the reward is the point: the cheapest way to run a strong
 * economy is to keep reviewing, so the player is chasing a bonus rather than
 * fleeing a penalty. Identical retrieval practice, opposite emotion.
 *
 * Two consequences follow from that and are enforced here rather than left to
 * good intentions:
 *
 *   - Unrest is capped, and it only dampens yields. No city can ever be lost
 *     to review debt.
 *   - Nothing accrues while the player is away. Unrest is only ever computed
 *     inside a turn, and turns only advance when somebody is playing, so
 *     coming back after a fortnight presents a pile of available bonuses
 *     rather than a burning empire.
 *
 * The engine still knows nothing about certifications. A bound topic is an
 * opaque string, and which topics are due is told to it, not worked out.
 */

import type { City } from '../entities/index.js';
import type { GameState } from '../state/gameState.js';

/** A city holds at most this many bound topics, so reviews stay spread out. */
export const MAX_BOUND_TOPICS = 3;

/** Trust granted by a review the player got right. */
export const REVIEW_TRUST_REWARD = 4;

/** How long the yield bonus from a good review lasts. */
export const REVIEW_BONUS_TURNS = 5;

/** Yield multiplier while a city is running on a fresh review. */
export const REVIEW_BONUS_MULTIPLIER = 1.25;

/** Ignored reviews tolerated before a city starts to grumble. */
export const IGNORES_BEFORE_UNREST = 2;

/** Unrest never exceeds this, which bounds the worst case at a known number. */
export const MAX_UNREST = 3;

/** Yield lost per point of unrest. At the cap this is a 36 percent dampening. */
export const UNREST_YIELD_PENALTY = 0.12;

export interface ReviewOpportunity {
  readonly cityId: string;
  readonly cityName: string;
  /** Opaque topic id. The engine never interprets it. */
  readonly topicId: string;
}

/**
 * Bind a freshly researched topic to a city.
 *
 * Chooses the city with the fewest bindings, breaking ties towards the larger
 * one, so reviews spread across the empire instead of piling onto the capital.
 * If every city is full the topic is simply not bound: a player who has
 * researched more than they have cities to hold is not doing anything wrong.
 */
export function bindTopicToCity(
  state: GameState,
  topicId: string,
  factionId: string = state.activeFactionId,
): GameState {
  const candidates = [...state.cities.values()]
    .filter((city) => city.factionId === factionId)
    .filter((city) => city.boundSkills.length < MAX_BOUND_TOPICS)
    .filter((city) => !city.boundSkills.includes(topicId));

  if (candidates.length === 0) return state;

  candidates.sort(
    (a, b) => a.boundSkills.length - b.boundSkills.length || b.population - a.population,
  );
  const chosen = candidates[0]!;

  const cities = new Map(state.cities);
  cities.set(chosen.id, {
    ...chosen,
    boundSkills: [...chosen.boundSkills, topicId],
  });
  return { ...state, cities };
}

/**
 * Which reviews a faction could hold right now.
 *
 * A city that has already reviewed this turn is excluded: one council per
 * city per turn is what makes the action cost something.
 */
export function reviewOpportunities(
  state: GameState,
  dueTopicIds: readonly string[],
  factionId: string = state.activeFactionId,
): ReviewOpportunity[] {
  if (dueTopicIds.length === 0) return [];
  const due = new Set(dueTopicIds);
  const out: ReviewOpportunity[] = [];

  for (const city of state.cities.values()) {
    if (city.factionId !== factionId) continue;
    if (city.lastReviewTurn === state.turn) continue;
    for (const topicId of city.boundSkills) {
      if (!due.has(topicId)) continue;
      out.push({ cityId: city.id, cityName: city.name, topicId });
    }
  }
  return out;
}

export type ReviewResult =
  | { readonly ok: true; readonly state: GameState; readonly trustGained: number }
  | { readonly ok: false; readonly reason: string };

/**
 * Apply the outcome of a council review.
 *
 * A wrong answer costs the turn and nothing else. It does not add unrest,
 * because punishing someone for attempting a review they were not sure about
 * teaches them to avoid reviews, which is precisely backwards. Only ignoring
 * a review has a cost, and even then only after a couple of them.
 */
export function resolveReview(
  state: GameState,
  cityId: string,
  topicId: string,
  score: number,
): ReviewResult {
  const city = state.cities.get(cityId);
  if (!city) return { ok: false, reason: 'No such city' };
  if (!city.boundSkills.includes(topicId)) {
    return { ok: false, reason: 'That topic is not bound to this city' };
  }
  if (city.lastReviewTurn === state.turn) {
    return { ok: false, reason: 'This city has already held a council this turn' };
  }

  const passed = score >= 0;
  const cities = new Map(state.cities);
  cities.set(cityId, {
    ...city,
    lastReviewTurn: state.turn,
    reviewBonusUntilTurn: passed ? state.turn + REVIEW_BONUS_TURNS : city.reviewBonusUntilTurn,
    // Attending settles a city whether or not the answer was right. Showing
    // up is the behaviour being reinforced.
    ignoredReviews: 0,
    unrest: passed ? Math.max(0, city.unrest - 1) : city.unrest,
  });

  let factions = state.factions;
  let trustGained = 0;
  if (passed) {
    const faction = state.factions.get(city.factionId);
    if (faction) {
      trustGained = REVIEW_TRUST_REWARD;
      const next = new Map(state.factions);
      next.set(city.factionId, {
        ...faction,
        resources: { ...faction.resources, trust: faction.resources.trust + trustGained },
      });
      factions = next;
    }
  }

  return { ok: true, state: { ...state, cities, factions }, trustGained };
}

/**
 * The multiplier a city's output is scaled by.
 *
 * One number combining the carrot and the small stick, so callers cannot
 * apply one and forget the other.
 */
export function cityMoraleMultiplier(city: City, turn: number): number {
  const bonus = turn < city.reviewBonusUntilTurn ? REVIEW_BONUS_MULTIPLIER : 1;
  const penalty = 1 - Math.min(MAX_UNREST, city.unrest) * UNREST_YIELD_PENALTY;
  return bonus * penalty;
}

export interface ReviewPhaseResult {
  readonly state: GameState;
  /** Reviews the player could have held and did not. */
  readonly ignored: readonly ReviewOpportunity[];
  /** Cities whose unrest went up this turn. */
  readonly unsettled: readonly string[];
}

/**
 * The unrest phase of a turn.
 *
 * Runs at the end of a turn over whatever was still due, so a review the
 * player actually held has already removed itself from the due list by then.
 */
export function reviewPhase(
  state: GameState,
  dueTopicIds: readonly string[],
  factionId: string = state.activeFactionId,
): ReviewPhaseResult {
  const ignored = reviewOpportunities(state, dueTopicIds, factionId);
  if (ignored.length === 0) return { state, ignored: [], unsettled: [] };

  const byCity = new Set(ignored.map((o) => o.cityId));
  const cities = new Map(state.cities);
  const unsettled: string[] = [];

  for (const cityId of byCity) {
    const city = cities.get(cityId);
    if (!city) continue;
    const ignoredReviews = city.ignoredReviews + 1;
    const overThreshold = ignoredReviews > IGNORES_BEFORE_UNREST;
    const unrest = overThreshold ? Math.min(MAX_UNREST, city.unrest + 1) : city.unrest;
    if (unrest > city.unrest) unsettled.push(cityId);
    cities.set(cityId, { ...city, ignoredReviews, unrest });
  }

  return { state: { ...state, cities }, ignored, unsettled };
}
