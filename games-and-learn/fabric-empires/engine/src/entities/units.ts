/**
 * Unit definitions.
 *
 * One table, like the terrain table, so balance lives in a single place.
 * `unlockedBySkill` refers to a leaf node of the DP-600 outline, which is how
 * the tech tree hands out an army. The engine treats it as an opaque number so
 * that nothing here depends on the learning layer (D35).
 */

export type UnitTypeId =
  | 'architect'
  | 'engineer'
  | 'profiler'
  | 'pipelineRunner'
  | 'querySlinger'
  | 'notebookCannon'
  | 'rlsSentinel'
  | 'shortcutSkiff'
  | 'lineageHawk'
  | 'refreshGuard'
  | 'semanticColossus'
  | 'directLakeTitan';

export type MovementDomain = 'land' | 'water';

export type UnitRole =
  | 'settler'
  | 'worker'
  | 'scout'
  | 'melee'
  | 'ranged'
  | 'siege'
  | 'defensive'
  | 'transport'
  | 'support';

export interface UnitType {
  readonly id: UnitTypeId;
  readonly label: string;
  readonly role: UnitRole;
  readonly strength: number;
  readonly maxHp: number;
  /** Movement points per turn. */
  readonly movement: number;
  readonly domain: MovementDomain;
  /** 0 for melee. Ranged units strike without taking return damage. */
  readonly range: number;
  /** Recon units slip past enemy lines instead of being pinned by them. */
  readonly ignoresZoneOfControl: boolean;
  /**
   * How far this unit can see, in hexes.
   *
   * ⚠️ **This is what makes a scout a scout.** With the whole map visible from
   * turn one the Profiler was just a faster soldier: its entire purpose is a
   * sight radius, and there was nothing for it to reveal.
   */
  readonly sight: number;
  /** Leaf skill index that unlocks this unit, or null if available at start. */
  readonly unlockedBySkill: number | null;
}

function unit(
  id: UnitTypeId,
  label: string,
  role: UnitRole,
  strength: number,
  movement: number,
  unlockedBySkill: number | null,
  extra: Partial<UnitType> = {},
): UnitType {
  return {
    id,
    label,
    role,
    strength,
    maxHp: 100,
    movement,
    domain: 'land',
    range: 0,
    ignoresZoneOfControl: false,
    // Two hexes is enough to see who is next to you and no more. Scouts and
    // ranged units override it; a siege train sees less than a horseman.
    sight: 2,
    unlockedBySkill,
    ...extra,
  };
}

export const UNIT_TYPES: Readonly<Record<UnitTypeId, UnitType>> = Object.freeze({
  architect: unit('architect', 'Architect', 'settler', 0, 2, null),
  engineer: unit('engineer', 'Engineer', 'worker', 0, 2, null),
  profiler: unit('profiler', 'Profiler', 'scout', 8, 3, null, { sight: 4 }),
  pipelineRunner: unit('pipelineRunner', 'Pipeline Runner', 'melee', 20, 2, 14),
  querySlinger: unit('querySlinger', 'Query Slinger', 'ranged', 18, 2, 27, {
    range: 2,
    // A unit that strikes at two hexes has to be able to see two hexes.
    sight: 3,
  }),
  notebookCannon: unit('notebookCannon', 'Notebook Cannon', 'siege', 25, 1, 17, {
    sight: 1,
  }),
  rlsSentinel: unit('rlsSentinel', 'RLS Sentinel', 'defensive', 22, 2, 3, {
    // It is a sentinel. Watching is the job.
    sight: 3,
  }),
  shortcutSkiff: unit('shortcutSkiff', 'Shortcut Skiff', 'transport', 12, 4, 16, {
    domain: 'water',
    sight: 3,
  }),
  lineageHawk: unit('lineageHawk', 'Lineage Hawk', 'scout', 14, 4, 9, {
    ignoresZoneOfControl: true,
    sight: 5,
  }),
  refreshGuard: unit('refreshGuard', 'Refresh Guard', 'support', 16, 2, 41),
  semanticColossus: unit('semanticColossus', 'Semantic Colossus', 'melee', 45, 1, 36),
  directLakeTitan: unit('directLakeTitan', 'Direct Lake Titan', 'melee', 60, 2, 39),
});

export const UNIT_TYPE_IDS: readonly UnitTypeId[] = Object.freeze(
  Object.keys(UNIT_TYPES) as UnitTypeId[],
);

export function unitType(id: UnitTypeId): UnitType {
  return UNIT_TYPES[id];
}

/** Non-combat units cannot attack and are captured rather than killed. */
export function isCivilian(id: UnitTypeId): boolean {
  const t = UNIT_TYPES[id];
  return t.role === 'settler' || t.role === 'worker';
}

/**
 * The smallest topic graph that can unlock every unit.
 *
 * ⚠️ **A curriculum shorter than this silently loses its late units.**
 * `unlockedBySkill` is a 1-based index into the topic graph, so a tree with
 * thirty nodes never unlocks the unit gated at forty-one: `unitUnlocked`
 * returns false forever and nothing anywhere says why. That was invisible
 * while there was exactly one curriculum with exactly the right length.
 *
 * Computed from the table rather than written down, so retuning an unlock
 * cannot leave a stale constant behind.
 */
export function minimumTopicCount(): number {
  return Object.values(UNIT_TYPES).reduce(
    (most, type) => Math.max(most, type.unlockedBySkill ?? 0),
    0,
  );
}
