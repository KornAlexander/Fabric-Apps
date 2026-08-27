import { describe, expect, it } from 'vitest';
import {
  absorbWithWalls,
  cancelProduction,
  cityCombatSide,
  createGameState,
  deserialise,
  maxWallHp,
  nextWallCost,
  productionCost,
  productionPhase,
  serialise,
  setProduction,
  wallDefenceBonus,
  wallIntegrity,
  MAX_WALL_LEVEL,
  PLAYER_FACTION_ID,
  PRODUCTION_CAP_PER_TURN,
  SAVE_VERSION,
  WALL_HP_PER_LEVEL,
  WALL_TARGET,
  type City,
  type GameState,
  type ProductionResult,
} from '../src/index.js';

const SEED = 'walls';

function start(): GameState {
  return createGameState(SEED);
}

function capital(state: GameState): City {
  const city = [...state.cities.values()].find((c) => c.factionId === PLAYER_FACTION_ID);
  if (!city) throw new Error('the player has no city');
  return city;
}

/** Found the player's first city, so there is something to fortify. */
function withCity(state: GameState): GameState {
  const cities = new Map(state.cities);
  const id = 'city-walls';
  const anchor = [...state.units.values()].find((u) => u.factionId === PLAYER_FACTION_ID);
  if (!anchor) throw new Error('the player has no units');
  cities.set(id, {
    id,
    factionId: PLAYER_FACTION_ID,
    hex: anchor.hex,
    name: 'Bastion',
    kind: 'workspace',
    hp: 200,
    wallLevel: 0,
    wallHp: 0,
    population: 3,
    rank: 'siedlung',
    growthStore: 0,
    boundSkills: [],
    unrest: 0,
    ignoredReviews: 0,
    reviewBonusUntilTurn: 0,
    lastReviewTurn: -1,
    productionProgress: 0,
    lastRaidedTurn: -1,
  });
  return { ...state, cities };
}

function fund(state: GameState, compute: number): GameState {
  const factions = new Map(state.factions);
  const faction = factions.get(PLAYER_FACTION_ID)!;
  factions.set(PLAYER_FACTION_ID, {
    ...faction,
    resources: { ...faction.resources, compute },
  });
  return { ...state, factions };
}

const done = (r: ProductionResult): GameState => {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};

/** A city with everything filled in, so a test can vary one thing honestly. */
function city(over: Partial<City> = {}): City {
  return {
    id: 'c',
    factionId: PLAYER_FACTION_ID,
    hex: { q: 0, r: 0 },
    name: 'x',
    kind: 'workspace',
    hp: 200,
    wallLevel: 0,
    wallHp: 0,
    population: 3,
    rank: 'siedlung',
    growthStore: 0,
    boundSkills: [],
    unrest: 0,
    ignoredReviews: 0,
    reviewBonusUntilTurn: 0,
    lastReviewTurn: -1,
    productionProgress: 0,
    lastRaidedTurn: -1,
    ...over,
  };
}

describe('what a wall costs', () => {
  it('gets dearer with every level and stops at the top', () => {
    const prices = [0, 1, 2].map((level) => nextWallCost(level));
    expect(prices.every((p) => p !== undefined)).toBe(true);
    expect(prices[1]!).toBeGreaterThan(prices[0]!);
    expect(prices[2]!).toBeGreaterThan(prices[1]!);
    expect(nextWallCost(MAX_WALL_LEVEL)).toBeUndefined();
  });

  it('competes with soldiers rather than sitting in its own queue', () => {
    // The plan's whole reason for walls: arming and fortifying draw on the
    // same capped Compute. A first wall should be a real fraction of it.
    expect(nextWallCost(0)!).toBeGreaterThan(PRODUCTION_CAP_PER_TURN);
  });
});

describe('building a wall', () => {
  it('raises the level and comes up at full height', () => {
    let state = fund(withCity(start()), 500);
    state = done(setProduction(state, 'city-walls', WALL_TARGET));

    const cost = nextWallCost(0)!;
    const turns = Math.ceil(cost / PRODUCTION_CAP_PER_TURN);
    for (let i = 0; i < turns; i += 1) {
      state = productionPhase(state, PLAYER_FACTION_ID).state;
    }

    const city = state.cities.get('city-walls')!;
    expect(city.wallLevel).toBe(1);
    expect(city.wallHp).toBe(maxWallHp(1));
    expect(city.wallHp).toBe(WALL_HP_PER_LEVEL);
  });

  it('reports the wall it finished', () => {
    let state = fund(withCity(start()), 500);
    state = done(setProduction(state, 'city-walls', WALL_TARGET));
    let walled: readonly { cityId: string; level: number }[] = [];
    for (let i = 0; i < 12 && walled.length === 0; i += 1) {
      const tick = productionPhase(state, PLAYER_FACTION_ID);
      state = tick.state;
      walled = tick.walled;
    }
    expect(walled).toEqual([{ cityId: 'city-walls', level: 1 }]);
  });

  it('needs no room on the map, unlike a unit', () => {
    // A unit can be blocked by a full tile. A wall is built where the city is.
    let state = fund(withCity(start()), 500);
    state = done(setProduction(state, 'city-walls', WALL_TARGET));
    let blocked: readonly string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const tick = productionPhase(state, PLAYER_FACTION_ID);
      state = tick.state;
      blocked = blocked.concat(tick.blocked);
    }
    expect(blocked).not.toContain('city-walls');
    expect(state.cities.get('city-walls')!.wallLevel).toBeGreaterThan(0);
  });

  it('⚠️ stops on its own at the top rather than completing forever', () => {
    // A full wall costs nothing, and a zero cost completes every single turn.
    let state = fund(withCity(start()), 5000);
    state = done(setProduction(state, 'city-walls', WALL_TARGET));
    for (let i = 0; i < 60; i += 1) {
      state = productionPhase(state, PLAYER_FACTION_ID).state;
    }
    const city = state.cities.get('city-walls')!;
    expect(city.wallLevel).toBe(MAX_WALL_LEVEL);
    expect(city.producing).toBeUndefined();
  });

  it('refuses to order a wall that is already at full height', () => {
    let state = withCity(start());
    const cities = new Map(state.cities);
    cities.set('city-walls', {
      ...state.cities.get('city-walls')!,
      wallLevel: MAX_WALL_LEVEL,
      wallHp: maxWallHp(MAX_WALL_LEVEL),
    });
    state = { ...state, cities };
    const result = setProduction(state, 'city-walls', WALL_TARGET);
    expect(result.ok).toBe(false);
  });

  it('can be cancelled, keeping the Compute already sunk in', () => {
    let state = fund(withCity(start()), 500);
    state = done(setProduction(state, 'city-walls', WALL_TARGET));
    state = productionPhase(state, PLAYER_FACTION_ID).state;
    const sunk = state.cities.get('city-walls')!.productionProgress;
    expect(sunk).toBeGreaterThan(0);

    state = done(cancelProduction(state, 'city-walls'));
    expect(state.cities.get('city-walls')!.producing).toBeUndefined();
    expect(state.cities.get('city-walls')!.productionProgress).toBe(sunk);
  });
});

describe('what a wall is worth', () => {
  const walled = (level: number, hp: number): City =>
    city({ wallLevel: level, wallHp: hp });
  it('reads an unwalled city as zero, not as perfect', () => {
    expect(wallIntegrity(walled(0, 0))).toBe(0);
    expect(wallDefenceBonus(walled(0, 0))).toBe(0);
  });

  it('⚠️ is worth less as it is battered down', () => {
    // Without this a siege faces the same defence on its last assault as its
    // first, which is the flaw hpFactor exists to fix for the city itself.
    const full = wallDefenceBonus(walled(2, maxWallHp(2)));
    const half = wallDefenceBonus(walled(2, maxWallHp(2) / 2));
    const gone = wallDefenceBonus(walled(2, 0));
    expect(full).toBeGreaterThan(half);
    expect(half).toBeGreaterThan(gone);
    expect(gone).toBe(0);
  });

  it('makes a city genuinely harder to take', () => {
    const state = withCity(start());
    const bare = state.cities.get('city-walls')!;
    const fort = { ...bare, wallLevel: MAX_WALL_LEVEL, wallHp: maxWallHp(MAX_WALL_LEVEL) };

    const weak = cityCombatSide(state, bare);
    const strong = cityCombatSide(state, fort);
    expect(strong.effective).toBeGreaterThan(weak.effective);
    // Three levels should roughly double it, not merely nudge it.
    expect(strong.effective).toBeGreaterThan(weak.effective * 1.5);
    expect(strong.fortifyBonus).toBeGreaterThan(0);
  });
});

describe('walls absorb before the city feels it', () => {
  const walled = (level: number, hp: number): City =>
    city({ wallLevel: level, wallHp: hp });

  it('passes everything through when there is no wall', () => {
    expect(absorbWithWalls(walled(0, 0), 30)).toEqual({ wallHp: 0, toCity: 30 });
  });

  it('soaks the blow while the wall stands', () => {
    expect(absorbWithWalls(walled(1, 40), 25)).toEqual({ wallHp: 15, toCity: 0 });
  });

  it('lets the remainder through once the wall is spent', () => {
    expect(absorbWithWalls(walled(1, 10), 25)).toEqual({ wallHp: 0, toCity: 15 });
  });
});

describe('saves', () => {
  it('carries walls through a round trip', () => {
    let state = fund(withCity(start()), 500);
    const cities = new Map(state.cities);
    cities.set('city-walls', {
      ...state.cities.get('city-walls')!,
      wallLevel: 2,
      wallHp: 55,
    });
    state = { ...state, cities };

    // ⚠️ `deserialise` returns the state and throws on a bad save. It is not a
    // result object, and treating it as one silently "fails" every load.
    const loaded = deserialise(serialise(state));
    const city = loaded.cities.get('city-walls')!;
    expect(city.wallLevel).toBe(2);
    expect(city.wallHp).toBe(55);
  });

  it('⚠️ gives an old save no walls rather than free ones', () => {
    // A non-zero default would hand every existing city a wall it never paid
    // for, which is worse than losing a field.
    const state = withCity(start());
    const raw = JSON.parse(serialise(state)) as {
      version: number;
      cities: Record<string, unknown>[];
    };
    raw.version = 7;
    for (const city of raw.cities) {
      delete city.wallLevel;
      delete city.wallHp;
    }

    const loaded = deserialise(JSON.stringify(raw));
    for (const city of loaded.cities.values()) {
      expect(city.wallLevel).toBe(0);
      expect(city.wallHp).toBe(0);
    }
  });

  it('is at the version this change claims', () => {
    // 11 since a game grew seats. The bump matters because the migration for
    // it is a decision rather than a default: one player's map becomes one
    // seat's map, found by reading the old flag rather than by assuming an id.
    expect(SAVE_VERSION).toBe(11);
  });
});

describe('a wall is not a unit', () => {
  it('costs what the wall costs, not what a unit costs', () => {
    let state = fund(withCity(start()), 500);
    state = done(setProduction(state, 'city-walls', WALL_TARGET));
    expect(productionCost(state.cities.get('city-walls')!)).toBe(nextWallCost(0));
  });

  it('musters nobody', () => {
    let state = fund(withCity(start()), 500);
    const before = state.units.size;
    state = done(setProduction(state, 'city-walls', WALL_TARGET));
    for (let i = 0; i < 12; i += 1) {
      state = productionPhase(state, PLAYER_FACTION_ID).state;
    }
    expect(state.units.size).toBe(before);
    expect(state.cities.get('city-walls')!.wallLevel).toBeGreaterThan(0);
  });
});
