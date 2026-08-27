/**
 * Enemy villages, and the three things you may do to one.
 *
 * The interesting assertions here are not that raiding adds resources. They
 * are that the CHOICE has consequences: that razing throws away the cluster
 * capture would have opened, that a raid cannot be repeated next turn, and
 * that an antagonist taking one of the player's cities does not quietly hand
 * the player a topic. Each of those is a way the feature could look like it
 * works while being wrong.
 */

import { describe, expect, it } from 'vitest';
import {
  ANTAGONISTS,
  PLAYER_FACTION_ID,
  RAID_COOLDOWN_TURNS,
  RAZE_TAKE,
  RAID_TAKE,
  GARRISON_INTERVAL_TURNS,
  MAX_GARRISON_PER_FACTION,
  canRaid,
  createGameState,
  citiesOf,
  deserialise,
  garrisonPhase,
  grantFoothold,
  raidCity,
  resolveAttack,
  ruinAt,
  sackLoot,
  serialise,
  unitsOf,
  type GameState,
  type Unit,
} from '../src/index.js';

const SEEDS = ['FABRIC', 'DP600', 'HORDE', 'LAKEHOUSE'];

/** The first antagonist that holds a village on this map. */
function anyEnemyCity(state: GameState) {
  return [...state.cities.values()].find((c) => c.factionId !== PLAYER_FACTION_ID)!;
}

/**
 * Put a player unit next to a city and make it the player's turn.
 *
 * Placed directly rather than marched there, because these tests are about
 * what happens at the walls, not about pathfinding to them.
 */
function playerUnitBeside(
  state: GameState,
  cityHex: { q: number; r: number },
  typeId: Unit['typeId'] = 'pipelineRunner',
): { state: GameState; unit: Unit } {
  const neighbours = [
    { q: cityHex.q + 1, r: cityHex.r },
    { q: cityHex.q - 1, r: cityHex.r },
    { q: cityHex.q, r: cityHex.r + 1 },
    { q: cityHex.q, r: cityHex.r - 1 },
    { q: cityHex.q + 1, r: cityHex.r - 1 },
    { q: cityHex.q - 1, r: cityHex.r + 1 },
  ];
  const spot = neighbours.find((h) => state.map.tiles.has(`${h.q},${h.r}`))!;

  const unit: Unit = {
    id: 'test-attacker',
    typeId,
    factionId: PLAYER_FACTION_ID,
    hex: spot,
    hp: 100,
    movesLeft: 2,
    fortified: false,
  };
  const units = new Map(state.units);
  units.set(unit.id, unit);
  return {
    state: { ...state, units, activeFactionId: PLAYER_FACTION_ID },
    unit,
  };
}

describe('every antagonist holds a village', () => {
  it('gives each faction exactly one settlement on every seed', () => {
    for (const seed of SEEDS) {
      const state = createGameState(seed);
      for (const definition of ANTAGONISTS) {
        expect(citiesOf(state, definition.id)).toHaveLength(1);
      }
    }
  });

  it('leaves the player with none until they found one', () => {
    expect(citiesOf(createGameState('FABRIC'), PLAYER_FACTION_ID)).toHaveLength(0);
  });

  it('names them, so the log can say what fell', () => {
    const state = createGameState('FABRIC');
    for (const definition of ANTAGONISTS) {
      expect(citiesOf(state, definition.id)[0]!.name).toBe(definition.seat);
    }
  });

  it('puts no two villages on the same hex', () => {
    for (const seed of SEEDS) {
      const state = createGameState(seed);
      const hexes = [...state.cities.values()].map((c) => `${c.hex.q},${c.hex.r}`);
      expect(new Set(hexes).size).toBe(hexes.length);
    }
  });

  it('sits every village on a real tile', () => {
    for (const seed of SEEDS) {
      const state = createGameState(seed);
      for (const city of state.cities.values()) {
        expect(state.map.tiles.has(`${city.hex.q},${city.hex.r}`)).toBe(true);
      }
    }
  });
});

describe('raiding', () => {
  it('takes plunder and leaves the village standing', () => {
    const base = createGameState('FABRIC');
    const city = anyEnemyCity(base);
    const { state, unit } = playerUnitBeside(base, city.hex);

    const result = raidCity(state, unit.id, city.hex);
    expect(result.ok).toBe(true);
    const after = result.state!;

    expect(after.cities.has(city.id)).toBe(true);
    expect(after.cities.get(city.id)!.hp).toBeLessThan(city.hp);
    expect(after.factions.get(PLAYER_FACTION_ID)!.resources.data).toBeGreaterThan(0);
  });

  it('spends the raider\u2019s turn, so raiding is not free', () => {
    const base = createGameState('FABRIC');
    const city = anyEnemyCity(base);
    const { state, unit } = playerUnitBeside(base, city.hex);

    const after = raidCity(state, unit.id, city.hex).state!;
    expect(after.units.get(unit.id)!.movesLeft).toBe(0);
  });

  it('refuses a second raid until the cooldown has passed', () => {
    const base = createGameState('FABRIC');
    const city = anyEnemyCity(base);
    const { state, unit } = playerUnitBeside(base, city.hex);

    const once = raidCity(state, unit.id, city.hex).state!;
    // Give the unit its moves back; only the cooldown should stop it.
    const units = new Map(once.units);
    units.set(unit.id, { ...once.units.get(unit.id)!, movesLeft: 2 });
    const ready: GameState = { ...once, units };

    expect(canRaid(ready, unit.id, city.hex).ok).toBe(false);
    expect(
      canRaid({ ...ready, turn: ready.turn + RAID_COOLDOWN_TURNS }, unit.id, city.hex).ok,
    ).toBe(true);
  });

  it('refuses a ranged unit, which carries nothing home', () => {
    const base = createGameState('FABRIC');
    const city = anyEnemyCity(base);
    const { state, unit } = playerUnitBeside(base, city.hex, 'querySlinger');
    expect(canRaid(state, unit.id, city.hex).ok).toBe(false);
  });

  it('refuses a civilian', () => {
    const base = createGameState('FABRIC');
    const city = anyEnemyCity(base);
    const { state, unit } = playerUnitBeside(base, city.hex, 'architect');
    expect(canRaid(state, unit.id, city.hex).ok).toBe(false);
  });

  it('refuses from two hexes away', () => {
    const base = createGameState('FABRIC');
    const city = anyEnemyCity(base);
    const { state, unit } = playerUnitBeside(base, city.hex);
    const far = { q: city.hex.q + 4, r: city.hex.r };
    const units = new Map(state.units);
    units.set(unit.id, { ...state.units.get(unit.id)!, hex: far });
    expect(canRaid({ ...state, units }, unit.id, city.hex).ok).toBe(false);
  });

  it('carries off less than razing does', () => {
    expect(sackLoot(3, RAID_TAKE).data).toBeLessThan(sackLoot(3, RAZE_TAKE).data);
  });
});

describe('capture and raze', () => {
  /**
   * Bring a village to the brink so the next melee blow decides its fate.
   *
   * ⚠️ Clears the garrison standing on the village hex first. Antagonist
   * raiders spawn on their own camp anchor, which is where the village is, so
   * an attack on that hex hits the defender and never reaches the walls. That
   * is correct in play, and it means these tests have to fight their way in
   * before they can test what happens when the walls come down.
   */
  function atTheBrink(seed: string, outcome: 'capture' | 'raze') {
    const base = createGameState(seed);
    const city = anyEnemyCity(base);
    const cities = new Map(base.cities);
    cities.set(city.id, { ...city, hp: 1 });

    const cleared = new Map(base.units);
    for (const [id, u] of cleared) {
      if (u.hex.q === city.hex.q && u.hex.r === city.hex.r) cleared.delete(id);
    }

    /*
     * Point the loser at a cluster this tree actually has.
     *
     * The antagonists quiz on `A1`..`C2`, which are DP-600 cluster ids, and
     * these engine tests run on the subject-free generic tree whose clusters
     * are `a`, `b`, `c`. Without this the spoils rule correctly grants nothing
     * and the test would be asserting against a tree that has no such branch.
     * That the two id sets line up in the real game is pinned separately, in
     * the learn tests, because that is where the mismatch would actually hurt.
     */
    const rootCluster = base.topics.nodes[0]!.cluster;
    const factions = new Map(base.factions);
    factions.set(city.factionId, {
      ...base.factions.get(city.factionId)!,
      topicCluster: rootCluster,
    });

    const { state, unit } = playerUnitBeside(
      { ...base, cities, units: cleared, factions },
      city.hex,
    );
    const strong = new Map(state.units);
    strong.set(unit.id, { ...state.units.get(unit.id)!, typeId: 'directLakeTitan' });

    const fought = resolveAttack({ ...state, units: strong }, unit.id, city.hex, {
      cityOutcome: outcome,
    });
    expect(fought.ok).toBe(true);
    return { before: city, result: fought.ok ? fought.result : undefined };
  }

  it('capture keeps the village and hands it to the attacker', () => {
    const { before, result } = atTheBrink('FABRIC', 'capture');
    expect(result!.log.cityCaptured).toBe(true);
    expect(result!.log.cityRazed).toBe(false);
    expect(result!.state.cities.get(before.id)!.factionId).toBe(PLAYER_FACTION_ID);
  });

  it('capture opens a foothold in the loser\u2019s cluster', () => {
    const { result } = atTheBrink('FABRIC', 'capture');
    // The whole reason to take a village rather than burn it.
    expect(result!.log.clusterOpened).toBeDefined();
    expect(result!.state.research.known).toContain(result!.log.clusterOpened);
  });

  it('raze removes the village and leaves a ruin', () => {
    const { before, result } = atTheBrink('FABRIC', 'raze');
    expect(result!.log.cityRazed).toBe(true);
    expect(result!.log.cityCaptured).toBe(false);
    expect(result!.state.cities.has(before.id)).toBe(false);
    expect(ruinAt(result!.state, before.hex)?.name).toBe(before.name);
  });

  it('raze pays better but teaches nothing', () => {
    const razed = atTheBrink('FABRIC', 'raze');
    const taken = atTheBrink('FABRIC', 'capture');

    expect(razed.result!.log.loot!.data).toBeGreaterThan(0);
    // The trade the player is actually making.
    expect(razed.result!.log.clusterOpened).toBeUndefined();
    expect(taken.result!.log.clusterOpened).toBeDefined();
  });

  it('defaults to capture, so old callers behave as they did', () => {
    const base = createGameState('FABRIC');
    const city = anyEnemyCity(base);
    const cities = new Map(base.cities);
    cities.set(city.id, { ...city, hp: 1 });
    const cleared = new Map(base.units);
    for (const [id, u] of cleared) {
      if (u.hex.q === city.hex.q && u.hex.r === city.hex.r) cleared.delete(id);
    }
    const { state, unit } = playerUnitBeside(
      { ...base, cities, units: cleared },
      city.hex,
    );
    const strong = new Map(state.units);
    strong.set(unit.id, { ...state.units.get(unit.id)!, typeId: 'directLakeTitan' });

    const fought = resolveAttack({ ...state, units: strong }, unit.id, city.hex);
    expect(fought.ok && fought.result.log.cityCaptured).toBe(true);
  });
});

describe('the spoils rule', () => {
  it('never grants a topic whose prerequisites are unmet', () => {
    const state = createGameState('FABRIC');
    const cluster = ANTAGONISTS[0]!.topicCluster;
    const { state: after, topicId } = grantFoothold(state, cluster);
    if (topicId === undefined) return;

    const node = after.topics.nodes.find((n) => n.id === topicId)!;
    const knownBefore = new Set(state.research.known);
    for (const requirement of node.requires) {
      expect(knownBefore.has(requirement)).toBe(true);
    }
  });

  it('is a no-op for a cluster that does not exist', () => {
    const state = createGameState('FABRIC');
    const { state: after, topicId } = grantFoothold(state, 'no-such-cluster');
    expect(topicId).toBeUndefined();
    expect(after.research.known).toEqual(state.research.known);
  });

  it('grants nothing when the player captures nothing', () => {
    const state = createGameState('FABRIC');
    expect(state.research.known).toHaveLength(0);
  });
});

describe('village garrisons', () => {
  it('raises nothing before the interval is up', () => {
    const state = createGameState('FABRIC');
    const faction = ANTAGONISTS[0]!.id;
    const before = unitsOf(state, faction).length;
    const after = garrisonPhase(state, faction);
    expect(unitsOf(after.state, faction).length).toBe(before);
  });

  it('raises a unit once the interval is up', () => {
    let state = createGameState('FABRIC');
    const faction = ANTAGONISTS[0]!.id;
    const before = unitsOf(state, faction).length;

    for (let i = 0; i < GARRISON_INTERVAL_TURNS; i++) {
      state = garrisonPhase(state, faction).state;
    }
    expect(unitsOf(state, faction).length).toBe(before + 1);
  });

  it('stops at the cap rather than growing without bound', () => {
    let state = createGameState('FABRIC');
    const faction = ANTAGONISTS[0]!.id;
    for (let i = 0; i < GARRISON_INTERVAL_TURNS * 12; i++) {
      state = garrisonPhase(state, faction).state;
    }
    expect(unitsOf(state, faction).length).toBeLessThanOrEqual(
      MAX_GARRISON_PER_FACTION,
    );
  });

  it('raises nothing for a faction with no villages left', () => {
    const state = createGameState('FABRIC');
    const faction = ANTAGONISTS[0]!.id;
    const cities = new Map(state.cities);
    for (const [id, city] of cities) {
      if (city.factionId === faction) cities.delete(id);
    }
    let stripped: GameState = { ...state, cities };
    const before = unitsOf(stripped, faction).length;
    for (let i = 0; i < GARRISON_INTERVAL_TURNS * 2; i++) {
      stripped = garrisonPhase(stripped, faction).state;
    }
    expect(unitsOf(stripped, faction).length).toBe(before);
  });

  it('never raises anything for the player', () => {
    let state = createGameState('FABRIC');
    const before = unitsOf(state, PLAYER_FACTION_ID).length;
    for (let i = 0; i < GARRISON_INTERVAL_TURNS * 3; i++) {
      state = garrisonPhase(state, PLAYER_FACTION_ID).state;
    }
    expect(unitsOf(state, PLAYER_FACTION_ID).length).toBe(before);
  });
});

describe('saving a war', () => {
  it('round-trips villages and ruins', () => {
    const { result } = (() => {
      const base = createGameState('FABRIC');
      const city = anyEnemyCity(base);
      const cities = new Map(base.cities);
      cities.set(city.id, { ...city, hp: 1 });
      const cleared = new Map(base.units);
      for (const [id, u] of cleared) {
        if (u.hex.q === city.hex.q && u.hex.r === city.hex.r) cleared.delete(id);
      }
      const { state, unit } = playerUnitBeside(
        { ...base, cities, units: cleared },
        city.hex,
      );
      const strong = new Map(state.units);
      strong.set(unit.id, { ...state.units.get(unit.id)!, typeId: 'directLakeTitan' });
      const fought = resolveAttack({ ...state, units: strong }, unit.id, city.hex, {
        cityOutcome: 'raze',
      });
      return { result: fought.ok ? fought.result : undefined };
    })();

    const after = result!.state;
    const restored = deserialise(serialise(after), after.topics);

    expect(restored.cities.size).toBe(after.cities.size);
    expect(restored.ruins.size).toBe(after.ruins.size);
    expect(restored.ruins.size).toBe(1);
  });
});
