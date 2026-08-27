/**
 * How far a settlement has come.
 *
 * ⚠️ **A second axis, not a replacement for `CityKind`.** A city already says
 * what it *does*: Workspace, Lakehouse, Warehouse, Eventhouse, Semantic Model.
 * Rank says how far along it is. The two compose, so a settlement reads
 * "Lakehouse, Village" and both halves mean something different.
 *
 * ⚠️ **A rank is bought with knowledge as well as with citizens, and that is
 * the entire point.** A town that grows purely on food rewards ending turns
 * quickly; a town that grows on what its owner has actually retained rewards
 * revising. Only the second of those is why this project exists. Every city
 * carries `boundSkills`, the topics whose buildings stand in it, and the
 * spaced-repetition data already grades each of those, so this is composition
 * rather than new machinery (PLAN 24.1).
 *
 * ⚠️ **The engine still knows nothing about certifications (D35).** Strength
 * arrives as a function from an opaque topic id to a number between 0 and 1.
 * What that number means, and that the topics happen to be DP-600 skills, is
 * the caller's business and is never inspected here.
 */

import type { City } from './index.js';

export type CityRank = 'siedlung' | 'dorf' | 'gemeinde' | 'stadt' | 'grossstadt';

export interface CityRankInfo {
  readonly id: CityRank;
  /** Shown in the interface today. */
  readonly label: string;
  /**
   * The German name.
   *
   * Carried here rather than in a translation file so the two can never drift
   * apart: the rank and its name are one row. The German interface pass is
   * deliberately after 1 September (D214) and will already have these.
   */
  readonly labelDe: string;
  /** Citizens needed. The body of the place. */
  readonly minPopulation: number;
  /** How many of its bound topics must be retained. The licence for the place. */
  readonly topicsRequired: number;
  /** How well retained, 0 to 1, for a topic to count towards the rank. */
  readonly strengthRequired: number;
  /** Multiplies everything the city collects. */
  readonly yieldBonus: number;
  /** Added to the city's hit points. A real town is harder to take. */
  readonly bonusHp: number;
}

/**
 * The five, smallest first.
 *
 * The requirements climb on both axes at once on purpose. Population alone
 * would let a well-fed hamlet outrank a studied capital, and mastery alone
 * would let a city with one bound topic leap to the top on turn three, which
 * reads as broken even though it is arguably the purer rule.
 */
export const CITY_RANKS: readonly CityRankInfo[] = Object.freeze([
  {
    id: 'siedlung',
    label: 'Settlement',
    labelDe: 'Siedlung',
    minPopulation: 1,
    topicsRequired: 0,
    strengthRequired: 0,
    yieldBonus: 1,
    bonusHp: 0,
  },
  {
    id: 'dorf',
    label: 'Village',
    labelDe: 'Dorf',
    minPopulation: 2,
    topicsRequired: 1,
    strengthRequired: 0.3,
    yieldBonus: 1.08,
    bonusHp: 20,
  },
  {
    id: 'gemeinde',
    label: 'Township',
    labelDe: 'Gemeinde',
    minPopulation: 4,
    topicsRequired: 2,
    strengthRequired: 0.6,
    yieldBonus: 1.18,
    bonusHp: 50,
  },
  {
    id: 'stadt',
    label: 'Town',
    labelDe: 'Stadt',
    minPopulation: 6,
    topicsRequired: 3,
    strengthRequired: 0.6,
    yieldBonus: 1.3,
    bonusHp: 90,
  },
  {
    id: 'grossstadt',
    label: 'City',
    labelDe: 'Großstadt',
    minPopulation: 9,
    topicsRequired: 4,
    strengthRequired: 0.95,
    yieldBonus: 1.45,
    bonusHp: 140,
  },
]);

export const FIRST_RANK: CityRank = 'siedlung';

const BY_ID = new Map(CITY_RANKS.map((r) => [r.id, r]));

export function rankInfo(id: CityRank): CityRankInfo {
  return BY_ID.get(id) ?? CITY_RANKS[0]!;
}

/** Where a rank sits in the order, 0 for the smallest. */
export function rankIndex(id: CityRank): number {
  const at = CITY_RANKS.findIndex((r) => r.id === id);
  return at < 0 ? 0 : at;
}

/** How well the topics standing in this city are retained, 0 to 1 each. */
export type StrengthOf = (topicId: string) => number;

/** How many of a city's bound topics are retained at least this well. */
export function topicsHeldAt(
  city: City,
  strengthOf: StrengthOf,
  atLeast: number,
): number {
  let held = 0;
  for (const topicId of city.boundSkills) {
    if (strengthOf(topicId) >= atLeast) held += 1;
  }
  return held;
}

function meets(city: City, rank: CityRankInfo, strengthOf: StrengthOf): boolean {
  if (city.population < rank.minPopulation) return false;
  if (rank.topicsRequired === 0) return true;
  return topicsHeldAt(city, strengthOf, rank.strengthRequired) >= rank.topicsRequired;
}

/**
 * The highest rank this city currently qualifies for.
 *
 * Note that this can be LOWER than the rank the city holds, because a topic
 * can lapse. What happens then is decided by the caller, not here: see
 * `promotionFor`.
 */
export function earnedRank(city: City, strengthOf: StrengthOf): CityRankInfo {
  let best = CITY_RANKS[0]!;
  for (const rank of CITY_RANKS) {
    if (meets(city, rank, strengthOf)) best = rank;
  }
  return best;
}

/**
 * The rank a city should hold after this turn, or nothing if it is unchanged.
 *
 * ⚠️ **It stalls, it never falls.** A lapsed topic stops a settlement rising
 * and it does not take anything away that was already built. The plan wanted
 * the full reference behaviour in 24.1, where a house downgrades when its
 * demand is unmet, and that is the sharper mechanic; it is also the one most
 * likely to feel like a punishment on a study aid, which is the last thing a
 * study aid can afford. Forgetting blocks progress. It does not burn your
 * town down.
 */
export function promotionFor(
  city: City,
  strengthOf: StrengthOf,
): CityRankInfo | undefined {
  const earned = earnedRank(city, strengthOf);
  return rankIndex(earned.id) > rankIndex(city.rank) ? earned : undefined;
}

export interface RankNeed {
  /** The rank being worked towards. */
  readonly rank: CityRankInfo;
  /** Citizens still wanted, zero when the population is already enough. */
  readonly citizensShort: number;
  /** Retained topics still wanted. */
  readonly topicsShort: number;
  /** True when only revision stands in the way. */
  readonly blockedByKnowledge: boolean;
}

/**
 * What the next rank is waiting for.
 *
 * Exists so the interface can say "two more citizens, and one more topic held
 * at familiar" rather than leaving a player to guess why a town has stopped.
 * A growth mechanic nobody can see is a growth mechanic nobody plays.
 */
export function nextRankNeed(city: City, strengthOf: StrengthOf): RankNeed | undefined {
  const next = CITY_RANKS[rankIndex(city.rank) + 1];
  if (!next) return undefined;

  const citizensShort = Math.max(0, next.minPopulation - city.population);
  const held = topicsHeldAt(city, strengthOf, next.strengthRequired);
  const topicsShort = Math.max(0, next.topicsRequired - held);

  return {
    rank: next,
    citizensShort,
    topicsShort,
    blockedByKnowledge: topicsShort > 0 && citizensShort === 0,
  };
}
