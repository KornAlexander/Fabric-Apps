/**
 * Terrain definitions.
 *
 * The table is the single source of truth for yields, movement and
 * passability. Nothing else in the engine should hard-code a terrain's
 * numbers, so balance changes happen in exactly one place.
 *
 * Terrain names are game fiction that map onto real concepts, which is the
 * whole point of the project: a player learns that Delta stores sit above raw
 * files by walking uphill from the plains into the highlands.
 */

export type ResourceId = 'data' | 'compute' | 'cu' | 'trust';

export const RESOURCE_IDS: readonly ResourceId[] = Object.freeze([
  'data',
  'compute',
  'cu',
  'trust',
]);

export type Yields = Readonly<Record<ResourceId, number>>;

export type TerrainId =
  | 'onelake'
  | 'rawFilePlains'
  | 'deltaHighlands'
  | 'parquetQuarry'
  | 'legacySwamp'
  | 'semanticPeaks'
  | 'geothermalVent'
  | 'ungovernedWastes';

export interface Terrain {
  readonly id: TerrainId;
  readonly label: string;
  readonly yields: Yields;
  /** Movement points to enter. Infinity means impassable to land units. */
  readonly moveCost: number;
  /** Water tiles need naval movement. */
  readonly water: boolean;
  /** Defence multiplier applied to a unit standing here. */
  readonly defenceBonus: number;
  /** Whether a city may be founded here. */
  readonly settleable: boolean;
}

function yields(data = 0, compute = 0, cu = 0, trust = 0): Yields {
  return Object.freeze({ data, compute, cu, trust });
}

export const TERRAINS: Readonly<Record<TerrainId, Terrain>> = Object.freeze({
  onelake: {
    id: 'onelake',
    label: 'OneLake',
    yields: yields(1, 0, 0, 0),
    moveCost: 1,
    water: true,
    defenceBonus: 0,
    settleable: false,
  },
  rawFilePlains: {
    id: 'rawFilePlains',
    label: 'Raw File Plains',
    yields: yields(2, 0, 0, 0),
    moveCost: 1,
    water: false,
    defenceBonus: 0,
    settleable: true,
  },
  deltaHighlands: {
    id: 'deltaHighlands',
    label: 'Delta Highlands',
    yields: yields(0, 2, 0, 1),
    moveCost: 2,
    water: false,
    defenceBonus: 0.25,
    settleable: true,
  },
  parquetQuarry: {
    id: 'parquetQuarry',
    label: 'Parquet Quarry',
    yields: yields(0, 0, 0, 3),
    moveCost: 2,
    water: false,
    defenceBonus: 0.25,
    settleable: true,
  },
  legacySwamp: {
    id: 'legacySwamp',
    label: 'Legacy Swamp',
    yields: yields(1, 0, 0, 0),
    moveCost: 3,
    water: false,
    defenceBonus: 0,
    settleable: false,
  },
  semanticPeaks: {
    id: 'semanticPeaks',
    label: 'Semantic Peaks',
    yields: yields(0, 0, 0, 2),
    moveCost: Number.POSITIVE_INFINITY,
    water: false,
    defenceBonus: 0,
    settleable: false,
  },
  geothermalVent: {
    id: 'geothermalVent',
    label: 'CU Geothermal Vent',
    yields: yields(0, 0, 3, 0),
    moveCost: 1,
    water: false,
    defenceBonus: 0,
    settleable: true,
  },
  ungovernedWastes: {
    id: 'ungovernedWastes',
    label: 'Ungoverned Wastes',
    yields: yields(0, 0, 0, 0),
    moveCost: 2,
    water: false,
    defenceBonus: 0,
    settleable: false,
  },
});

export const TERRAIN_IDS: readonly TerrainId[] = Object.freeze(
  Object.keys(TERRAINS) as TerrainId[],
);

export function terrain(id: TerrainId): Terrain {
  return TERRAINS[id];
}

export function isPassableByLand(id: TerrainId): boolean {
  const t = TERRAINS[id];
  return !t.water && Number.isFinite(t.moveCost);
}

/** A river adds Data and makes the tile more attractive to settle beside. */
export const RIVER_BONUS: Yields = Object.freeze({
  data: 1,
  compute: 0,
  cu: 0,
  trust: 0,
});

export function tileYields(id: TerrainId, hasRiver: boolean): Yields {
  const base = TERRAINS[id].yields;
  if (!hasRiver) return base;
  return Object.freeze({
    data: base.data + RIVER_BONUS.data,
    compute: base.compute + RIVER_BONUS.compute,
    cu: base.cu + RIVER_BONUS.cu,
    trust: base.trust + RIVER_BONUS.trust,
  });
}
