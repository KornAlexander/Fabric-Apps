/**
 * Marching orders: "go there", over as many turns as it takes.
 *
 * ⚠️ **`findPath` has always said it existed for this.** Its own comment reads
 * "used for multi-turn orders: the unit walks it a few tiles per turn", and
 * until now nothing did. The only caller was the AI, which recomputed a route
 * every turn because it had nowhere to keep one.
 *
 * A player did not even have that. Sending a Profiler across the map meant
 * clicking the furthest lit hex, ending the turn, finding the unit, clicking
 * again, and repeating for six turns, and the unit that most wants to make that
 * journey is the scout, whose entire job is to be somewhere else.
 *
 * ## The two rules this module has to borrow rather than restate
 *
 * ⚠️ **Step costs come from `stepCost`, and the budget follows the same
 * "minimum move" rule `reachable` uses**: a unit with any movement left can
 * always take one more step, however expensive the ground. Writing a second
 * cost model here is how the line drawn on the map stops agreeing with where
 * the unit actually ends up, and the drawing is the whole feature.
 */

import { hexKey, type Hex } from '../hex/index.js';
import { unitType, type Unit } from '../entities/index.js';
import { tileAt, unitAt, type GameState } from '../state/index.js';
import { moveUnit } from './actions.js';
import { findPath, stepCost } from './movement.js';
import { sightOf } from './vision.js';

/** A standing order to walk somewhere, carried on the unit. */
export interface MarchOrder {
  readonly target: Hex;
}

/**
 * One turn's worth of the journey.
 *
 * `hexes` is what is walked during that turn and `at` is where the unit stands
 * when it stops, which is the tile the interface writes the number on.
 *
 * ⚠️ A leg CAN be empty, and that is not a bug worth removing. A unit that has
 * already spent its movement marches nowhere this turn, so the first leg is
 * empty and the first real position is two turns away. Collapsing that would
 * label the arrival "1" and be wrong by a turn.
 */
export interface MarchLeg {
  readonly hexes: readonly Hex[];
  readonly at: Hex;
}

/**
 * Split a route into per-turn legs.
 *
 * This is what the map draws: the dotted line is every hex of the path, and the
 * numbers sit on `at` for each leg.
 */
export function marchLegs(state: GameState, unit: Unit, path: readonly Hex[]): MarchLeg[] {
  const type = unitType(unit.typeId);
  const perTurn = Math.max(1, type.movement);

  const legs: MarchLeg[] = [];
  let budget = unit.movesLeft;
  let hexes: Hex[] = [];
  let at = unit.hex;

  for (let i = 1; i < path.length; i += 1) {
    if (budget <= 0) {
      legs.push({ hexes, at });
      hexes = [];
      budget = perTurn;
    }
    const from = tileAt(state, path[i - 1]!);
    const to = tileAt(state, path[i]!);
    if (!from || !to) break;
    const raw = stepCost(type, from, to);
    if (!Number.isFinite(raw)) break;

    // ⚠️ The same minimum-move rule `reachable` applies, or the preview would
    // promise a shorter journey than the unit can actually make.
    budget -= Math.min(raw, budget);
    hexes.push(path[i]!);
    at = path[i]!;
  }

  if (hexes.length > 0 || legs.length === 0) legs.push({ hexes, at });
  return legs;
}

/** The route a unit would take, and how it breaks into turns. Undefined if it cannot get there. */
export function planMarch(
  state: GameState,
  unit: Unit,
  target: Hex,
): { path: Hex[]; legs: MarchLeg[] } | undefined {
  if (hexKey(unit.hex) === hexKey(target)) return undefined;
  const planned = findPath(state, unit, target);
  if (!planned || planned.path.length < 2) return undefined;
  return { path: planned.path, legs: marchLegs(state, unit, planned.path) };
}

/** Give a unit somewhere to be. Returns the state unchanged if it cannot get there. */
export function setMarch(state: GameState, unitId: string, target: Hex): GameState {
  const unit = state.units.get(unitId);
  if (!unit) return state;
  if (!planMarch(state, unit, target)) return state;
  const units = new Map(state.units);
  units.set(unitId, { ...unit, order: { target } });
  return { ...state, units };
}

/** Forget it. Used on arrival, on interruption, and whenever the player takes over. */
export function clearMarch(state: GameState, unitId: string): GameState {
  const unit = state.units.get(unitId);
  if (!unit?.order) return state;
  const { order, ...rest } = unit;
  void order;
  const units = new Map(state.units);
  units.set(unitId, rest);
  return { ...state, units };
}

/**
 * Everything hostile this faction can see right now, by id.
 *
 * ⚠️ Units AND cities. Cresting a ridge and finding a walled town is exactly
 * the kind of thing a march should stop for, and it is the more valuable of
 * the two discoveries.
 */
export function hostilesInSight(state: GameState, factionId: string): Set<string> {
  const sight = sightOf(state, factionId);
  const found = new Set<string>();
  for (const other of state.units.values()) {
    if (other.factionId === factionId) continue;
    if (sight.has(hexKey(other.hex))) found.add(other.id);
  }
  for (const city of state.cities.values()) {
    if (city.factionId === factionId) continue;
    if (sight.has(hexKey(city.hex))) found.add(city.id);
  }
  return found;
}

export type MarchStop = 'arrived' | 'spotted' | 'blocked' | 'out-of-moves';

export interface MarchResult {
  readonly state: GameState;
  readonly stop: MarchStop;
  /** Where the thing that interrupted the march is, when one did. */
  readonly spotted?: Hex;
  /**
   * Every hex the unit actually stood on this turn, starting where it began.
   *
   * ⚠️ **Reported because a march is a move, and moves have consequences the
   * engine does not own.** A hand-driven move already hands its route to the
   * app, which is what lets a Profiler dig up a chest it walked over. A march
   * reported only its start and end, so anything buried in between was walked
   * straight past: the unit crossed the tile, the fog opened, and nothing
   * happened. From the outside that reads as the chest being broken rather
   * than as the march never having mentioned it.
   */
  readonly walked: readonly Hex[];
}

/**
 * Walk this turn's share of the journey.
 *
 * ⚠️ **One hex at a time, through `moveUnit`, rather than one jump to the end
 * of the leg.** Three things depend on it: the fog opens along the route, the
 * memory records towns passed en route, and the march can be stopped in the
 * middle of a turn by something the unit has just seen. A single call to the
 * leg's end would get the first two right and the third wrong, which is the
 * one that matters here.
 *
 * ⚠️ **A newly seen enemy stops the march, and a familiar one does not.** The
 * test is the set of hostile ids in sight before and after the step, not
 * whether any are visible: a scout walking along a border it has been watching
 * for ten turns would otherwise refuse to move at all.
 */
export function advanceMarch(state: GameState, unitId: string): MarchResult {
  let current = state;
  const start = current.units.get(unitId);
  if (!start?.order) return { state, stop: 'arrived', walked: [] };

  // Starts where the unit stands, so the route is continuous even when the
  // march manages no steps at all this turn.
  const walked: Hex[] = [start.hex];
  let known = hostilesInSight(current, start.factionId);

  for (;;) {
    const unit = current.units.get(unitId);
    if (!unit?.order) return { state: current, stop: 'arrived', walked };
    if (hexKey(unit.hex) === hexKey(unit.order.target)) {
      return { state: clearMarch(current, unitId), stop: 'arrived', walked };
    }
    if (unit.movesLeft <= 0) return { state: current, stop: 'out-of-moves', walked };

    const plan = planMarch(current, unit, unit.order.target);
    if (!plan) return { state: clearMarch(current, unitId), stop: 'blocked', walked };
    const next = plan.path[1];
    if (!next) return { state: clearMarch(current, unitId), stop: 'blocked', walked };

    /*
     * ⚠️ Somebody standing in the way ends the march rather than routing round
     * them. `findPath` already avoids occupied ground, so reaching this means
     * the only way through is blocked, and quietly taking a ten hex detour is
     * not what the player drew a line for.
     */
    if (unitAt(current, next)) return { state: clearMarch(current, unitId), stop: 'blocked', walked };

    const moved = moveUnit(current, unitId, next);
    if (!moved.ok) return { state: clearMarch(current, unitId), stop: 'blocked', walked };
    current = moved.state;

    const after = current.units.get(unitId);
    if (!after) return { state: current, stop: 'blocked', walked };
    walked.push(after.hex);

    const seen = hostilesInSight(current, after.factionId);
    for (const id of seen) {
      if (known.has(id)) continue;
      const where = current.units.get(id)?.hex ?? current.cities.get(id)?.hex;
      return {
        state: clearMarch(current, unitId),
        stop: 'spotted',
        walked,
        ...(where ? { spotted: where } : {}),
      };
    }
    known = seen;

    if (hexKey(after.hex) === hexKey(after.order?.target ?? after.hex)) {
      return { state: clearMarch(current, unitId), stop: 'arrived', walked };
    }
  }
}

export interface MarchReport {
  readonly unitId: string;
  readonly stop: MarchStop;
  readonly from: Hex;
  readonly to: Hex;
  readonly spotted?: Hex;
  /** The route walked this turn. See {@link MarchResult.walked}. */
  readonly walked: readonly Hex[];
}

/**
 * Move every unit of one faction that has somewhere to be.
 *
 * ⚠️ **Sorted by id, so the order is the same on every machine and after every
 * reload.** Units block each other, so which one walks first decides who gets
 * the pass, and map iteration order is not something to leave a rule depending
 * on when the same seed is meant to replay the same way (D39).
 *
 * Reports rather than logs: the engine has never known what a sentence is, and
 * the app needs to say something different for "arrived" than for "stopped
 * because there is a Silo Horde raider over that hill".
 */
export function advanceMarches(
  state: GameState,
  factionId: string,
): { state: GameState; reports: MarchReport[] } {
  const marching = [...state.units.values()]
    .filter((u) => u.factionId === factionId && u.order)
    .map((u) => u.id)
    .sort();

  let current = state;
  const reports: MarchReport[] = [];
  for (const id of marching) {
    const before = current.units.get(id);
    if (!before) continue;
    const result = advanceMarch(current, id);
    current = result.state;
    const after = current.units.get(id);
    if (!after) continue;
    // Nothing to report for a unit that simply had no movement left.
    if (result.stop === 'out-of-moves' && hexKey(after.hex) === hexKey(before.hex)) continue;
    reports.push({
      unitId: id,
      stop: result.stop,
      from: before.hex,
      to: after.hex,
      walked: result.walked,
      ...(result.spotted ? { spotted: result.spotted } : {}),
    });
  }
  return { state: current, reports };
}
