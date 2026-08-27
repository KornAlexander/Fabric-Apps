/**
 * Movement rules: costs, reachability, pathfinding and zones of control.
 *
 * Pure functions over a GameState. Nothing here mutates, so the UI can call
 * `reachable` on hover to paint move ranges without any risk of touching the
 * game.
 */

import {
  hexDistance,
  hexKey,
  hexNeighbours,
  type Hex,
} from '../hex/index.js';
import { terrain, type MapTile } from '../map/index.js';
import { isCivilian, unitType, type Unit, type UnitType } from '../entities/index.js';
import { cityAt, tileAt, unitAt, type GameState } from '../state/index.js';

export const IMPASSABLE = Number.POSITIVE_INFINITY;

/** Moving along a river is fast, the way a river is a road before roads. */
export const RIVER_TRAVEL_COST = 1;

export interface ReachableTile {
  readonly hex: Hex;
  /** Movement points spent to arrive here. */
  readonly cost: number;
  /** Key of the tile stepped from, or undefined for the origin. */
  readonly from: string | undefined;
  /** True when arriving here ends movement for the turn. */
  readonly stops: boolean;
}

/**
 * Can this unit type physically stand on this terrain?
 * Domain first: land units drown, ships do not sail up mountains.
 */
export function canStandOn(type: UnitType, tile: MapTile): boolean {
  const info = terrain(tile.terrain);
  if (type.domain === 'water') return info.water;
  return !info.water && Number.isFinite(info.moveCost);
}

/** Cost to step from one tile to an adjacent one, or IMPASSABLE. */
export function stepCost(
  type: UnitType,
  from: MapTile,
  to: MapTile,
): number {
  if (!canStandOn(type, to)) return IMPASSABLE;
  if (from.river && to.river && type.domain === 'land') {
    return RIVER_TRAVEL_COST;
  }
  return terrain(to.terrain).moveCost;
}

/**
 * Is the tile blocked by another unit?
 *
 * One unit per tile. Friendly units block too, which forces real positioning
 * decisions instead of letting an entire army share a mountain pass.
 */
export function isOccupied(state: GameState, hex: Hex, movingUnitId?: string): boolean {
  const occupant = unitAt(state, hex);
  return occupant !== undefined && occupant.id !== movingUnitId;
}

/**
 * Tiles projected by enemy combat units: the tiles they stand on and every
 * neighbour. Civilians project nothing, since a lone settler should not pin
 * an army in place.
 */
export function enemyZoneOfControl(
  state: GameState,
  factionId: string,
): Set<string> {
  const zone = new Set<string>();
  for (const unit of state.units.values()) {
    if (unit.factionId === factionId) continue;
    if (isCivilian(unit.typeId)) continue;
    zone.add(hexKey(unit.hex));
    for (const n of hexNeighbours(unit.hex)) zone.add(hexKey(n));
  }
  return zone;
}

export interface ReachOptions {
  /** Override the unit's remaining movement, for previewing a full turn. */
  readonly budget?: number;
}

/**
 * Every tile the unit can reach this turn, by Dijkstra over movement points.
 *
 * Two rules that make this more than a flood fill:
 *
 * 1. Minimum move. A unit with any movement left may always enter an adjacent
 *    tile, paying at most what it has. Without this, slow units can never
 *    cross a swamp and simply get stuck.
 * 2. Zones of control. Entering a tile next to an enemy consumes the rest of
 *    the turn, so armies cannot stroll past each other's lines. The tile the
 *    unit starts on is exempt: a unit that begins its turn beside an enemy is
 *    pinned, not paralysed, and can still withdraw.
 */
export function reachable(
  state: GameState,
  unit: Unit,
  options: ReachOptions = {},
): Map<string, ReachableTile> {
  const type = unitType(unit.typeId);
  const budget = options.budget ?? unit.movesLeft;
  const originTile = tileAt(state, unit.hex);

  const result = new Map<string, ReachableTile>();
  if (!originTile) return result;

  const originKey = hexKey(unit.hex);
  result.set(originKey, {
    hex: unit.hex,
    cost: 0,
    from: undefined,
    stops: false,
  });
  if (budget <= 0) return result;

  const zone = type.ignoresZoneOfControl
    ? new Set<string>()
    : enemyZoneOfControl(state, unit.factionId);

  // Frontier is tiny (movement budgets are single digits), so a linear scan
  // for the minimum is cheaper than maintaining a heap.
  const frontier: string[] = [originKey];

  while (frontier.length > 0) {
    let bestIndex = 0;
    for (let i = 1; i < frontier.length; i++) {
      if (result.get(frontier[i]!)!.cost < result.get(frontier[bestIndex]!)!.cost) {
        bestIndex = i;
      }
    }
    const currentKey = frontier.splice(bestIndex, 1)[0]!;
    const current = result.get(currentKey)!;
    if (current.stops) continue;

    const currentTile = tileAt(state, current.hex)!;
    const remaining = budget - current.cost;
    if (remaining <= 0) continue;

    for (const next of hexNeighbours(current.hex)) {
      const nextKey = hexKey(next);
      const nextTile = tileAt(state, next);
      if (!nextTile) continue;
      if (isOccupied(state, next, unit.id)) continue;

      const raw = stepCost(type, currentTile, nextTile);
      if (!Number.isFinite(raw)) continue;

      // Minimum move: never cost more than what is left.
      const spent = Math.min(raw, remaining);
      const cost = current.cost + spent;
      const stops = zone.has(nextKey);

      const existing = result.get(nextKey);
      if (existing && existing.cost <= cost) continue;

      result.set(nextKey, { hex: next, cost, from: currentKey, stops });
      if (!stops) frontier.push(nextKey);
    }
  }

  return result;
}

/** Walk the predecessor links back from a reachable tile. */
export function pathTo(
  reach: ReadonlyMap<string, ReachableTile>,
  target: Hex,
): Hex[] | undefined {
  const targetKey = hexKey(target);
  if (!reach.has(targetKey)) return undefined;

  const path: Hex[] = [];
  let cursor: string | undefined = targetKey;
  const guard = new Set<string>();
  while (cursor !== undefined) {
    if (guard.has(cursor)) return undefined; // corrupt links, refuse to loop
    guard.add(cursor);
    const node: ReachableTile = reach.get(cursor)!;
    path.push(node.hex);
    cursor = node.from;
  }
  return path.reverse();
}

export interface PlannedPath {
  readonly path: Hex[];
  readonly cost: number;
}

/**
 * A path to an arbitrary destination, ignoring this turn's movement budget.
 *
 * Used for multi-turn orders: the unit walks it a few tiles per turn. Zones of
 * control are ignored here because they change the timing of a journey, not
 * whether it is possible.
 */
export function findPath(
  state: GameState,
  unit: Unit,
  target: Hex,
): PlannedPath | undefined {
  const type = unitType(unit.typeId);
  const startKey = hexKey(unit.hex);
  const targetKey = hexKey(target);
  if (startKey === targetKey) return { path: [unit.hex], cost: 0 };

  const targetTile = tileAt(state, target);
  if (!targetTile || !canStandOn(type, targetTile)) return undefined;

  const cameFrom = new Map<string, string>();
  const bestCost = new Map<string, number>([[startKey, 0]]);
  const open: { key: string; hex: Hex; estimate: number }[] = [
    { key: startKey, hex: unit.hex, estimate: hexDistance(unit.hex, target) },
  ];

  while (open.length > 0) {
    let bestIndex = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i]!.estimate < open[bestIndex]!.estimate) bestIndex = i;
    }
    const current = open.splice(bestIndex, 1)[0]!;
    if (current.key === targetKey) break;

    const currentTile = tileAt(state, current.hex)!;
    const currentCost = bestCost.get(current.key)!;

    for (const next of hexNeighbours(current.hex)) {
      const nextKey = hexKey(next);
      const nextTile = tileAt(state, next);
      if (!nextTile) continue;
      // The destination may be occupied by the thing we are marching at.
      if (nextKey !== targetKey && isOccupied(state, next, unit.id)) continue;

      const step = stepCost(type, currentTile, nextTile);
      if (!Number.isFinite(step)) continue;

      const cost = currentCost + step;
      const known = bestCost.get(nextKey);
      if (known !== undefined && known <= cost) continue;

      bestCost.set(nextKey, cost);
      cameFrom.set(nextKey, current.key);
      // Terrain never costs less than 1, so plain hex distance never
      // overestimates and A* stays admissible.
      open.push({ key: nextKey, hex: next, estimate: cost + hexDistance(next, target) });
    }
  }

  if (!bestCost.has(targetKey)) return undefined;

  const path: Hex[] = [];
  let cursor: string | undefined = targetKey;
  const seen = new Set<string>();
  while (cursor !== undefined) {
    if (seen.has(cursor)) return undefined;
    seen.add(cursor);
    const tile = state.map.tiles.get(cursor)!;
    path.push(tile.hex);
    cursor = cameFrom.get(cursor);
  }

  return { path: path.reverse(), cost: bestCost.get(targetKey)! };
}

/** Whether a unit may found a city where it stands. */
export function canFoundCity(state: GameState, unit: Unit): boolean {
  if (unit.typeId !== 'architect') return false;
  const tile = tileAt(state, unit.hex);
  if (!tile || !terrain(tile.terrain).settleable) return false;
  if (cityAt(state, unit.hex)) return false;
  // Cities need elbow room, or the map turns into one continuous city.
  for (const city of state.cities.values()) {
    if (hexDistance(city.hex, unit.hex) < 3) return false;
  }
  return true;
}
