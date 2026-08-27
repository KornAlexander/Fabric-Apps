/**
 * Economy: territory, worked tiles, city output and empire income.
 *
 * Split the way a 4X economy usually is: Data stays local and grows the city
 * that produced it, while Compute, Capacity Units and Trust flow to the
 * empire treasury. That split is what makes founding a second city a real
 * decision rather than a strictly better version of growing the first.
 */

import { hexDistance, hexKey, hexSpiral, type Hex } from '../hex/index.js';
import { tileYields, type MapTile, type ResourceId } from '../map/index.js';
import { cityKind, isCivilian, type City, type Resources } from '../entities/index.js';
import { rankInfo } from '../entities/rank.js';
import { cityMoraleMultiplier } from './review.js';
import { tileAt, type GameState } from '../state/index.js';

/** How far a city's borders reach. */
export const CITY_WORK_RADIUS = 2;

/** Combat units this many and under cost no upkeep. */
export const FREE_UNIT_ALLOWANCE = 3;

export function addResources(a: Resources, b: Resources): Resources {
  return Object.freeze({
    data: a.data + b.data,
    compute: a.compute + b.compute,
    cu: a.cu + b.cu,
    trust: a.trust + b.trust,
  });
}

export function scaleResources(r: Resources, factor: number): Resources {
  return Object.freeze({
    data: r.data * factor,
    compute: r.compute * factor,
    cu: r.cu * factor,
    trust: r.trust * factor,
  });
}

export function floorResources(r: Resources): Resources {
  return Object.freeze({
    data: Math.floor(r.data),
    compute: Math.floor(r.compute),
    cu: Math.floor(r.cu),
    trust: Math.floor(r.trust),
  });
}

/**
 * Which city owns each tile.
 *
 * Nearest city wins, ties broken by city id so the result never depends on
 * Map iteration order. A tile is owned by at most one city, which is what
 * stops two neighbouring cities both counting the same vent.
 */
export function cityTerritory(state: GameState): Map<string, string> {
  const owner = new Map<string, string>();
  const bestDistance = new Map<string, number>();

  for (const city of [...state.cities.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    for (const hex of hexSpiral(city.hex, CITY_WORK_RADIUS)) {
      const key = hexKey(hex);
      if (!state.map.tiles.has(key)) continue;
      const distance = hexDistance(city.hex, hex);
      const current = bestDistance.get(key);
      if (current === undefined || distance < current) {
        bestDistance.set(key, distance);
        owner.set(key, city.id);
      }
    }
  }

  return owner;
}

/** Raw value of a tile, ignoring what the city currently needs. */
export function tileValue(tile: MapTile): number {
  const y = tileYields(tile.terrain, tile.river);
  return y.data * 1.0 + y.compute * 1.1 + y.cu * 1.5 + y.trust * 1.0;
}

/** Data a city needs each turn before surplus tiles are worth taking. */
export function subsistenceNeed(population: number): number {
  return population + 1;
}

/**
 * The tiles a city works: its own centre, always, plus the best `population`
 * tiles inside its borders.
 *
 * Selection is greedy but **subsistence aware**, and that qualifier is the
 * whole point. A purely value-ranked pick sends a city on food-poor terrain
 * straight for the nearest Capacity Unit vent, which is worth the most and
 * feeds nobody. Measured on seed FABRIC, that produced a capital making 1 Data
 * a turn against an 18 Data growth threshold: its first citizen arrived on
 * turn 19, and a city on pure highlands would never have grown at all.
 *
 * So until the city covers its own subsistence, Data is worth triple.
 */
export function workedTiles(
  state: GameState,
  city: City,
  territory: ReadonlyMap<string, string> = cityTerritory(state),
): MapTile[] {
  const centre = tileAt(state, city.hex);
  if (!centre) return [];

  const centreKey = hexKey(city.hex);
  const candidates: MapTile[] = [];
  for (const [key, ownerId] of territory) {
    if (ownerId !== city.id || key === centreKey) continue;
    const tile = state.map.tiles.get(key);
    if (tile) candidates.push(tile);
  }

  const chosen: MapTile[] = [centre];
  let data = tileYields(centre.terrain, centre.river).data;
  const need = subsistenceNeed(city.population);

  for (let picked = 0; picked < city.population; picked++) {
    let best: MapTile | undefined;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const tile of candidates) {
      const y = tileYields(tile.terrain, tile.river);
      const hungry = data < need;
      const score = tileValue(tile) + (hungry ? y.data * 3 : 0);
      if (
        score > bestScore ||
        (score === bestScore &&
          best !== undefined &&
          hexKey(tile.hex).localeCompare(hexKey(best.hex)) < 0)
      ) {
        best = tile;
        bestScore = score;
      }
    }

    if (!best) break;
    chosen.push(best);
    data += tileYields(best.terrain, best.river).data;
    candidates.splice(candidates.indexOf(best), 1);
  }

  return chosen;
}

/** Everything a city produces in a turn, before the local/empire split. */
export function cityOutput(
  state: GameState,
  city: City,
  territory: ReadonlyMap<string, string> = cityTerritory(state),
): Resources {
  const bias = cityKind(city.kind).yieldBias;
  let total: Resources = { data: 0, compute: 0, cu: 0, trust: 0 };

  for (const tile of workedTiles(state, city, territory)) {
    total = addResources(total, tileYields(tile.terrain, tile.river));
  }

  const biased: Record<ResourceId, number> = { ...total };
  for (const key of Object.keys(bias) as ResourceId[]) {
    biased[key] = total[key] * (bias[key] ?? 1);
  }

  // Rank and then morale, both applied here rather than at the call sites so
  // that no caller can collect a city's yields and quietly forget one of them.
  //
  // Rank is what makes revising pay in the currency the game is actually
  // played in: a Großstadt returns 45 percent more than the Siedlung it grew
  // from, and it could only have got there by retaining what was built in it.
  const rankBonus = rankInfo(city.rank).yieldBonus;
  const morale = cityMoraleMultiplier(city, state.turn);
  const multiplier = rankBonus * morale;
  if (multiplier !== 1) {
    for (const key of Object.keys(biased) as ResourceId[]) {
      biased[key] = biased[key]! * multiplier;
    }
  }

  return floorResources(biased);
}

/** Capacity Units burned every turn keeping the army in the field. */
export function unitUpkeep(state: GameState, factionId: string): number {
  let combatUnits = 0;
  for (const unit of state.units.values()) {
    if (unit.factionId !== factionId) continue;
    if (isCivilian(unit.typeId)) continue;
    combatUnits++;
  }
  return Math.max(0, combatUnits - FREE_UNIT_ALLOWANCE);
}

export interface EmpireIncome {
  /** Added to the treasury. Data is excluded: it grows cities locally. */
  readonly treasury: Resources;
  /** Per-city Data, which feeds growth. */
  readonly growth: ReadonlyMap<string, number>;
  readonly upkeep: number;
}

export function empireIncome(state: GameState, factionId: string): EmpireIncome {
  const territory = cityTerritory(state);
  const growth = new Map<string, number>();
  let treasury: Resources = { data: 0, compute: 0, cu: 0, trust: 0 };

  for (const city of state.cities.values()) {
    if (city.factionId !== factionId) continue;
    const output = cityOutput(state, city, territory);
    growth.set(city.id, output.data);
    treasury = addResources(treasury, {
      data: 0,
      compute: output.compute,
      cu: output.cu,
      trust: output.trust,
    });
  }

  const upkeep = unitUpkeep(state, factionId);
  return {
    treasury: Object.freeze({ ...treasury, cu: treasury.cu - upkeep }),
    growth,
    upkeep,
  };
}

/** Data needed for the next citizen. Rises with size, as growth should. */
export function growthThreshold(population: number): number {
  return 10 + population * 8;
}

/** Tiles a city's borders cover, for drawing and for the AI. */
export function territoryOf(state: GameState, cityId: string): Hex[] {
  const out: Hex[] = [];
  for (const [key, owner] of cityTerritory(state)) {
    if (owner !== cityId) continue;
    const tile = state.map.tiles.get(key);
    if (tile) out.push(tile.hex);
  }
  return out;
}
