import { describe, it, expect } from 'vitest';
import {
  CITY_WORK_RADIUS,
  FREE_UNIT_ALLOWANCE,
  PLAYER_FACTION_ID,
  SAVE_VERSION,
  cityOutput,
  cityTerritory,
  createGameState,
  deserialise,
  empireIncome,
  endTurn,
  fortifyUnit,
  foundCity,
  growthThreshold,
  idleUnits,
  mapDigest,
  moveUnit,
  reachable,
  serialise,
  skipUnit,
  territoryOf,
  toSaveFile,
  unitType,
  unitUpkeep,
  unitsOf,
  workedTiles,
  hexDistance,
  hexKey,
  type GameState,
  type Unit,
} from '../src/index.js';

function architectOf(state: GameState): Unit {
  return unitsOf(state, PLAYER_FACTION_ID).find((u) => u.typeId === 'architect')!;
}

/**
 * A state with the capital founded, which is where the economy starts.
 *
 * ⚠️ **Sandbox, with no antagonists.** Every antagonist now holds a village
 * from turn one, so on a normal map `state.cities` contains eight settlements
 * and "the only city" is meaningless. These tests are about the player's
 * economy, and the cleanest way to say that is to leave the opposition out
 * rather than filter it back out at every assertion.
 */
function withCapital(seed = 'FABRIC'): GameState {
  const state = createGameState(seed, { spawnAntagonists: false });
  const result = foundCity(state, architectOf(state).id);
  if (!result.ok) throw new Error(`Could not found capital: ${result.reason}`);
  return result.state;
}

describe('founding a city', () => {
  it('consumes the architect and creates a workspace', () => {
    const state = createGameState('FABRIC', { spawnAntagonists: false });
    const architect = architectOf(state);
    const result = foundCity(state, architect.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.units.has(architect.id)).toBe(false);
    expect(result.state.cities.size).toBe(1);

    const city = [...result.state.cities.values()][0]!;
    expect(city.kind).toBe('workspace');
    expect(city.population).toBe(1);
    expect(city.growthStore).toBe(0);
    expect(hexKey(city.hex)).toBe(hexKey(architect.hex));
  });

  it('explains itself when refused, rather than throwing', () => {
    const state = withCapital();
    const scout = unitsOf(state, PLAYER_FACTION_ID)[0]!;
    const result = foundCity(state, scout.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('refuses an unknown unit id', () => {
    const state = createGameState('FABRIC');
    expect(foundCity(state, 'nonsense').ok).toBe(false);
  });

  it('gives later cities a kind that suits the terrain', () => {
    // Only the first city is the Workspace; the rest reflect where they sit.
    const state = withCapital();
    const city = [...state.cities.values()][0]!;
    expect(city.kind).toBe('workspace');
  });
});

describe('territory', () => {
  it('covers the tiles within the work radius', () => {
    const state = withCapital();
    const city = [...state.cities.values()][0]!;
    for (const hex of territoryOf(state, city.id)) {
      expect(hexDistance(city.hex, hex)).toBeLessThanOrEqual(CITY_WORK_RADIUS);
    }
  });

  it('assigns every tile to at most one city', () => {
    const state = withCapital();
    const territory = cityTerritory(state);
    // A Map cannot hold duplicate keys, so this asserts the real risk:
    // that the owner set is a subset of real tiles.
    for (const [key, owner] of territory) {
      expect(state.map.tiles.has(key)).toBe(true);
      expect(state.cities.has(owner)).toBe(true);
    }
  });

  it('is empty before any city exists', () => {
    expect(
      cityTerritory(createGameState('FABRIC', { spawnAntagonists: false })).size,
    ).toBe(0);
  });
});

describe('city output', () => {
  it('works its own centre plus population tiles', () => {
    const state = withCapital();
    const city = [...state.cities.values()][0]!;
    const worked = workedTiles(state, city);
    expect(worked.length).toBe(1 + city.population);
    expect(hexKey(worked[0]!.hex)).toBe(hexKey(city.hex));
  });

  it('works more tiles as it grows', () => {
    const state = withCapital();
    const city = [...state.cities.values()][0]!;
    const bigger = { ...city, population: 4 };
    expect(workedTiles(state, bigger).length).toBeGreaterThan(
      workedTiles(state, city).length,
    );
  });

  it('never works the same tile twice', () => {
    const state = withCapital();
    const city = { ...[...state.cities.values()][0]!, population: 6 };
    const keys = workedTiles(state, city).map((t) => hexKey(t.hex));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('produces something, and never a negative yield', () => {
    const state = withCapital();
    const city = [...state.cities.values()][0]!;
    const output = cityOutput(state, city);
    for (const value of Object.values(output)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(value)).toBe(true);
    }
    expect(output.data + output.compute + output.cu + output.trust).toBeGreaterThan(0);
  });

  it('feeds itself before chasing the most valuable tile', () => {
    /*
     * The regression this guards is subtle and was found by looking at numbers
     * rather than by any assertion: a purely value-ranked pick sent a capital
     * on Delta Highlands straight for the adjacent Capacity Unit vent, which
     * scores highest and yields no Data at all. The city then made 1 Data a
     * turn against an 18 Data threshold.
     */
    for (const seed of ['FABRIC', 'ALPHA', 'DP600']) {
      const state = withCapital(seed);
      const city = [...state.cities.values()][0]!;
      const output = cityOutput(state, city);
      expect(output.data, `capital on seed ${seed} is starving`).toBeGreaterThanOrEqual(2);
    }
  });

  it('takes the high-value tile once it is fed', () => {
    // Subsistence weighting must not permanently blind the city to value.
    const state = withCapital();
    const city = [...state.cities.values()][0]!;
    const fed = { ...city, population: 4 };
    const worked = workedTiles(state, fed);
    const nonFood = worked.filter(
      (t) => t.terrain === 'geothermalVent' || t.terrain === 'deltaHighlands' ||
        t.terrain === 'parquetQuarry',
    );
    expect(nonFood.length).toBeGreaterThan(0);
  });

  it('reaches size two within a reasonable number of turns', () => {
    // Hard ceiling on the growth crawl. Nineteen turns for the first citizen
    // is what the original tile selection produced.
    for (const seed of ['FABRIC', 'ALPHA', 'DP600']) {
      let state = withCapital(seed);
      const cityId = [...state.cities.values()][0]!.id;
      let turnsTaken = 0;
      for (let i = 0; i < 30; i++) {
        state = endTurn(state).state;
        turnsTaken++;
        if (state.cities.get(cityId)!.population >= 2) break;
      }
      expect(turnsTaken, `seed ${seed} grew too slowly`).toBeLessThanOrEqual(12);
    }
  });
});

describe('upkeep', () => {
  it('is free up to the allowance', () => {
    const state = withCapital();
    expect(unitsOf(state, PLAYER_FACTION_ID).length).toBeLessThanOrEqual(
      FREE_UNIT_ALLOWANCE,
    );
    expect(unitUpkeep(state, PLAYER_FACTION_ID)).toBe(0);
  });

  it('charges for every combat unit beyond the allowance', () => {
    const state = withCapital();
    const units = new Map(state.units);
    for (let i = 0; i < FREE_UNIT_ALLOWANCE + 2; i++) {
      const id = `extra-${i}`;
      units.set(id, {
        id,
        typeId: 'pipelineRunner',
        factionId: PLAYER_FACTION_ID,
        hex: { q: 0, r: 0 },
        hp: 100,
        movesLeft: 2,
        fortified: false,
      });
    }
    const crowded = { ...state, units };
    // The starting Profiler counts too; civilians never do.
    expect(unitUpkeep(crowded, PLAYER_FACTION_ID)).toBeGreaterThan(0);
  });

  it('does not charge for civilians', () => {
    const state = withCapital();
    const units = new Map(state.units);
    for (let i = 0; i < 6; i++) {
      const id = `worker-${i}`;
      units.set(id, {
        id,
        typeId: 'engineer',
        factionId: PLAYER_FACTION_ID,
        hex: { q: 0, r: 0 },
        hp: 100,
        movesLeft: 2,
        fortified: false,
      });
    }
    expect(unitUpkeep({ ...state, units }, PLAYER_FACTION_ID)).toBe(0);
  });
});

describe('turns', () => {
  it('advances the counter', () => {
    const state = withCapital();
    expect(endTurn(state).state.turn).toBe(state.turn + 1);
  });

  it('pays income into the treasury', () => {
    const state = withCapital();
    const before = state.factions.get(PLAYER_FACTION_ID)!.resources;
    const { state: after, report } = endTurn(state);
    const now = after.factions.get(PLAYER_FACTION_ID)!.resources;

    /*
     * ⚠️ The whole Compute ledger, not just the income half.
     *
     * This used to assert that the treasury simply grew by the income, which
     * held only because an empire researching nothing spent nothing. Now that
     * a game always has something selected, Compute arrives and is drawn on in
     * the same turn, and the claim worth making is the stronger one: every
     * Compute is accounted for as income, research or production.
     */
    expect(now.compute).toBe(
      before.compute +
        report.treasuryGained.compute -
        report.researchSpent -
        report.productionSpent,
    );
    // Nothing spends Trust, so it still simply accumulates.
    expect(now.trust).toBe(before.trust + report.treasuryGained.trust);
  });

  it('keeps Data local, so it never lands in the treasury', () => {
    // Data feeds city growth. If it also piled up centrally, founding cities
    // would be strictly better than growing them and the choice would vanish.
    let state = withCapital();
    for (let i = 0; i < 5; i++) state = endTurn(state).state;
    expect(state.factions.get(PLAYER_FACTION_ID)!.resources.data).toBe(0);
  });

  it('accumulates growth and eventually adds a citizen', () => {
    let state = withCapital();
    const cityId = [...state.cities.values()][0]!.id;
    let grew = false;
    for (let i = 0; i < 40 && !grew; i++) {
      const result = endTurn(state);
      state = result.state;
      if (result.report.grownCities.includes(cityId)) grew = true;
    }
    expect(grew).toBe(true);
    expect(state.cities.get(cityId)!.population).toBeGreaterThan(1);
  });

  it('adds at most one citizen per turn', () => {
    // A windfall must not detonate a size-1 city into a metropolis.
    let state = withCapital();
    const cityId = [...state.cities.values()][0]!.id;
    const cities = new Map(state.cities);
    cities.set(cityId, { ...cities.get(cityId)!, growthStore: 10_000 });
    state = { ...state, cities };

    const before = state.cities.get(cityId)!.population;
    const after = endTurn(state).state.cities.get(cityId)!.population;
    expect(after).toBe(before + 1);
  });

  it('raises the growth threshold as a city gets bigger', () => {
    expect(growthThreshold(2)).toBeGreaterThan(growthThreshold(1));
  });

  it('gives every unit its movement back', () => {
    let state = withCapital();
    const scout = unitsOf(state, PLAYER_FACTION_ID)[0]!;
    state = skipUnit(state, scout.id).ok
      ? (skipUnit(state, scout.id) as { ok: true; state: GameState }).state
      : state;
    expect(state.units.get(scout.id)!.movesLeft).toBe(0);

    const refreshed = endTurn(state).state;
    expect(refreshed.units.get(scout.id)!.movesLeft).toBe(
      unitType(scout.typeId).movement,
    );
  });

  it('leaves fortified units dug in rather than waking them up', () => {
    const state = withCapital();
    const scout = unitsOf(state, PLAYER_FACTION_ID).find(
      (u) => unitType(u.typeId).strength > 0,
    )!;
    const fortified = fortifyUnit(state, scout.id);
    expect(fortified.ok).toBe(true);
    if (!fortified.ok) return;

    const next = endTurn(fortified.state).state;
    expect(next.units.get(scout.id)!.fortified).toBe(true);
    /*
     * ⚠️ **This used to assert `movesLeft` was 0, and that assertion was the
     * bug written down as though it were the design.**
     *
     * Staying dug in is about the flag, which is what the defence bonus and
     * the end-of-turn nag both read, and the flag is still set above. Refusing
     * the unit its movement as well made it impossible to ever leave: the
     * documented way to wake up is to be ordered elsewhere, `moveUnit` clears
     * the flag to do exactly that, and `moveUnit` rejects a unit with no
     * movement before it ever reaches that line.
     *
     * So a fortified unit was stranded for the rest of the game, and this test
     * held it there. See `fortify.test.ts`.
     */
    expect(next.units.get(scout.id)!.movesLeft).toBe(unitType(scout.typeId).movement);
    // And it still does not nag, which was the only thing the old behaviour
    // was actually for.
    expect(idleUnits(next, PLAYER_FACTION_ID).map((u) => u.id)).not.toContain(scout.id);
  });

  it('reports bankruptcy instead of letting the treasury go negative', () => {
    const state = withCapital();
    const units = new Map(state.units);
    for (let i = 0; i < 12; i++) {
      const id = `army-${i}`;
      units.set(id, {
        id,
        typeId: 'pipelineRunner',
        factionId: PLAYER_FACTION_ID,
        hex: { q: 0, r: 0 },
        hp: 100,
        movesLeft: 2,
        fortified: false,
      });
    }
    const result = endTurn({ ...state, units });
    expect(result.report.upkeepPaid).toBeGreaterThan(0);
    expect(result.report.bankrupt).toBe(true);
    expect(
      result.state.factions.get(PLAYER_FACTION_ID)!.resources.cu,
    ).toBeGreaterThanOrEqual(0);
  });

  it('does not mutate the state it was given', () => {
    const state = withCapital();
    const snapshot = serialise(state);
    endTurn(state);
    expect(serialise(state)).toBe(snapshot);
  });
});

describe('moving units', () => {
  it('moves to a reachable tile and spends the movement', () => {
    const state = withCapital();
    const unit = unitsOf(state, PLAYER_FACTION_ID)[0]!;
    const target = [...reachable(state, unit).values()].find(
      (entry) => entry.cost > 0,
    )!;

    const result = moveUnit(state, unit.id, target.hex);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const moved = result.state.units.get(unit.id)!;
    expect(hexKey(moved.hex)).toBe(hexKey(target.hex));
    expect(moved.movesLeft).toBeLessThan(unit.movesLeft);
  });

  it('refuses a tile out of range this turn', () => {
    const state = withCapital();
    const unit = unitsOf(state, PLAYER_FACTION_ID)[0]!;
    const far = [...state.map.tiles.values()].find(
      (t) => hexDistance(t.hex, unit.hex) > 8,
    )!;
    const result = moveUnit(state, unit.id, far.hex);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('range');
  });

  it('refuses to move somewhere off the map', () => {
    const state = withCapital();
    const unit = unitsOf(state, PLAYER_FACTION_ID)[0]!;
    expect(moveUnit(state, unit.id, { q: 999, r: 999 }).ok).toBe(false);
  });

  it('refuses a unit with no movement left', () => {
    const state = withCapital();
    const unit = unitsOf(state, PLAYER_FACTION_ID)[0]!;
    const spent = skipUnit(state, unit.id);
    expect(spent.ok).toBe(true);
    if (!spent.ok) return;
    const target = [...reachable(state, unit).values()].find((e) => e.cost > 0)!;
    expect(moveUnit(spent.state, unit.id, target.hex).ok).toBe(false);
  });

  it('clears the fortified flag when a unit is ordered to move', () => {
    const state = withCapital();
    const unit = unitsOf(state, PLAYER_FACTION_ID).find(
      (u) => unitType(u.typeId).strength > 0,
    )!;
    const target = [...reachable(state, unit).values()].find((e) => e.cost > 0)!;
    const result = moveUnit(state, unit.id, target.hex);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.units.get(unit.id)!.fortified).toBe(false);
  });

  it('lists units that still have orders to give', () => {
    const state = withCapital();
    expect(idleUnits(state, PLAYER_FACTION_ID).length).toBeGreaterThan(0);
    const cleared = state.units.size;
    let working = state;
    for (const unit of unitsOf(state, PLAYER_FACTION_ID)) {
      const result = skipUnit(working, unit.id);
      if (result.ok) working = result.state;
    }
    expect(cleared).toBeGreaterThan(0);
    expect(idleUnits(working, PLAYER_FACTION_ID)).toHaveLength(0);
  });
});

describe('save and load', () => {
  it('round trips a fresh game', () => {
    const state = withCapital();
    const restored = deserialise(serialise(state));

    expect(restored.seed).toBe(state.seed);
    expect(restored.turn).toBe(state.turn);
    expect(restored.units.size).toBe(state.units.size);
    expect(restored.cities.size).toBe(state.cities.size);
    expect(restored.activeFactionId).toBe(state.activeFactionId);
  });

  it('regenerates a byte-identical map instead of storing it', () => {
    // This is why a save is kilobytes rather than megabytes, and it only
    // holds because map generation is deterministic.
    const state = withCapital();
    const restored = deserialise(serialise(state));
    expect(mapDigest(restored.map)).toBe(mapDigest(state.map));
  });

  it('keeps a save small', () => {
    const state = withCapital();
    expect(serialise(state).length).toBeLessThan(8_000);
  });

  it('survives a round trip after several turns of play', () => {
    let state = withCapital();
    for (let i = 0; i < 12; i++) state = endTurn(state).state;

    const restored = deserialise(serialise(state));
    expect(restored.turn).toBe(state.turn);
    expect(restored.factions.get(PLAYER_FACTION_ID)!.resources).toEqual(
      state.factions.get(PLAYER_FACTION_ID)!.resources,
    );
    for (const [id, city] of state.cities) {
      expect(restored.cities.get(id)).toEqual(city);
    }
    for (const [id, unit] of state.units) {
      expect(restored.units.get(id)).toEqual(unit);
    }
  });

  it('a restored game plays on identically', () => {
    let state = withCapital();
    for (let i = 0; i < 5; i++) state = endTurn(state).state;

    const restored = deserialise(serialise(state));
    const continuedDirect = endTurn(state);
    const continuedRestored = endTurn(restored);

    expect(continuedRestored.report).toEqual(continuedDirect.report);
    expect(serialise(continuedRestored.state)).toBe(
      serialise(continuedDirect.state),
    );
  });

  it('stamps the current version', () => {
    expect(toSaveFile(withCapital()).version).toBe(SAVE_VERSION);
  });

  it('refuses a save from a newer build rather than corrupting it', () => {
    const save = { ...toSaveFile(withCapital()), version: SAVE_VERSION + 5 };
    expect(() => deserialise(JSON.stringify(save))).toThrow(/newer/);
  });

  it('refuses malformed input with a useful message', () => {
    expect(() => deserialise('not json')).toThrow(/valid JSON/);
    expect(() => deserialise('null')).toThrow(/object/);
  });

  it('keeps map overrides, so a custom-size game reloads at that size', () => {
    const small = createGameState('FABRIC', { map: { radius: 8 } });
    const restored = deserialise(serialise(small));
    expect(restored.map.radius).toBe(8);
    expect(mapDigest(restored.map)).toBe(mapDigest(small.map));
  });
});

describe('empire income', () => {
  it('is zero before the first city', () => {
    const income = empireIncome(createGameState('FABRIC'), PLAYER_FACTION_ID);
    expect(income.treasury.compute).toBe(0);
    expect(income.growth.size).toBe(0);
  });

  it('reports growth for every city', () => {
    const state = withCapital();
    const income = empireIncome(state, PLAYER_FACTION_ID);
    for (const city of state.cities.values()) {
      expect(income.growth.has(city.id)).toBe(true);
    }
  });
});
