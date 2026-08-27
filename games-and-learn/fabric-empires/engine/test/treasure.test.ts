/**
 * Buried caches.
 *
 * ⚠️ The rule worth defending here is the one that is easy to "simplify" later:
 * a wrong answer SHRINKS the chest rather than emptying it or leaving it whole.
 * Both of the obvious alternatives are worse, and neither failure is visible in
 * a screenshot:
 *
 *   - emptied, and one missed question is punished permanently, in a tool whose
 *     entire purpose is to be somewhere you are allowed to not know things;
 *   - untouched, and the question is free to retry, so it stops being a
 *     question and becomes a dialog to click through until it opens.
 *
 * The tests below therefore pin the SHAPE of the curve, not just its endpoints:
 * a retry has to be worth making, and grinding has to terminate.
 */

import { describe, expect, it } from 'vitest';
import {
  PLAYER_FACTION_ID,
  SAVE_VERSION,
  TREASURE_MAX_AMOUNT,
  TREASURE_MIN_AMOUNT,
  TREASURE_SPOIL,
  TREASURE_WORTH_CARRYING,
  claimTreasure,
  createGameState,
  deserialise,
  hexKey,
  isPassableByLand,
  serialise,
  treasureAt,
  unitsOf,
  type Treasure,
} from '../src/index.js';

const chest = (amount: number): Treasure => ({
  id: 'treasure-1',
  hex: { q: 0, r: 0 },
  resource: 'compute',
  amount,
});

describe('where chests are buried', () => {
  it('puts some on the map at all', () => {
    const state = createGameState('FABRIC');
    expect(state.treasures.size).toBeGreaterThan(0);
  });

  it('⚠️ never on water, and never off the mainland', () => {
    /*
     * A chest on an island the Profiler cannot walk to is a chest that does
     * not exist, and one in the sea is worse: it would render under the water
     * surface and read as a bug.
     */
    const state = createGameState('FABRIC');
    for (const treasure of state.treasures.values()) {
      const tile = state.map.tiles.get(hexKey(treasure.hex));
      expect(tile, `${hexKey(treasure.hex)} is off the map`).toBeDefined();
      expect(isPassableByLand(tile!.terrain)).toBe(true);
      expect(state.map.mainland.has(hexKey(treasure.hex))).toBe(true);
    }
  });

  it('never buries one under the unit that starts on it', () => {
    const state = createGameState('FABRIC');
    const start = unitsOf(state, PLAYER_FACTION_ID)[0]!;
    expect(treasureAt(state.treasures, start.hex)).toBeUndefined();
  });

  it('never buries two in the same hole', () => {
    const state = createGameState('FABRIC');
    const seen = new Set<string>();
    for (const treasure of state.treasures.values()) {
      const key = hexKey(treasure.hex);
      expect(seen.has(key), `${key} has two chests`).toBe(false);
      seen.add(key);
    }
  });

  it('is a pure function of the seed, like the map it sits on', () => {
    const a = createGameState('FABRIC');
    const b = createGameState('FABRIC');
    expect([...a.treasures.values()]).toEqual([...b.treasures.values()]);

    const other = createGameState('ONELAKE');
    expect([...other.treasures.values()]).not.toEqual([...a.treasures.values()]);
  });

  it('starts every chest inside its stated range', () => {
    const state = createGameState('FABRIC');
    for (const treasure of state.treasures.values()) {
      expect(treasure.amount).toBeGreaterThanOrEqual(TREASURE_MIN_AMOUNT);
      expect(treasure.amount).toBeLessThanOrEqual(TREASURE_MAX_AMOUNT);
    }
  });
});

describe('opening one', () => {
  it('hands over everything in it and takes the chest away', () => {
    const claim = claimTreasure(chest(60), true);
    expect(claim.gained).toBe(60);
    expect(claim.resource).toBe('compute');
    expect(claim.remaining).toBeUndefined();
  });

  it('⚠️ gives nothing on a wrong answer, but leaves something to come back for', () => {
    const claim = claimTreasure(chest(60), false);
    expect(claim.gained).toBe(0);
    expect(claim.remaining?.amount).toBe(Math.floor(60 * TREASURE_SPOIL));
  });

  it('⚠️ makes the second attempt worth strictly less than the first', () => {
    // The price of guessing. If these were ever equal, the question would be
    // free to retry and would stop being a question.
    const first = claimTreasure(chest(60), false).remaining!;
    expect(first.amount).toBeLessThan(60);
    const second = claimTreasure(first, false).remaining;
    expect(second!.amount).toBeLessThan(first.amount);
  });

  it('⚠️ terminates, so a chest cannot be ground for ever', () => {
    /*
     * Halving never reaches zero in arithmetic. Without the floor the map
     * would keep a permanent question paying one Compute, and the loop below
     * would not end.
     */
    let current: Treasure | undefined = chest(TREASURE_MAX_AMOUNT);
    let attempts = 0;
    while (current && attempts < 50) {
      current = claimTreasure(current, false).remaining;
      attempts += 1;
    }
    expect(current).toBeUndefined();
    expect(attempts).toBeLessThanOrEqual(6);
  });

  it('removes a chest once what is left is not worth carrying', () => {
    const claim = claimTreasure(chest(TREASURE_WORTH_CARRYING), false);
    expect(claim.remaining).toBeUndefined();
  });

  it('still pays out in full if you get it right on the last scrap', () => {
    // Shrinking is a penalty on the haul, never a penalty on knowing.
    const nearly = chest(TREASURE_WORTH_CARRYING + 1);
    expect(claimTreasure(nearly, true).gained).toBe(TREASURE_WORTH_CARRYING + 1);
  });
});

describe('chests in the save', () => {
  it('round-trips what is left, rather than restocking from the seed', () => {
    /*
     * ⚠️ The bug this prevents pays out for ever. Placement is a pure function
     * of the seed, so regenerating on load would refill every chest the player
     * had already emptied, on every load.
     */
    const state = createGameState('FABRIC');
    const first = [...state.treasures.values()][0]!;
    const emptied = new Map(state.treasures);
    emptied.delete(first.id);

    const loaded = deserialise(serialise({ ...state, treasures: emptied }));
    expect(loaded.treasures.has(first.id)).toBe(false);
    expect(loaded.treasures.size).toBe(state.treasures.size - 1);
  });

  it('keeps each chest\u2019s remaining amount, not its original one', () => {
    const state = createGameState('FABRIC');
    const first = [...state.treasures.values()][0]!;
    const spoiled = new Map(state.treasures);
    spoiled.set(first.id, { ...first, amount: 11 });

    const loaded = deserialise(serialise({ ...state, treasures: spoiled }));
    expect(loaded.treasures.get(first.id)?.amount).toBe(11);
  });

  it('⚠️ gives a save from before the feature an empty field, not a full one', () => {
    /*
     * The migration decision, stated as a test. Burying a fresh field into an
     * old empire would drop a chest under a city founded twenty turns ago, and
     * would do it again on every load.
     */
    const state = createGameState('FABRIC');
    const old = JSON.parse(serialise(state)) as Record<string, unknown>;
    old.version = 8;
    delete old.treasures;
    /*
     * ⚠️ The seat fields go too, or this is a current save wearing an old
     * number. 10 -> 11 rewrites factions, and a fixture that skipped that
     * migration would keep passing on the day it broke.
     */
    delete old.memory;
    old.factions = (old.factions as readonly Record<string, unknown>[]).map((f) => {
      const { control, ...rest } = f;
      return { ...rest, isPlayer: control === 'human' };
    });

    const loaded = deserialise(JSON.stringify(old));
    expect(loaded.treasures.size).toBe(0);
    expect(SAVE_VERSION).toBe(11);
  });
});
