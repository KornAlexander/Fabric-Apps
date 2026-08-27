/**
 * Sacking: what you may do to somebody else's city besides taking it.
 *
 * Capture was already written and already worked, but nothing on the map could
 * be captured, so the whole branch was unreachable. Now that every antagonist
 * holds a village, the interesting question is not whether you can take one but
 * whether you should. Three answers, and they trade against each other:
 *
 *   - **Capture** keeps the village and, more importantly, the cluster. It is
 *     slow, because you have to break the walls with a melee unit, and it hands
 *     you a city full of somebody else's ideas that you now have to hold.
 *   - **Raze** destroys it for a large one-off haul. Fast, final, and it throws
 *     away the cluster you would have learned. It leaves a ruin.
 *   - **Raid** takes a small haul without breaking anything. Repeatable, but on
 *     a cooldown, and it leaves the village standing to raid you back.
 *
 * ⚠️ **The point of the choice is the curriculum, not the loot.** Each faction
 * quizzes on its own cluster (see `ANTAGONISTS`). Capturing is the only one of
 * the three that opens that cluster to you, so a player who razes everything
 * ends the game rich, undefeated and narrow, which is exactly the failure mode
 * a DP-600 candidate has in real life. Razing is deliberately the tempting one.
 */

import { hexDistance, type Hex } from '../hex/index.js';
import type { Ruin } from '../entities/index.js';
import { cityAt, type GameState } from '../state/gameState.js';
import { isCivilian, unitType } from '../entities/index.js';
import { bindTopicToCity } from './review.js';
import type { ResourceId } from '../map/index.js';

/**
 * Turns before the same city may be raided again.
 *
 * Without a cooldown a unit parked next to a village is an income stream, and
 * the dominant strategy becomes standing still, which is the one behaviour the
 * whole game is trying to punish.
 */
export const RAID_COOLDOWN_TURNS = 4;

/** Share of a city's stock a raid carries off. */
export const RAID_TAKE = 0.12;

/** Share a razing carries off. Much larger, because it is the last time. */
export const RAZE_TAKE = 0.55;

/** Damage a raid does to the village it robs. */
export const RAID_DAMAGE = 12;

export interface SackResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly state?: GameState;
  readonly loot?: Partial<Record<ResourceId, number>>;
}

const fail = (reason: string): SackResult => ({ ok: false, reason });

/**
 * What a city is worth to whoever takes it.
 *
 * Scaled by population so a grown city is a real prize and a size-one hamlet is
 * not worth a detour. Deliberately not scaled by the victim's treasury: the
 * antagonists do not run an economy the player can inspect, and loot that
 * depended on an invisible number would look random.
 */
export function sackLoot(
  population: number,
  share: number,
): Record<ResourceId, number> {
  const base = 40 * population;
  return {
    data: Math.round(base * share),
    compute: Math.round(base * share * 0.75),
    cu: Math.round(base * share * 0.5),
    trust: 0,
  };
}

function award(
  state: GameState,
  factionId: string,
  loot: Record<ResourceId, number>,
): GameState {
  const faction = state.factions.get(factionId);
  if (!faction) return state;
  const factions = new Map(state.factions);
  factions.set(factionId, {
    ...faction,
    resources: {
      data: faction.resources.data + loot.data,
      compute: faction.resources.compute + loot.compute,
      cu: faction.resources.cu + loot.cu,
      trust: faction.resources.trust + loot.trust,
    },
  });
  return { ...state, factions };
}

export interface RaidCheck {
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * Whether this unit may raid the city on that hex right now.
 *
 * Melee only, and adjacency only. A ranged unit bombarding a village from three
 * hexes away is not carrying anything home, and letting it would make ranged
 * units strictly better at everything.
 */
export function canRaid(
  state: GameState,
  unitId: string,
  target: Hex,
): RaidCheck {
  const unit = state.units.get(unitId);
  if (!unit) return { ok: false, reason: 'No such unit' };
  if (unit.factionId !== state.activeFactionId) {
    return { ok: false, reason: 'Not your unit' };
  }
  if (unit.movesLeft <= 0) return { ok: false, reason: 'No moves left' };

  const type = unitType(unit.typeId);
  if (isCivilian(unit.typeId)) {
    return { ok: false, reason: 'Civilians do not raid' };
  }
  if (type.range > 0) {
    return { ok: false, reason: 'A ranged unit cannot carry off plunder' };
  }

  const city = cityAt(state, target);
  if (!city) return { ok: false, reason: 'No settlement there' };
  if (city.factionId === unit.factionId) {
    return { ok: false, reason: 'That is your own city' };
  }
  if (hexDistance(unit.hex, target) > 1) {
    return { ok: false, reason: 'Must be adjacent to raid' };
  }
  if (
    city.lastRaidedTurn >= 0 &&
    state.turn - city.lastRaidedTurn < RAID_COOLDOWN_TURNS
  ) {
    const wait = RAID_COOLDOWN_TURNS - (state.turn - city.lastRaidedTurn);
    return { ok: false, reason: `Already stripped, ${wait} turn(s) to recover` };
  }
  return { ok: true };
}

/**
 * Rob a city without taking it.
 *
 * The village survives, loses a little health and goes on a cooldown. The unit
 * spends its turn, which is the real cost: a raiding unit is not besieging.
 */
export function raidCity(
  state: GameState,
  unitId: string,
  target: Hex,
): SackResult {
  const check = canRaid(state, unitId, target);
  if (!check.ok) return fail(check.reason ?? 'Cannot raid');

  const unit = state.units.get(unitId)!;
  const city = cityAt(state, target)!;

  const loot = sackLoot(city.population, RAID_TAKE);

  const cities = new Map(state.cities);
  cities.set(city.id, {
    ...city,
    hp: Math.max(1, city.hp - RAID_DAMAGE),
    lastRaidedTurn: state.turn,
    // Being robbed is exactly the sort of thing that unsettles a place.
    unrest: city.unrest + 1,
  });

  const units = new Map(state.units);
  units.set(unit.id, { ...unit, movesLeft: 0, fortified: false });

  return {
    ok: true,
    state: award({ ...state, cities, units }, unit.factionId, loot),
    loot,
  };
}

/**
 * Burn a city to the ground.
 *
 * Only legal once the walls are down, which is the same condition capture
 * needs, so razing is a decision made at the moment of victory rather than an
 * alternative way to win the fight.
 */
export function canRaze(
  state: GameState,
  unitId: string,
  target: Hex,
): RaidCheck {
  const unit = state.units.get(unitId);
  if (!unit) return { ok: false, reason: 'No such unit' };
  if (unit.factionId !== state.activeFactionId) {
    return { ok: false, reason: 'Not your unit' };
  }
  const city = cityAt(state, target);
  if (!city) return { ok: false, reason: 'No settlement there' };
  if (city.factionId === unit.factionId) {
    return { ok: false, reason: 'That is your own city' };
  }
  if (hexDistance(unit.hex, target) > 1) {
    return { ok: false, reason: 'Must be adjacent to raze' };
  }
  return { ok: true };
}

/**
 * Remove a city and leave a ruin.
 *
 * Shared by the raze action and by `attack` when the killing blow is ordered
 * with `cityOutcome: 'raze'`, so there is exactly one description of what
 * burning a place down does.
 */
export function razeCityAt(
  state: GameState,
  cityId: string,
  toFactionId: string,
): { state: GameState; loot: Record<ResourceId, number>; ruin: Ruin } {
  const city = state.cities.get(cityId)!;
  const loot = sackLoot(city.population, RAZE_TAKE);

  const cities = new Map(state.cities);
  cities.delete(cityId);

  const ruin: Ruin = {
    id: `ruin-${state.nextEntityId}`,
    hex: city.hex,
    name: city.name,
    formerFactionId: city.factionId,
    razedOnTurn: state.turn,
  };
  const ruins = new Map(state.ruins);
  ruins.set(ruin.id, ruin);

  const next: GameState = {
    ...state,
    cities,
    ruins,
    nextEntityId: state.nextEntityId + 1,
  };

  return { state: award(next, toFactionId, loot), loot, ruin };
}

/**
 * Open a foothold in a cluster the player has just conquered.
 *
 * Grants the cheapest topic in that cluster whose prerequisites the player
 * already holds, and binds it to a city so the review system owns it like any
 * other learned topic. Returns the state unchanged when the cluster is already
 * exhausted or still gated, which is a real outcome rather than an error: you
 * can take a village and learn nothing from it if you were not ready to.
 *
 * ⚠️ **Prerequisites are respected.** Granting a node whose `requires` are
 * unmet would put the tech tree in a state the research rules can never
 * produce, and every downstream readiness number would then be describing a
 * tree that could not exist.
 */
export function grantFoothold(
  state: GameState,
  cluster: string,
): { state: GameState; topicId?: string } {
  if (!cluster) return { state };

  const known = new Set(state.research.known);
  const candidate = state.topics.nodes
    .filter(
      (node) =>
        node.cluster === cluster &&
        !known.has(node.id) &&
        node.requires.every((req) => known.has(req)),
    )
    .sort((a, b) => a.weight - b.weight || a.id.localeCompare(b.id))[0];

  if (!candidate) return { state };

  const withTopic: GameState = {
    ...state,
    research: {
      ...state.research,
      known: [...state.research.known, candidate.id],
    },
  };

  return { state: bindTopicToCity(withTopic, candidate.id), topicId: candidate.id };
}
