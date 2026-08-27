import { describe, expect, it } from 'vitest';
import {
  createGameState,
  garrisonPhase,
  maxWallHp,
  wallIntegrity,
  GARRISON_INTERVAL_TURNS,
  MAX_GARRISON_PER_FACTION,
  MAX_WALL_LEVEL,
  PLAYER_FACTION_ID,
  WALL_MEND_PER_CYCLE,
  type City,
  type GameState,
  type Unit,
} from '../src/index.js';

/**
 * Antagonists fortify.
 *
 * Section 19.2: "The AI must understand walls." D423 taught it not to batter a
 * fortress it cannot break; this is the other half, without which walls are
 * something only the player ever has and half the siege system is never
 * exercised in an actual game.
 */

const SEED = 'ai-walls';

/** An antagonist faction id that exists on every generated map. */
function antagonist(state: GameState): string {
  const other = [...state.factions.values()].find((f) => f.control === 'ai');
  if (!other) throw new Error('no antagonist faction');
  return other.id;
}

/** Give a faction exactly this many standing units, and one city. */
function stage(
  count: number,
  cityOver: Partial<City> = {},
): { state: GameState; factionId: string; cityId: string } {
  const base = createGameState(SEED);
  const factionId = antagonist(base);

  const units = new Map<string, Unit>();
  for (let i = 0; i < count; i += 1) {
    units.set(`u${i}`, {
      id: `u${i}`,
      typeId: 'pipelineRunner',
      factionId,
      hex: { q: 40 + i, r: 0 },
      hp: 100,
      movesLeft: 1,
      fortified: false,
    });
  }

  const cities = new Map<string, City>();
  const cityId = 'ai-city';
  cities.set(cityId, {
    id: cityId,
    factionId,
    hex: { q: 0, r: 0 },
    name: 'Silo',
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
    // Poised so the very next tick fires, rather than waiting six turns.
    productionProgress: GARRISON_INTERVAL_TURNS - 1,
    lastRaidedTurn: -1,
    ...cityOver,
  });

  return { state: { ...base, units, cities }, factionId, cityId };
}

describe('an antagonist at full strength digs in', () => {
  it('raises a wall level with the spare cycle', () => {
    const { state, factionId, cityId } = stage(MAX_GARRISON_PER_FACTION);
    const after = garrisonPhase(state, factionId).state;
    const city = after.cities.get(cityId)!;
    expect(city.wallLevel).toBe(1);
    expect(city.wallHp).toBe(maxWallHp(1));
  });

  it('keeps going, one level per cycle, and then stops', () => {
    let { state } = stage(MAX_GARRISON_PER_FACTION);
    const factionId = antagonist(state);
    for (let i = 0; i < GARRISON_INTERVAL_TURNS * (MAX_WALL_LEVEL + 3); i += 1) {
      state = garrisonPhase(state, factionId).state;
    }
    const city = state.cities.get('ai-city')!;
    expect(city.wallLevel).toBe(MAX_WALL_LEVEL);
    expect(wallIntegrity(city)).toBe(1);
  });

  it('⚠️ mends a breach by patching it, not by rebuilding it', () => {
    /*
     * This test used to assert the wall came back to full height in a single
     * cycle, which is what it did. That was the deadlock: a free repair of 120
     * hit points every six turns outran every besieger in the game except the
     * heaviest, so a level-three city simply could not be taken. The test
     * passed the whole time, because it was asserting the defect.
     *
     * A mend is now a patch. It makes progress, it never exceeds the wall's own
     * height, and enough cycles still finish the job.
     */
    const { state, factionId, cityId } = stage(MAX_GARRISON_PER_FACTION, {
      wallLevel: 2,
      wallHp: 3,
    });

    const once = garrisonPhase(state, factionId).state.cities.get(cityId)!;
    expect(once.wallLevel).toBe(2);
    expect(once.wallHp).toBeGreaterThan(3);
    expect(once.wallHp).toBeLessThan(maxWallHp(2));
    expect(once.wallHp).toBe(3 + WALL_MEND_PER_CYCLE);
  });

  it('gets there in the end, and stops at the wall it has', () => {
    let { state, factionId, cityId } = stage(MAX_GARRISON_PER_FACTION, {
      wallLevel: 2,
      wallHp: 3,
    });
    for (let i = 0; i < GARRISON_INTERVAL_TURNS * 12; i += 1) {
      state = garrisonPhase(state, factionId).state;
    }
    const city = state.cities.get(cityId)!;
    // It carries on to the full height once the breach is patched.
    expect(city.wallLevel).toBe(MAX_WALL_LEVEL);
    expect(city.wallHp).toBe(maxWallHp(MAX_WALL_LEVEL));
  });
});

describe('⚠️ troops come first', () => {
  it('raises a unit rather than a wall while below the cap', () => {
    // The failure this guards against: an AI that fortifies instead of
    // defending would be easier to beat, not harder, and would stop being a
    // threat entirely.
    const { state, factionId, cityId } = stage(0);
    const result = garrisonPhase(state, factionId);
    const city = result.state.cities.get(cityId)!;
    expect(city.wallLevel).toBe(0);
    expect(result.events.length).toBe(1);
  });

  it('goes back to raising troops after losing one', () => {
    // Wall up at the cap...
    let { state, factionId, cityId } = stage(MAX_GARRISON_PER_FACTION);
    state = garrisonPhase(state, factionId).state;
    expect(state.cities.get(cityId)!.wallLevel).toBe(1);

    // ...then lose a unit, and the next ready cycle should replace it.
    const units = new Map(state.units);
    units.delete('u0');
    const cities = new Map(state.cities);
    cities.set(cityId, {
      ...state.cities.get(cityId)!,
      productionProgress: GARRISON_INTERVAL_TURNS - 1,
    });
    state = { ...state, units, cities };

    const result = garrisonPhase(state, factionId);
    expect(result.events.length).toBe(1);
    // The wall it already built is not spent on the replacement.
    expect(result.state.cities.get(cityId)!.wallLevel).toBe(1);
  });
});

describe('the player is not affected', () => {
  it('never fortifies a player city, because the phase skips them', () => {
    const { state } = stage(MAX_GARRISON_PER_FACTION);
    const cities = new Map(state.cities);
    cities.set('ai-city', { ...state.cities.get('ai-city')!, factionId: PLAYER_FACTION_ID });
    const mine = { ...state, cities };

    const after = garrisonPhase(mine, PLAYER_FACTION_ID).state;
    expect(after.cities.get('ai-city')!.wallLevel).toBe(0);
  });
});
