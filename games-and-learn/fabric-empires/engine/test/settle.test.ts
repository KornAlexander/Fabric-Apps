/**
 * Where to put the next city.
 *
 * ⚠️ **The thing worth testing is that the advice prefers what it says it
 * prefers.** A scoring function is trivially "correct" in the sense that it
 * returns a number, and completely wrong in the sense that matters, which is
 * the ordering it produces. So these build small hand-made maps where the
 * right answer is known and check that it comes first.
 */

import { describe, it, expect } from 'vitest';
import {
  memoryOf,
  GROWTH_WEIGHT,
  PLAYER_FACTION_ID,
  createGameState,
  dataAtFounding,
  growthThreshold,
  hexKey,
  hexSpiral,
  settleScore,
  settleSites,
  turnsToFirstCitizen,
  unitsOf,
  type GameState,
  type Hex,
  type TerrainId,
  type Unit,
} from '../src/index.js';

const fresh = (): GameState =>
  createGameState('FABRIC', { spawnAntagonists: false });

/** The player's Architect, which every game starts with. */
function architect(state: GameState): Unit {
  const found = unitsOf(state, PLAYER_FACTION_ID).find((u) => u.typeId === 'architect');
  if (!found) throw new Error('the player starts with no Architect');
  return found;
}

/** Repaint a tile, so a site's quality can be stated rather than searched for. */
function paint(state: GameState, hex: Hex, terrain: TerrainId, river = false): GameState {
  const key = hexKey(hex);
  const tile = state.map.tiles.get(key);
  if (!tile) throw new Error(`no tile at ${key}`);
  const tiles = new Map(state.map.tiles);
  tiles.set(key, { ...tile, terrain, river });
  return { ...state, map: { ...state.map, tiles } };
}

/** Explore everything, so the fog is not what is being tested. */
function reveal(state: GameState): GameState {
  const memory = new Map(state.memory);
  memory.set(PLAYER_FACTION_ID, {
    ...memoryOf(state, PLAYER_FACTION_ID),
    explored: new Set(state.map.tiles.keys()),
  });
  return { ...state, memory };
}

/** Repaint an entire work radius, so a site's yield is known and not guessed. */
function paintArea(state: GameState, centre: Hex, terrain: TerrainId): GameState {
  let next = state;
  for (const hex of hexSpiral(centre, 2)) {
    if (state.map.tiles.has(hexKey(hex))) next = paint(next, hex, terrain);
  }
  return next;
}

describe('turns to the first citizen', () => {
  it('⚠️ does not deduct subsistence, because the game does not', () => {
    /*
     * `subsistenceNeed` biases which tiles a city works. The turn pipeline
     * adds the whole Data output to the growth store without subtracting
     * anything, so an estimate that deducted it would be showing the player a
     * rule that does not exist.
     */
    expect(growthThreshold(1)).toBe(18);
    expect(turnsToFirstCitizen(3)).toBe(6);
    expect(turnsToFirstCitizen(18)).toBe(1);
    expect(turnsToFirstCitizen(4)).toBe(5); // 18/4 = 4.5, rounded up
  });

  it('says never rather than a very large number', () => {
    expect(turnsToFirstCitizen(0)).toBeUndefined();
    expect(turnsToFirstCitizen(-1)).toBeUndefined();
  });
});

describe('⚠️ the score prioritises growth', () => {
  /*
   * The point of the whole exercise. A site ringed with Capacity Units is
   * worth more per tile than one ringed with Raw File Plains, and it is the
   * worse city, because every citizen works another tile and only Data buys
   * citizens. This is the trap the advice exists to steer around.
   */
  const centre: Hex = { q: 0, r: 0 };

  it('prefers Data-rich ground to Capacity-rich ground', () => {
    /*
     * ⚠️ The whole work radius is painted, not just the six neighbours. The
     * first version painted only the inner ring and left the outer one as the
     * map generated it, so the comparison depended on whatever happened to be
     * two hexes away and was not really a comparison at all.
     */
    const fed = paintArea(fresh(), centre, 'rawFilePlains');
    const rich = paint(paintArea(fresh(), centre, 'geothermalVent'), centre, 'rawFilePlains');
    expect(settleScore(fed, centre)).toBeGreaterThan(settleScore(rich, centre));
  });

  it('⚠️ keeps one Data tile worth more than one Capacity tile', () => {
    /*
     * The arithmetic the weighting has to satisfy, stated directly. A plains
     * tile is 2 Data and a vent tile is 3 Capacity at a weight of 1.3, so
     * growth has to clear 1.95 or the advice recommends the trap it exists to
     * warn about. It was briefly set to 1.6.
     */
    expect(2 * GROWTH_WEIGHT).toBeGreaterThan(3 * 1.3);
  });

  it('still values a river', () => {
    const dry = paint(fresh(), centre, 'rawFilePlains', false);
    const wet = paint(fresh(), centre, 'rawFilePlains', true);
    expect(settleScore(wet, centre)).toBeGreaterThan(settleScore(dry, centre));
  });
});

describe('what a city here would collect', () => {
  it('⚠️ uses the real tile picker rather than an estimate', () => {
    /*
     * `workedTiles` is subsistence aware: a hungry city values Data at triple
     * when choosing what to work, which is exactly the rule that decides
     * whether a site grows at all. Reusing it means the number shown cannot
     * drift from the number the game produces.
     *
     * ⚠️ **The whole work radius is painted, not just one neighbour.** The
     * first version of this test painted the centre and one adjacent tile and
     * expected both to be worked. They were not: a size-one city works exactly
     * one tile besides its centre, and it picked a Capacity vent two hexes
     * away instead, because at 2 Data it is not *below* subsistence and so
     * stops favouring food. That is the trap this whole feature exists to warn
     * about, and it turned up first in the test for it.
     */
    const centre: Hex = { q: 0, r: 0 };
    const state = paintArea(fresh(), centre, 'rawFilePlains');
    // Centre plus the one tile a size-one city works, both worth 2 Data.
    expect(dataAtFounding(state, centre)).toBe(4);
  });

  it('⚠️ reports the poor site as poor', () => {
    // The other half of the same claim: ground with no food on it says so.
    const centre: Hex = { q: 0, r: 0 };
    const state = paintArea(fresh(), centre, 'parquetQuarry');
    expect(dataAtFounding(state, centre)).toBe(0);
    expect(turnsToFirstCitizen(dataAtFounding(state, centre))).toBeUndefined();
  });

  it('reports something for any settleable tile', () => {
    const state = reveal(fresh());
    for (const site of settleSites(state, architect(state))) {
      expect(site.dataAtFounding).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('the proposals', () => {
  it('offers nothing for a unit that cannot found', () => {
    const state = reveal(fresh());
    const soldier = unitsOf(state, PLAYER_FACTION_ID).find((u) => u.typeId !== 'architect');
    if (!soldier) return;
    expect(settleSites(state, soldier)).toEqual([]);
  });

  it('offers somewhere for the Architect the game starts with', () => {
    const state = reveal(fresh());
    const sites = settleSites(state, architect(state));
    expect(sites.length).toBeGreaterThan(0);
  });

  it('comes back best first', () => {
    const state = reveal(fresh());
    const sites = settleSites(state, architect(state));
    for (let i = 1; i < sites.length; i += 1) {
      expect(sites[i - 1]!.score).toBeGreaterThanOrEqual(sites[i]!.score);
    }
  });

  it('⚠️ never proposes ground the player has not explored', () => {
    /*
     * Advice that points at unexplored tiles is the game handing over the
     * shape of the map, which is the one thing the fog is for.
     */
    const state = fresh();
    const sites = settleSites(state, architect(state));
    for (const site of sites) {
      expect(memoryOf(state, PLAYER_FACTION_ID).explored.has(hexKey(site.hex)), hexKey(site.hex)).toBe(true);
    }
  });

  it('proposes only legal sites', () => {
    const state = reveal(fresh());
    const unit = architect(state);
    for (const site of settleSites(state, unit)) {
      // Every one must survive the rule founding itself applies.
      for (const city of state.cities.values()) {
        const dq = city.hex.q - site.hex.q;
        const dr = city.hex.r - site.hex.r;
        const distance = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
        expect(distance).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('is deterministic, so the same position always advises the same thing', () => {
    const state = reveal(fresh());
    const unit = architect(state);
    const once = settleSites(state, unit).map((s) => hexKey(s.hex));
    const twice = settleSites(state, unit).map((s) => hexKey(s.hex));
    expect(once).toEqual(twice);
  });

  it('says which of them could be reached this turn', () => {
    const state = reveal(fresh());
    const sites = settleSites(state, architect(state));
    const here = sites.find((s) => s.distance === 0);
    // Wherever it is standing is trivially reachable, when it is legal at all.
    if (here) expect(here.reachableNow).toBe(true);
  });

  it('keeps the list short enough to be advice', () => {
    const state = reveal(fresh());
    expect(settleSites(state, architect(state)).length).toBeLessThanOrEqual(5);
    expect(settleSites(state, architect(state), 2).length).toBeLessThanOrEqual(2);
  });
});
