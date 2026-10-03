/**
 * Entity shapes.
 *
 * Everything is plain readonly data with no methods, so the whole game state
 * serialises to JSON without a custom encoder and a save file is exactly what
 * the engine holds in memory.
 */

import type { Hex } from '../hex/index.js';
import type { ResourceId } from '../map/index.js';
import type { UnitTypeId } from './units.js';
import type { CityRank } from './rank.js';

export type CityKind =
  | 'workspace'
  | 'lakehouse'
  | 'warehouse'
  | 'eventhouse'
  | 'semanticModel';

export interface CityKindInfo {
  readonly id: CityKind;
  readonly label: string;
  readonly baseHp: number;
  /** Multiplies the tile yields the city collects. */
  readonly yieldBias: Readonly<Partial<Record<ResourceId, number>>>;
}

export const CITY_KINDS: Readonly<Record<CityKind, CityKindInfo>> = Object.freeze({
  workspace: {
    id: 'workspace',
    label: 'Workspace',
    baseHp: 200,
    yieldBias: { data: 1.2, compute: 1.2, cu: 1.2, trust: 1.2 },
  },
  lakehouse: {
    id: 'lakehouse',
    label: 'Lakehouse',
    baseHp: 140,
    yieldBias: { data: 1.5 },
  },
  warehouse: {
    id: 'warehouse',
    label: 'Warehouse',
    baseHp: 180,
    yieldBias: { compute: 1.4, trust: 1.2 },
  },
  eventhouse: {
    id: 'eventhouse',
    label: 'Eventhouse',
    baseHp: 120,
    yieldBias: { data: 1.3, compute: 1.2 },
  },
  semanticModel: {
    id: 'semanticModel',
    label: 'Semantic Model',
    baseHp: 130,
    yieldBias: { trust: 1.6 },
  },
});

export type Resources = Readonly<Record<ResourceId, number>>;

/**
 * Who is playing a faction.
 *
 * ⚠️ **This replaced a boolean called `isPlayer`, and the rename is the whole
 * seat model.** Every rule that read that flag was really asking one of two
 * questions, "should the AI move this empire" and "does this empire accumulate
 * map memory", and both have the same answer for a second human as they do for
 * the first. So multiplayer is not a new subsystem bolted alongside the rules;
 * it is the same flag stopping being singular.
 *
 * A faction is a **seat**. `'ai'` means the seat is unassigned and the machine
 * is keeping it warm, which is why a game can be joined in progress at all: an
 * empire is already there, already fighting, and taking it over is a change of
 * driver rather than a spawn.
 */
export type SeatControl = 'human' | 'ai';

export interface Faction {
  readonly id: string;
  readonly label: string;
  readonly control: SeatControl;
  /** Hex colour used for banners and borders. */
  readonly colour: string;
  readonly resources: Resources;
  /** Opaque topic cluster this faction quizzes on. Empty for the player. */
  readonly topicCluster: string;
}

export interface Unit {
  readonly id: string;
  readonly typeId: UnitTypeId;
  readonly factionId: string;
  readonly hex: Hex;
  readonly hp: number;
  readonly movesLeft: number;
  readonly fortified: boolean;
  /**
   * Somewhere this unit is trying to get to, over as many turns as it takes.
   *
   * ⚠️ Optional, and therefore needs no save migration: JSON omits it, an
   * older save loads with no order, and a unit with nothing to do is exactly
   * what that means. Declared as a bare hex rather than a cached route because
   * a stored path goes stale the moment anything else moves, and recomputing
   * one costs a few hundred microseconds on a map this size.
   */
  readonly order?: { readonly target: Hex };
}

/**
 * A city builds soldiers or it builds walls, out of one purse.
 *
 * ⚠️ Declared here rather than in `rules/production.ts` because `City` carries
 * it, and entities must not import from rules. `'wall'` is not a `UnitTypeId`,
 * so the compiler flags every existing site that assumed one.
 */
export const WALL_TARGET = 'wall';
export type ProductionTarget = UnitTypeId | typeof WALL_TARGET;

/** Whether a set of build orders means fortification rather than a unit. */
export function isWallTarget(target: ProductionTarget): target is typeof WALL_TARGET {
  return target === WALL_TARGET;
}

export interface City {
  readonly id: string;  readonly factionId: string;
  readonly hex: Hex;
  readonly name: string;
  readonly kind: CityKind;
  readonly hp: number;
  /**
   * Fortification built here, 0 to `MAX_WALL_LEVEL`. Raised only by
   * production; never falls when the walls are battered.
   */
  readonly wallLevel: number;
  /**
   * Wall hit points still standing. Separate from `wallLevel` so a siege can
   * make progress across several assaults without erasing what was paid for.
   */
  readonly wallHp: number;
  readonly population: number;
  /**
   * How far the settlement has come: Siedlung through Großstadt.
   *
   * ⚠️ Stored rather than derived, and that is deliberate. Rank is a pure
   * function of population and retained knowledge, so deriving it would need
   * no save field at all, but a derived rank also FALLS the moment a topic
   * lapses. Keeping it means a settlement stalls instead of collapsing, which
   * is the promise made in `rank.ts`, and it means the high-water mark
   * survives a reload.
   */
  readonly rank: CityRank;
  /** Data accumulated towards the next citizen. */
  readonly growthStore: number;
  /**
   * Opaque topic ids whose buildings stand here. Drives the review system.
   *
   * Strings rather than numbers, because a topic id is whatever the challenge
   * provider says it is and the engine must not assume it can be counted.
   */
  readonly boundSkills: readonly string[];
  /** Grumbling from ignored reviews. Capped, and only ever dampens yields. */
  readonly unrest: number;
  /** Consecutive reviews this city was offered and the player skipped. */
  readonly ignoredReviews: number;
  /** Turn until which a good review is still paying a yield bonus. */
  readonly reviewBonusUntilTurn: number;
  /** Last turn a council was held here, so it is one per city per turn. */
  readonly lastReviewTurn: number;
  /**
   * What this city is building, if anything.
   *
   * Optional rather than a null, because `exactOptionalPropertyTypes` makes
   * the difference between "not building" and "building undefined" a real one.
   *
   * ⚠️ Widened from `UnitTypeId` to include `WALL_TARGET`, so that walls
   * compete for the same capped Compute as soldiers rather than living in a
   * parallel queue. The union is deliberate: every place that assumed a unit
   * now fails to compile until it says what it means by a wall.
   */
  readonly producing?: ProductionTarget;
  /** Compute already sunk into the current build. Kept when orders change. */
  readonly productionProgress: number;
  /**
   * Turn this city was last raided, so a raid is not a repeatable free tap.
   *
   * -1 means never. Raiding is meant to be a decision with a cooldown, not a
   * resource faucet a player can stand next to and drain.
   */
  readonly lastRaidedTurn: number;
}

/**
 * What is left where a city was razed.
 *
 * Kept as its own record rather than a flag on the tile, because the tile is
 * map data that never changes after generation, and a ruin is a thing that
 * happened during a game. Ruins are inert: they do not yield, defend or
 * produce. They exist so a razed village leaves a mark, and so the late map
 * does not quietly become empty ground with no memory of the war.
 */
export interface Ruin {
  readonly id: string;
  readonly hex: Hex;
  /** The name the city had, so the log can say what was lost. */
  readonly name: string;
  /** Who owned it when it fell. */
  readonly formerFactionId: string;
  readonly razedOnTurn: number;
}

export function cityKind(kind: CityKind): CityKindInfo {
  return CITY_KINDS[kind];
}

/**
 * A cache buried on the map, opened by answering a question.
 *
 * Its own record rather than a flag on the tile, for the reason ruins are:
 * the tile is map data that never changes after generation, and a treasure is
 * a thing that gets used up during a game.
 *
 * ⚠️ **`amount` shrinks rather than the chest vanishing on a wrong answer.**
 * The obvious rules are both worse. Emptying it makes one missed question
 * permanent, which is a harsh thing for a study tool to do at the exact moment
 * somebody has just discovered they do not know something. Leaving it whole
 * makes retrying free: step off, step back, and guess until it opens, which
 * turns the question into an obstacle to click through rather than a question.
 *
 * Halving on each failure allows the retry and prices it. The chest is removed
 * once what is left is not worth carrying, so grinding converges to an empty
 * hole in three or four attempts instead of running for ever.
 */
export interface Treasure {
  readonly id: string;
  readonly hex: Hex;
  /** Which resource is inside. One kind per chest, so the log can be short. */
  readonly resource: ResourceId;
  /** What is still in it. Falls on every failed attempt. */
  readonly amount: number;
}

/**
 * A town the player has seen, as it looked the last time they looked.
 *
 * ⚠️ **A snapshot, emphatically not a reference to the live city.** Fog used
 * to hide a remembered town completely, on the grounds that keeping it drawn
 * would give "a permanent live readout of a place they walked past once,
 * including whether it still stands after somebody else took it". That
 * objection is right and this is the answer to it rather than a reversal of
 * it: what is kept is a *memory*, and a memory goes stale.
 *
 * So if a town changes hands, grows, is fortified or is razed while you are
 * away, your map keeps showing the old picture until you go back and look.
 * Scouting stays worth doing, and the map still answers the question that
 * prompted this: where was it, and whose was it when I found it.
 *
 * ⚠️ **Deliberately carries no `hp` and no `wallHp`.** Those are live combat
 * state and change every time somebody swings at the place. `breached` is
 * here because a broken wall is something you can *see* from outside and it
 * changes the silhouette; the number behind it is not.
 *
 * Keyed by hex rather than by city id, because the player remembers a place.
 * A razed town and its replacement on the same ground are the same memory.
 */
export interface SeenCity {
  readonly hex: Hex;
  readonly name: string;
  /** Whose it was when last seen, which is not necessarily whose it is. */
  readonly factionId: string;
  readonly kind: CityKind;
  readonly rank: CityRank;
  readonly population: number;
  readonly wallLevel: number;
  readonly breached: boolean;
  /** The turn this picture was taken, so the interface can say how stale it is. */
  readonly turnSeen: number;
}

export function emptyResources(): Resources {
  return Object.freeze({ data: 0, compute: 0, cu: 0, trust: 0 });
}

/**
 * What one empire knows about the map.
 *
 * ⚠️ **Held per faction, which the single-player build deliberately did not
 * do.** The old comment on `GameState.explored` argued that a set per faction
 * would leave six of the seven permanently empty, and that was correct while
 * exactly one seat was human. It stops being correct the moment a second
 * person sits down: two humans sharing one memory would hand each of them the
 * other's scouting, and on one machine it would hand them the other's map.
 *
 * Still only populated for seats a human holds. An AI faction does not use fog
 * (section 21.3), so giving it a memory would cost real allocation per turn to
 * store something nothing ever reads.
 */
export interface FactionMemory {
  /** Hex keys this empire has ever uncovered. */
  readonly explored: ReadonlySet<string>;
  /** Towns it has found, as they looked when last seen, keyed by hex. */
  readonly seenCities: ReadonlyMap<string, SeenCity>;
}

/** A seat that has never looked at anything. Shared, and safe because frozen. */
export const NO_MEMORY: FactionMemory = Object.freeze({
  explored: Object.freeze(new Set<string>()) as ReadonlySet<string>,
  seenCities: Object.freeze(new Map<string, SeenCity>()) as ReadonlyMap<string, SeenCity>,
});

export * from './units.js';
export * from './rank.js';
