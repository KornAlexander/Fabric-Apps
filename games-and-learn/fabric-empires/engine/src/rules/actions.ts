/**
 * Player actions.
 *
 * Every action takes a state and returns either a new state or a refusal with
 * a reason. Nothing throws for an illegal move: the UI needs to know why a
 * button is disabled, and "why not" is part of teaching the rules.
 */

import { hexKey, type Hex } from '../hex/index.js';
import { terrain } from '../map/index.js';
import { cityKind, unitType, type City, type CityKind, type Unit } from '../entities/index.js';
import { FIRST_RANK } from '../entities/rank.js';
import { tileAt, unitAt, type GameState } from '../state/index.js';
import { canFoundCity, pathTo, reachable } from './movement.js';
import { rememberAlong, rememberVisible } from './vision.js';

export type ActionResult =
  | {
      readonly ok: true;
      readonly state: GameState;
      /**
       * The hexes walked, in order, NOT including where the unit started.
       *
       * Only movement sets this. It exists so the view can follow the same
       * route the rules did: the fog is folded in one hex at a time here, and
       * a presentation that jumped straight to the destination would uncover
       * the whole corridor at once.
       */
      readonly path?: readonly Hex[];
    }
  | { readonly ok: false; readonly reason: string };

function fail(reason: string): ActionResult {
  return { ok: false, reason };
}

function replaceUnit(state: GameState, unit: Unit): GameState {
  const units = new Map(state.units);
  units.set(unit.id, unit);
  return { ...state, units };
}

/**
 * Move a unit to a tile it can reach this turn.
 *
 * Movement is resolved through `reachable`, so every rule that constrains
 * reachability (terrain, occupancy, zones of control, the minimum-move rule)
 * automatically constrains movement too. There is no second implementation to
 * drift out of step with the first.
 */
export function moveUnit(
  state: GameState,
  unitId: string,
  target: Hex,
): ActionResult {
  const unit = state.units.get(unitId);
  if (!unit) return fail('No such unit');
  if (unit.factionId !== state.activeFactionId) return fail('Not your unit');
  if (unit.movesLeft <= 0) return fail('This unit has already moved');

  const targetKey = hexKey(target);
  if (targetKey === hexKey(unit.hex)) return fail('Already there');
  if (!state.map.tiles.has(targetKey)) return fail('Off the map');

  const reach = reachable(state, unit);
  const destination = reach.get(targetKey);
  if (!destination) return fail('Out of range this turn');

  const path = pathTo(reach, target);
  if (!path) return fail('No route');

  // Stepping into a zone of control ends the turn for this unit, whatever it
  // had left. That is the whole point of a zone of control.
  const movesLeft = destination.stops ? 0 : unit.movesLeft - destination.cost;

  /*
   * Reveal as you go, not at the end of the turn, and not at the destination
   * either.
   *
   * ⚠️ **This used to fold sight ONCE, after the unit had already arrived**,
   * directly under a comment claiming it did otherwise. A scout that walks six
   * hexes then lit up only what it could see from the far end: the ground it
   * had actually walked past stayed dark unless it happened to fall inside the
   * destination's sight radius, which on a six-hex march it mostly does not.
   *
   * `pathTo` includes the starting hex, whose sight is already folded in, so
   * the walk begins at index 1.
   */
  const walked = path.slice(1);
  const carried = rememberAlong(state, walked, unitType(unit.typeId).sight, unit.factionId);

  const moved = replaceUnit(carried, {
    ...unit,
    hex: target,
    movesLeft: Math.max(0, movesLeft),
    fortified: false,
  });

  return { ok: true, state: rememberVisible(moved, unit.factionId), path: walked };
}

/** Terrain decides what kind of settlement an Architect can raise. */
export function cityKindFor(state: GameState, hex: Hex): CityKind {
  const tile = tileAt(state, hex);
  if (!tile) return 'lakehouse';
  if (tile.terrain === 'deltaHighlands' || tile.terrain === 'parquetQuarry') {
    return 'warehouse';
  }
  if (tile.river) return 'eventhouse';
  return 'lakehouse';
}

export interface FoundCityOptions {
  readonly name?: string;
}

export function foundCity(
  state: GameState,
  unitId: string,
  options: FoundCityOptions = {},
): ActionResult {
  const unit = state.units.get(unitId);
  if (!unit) return fail('No such unit');
  if (unit.factionId !== state.activeFactionId) return fail('Not your unit');
  if (unit.typeId !== 'architect') return fail('Only an Architect can found a city');

  const tile = tileAt(state, unit.hex);
  if (!tile) return fail('Off the map');
  if (!terrain(tile.terrain).settleable) {
    return fail(`Cannot settle on ${terrain(tile.terrain).label}`);
  }
  if (!canFoundCity(state, unit)) return fail('Too close to another city');

  const isFirst = [...state.cities.values()].every(
    (c) => c.factionId !== unit.factionId,
  );
  // The first city of an empire is always the Workspace, which is the joke
  // and also correct: everything in Fabric starts in a workspace.
  const kind: CityKind = isFirst ? 'workspace' : cityKindFor(state, unit.hex);

  const id = `city-${state.nextEntityId}`;
  const city: City = {
    id,
    factionId: unit.factionId,
    hex: unit.hex,
    name: options.name ?? cityKind(kind).label,
    kind,
    hp: cityKind(kind).baseHp,
    wallLevel: 0,
    wallHp: 0,
    population: 1,
    rank: FIRST_RANK,
    growthStore: 0,
    boundSkills: [],
    unrest: 0,
    ignoredReviews: 0,
    reviewBonusUntilTurn: 0,
    lastReviewTurn: -1,
    productionProgress: 0,
    lastRaidedTurn: -1,
  };

  const cities = new Map(state.cities);
  cities.set(id, city);
  const units = new Map(state.units);
  units.delete(unit.id); // the Architect becomes the city

  return {
    ok: true,
    state: { ...state, cities, units, nextEntityId: state.nextEntityId + 1 },
  };
}

/** Dig in: trade movement for defence until the unit is ordered elsewhere. */
export function fortifyUnit(state: GameState, unitId: string): ActionResult {
  const unit = state.units.get(unitId);
  if (!unit) return fail('No such unit');
  if (unit.factionId !== state.activeFactionId) return fail('Not your unit');
  if (unitType(unit.typeId).strength === 0) return fail('Civilians cannot fortify');
  if (unit.fortified) return fail('Already fortified');

  return {
    ok: true,
    state: replaceUnit(state, { ...unit, fortified: true, movesLeft: 0 }),
  };
}

/**
 * Stand down, without going anywhere.
 *
 * Ordering a fortified unit to move already wakes it (`moveUnit` clears the
 * flag), which is the usual way out and the one every 4X player tries first.
 * This is for the other case: staying exactly where you are but giving up the
 * dug-in bonus, usually because you are about to attack out of the position
 * rather than hold it.
 *
 * ⚠️ **It does not refund the turn spent digging in.** Fortifying costs the
 * rest of that turn, so waking on the same turn leaves the unit with the zero
 * movement it just spent. Refunding it would make fortify-then-wake a free way
 * to reset a unit that had already walked.
 */
export function wakeUnit(state: GameState, unitId: string): ActionResult {
  const unit = state.units.get(unitId);
  if (!unit) return fail('No such unit');
  if (unit.factionId !== state.activeFactionId) return fail('Not your unit');
  if (!unit.fortified) return fail('Not fortified');

  return { ok: true, state: replaceUnit(state, { ...unit, fortified: false }) };
}

/** Spend the rest of a unit's turn without moving it. */
export function skipUnit(state: GameState, unitId: string): ActionResult {
  const unit = state.units.get(unitId);
  if (!unit) return fail('No such unit');
  if (unit.factionId !== state.activeFactionId) return fail('Not your unit');
  return { ok: true, state: replaceUnit(state, { ...unit, movesLeft: 0 }) };
}

/** Units that still have something to do, so the UI can nag before ending a turn. */
export function idleUnits(state: GameState, factionId: string): Unit[] {
  return [...state.units.values()].filter(
    (u) => u.factionId === factionId && u.movesLeft > 0 && !u.fortified,
  );
}

/** Convenience for the UI: is there a unit here belonging to the active player? */
export function selectableUnitAt(state: GameState, hex: Hex): Unit | undefined {
  const unit = unitAt(state, hex);
  if (!unit || unit.factionId !== state.activeFactionId) return undefined;
  return unit;
}
