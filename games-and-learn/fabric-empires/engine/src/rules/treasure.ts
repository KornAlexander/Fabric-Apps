/**
 * Buried caches, and the question that opens them.
 *
 * ⚠️ **The chest is a reason to answer, not a reward for walking.** Every other
 * source of resources in this game is produced by cities on a schedule, which
 * means the map itself never asks the player anything. A treasure is the one
 * thing on the ground whose value is unlocked by knowing something, which is
 * what the whole product is for.
 *
 * Two rules carry that, and both were chosen against an obvious alternative:
 *
 *   - **Only the Profiler opens them.** The scout's entire identity was a sight
 *     radius, which is a passive virtue: you build one, park it on a hill and
 *     forget it. Giving it the one job that turns exploration into resources
 *     means the unit has something to do every turn.
 *   - **A wrong answer shrinks the haul instead of destroying it.** See
 *     `Treasure` for why neither "gone" nor "unchanged" is the right answer.
 */

import { hexKey, type Hex } from '../hex/index.js';
import { RESOURCE_IDS, type ResourceId } from '../map/terrain.js';
import { isPassableByLand } from '../map/terrain.js';
import type { GameMap } from '../map/generate.js';
import type { Rng } from '../rng/index.js';
import type { Treasure } from '../entities/index.js';

/**
 * How many chests a map carries, as a share of its LAND tiles.
 *
 * ⚠️ Scaled to land rather than fixed, because the world presets change the map
 * size by a factor of four and an archipelago is mostly water. A fixed count
 * would make a small islands map a treasure hunt and a large continent an empty
 * field.
 */
export const TREASURE_SHARE = 0.012;

/** The smallest and largest a fresh chest can be. */
export const TREASURE_MIN_AMOUNT = 25;
export const TREASURE_MAX_AMOUNT = 70;

/**
 * What is left after a failed attempt, as a share of what was there.
 *
 * Halving is steep on purpose. It has to be cheap enough that a player who
 * missed is willing to come back, and expensive enough that guessing is not a
 * strategy: at 0.5 a full chest is down to a quarter after two misses.
 */
export const TREASURE_SPOIL = 0.5;

/**
 * Below this the chest is emptied and removed rather than left holding coins.
 *
 * ⚠️ Without a floor, halving never reaches zero and the map keeps a permanent
 * question that pays one Compute. The number that matters is not the coins, it
 * is that grinding terminates: from the largest chest this bottoms out on the
 * fourth failure.
 */
export const TREASURE_WORTH_CARRYING = 8;

/** The chest on this hex, if there is one. */
export function treasureAt(
  treasures: ReadonlyMap<string, Treasure>,
  hex: Hex,
): Treasure | undefined {
  const key = hexKey(hex);
  for (const treasure of treasures.values()) {
    if (hexKey(treasure.hex) === key) return treasure;
  }
  return undefined;
}

/**
 * Scatter chests over the land of a freshly generated map.
 *
 * ⚠️ Takes the rng rather than making one, so a world is still a pure function
 * of its seed. Two games on `FABRIC` must bury the same chests in the same
 * places, or a save that reloads its map from the seed would find them moved.
 */
export function placeTreasures(
  map: GameMap,
  rng: Rng,
  startingHex: Hex,
  firstId: number,
): { treasures: Map<string, Treasure>; nextId: number } {
  const treasures = new Map<string, Treasure>();
  let nextId = firstId;

  const startKey = hexKey(startingHex);
  const land = [...map.tiles.values()].filter(
    (tile) =>
      isPassableByLand(tile.terrain) &&
      map.mainland.has(hexKey(tile.hex)) &&
      hexKey(tile.hex) !== startKey,
  );
  if (land.length === 0) return { treasures, nextId };

  const wanted = Math.max(1, Math.round(land.length * TREASURE_SHARE));
  const taken = new Set<string>();

  /*
   * ⚠️ A bounded number of attempts, not a loop until `wanted` is reached.
   * On a tiny map the same few tiles can be drawn repeatedly, and "keep going
   * until you have twelve distinct ones" is how a world generator hangs on a
   * seed nobody will ever reproduce.
   */
  for (let attempt = 0; attempt < wanted * 8 && treasures.size < wanted; attempt += 1) {
    const tile = land[rng.int(0, land.length - 1)]!;
    const key = hexKey(tile.hex);
    if (taken.has(key)) continue;
    taken.add(key);

    const id = `treasure-${nextId}`;
    nextId += 1;
    treasures.set(id, {
      id,
      hex: tile.hex,
      resource: RESOURCE_IDS[rng.int(0, RESOURCE_IDS.length - 1)] as ResourceId,
      amount: rng.int(TREASURE_MIN_AMOUNT, TREASURE_MAX_AMOUNT),
    });
  }

  return { treasures, nextId };
}

export interface TreasureClaim {
  /** What the player actually gets. Zero on a failed attempt. */
  readonly gained: number;
  readonly resource: ResourceId;
  /** The chest afterwards, or undefined once it is not worth carrying. */
  readonly remaining: Treasure | undefined;
}

/**
 * Settle an attempt on a chest.
 *
 * ⚠️ Deliberately knows nothing about questions, units or who asked. The engine
 * is handed a yes or a no and answers what that means for the chest, which is
 * the same split every other challenge in this game uses (D35): the presenter
 * owns the question, the engine owns the consequence.
 */
export function claimTreasure(treasure: Treasure, success: boolean): TreasureClaim {
  if (success) {
    return { gained: treasure.amount, resource: treasure.resource, remaining: undefined };
  }

  const left = Math.floor(treasure.amount * TREASURE_SPOIL);
  return {
    gained: 0,
    resource: treasure.resource,
    remaining:
      left < TREASURE_WORTH_CARRYING ? undefined : { ...treasure, amount: left },
  };
}
