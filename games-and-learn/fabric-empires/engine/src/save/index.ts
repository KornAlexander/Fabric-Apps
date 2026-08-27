/**
 * Save and load.
 *
 * The map is NOT serialised. It is a pure function of the seed and a handful
 * of options, so a save carries those instead of two thousand tiles: a save
 * file stays a few kilobytes, and the golden map test doubles as a guarantee
 * that a loaded game looks exactly like the one that was saved.
 *
 * Everything else is stored verbatim. Maps become arrays because JSON has no
 * Map, and that conversion is the only transformation on the way out.
 */

import { generateMap, type MapOptions } from '../map/index.js';
import { hexKey } from '../hex/index.js';
import type { City, Faction, FactionMemory, Ruin, SeenCity, Treasure, Unit } from '../entities/index.js';
import { CITY_RANKS, FIRST_RANK, type CityRank } from '../entities/rank.js';
import { GENERIC_TOPIC_GRAPH, type TopicGraph } from '../challenge/index.js';
import { EMPTY_RESEARCH, type ResearchState } from '../rules/research.js';
import type { Difficulty, GameState } from '../state/index.js';

export const SAVE_VERSION = 11;

/**
 * One seat's memory, on the way to disk.
 *
 * ⚠️ Keyed by faction rather than being a bare pair of arrays, because there
 * is now more than one of them and which seat a memory belongs to is the whole
 * point. A save that stored them positionally would hand the wrong map to the
 * wrong player the first time a seat was vacated.
 */
export interface SavedMemory {
  readonly factionId: string;
  /**
   * Hex keys this seat has uncovered.
   *
   * An array because JSON has no Set. On a radius-45 map fully explored this
   * is about 6,200 short strings, which is the largest thing in the file by
   * some way and still small.
   */
  readonly explored: readonly string[];
  /**
   * Towns it has found, as they looked when last seen.
   *
   * ⚠️ **Cannot be rebuilt from anything else, unlike most of this file.**
   * `explored` says which GROUND is remembered; it says nothing about what was
   * standing on it, and the live `cities` list is the current truth rather
   * than what the player was shown. A memory that is not saved is a memory
   * the player loses every time they close the tab, which is the one thing
   * this feature exists to prevent.
   */
  readonly seenCities: readonly SeenCity[];
}

export interface SaveFile {
  readonly version: number;
  readonly seed: string;
  readonly difficulty: Difficulty;
  readonly turn: number;
  readonly mapOverrides: Partial<MapOptions>;
  readonly factions: readonly Faction[];
  readonly units: readonly Unit[];
  readonly cities: readonly City[];
  readonly ruins: readonly Ruin[];
  /**
   * Chests still unopened.
   *
   * ⚠️ Saved rather than regenerated from the seed, even though placement IS
   * a pure function of the seed. Regenerating would restock every chest the
   * player has already emptied on every load, which is both a duplication bug
   * and an infinite resource supply. The seed decides where they start; the
   * save decides what is left.
   */
  readonly treasures?: readonly Treasure[];
  /**
   * Research progress travels with the save; the topic GRAPH does not.
   * The graph belongs to the challenge provider, so a load takes it from
   * whichever provider is active rather than trusting a stale copy on disk.
   */
  readonly research: ResearchState;
  readonly activeFactionId: string;
  readonly nextEntityId: number;
  readonly cheatsUsed: readonly string[];
  /**
   * What each seat knows, one entry per human-held faction.
   *
   * Optional so a version-10 save still parses while its migration runs.
   */
  readonly memory?: readonly SavedMemory[];
  /**
   * Hex keys the player uncovered, from version 10 and earlier.
   *
   * ⚠️ Kept on the type purely so the 10 -> 11 migration can read it. Nothing
   * writes it any more. Deleting it from the interface would mean the
   * migration had to cast, and a cast is how a field quietly stops being read
   * at all.
   */
  readonly explored?: readonly string[];
  /** Towns the player had found, from version 10 and earlier. See `explored`. */
  readonly seenCities?: readonly SeenCity[];
}

export function toSaveFile(state: GameState): SaveFile {
  return {
    version: SAVE_VERSION,
    seed: state.seed,
    difficulty: state.difficulty,
    turn: state.turn,
    mapOverrides: state.mapOverrides,
    factions: [...state.factions.values()],
    units: [...state.units.values()],
    cities: [...state.cities.values()],
    ruins: [...state.ruins.values()],
    treasures: [...state.treasures.values()],
    research: state.research,
    activeFactionId: state.activeFactionId,
    nextEntityId: state.nextEntityId,
    cheatsUsed: state.cheatsUsed,
    memory: [...state.memory].map(([factionId, seat]) => ({
      factionId,
      explored: [...seat.explored],
      seenCities: [...seat.seenCities.values()],
    })),
  };
}

export function serialise(state: GameState): string {
  return JSON.stringify(toSaveFile(state));
}

/**
 * Migrations from older save versions.
 *
 * Each entry takes the previous shape and returns the next one. They are
 * applied in order, so a save from any supported version can reach the
 * current one. Adding a field with a sensible default belongs here, not in a
 * scattering of `?? fallback` reads across the engine.
 */
const MIGRATIONS: Readonly<Record<number, (save: SaveFile) => SaveFile>> =
  Object.freeze({
    // 0 -> 1 is a placeholder for the shape of the thing. There are no
    // published saves older than version 1.

    /**
     * 1 -> 2: cities gained council review state.
     *
     * `boundSkills` also changed from numbers to opaque topic id strings. No
     * version 1 save ever had a non-empty one, because nothing wrote to it,
     * so the migration can simply drop whatever is there rather than trying
     * to invent a mapping.
     */
    1: (save) => ({
      ...save,
      version: 2,
      cities: save.cities.map((city) => ({
        ...city,
        boundSkills: [],
        unrest: 0,
        ignoredReviews: 0,
        reviewBonusUntilTurn: 0,
        lastReviewTurn: -1,
      })),
    }),

    /**
     * 2 -> 3: cities can build things.
     *
     * `producing` is deliberately left absent rather than set to undefined:
     * with `exactOptionalPropertyTypes` those are different, and an absent key
     * is what "this city has no orders" means everywhere else.
     */
    2: (save) => ({
      ...save,
      version: 3,
      cities: save.cities.map((city) => ({
        ...city,
        productionProgress: 0,
      })),
    }),

    /**
     * 3 -> 4: enemy villages, and the three things you may do to one.
     *
     * Ruins did not exist, so an old save has none. `lastRaidedTurn` is -1,
     * meaning never raided, which lets a loaded game raid immediately rather
     * than sitting on a phantom cooldown counted from turn zero.
     *
     * ⚠️ Old saves keep their empty antagonist camps. Villages are seeded at
     * `createGameState`, and back-filling them here would drop seven cities
     * into a game the player has already been fighting, on hexes their units
     * may well be standing on.
     */
    3: (save) => ({
      ...save,
      version: 4,
      ruins: [],
      cities: save.cities.map((city) => ({
        ...city,
        lastRaidedTurn: -1,
      })),
    }),

    /**
     * 4 -> 5: the cheat log.
     *
     * An older save predates cheat codes entirely, so it cannot have used one.
     * Empty is the honest answer rather than unknown.
     */
    4: (save) => ({
      ...save,
      version: 5,
      cheatsUsed: [],
    }),

    /**
     * 5 -> 6: fog of war.
     *
     * ⚠️ **Migrated to FULLY explored, not to darkness.** An older save was
     * played on a map with no fog, so the player has already seen all of it.
     * Blanking it would take back ground they genuinely uncovered and hide
     * their own cities behind a fog that arrived after the fact.
     *
     * The empty array is a signal rather than a value: `fromSaveFile` fills it
     * from the map, which is the only place that knows how many hexes there
     * are.
     */
    5: (save) => ({
      ...save,
      version: 6,
      explored: [],
    }),

    /**
     * 6 -> 7: settlements have a rank.
     *
     * ⚠️ **Granted on population alone, and knowingly generously.** The honest
     * migration would also check retained knowledge, since that is half of
     * what a rank costs, but a save from before ranks existed was played by
     * someone who was never told that revising grows their towns. Demoting a
     * nine-citizen capital to a Siedlung on load because its topics have gone
     * stale would be punishing them for a rule that did not exist when they
     * played.
     *
     * So an old city keeps whatever its size already justifies, and every rank
     * after that has to be earned the real way.
     */
    6: (save) => ({
      ...save,
      version: 7,
      cities: save.cities.map((city) => ({
        ...city,
        rank: rankFromPopulationAlone(city.population ?? 1),
      })),
    }),

    /**
     * 7 -> 8: cities can be walled.
     *
     * Both fields default to zero, which is exactly what an old save means:
     * nobody had ever built a wall, so nothing had one. ⚠️ `wallHp` must not be
     * seeded from `maxWallHp` here, because a level of zero has no hit points
     * and a non-zero default would hand every existing city a wall it never
     * paid for.
     */
    7: (save) => ({
      ...save,
      version: 8,
      cities: save.cities.map((city) => ({
        ...city,
        wallLevel: 0,
        wallHp: 0,
      })),
    }),

    /**
     * 8 -> 9: there are chests buried on the map.
     *
     * ⚠️ **An existing empire gets none, and that is the only stable answer.**
     * Burying a fresh field would put a chest under a city founded twenty
     * turns ago, and would do it again on every load, because nothing in an
     * old save records which chests had been opened. Placement is a pure
     * function of the seed, so "regenerate them" and "restock them" are the
     * same operation.
     *
     * The cost is that a game in progress never sees the feature. That is a
     * fair price for a save that means the same thing every time it is opened.
     */
    8: (save) => ({
      ...save,
      version: 9,
      treasures: [],
    }),

    /**
     * Town memory arrives empty.
     *
     * ⚠️ **Empty, not "everything you have explored".** The tempting migration
     * is to walk `explored` and photograph every town standing on remembered
     * ground, and it would be a lie in the player's favour: it would hand them
     * a picture of towns as they are TODAY and label it as something they saw
     * on turn four, including places that have changed hands since. A blank
     * memory is simply true, and one walk past refills it.
     */
    9: (save) => ({
      ...save,
      version: 10,
      seenCities: [],
    }),

    /**
     * 10 -> 11: seats. One player becomes a table of them.
     *
     * Two shape changes, and both are the same change seen from different
     * ends. `Faction.isPlayer` becomes `control`, and the single `explored` /
     * `seenCities` pair becomes a memory per seat.
     *
     * ⚠️ **The old memory goes to whichever faction was the player, found by
     * reading the old flag rather than by assuming `PLAYER_FACTION_ID`.** A
     * campaign is free to rename its factions, and handing a saved map to a
     * hard-coded id would silently blank the fog of anyone whose empire was
     * not called `player`. If no faction claims it, the memory is dropped
     * rather than parked on an arbitrary seat.
     */
    10: (save) => {
      type LegacyFaction = Omit<Faction, 'control'> & { readonly isPlayer?: boolean };
      const legacy = save.factions as readonly LegacyFaction[];
      const human = legacy.find((f) => f.isPlayer === true);
      const factions: Faction[] = legacy.map(({ isPlayer, ...rest }) => ({
        ...rest,
        control: isPlayer === true ? 'human' : 'ai',
      }));
      return {
        ...save,
        version: 11,
        factions,
        memory: human
          ? [
              {
                factionId: human.id,
                explored: save.explored ?? [],
                seenCities: save.seenCities ?? [],
              },
            ]
          : [],
      };
    },
  });

/** The best rank a population would justify if knowledge were not asked for. */
function rankFromPopulationAlone(population: number): CityRank {
  let best: CityRank = FIRST_RANK;
  for (const rank of CITY_RANKS) {
    if (population >= rank.minPopulation) best = rank.id;
  }
  return best;
}

export function migrate(save: SaveFile): SaveFile {
  let current = save;
  while (current.version < SAVE_VERSION) {
    const step = MIGRATIONS[current.version];
    if (!step) {
      throw new Error(
        `No migration from save version ${current.version} to ${current.version + 1}`,
      );
    }
    current = step(current);
  }
  return current;
}

export function fromSaveFile(
  save: SaveFile,
  topics: TopicGraph = GENERIC_TOPIC_GRAPH,
): GameState {
  if (typeof save.version !== 'number') {
    throw new Error('Save file has no version');
  }
  if (save.version > SAVE_VERSION) {
    throw new Error(
      `Save version ${save.version} is newer than this build understands (${SAVE_VERSION})`,
    );
  }

  const migrated = migrate(save);
  const map = generateMap(migrated.seed, migrated.mapOverrides ?? {});

  /*
   * An empty explored set on a save that has a turn behind it means the save
   * predates fog of war, so the whole map is remembered. A genuinely new game
   * never reaches here: `createGameState` seeds its own sight.
   *
   * ⚠️ Applied per seat, and only to a seat that has an entry at all. A seat
   * with no entry is an AI faction, which does not use fog and must not be
   * handed the map: doing that would put six thousand hex keys per antagonist
   * into every save for something nothing reads.
   */
  const memory = new Map<string, FactionMemory>(
    (migrated.memory ?? []).map((seat) => [
      seat.factionId,
      {
        explored:
          seat.explored.length > 0 ? new Set(seat.explored) : new Set(map.tiles.keys()),
        // ⚠️ `hexKey`, not an inline template. The format happens to be `q,r`
        // today, and a second copy of it here is a silent way for a save to
        // stop matching the map the moment that changes.
        seenCities: new Map(seat.seenCities.map((c) => [hexKey(c.hex), c])),
      },
    ]),
  );

  return {
    seed: migrated.seed,
    difficulty: migrated.difficulty,
    turn: migrated.turn,
    map,
    mapOverrides: migrated.mapOverrides ?? {},
    factions: new Map(migrated.factions.map((f) => [f.id, f])),
    units: new Map(migrated.units.map((u) => [u.id, u])),
    cities: new Map(migrated.cities.map((c) => [c.id, c])),
    ruins: new Map((migrated.ruins ?? []).map((r) => [r.id, r])),
    /*
     * ⚠️ **An older save gets NO treasures, not freshly buried ones.**
     *
     * The tempting migration is to run `placeTreasures` for saves that predate
     * the feature, so an existing empire gets to enjoy it. That would bury a
     * chest under a city somebody founded twenty turns ago, and would do it
     * again on every load, because nothing in an old save records which ones
     * were opened. An empty field is the only answer that is stable.
     */
    treasures: new Map((migrated.treasures ?? []).map((t) => [t.id, t])),
    topics,
    research: migrated.research ?? EMPTY_RESEARCH,
    activeFactionId: migrated.activeFactionId,
    nextEntityId: migrated.nextEntityId,
    cheatsUsed: migrated.cheatsUsed ?? [],
    memory,
  };
}

export function deserialise(
  json: string,
  topics: TopicGraph = GENERIC_TOPIC_GRAPH,
): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Save file is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Save file is not an object');
  }
  return fromSaveFile(parsed as SaveFile, topics);
}
