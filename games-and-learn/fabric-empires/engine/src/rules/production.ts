import { hexNeighbours, type Hex } from '../hex/index.js';
import {
  isWallTarget,
  minimumTopicCount,
  unitType,
  type City,
  type ProductionTarget,
  type Unit,
  type UnitType,
  type UnitTypeId,
  UNIT_TYPE_IDS,
} from '../entities/index.js';
import { canStandOn } from './movement.js';
import { maxWallHp, wallWork } from './walls.js';
import { tileAt, unitAt, type GameState } from '../state/index.js';

/**
 * Building things.
 *
 * The last phase from the plan that had no implementation. Until now a city
 * collected resources and did nothing with them, which meant an empire could
 * lose units and never replace one: once the Silo Horde started raiding, the
 * game had no counterplay in it at all.
 *
 * ⚠️ **Production spends Compute, the same resource as research, and that is
 * the point.** Every Compute spent on a soldier is a Compute not spent on
 * learning something. In a game whose subject is studying, that is the
 * tension worth having, and it means a player who ignores the tech tree to
 * build an army wins the battle and loses the exam.
 *
 * The tech tree is also what hands out the army: `unlockedBySkill` on a unit
 * type is a 1-based index into the topic graph, so a Pipeline Runner exists
 * only once its skill is known. That field has been sitting in the unit table
 * since the beginning with nothing reading it.
 */

/**
 * The most Compute a single city may draw in one turn.
 *
 * ⚠️ Without a cap, production and research fight over the same treasury and
 * whichever is funded first takes all of it: a player who queued a unit would
 * silently stop researching, and the tech tree would look broken rather than
 * starved. The cap means both advance every turn, and a queued unit costs a
 * few turns rather than everything.
 */
export const PRODUCTION_CAP_PER_TURN = 15;

/** Flat cost every unit pays before its strength is considered. */
export const PRODUCTION_BASE_COST = 24;

export function unitCost(type: UnitType): number {
  return Math.round(PRODUCTION_BASE_COST + type.strength * 1.5);
}

/**
 * Whether the tech tree has unlocked this unit yet.
 *
 * `unlockedBySkill` is a 1-based index into the topic graph rather than a
 * topic id, because the engine must not assume anything about what a topic id
 * looks like (D35).
 *
 * ⚠️ **The index is a position on the ladder, not a count of topics.** It used
 * to be read as a literal index, which quietly made the whole unit table a
 * statement about DP-600 in particular: that curriculum has exactly 41 topics
 * and the last unit unlocks at exactly 41, so it worked, and it worked only
 * because those two numbers happened to be equal. A 24-topic curriculum could
 * never unlock anything gated above 24, so `unitUnlocked` returned false
 * forever and nothing said why.
 *
 * Scaling the ladder onto whatever length the campaign actually has removes
 * the assumption. For a graph of exactly `minimumTopicCount()` nodes the
 * arithmetic is the identity, so DP-600 is unaffected, which is the property
 * that made this safe to change at all.
 */
export function unitUnlocked(state: GameState, typeId: UnitTypeId): boolean {
  const skill = unitType(typeId).unlockedBySkill;
  if (skill === null) return true;

  const nodes = state.topics.nodes;
  if (nodes.length === 0) return false;

  const ladder = minimumTopicCount();
  /*
   * ⚠️ Multiply before dividing, or the identity case stops being the
   * identity. Written as `(skill / ladder) * nodes.length` this goes through a
   * float: 12/41 is not representable, and 12/41*41 comes back as
   * 12.000000000000002, which `ceil` turns into 13. Every unit then unlocked
   * one topic late on the campaign the arithmetic was supposed to leave alone.
   * `(skill * nodes.length) / ladder` stays exact whenever the two lengths are
   * equal, which is the case that had to keep working.
   */
  const index = ladder <= 0 ? skill : Math.ceil((skill * nodes.length) / ladder);

  const node = nodes[Math.min(nodes.length, Math.max(1, index)) - 1];
  if (!node) return false;
  return state.research.known.includes(node.id);
}

/** Every unit type this faction could currently queue. */
export function buildableUnits(state: GameState): UnitTypeId[] {
  return UNIT_TYPE_IDS.filter((id) => unitUnlocked(state, id));
}

export type ProductionResult =
  | { readonly ok: true; readonly state: GameState }
  | { readonly ok: false; readonly reason: string };

/**
 * Order a city to build something.
 *
 * Switching to a different unit keeps the progress. Half-built things are a
 * classic place to punish a player for changing their mind, and there is
 * nothing to be learned from it here.
 */
export function setProduction(
  state: GameState,
  cityId: string,
  typeId: ProductionTarget,
): ProductionResult {
  const city = state.cities.get(cityId);
  if (!city) return { ok: false, reason: 'No such city' };
  if (city.factionId !== state.activeFactionId) {
    return { ok: false, reason: 'Not your city' };
  }
  if (isWallTarget(typeId)) {
    if (wallWork(city) === undefined) {
      return { ok: false, reason: 'The walls are at their full height and undamaged' };
    }
  } else if (!unitUnlocked(state, typeId)) {
    return { ok: false, reason: `${unitType(typeId).label} has not been researched` };
  }

  const cities = new Map(state.cities);
  cities.set(cityId, { ...city, producing: typeId });
  return { ok: true, state: { ...state, cities } };
}

/** Stop building, keeping whatever Compute has already gone in. */
export function cancelProduction(state: GameState, cityId: string): ProductionResult {
  const city = state.cities.get(cityId);
  if (!city) return { ok: false, reason: 'No such city' };
  const cities = new Map(state.cities);
  const next = { ...city };
  delete (next as { producing?: ProductionTarget }).producing;
  cities.set(cityId, next);
  return { ok: true, state: { ...state, cities } };
}

/** What the city's current orders cost in total, walls included. */
export function productionCost(city: City): number {
  if (!city.producing) return 0;
  if (isWallTarget(city.producing)) {
    return wallWork(city)?.cost ?? 0;
  }
  return unitCost(unitType(city.producing));
}

/** Where a newly built unit can stand: the city itself, or beside it. */
export function musterTile(state: GameState, city: City): Hex | undefined {
  const type = (id: UnitTypeId) => unitType(id);
  const candidate = (hex: Hex): boolean => {
    const tile = tileAt(state, hex);
    if (!tile) return false;
    if (unitAt(state, hex)) return false;
    // Walls muster nothing, so fall back to the lightest footprint rather than
    // asking `unitType` about a target that is not a unit.
    const orders = city.producing;
    const id = orders && !isWallTarget(orders) ? orders : 'engineer';
    return canStandOn(type(id), tile);
  };
  if (candidate(city.hex)) return city.hex;
  return hexNeighbours(city.hex).find(candidate);
}

export interface ProductionEvent {
  readonly cityId: string;
  readonly typeId: UnitTypeId;
  readonly unitId: string;
  readonly hex: Hex;
}

/** A wall that went up this turn, for the log to mention. */
export interface WallEvent {
  readonly cityId: string;
  readonly level: number;
}

export interface ProductionTick {
  readonly state: GameState;
  readonly spent: number;
  readonly built: readonly ProductionEvent[];
  readonly walled: readonly WallEvent[];
  /** Cities that finished something but had nowhere to put it. */
  readonly blocked: readonly string[];
}

/**
 * PRODUCTION: move Compute into what each city is building, and muster what
 * is finished.
 *
 * Cities are processed in id order so a treasury that cannot fund all of them
 * funds the same ones every time.
 */
export function productionPhase(state: GameState, factionId: string): ProductionTick {
  const faction = state.factions.get(factionId);
  if (!faction) return { state, spent: 0, built: [], walled: [], blocked: [] };

  const ids = [...state.cities.keys()].sort();
  const cities = new Map(state.cities);
  const units = new Map(state.units);
  const built: ProductionEvent[] = [];
  const walled: WallEvent[] = [];
  const blocked: string[] = [];
  let purse = faction.resources.compute;
  let spent = 0;
  let nextEntityId = state.nextEntityId;

  for (const id of ids) {
    const city = cities.get(id);
    if (!city || city.factionId !== factionId || !city.producing) continue;

    const cost = productionCost(city);
    // ⚠️ A wall already at full height costs nothing and would otherwise
    // complete instantly, every turn, forever. Drop the orders instead.
    if (cost <= 0) {
      const idle = { ...city, productionProgress: 0 };
      delete (idle as { producing?: ProductionTarget }).producing;
      cities.set(id, idle);
      continue;
    }
    const remaining = cost - city.productionProgress;
    const draw = Math.max(0, Math.min(remaining, PRODUCTION_CAP_PER_TURN, purse));
    const progress = city.productionProgress + draw;
    purse -= draw;
    spent += draw;

    if (progress < cost) {
      cities.set(id, { ...city, productionProgress: progress });
      continue;
    }

    // A finished wall needs no muster tile and no room on the map. It goes up,
    // it comes back to full height, and the orders are kept so a player who
    // wants a fortress does not have to ask three times.
    if (isWallTarget(city.producing)) {
      const work = wallWork(city);
      // The cost check above already refused zero, so there is work here.
      const level = work?.kind === 'raise' ? work.level : city.wallLevel;
      const raised = {
        ...city,
        wallLevel: level,
        wallHp: maxWallHp(level),
        productionProgress: 0,
      };
      // Stop when there is nothing left to build or mend, rather than looping.
      if (wallWork(raised) === undefined) {
        delete (raised as { producing?: ProductionTarget }).producing;
      }
      cities.set(id, raised);
      walled.push({ cityId: id, level });
      continue;
    }

    const type = unitType(city.producing);

    // Finished. Find somewhere to stand before spending the progress, so a
    // hemmed-in city keeps its unit rather than losing it to a full tile.
    const working: GameState = { ...state, cities, units };
    const hex = musterTile(working, { ...city, productionProgress: progress });
    if (!hex) {
      blocked.push(id);
      cities.set(id, { ...city, productionProgress: progress });
      continue;
    }

    const unitId = `unit-${nextEntityId++}`;
    const unit: Unit = {
      id: unitId,
      typeId: city.producing,
      factionId,
      hex,
      hp: type.maxHp,
      // Mustered units stand to this turn and march the next one, which stops
      // a city from building and attacking in the same instant.
      movesLeft: 0,
      fortified: false,
    };
    units.set(unitId, unit);
    built.push({ cityId: id, typeId: city.producing, unitId, hex });

    const done = { ...city, productionProgress: 0 };
    // Keep building the same thing, which is what a player almost always
    // wants and saves a click every few turns.
    cities.set(id, done);
  }

  if (spent === 0 && built.length === 0 && walled.length === 0 && blocked.length === 0) {
    return { state, spent: 0, built: [], walled: [], blocked: [] };
  }

  const factions = new Map(state.factions);
  factions.set(factionId, {
    ...faction,
    resources: { ...faction.resources, compute: faction.resources.compute - spent },
  });

  return {
    state: { ...state, factions, cities, units, nextEntityId },
    spent,
    built,
    walled,
    blocked,
  };
}
