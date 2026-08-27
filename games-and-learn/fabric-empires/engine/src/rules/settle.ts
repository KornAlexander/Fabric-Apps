/**
 * Where to put the next city.
 *
 * ⚠️ **Founding was the one important decision the game gave no help with.**
 * An Architect can settle almost anywhere, the difference between a good site
 * and a bad one is enormous and permanent, and nothing on screen said which
 * was which. A player either already knew that Data is what makes a city grow,
 * or they founded on the tile they happened to be standing on and wondered why
 * their capital took twenty turns to reach size two.
 *
 * So this proposes sites, and it proposes them by running the real yield rules
 * over each candidate rather than by a rule of thumb. The numbers it reports
 * are the numbers the city will actually produce, because they come from the
 * same functions the turn pipeline uses.
 *
 * ⚠️ **Only tiles the player has already explored are offered.** Suggesting a
 * site behind the fog would be the game telling them what is out there, which
 * is exactly the information the fog exists to withhold.
 */

import { hexDistance, hexKey, hexSpiral, type Hex } from '../hex/index.js';
import { terrain, tileYields } from '../map/index.js';
import { CITY_KINDS, type City, type Unit } from '../entities/index.js';
import { FIRST_RANK } from '../entities/rank.js';
import { cityAt, memoryOf, tileAt, type GameState } from '../state/index.js';
import { CITY_WORK_RADIUS, growthThreshold, workedTiles } from './yields.js';
import { canFoundCity, isOccupied, reachable } from './movement.js';
import { cityKindFor } from './actions.js';

/** How far from the Architect to look for somewhere to build. */
export const SETTLE_SEARCH_RADIUS = 3;

/** How many sites to offer. More than a handful is a menu, not advice. */
export const SETTLE_SUGGESTIONS = 5;

/**
 * How much the score cares about growth over everything else.
 *
 * ⚠️ Deliberately heavier than the weighting `startScore` uses for placing the
 * opening capital. Compute, Capacity and Trust are all worth having, and a
 * city that cannot grow collects a small amount of each of them forever: every
 * citizen works one more tile, so growth multiplies the rest. A site that
 * looks rich and cannot feed itself is the classic trap, and it is the one the
 * suggestion is here to steer around.
 *
 * ⚠️ **There is a floor under this number and it is 1.95.** A Raw File Plain
 * yields 2 Data and a Geothermal Vent 3 Capacity, and Capacity is weighted
 * 1.3, so a plains tile only outranks a vent tile while `2 * GROWTH_WEIGHT >
 * 3 * 1.3`. Dropping this to 1.6 while adding the founding term below silently
 * inverted the whole recommendation, and only the test caught it.
 */
export const GROWTH_WEIGHT = 2.4;

/**
 * How much it cares about Data the city will collect on its very first turn.
 *
 * ⚠️ **This exists because scoring the neighbourhood alone recommended sites
 * that grew more slowly than the tile the Architect was already standing on.**
 * Summing Data across the whole work radius describes a city's eventual
 * ceiling, and a size-one city works its centre and exactly one other tile, so
 * the two can point in opposite directions. The advice then contradicted
 * itself on screen: "better site, 2 Data, 9 turns" next to "here: 3 Data, 6
 * turns".
 */
export const FOUNDING_DATA_WEIGHT = 4;

export interface SettleSite {
  readonly hex: Hex;
  readonly score: number;
  /** Data a city here would collect on its first turn, from the real rules. */
  readonly dataAtFounding: number;
  /**
   * Turns until this city's first new citizen.
   *
   * `undefined` when it would never grow, which is a real outcome on Data-poor
   * ground and worth saying out loud rather than showing as a large number.
   */
  readonly turnsToGrow: number | undefined;
  /** Steps from the Architect, so the interface can say how far it is. */
  readonly distance: number;
  /** True when the Architect could walk there and found on this same turn. */
  readonly reachableNow: boolean;
}

/**
 * How long a city producing this much Data takes to add its first citizen.
 *
 * ⚠️ **Subsistence is not subtracted, because the game does not subtract it.**
 * `subsistenceNeed` only biases which tiles a city chooses to work; the turn
 * pipeline adds the whole Data output to the growth store. Showing a number
 * that quietly deducted it would be showing the player a rule that does not
 * exist.
 */
export function turnsToFirstCitizen(dataPerTurn: number): number | undefined {
  if (dataPerTurn <= 0) return undefined;
  return Math.ceil(growthThreshold(1) / dataPerTurn);
}

/** A city that does not exist, for asking what one here would collect. */
function hypothetical(state: GameState, hex: Hex): City {
  const kind = cityKindFor(state, hex);
  return {
    id: '__proposed__',
    factionId: state.activeFactionId,
    hex,
    name: '',
    kind,
    hp: CITY_KINDS[kind].baseHp,
    wallLevel: 0,
    wallHp: 0,
    population: 1,
    rank: FIRST_RANK,
    growthStore: 0,
    boundSkills: [],
    unrest: 0,
    ignoredReviews: 0,
    reviewBonusUntilTurn: 0,
    lastReviewTurn: 0,
    lastRaidedTurn: 0,
    productionProgress: 0,
  };
}

/**
 * Score a candidate site.
 *
 * Exported so a test can compare two tiles directly, which is the only honest
 * way to assert that the weighting prefers what it claims to prefer.
 *
 * `founding` is the Data a city here collects immediately; it defaults to
 * working it out, and `settleSites` passes the value it already has.
 */
export function settleScore(
  state: GameState,
  hex: Hex,
  founding = dataAtFounding(state, hex),
): number {
  const centre = tileAt(state, hex);
  if (!centre) return Number.NEGATIVE_INFINITY;

  let growth = 0;
  let wealth = 0;
  let freshWater = centre.river;
  let coastal = false;
  const kinds = new Set<string>();

  for (const ring of hexSpiral(hex, CITY_WORK_RADIUS)) {
    const tile = state.map.tiles.get(hexKey(ring));
    if (!tile) continue;
    // Ground the city will never work is ground that does not count.
    if (cityAt(state, ring)) continue;

    const y = tileYields(tile.terrain, tile.river);
    growth += y.data;
    wealth += y.compute * 1.0 + y.cu * 1.3 + y.trust * 0.9;

    if (tile.river) freshWater = true;
    if (tile.terrain === 'onelake') coastal = true;
    // Wastes next door mean an antagonist on the doorstep.
    if (tile.terrain === 'ungovernedWastes') wealth -= 4;
    if (tile.terrain !== 'onelake') kinds.add(tile.terrain);
  }

  let score = founding * FOUNDING_DATA_WEIGHT + growth * GROWTH_WEIGHT + wealth;
  if (freshWater) score += 5;
  if (coastal) score += 3;
  // Variety is what lets a city build more than one thing.
  score += kinds.size * 1.5;
  return score;
}

/** What a city founded here would actually collect on its first turn. */
export function dataAtFounding(state: GameState, hex: Hex): number {
  const city = hypothetical(state, hex);
  /*
   * ⚠️ The real tile picker, not an approximation of it. `workedTiles` is
   * subsistence aware: a hungry city values Data at triple, which is exactly
   * the behaviour that decides whether a site grows, so guessing at it here
   * would make the advice disagree with the game.
   */
  const territory = new Map<string, string>();
  for (const ring of hexSpiral(hex, CITY_WORK_RADIUS)) {
    const key = hexKey(ring);
    if (!state.map.tiles.has(key)) continue;
    if (cityAt(state, ring)) continue;
    territory.set(key, city.id);
  }

  let data = 0;
  for (const tile of workedTiles(state, city, territory)) {
    data += tileYields(tile.terrain, tile.river).data;
  }
  return data;
}

/**
 * Somewhere for this Architect to build, best first.
 *
 * Returns nothing at all for a unit that cannot found, so the caller does not
 * have to know which units are settlers.
 */
export function settleSites(
  state: GameState,
  unit: Unit,
  limit = SETTLE_SUGGESTIONS,
): SettleSite[] {
  if (unit.typeId !== 'architect') return [];

  // Asked once. The interface wants to draw "you could be there this turn"
  // differently from "that is a walk", and recomputing a Dijkstra per
  // candidate to answer it would be silly.
  const reach = reachable(state, unit);

  /*
   * ⚠️ The memory of whoever OWNS the unit, not of "the player".
   *
   * With seats, two people are choosing sites on the same board out of
   * different maps. Reading a single shared memory here would offer each of
   * them sites the other had scouted, which is the fog leaking through the
   * one screen that is meant to respect it most.
   */
  const known = memoryOf(state, unit.factionId).explored;

  const sites: SettleSite[] = [];
  for (const hex of hexSpiral(unit.hex, SETTLE_SEARCH_RADIUS)) {
    const key = hexKey(hex);
    const tile = state.map.tiles.get(key);
    if (!tile) continue;
    if (!terrain(tile.terrain).settleable) continue;
    /*
     * ⚠️ Explored only. Offering a site the player has not seen would hand
     * them the shape of the map through the back door, and the fog is there
     * on purpose.
     */
    if (!known.has(key)) continue;
    // Somebody else standing there is somebody else's tile for now.
    if (isOccupied(state, hex, unit.id)) continue;
    // The same elbow-room rule founding itself applies.
    if (canFoundCity(state, { ...unit, hex }) === false) continue;

    const data = dataAtFounding(state, hex);
    sites.push({
      hex,
      score: settleScore(state, hex, data),
      dataAtFounding: data,
      turnsToGrow: turnsToFirstCitizen(data),
      distance: hexDistance(unit.hex, hex),
      reachableNow: reach.has(key),
    });
  }

  sites.sort(
    (a, b) =>
      b.score - a.score ||
      a.distance - b.distance ||
      // Deterministic, so the same position always advises the same thing.
      hexKey(a.hex).localeCompare(hexKey(b.hex)),
  );
  return sites.slice(0, limit);
}
