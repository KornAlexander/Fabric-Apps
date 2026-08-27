import { describe, expect, it } from 'vitest';
import {
  memoryOf,
  ANTAGONIST_FACTION_ID,
  PLAYER_FACTION_ID,
  createGameState,
  deserialise,
  hexKey,
  rememberVisible,
  serialise,
  unitsOf,
  type City,
  type GameState,
} from '../src/index.js';

/*
  Towns you have found, and the fog closing over them.

  The rule this replaces refused to draw a remembered town at all, on the
  grounds that keeping it would give "a permanent live readout of a place they
  walked past once, including whether it still stands after somebody else took
  it". That objection is right, and these tests are mostly about honouring it
  while still answering "where did I find it".

  So the thing kept is a SNAPSHOT. It goes stale, it is the player's alone, and
  it is forgotten when the player can see the ground is empty.
*/

function withCity(state: GameState, city: Partial<City> & { hex: City['hex'] }): GameState {
  const cities = new Map(state.cities);
  const id = city.id ?? `c-${cities.size + 1}`;
  cities.set(id, {
    id,
    factionId: ANTAGONIST_FACTION_ID,
    name: 'Farsight',
    kind: 'workspace',
    rank: 'siedlung',
    population: 2,
    hp: 200,
    wallLevel: 0,
    wallHp: 0,
    ...city,
  } as City);
  return { ...state, cities };
}

/** A hex next to the player's first unit, so it starts inside their sight. */
function beside(state: GameState) {
  const unit = unitsOf(state, PLAYER_FACTION_ID)[0]!;
  return { q: unit.hex.q + 1, r: unit.hex.r };
}

describe('finding a town', () => {
  it('records it once seen', () => {
    const base = createGameState('FABRIC');
    const hex = beside(base);
    const state = rememberVisible(withCity(base, { hex }), PLAYER_FACTION_ID);

    const seen = memoryOf(state, PLAYER_FACTION_ID).seenCities.get(hexKey(hex));
    expect(seen).toBeDefined();
    expect(seen!.name).toBe('Farsight');
    expect(seen!.factionId).toBe(ANTAGONIST_FACTION_ID);
    expect(seen!.turnSeen).toBe(state.turn);
  });

  it('⚠️ keeps it after it leaves sight', () => {
    const base = createGameState('FABRIC');
    const hex = beside(base);
    const found = rememberVisible(withCity(base, { hex }), PLAYER_FACTION_ID);

    // Every player unit vanishes: nothing can see anything any more.
    const blind: GameState = { ...found, units: new Map() };
    const later = rememberVisible(blind, PLAYER_FACTION_ID);

    expect(memoryOf(later, PLAYER_FACTION_ID).seenCities.get(hexKey(hex))).toBeDefined();
  });

  it('⚠️ keeps the OLD picture when the town changes hands unseen', () => {
    /*
     * The heart of the design. A live readout would flip the banner the
     * instant it changed; a memory cannot know, so it keeps showing what was
     * seen until somebody goes back and looks.
     */
    const base = createGameState('FABRIC');
    const hex = beside(base);
    const found = rememberVisible(withCity(base, { hex, id: 'target' }), PLAYER_FACTION_ID);
    expect(memoryOf(found, PLAYER_FACTION_ID).seenCities.get(hexKey(hex))!.factionId).toBe(ANTAGONIST_FACTION_ID);

    const cities = new Map(found.cities);
    cities.set('target', { ...cities.get('target')!, factionId: 'scan-wraiths' });
    const blind: GameState = { ...found, cities, units: new Map() };
    const later = rememberVisible(blind, PLAYER_FACTION_ID);

    expect(memoryOf(later, PLAYER_FACTION_ID).seenCities.get(hexKey(hex))!.factionId).toBe(ANTAGONIST_FACTION_ID);
  });

  it('updates the picture when it is seen again', () => {
    const base = createGameState('FABRIC');
    const hex = beside(base);
    const found = rememberVisible(withCity(base, { hex, id: 'target' }), PLAYER_FACTION_ID);

    const cities = new Map(found.cities);
    cities.set('target', { ...cities.get('target')!, factionId: 'scan-wraiths' });
    const looked = rememberVisible({ ...found, cities }, PLAYER_FACTION_ID);

    expect(memoryOf(looked, PLAYER_FACTION_ID).seenCities.get(hexKey(hex))!.factionId).toBe('scan-wraiths');
  });

  it('⚠️ forgets a town that is visibly no longer there', () => {
    /*
     * Without this a razed village haunts the map for ever, and the one place
     * the player could check, by walking back to it, is exactly where the lie
     * would survive.
     */
    const base = createGameState('FABRIC');
    const hex = beside(base);
    const found = rememberVisible(withCity(base, { hex, id: 'target' }), PLAYER_FACTION_ID);
    expect(memoryOf(found, PLAYER_FACTION_ID).seenCities.has(hexKey(hex))).toBe(true);

    const cities = new Map(found.cities);
    cities.delete('target');
    const razed = rememberVisible({ ...found, cities }, PLAYER_FACTION_ID);

    expect(memoryOf(razed, PLAYER_FACTION_ID).seenCities.has(hexKey(hex))).toBe(false);
  });
});

describe('whose memory it is', () => {
  it('⚠️ an antagonist looking at a town does not fill the player\'s map', () => {
    /*
     * `rememberVisible` runs for every faction, and the seven antagonists
     * roam the whole map. Without the guard the player would be handed the
     * entire town list within a few turns while the ground stayed dark, which
     * reads as the fog being broken rather than as a feature.
     */
    const base = createGameState('FABRIC');
    const foe = unitsOf(base, ANTAGONIST_FACTION_ID)[0]!;
    const hex = { q: foe.hex.q + 1, r: foe.hex.r };
    const state = rememberVisible(withCity(base, { hex }), ANTAGONIST_FACTION_ID);

    expect(memoryOf(state, PLAYER_FACTION_ID).seenCities.size).toBe(0);
  });
});

describe('the memory in the save', () => {
  it('survives a round trip', () => {
    const base = createGameState('FABRIC');
    const hex = beside(base);
    const found = rememberVisible(withCity(base, { hex }), PLAYER_FACTION_ID);

    const loaded = deserialise(serialise(found));
    const seen = memoryOf(loaded, PLAYER_FACTION_ID).seenCities.get(hexKey(hex));
    expect(seen).toBeDefined();
    expect(seen!.name).toBe('Farsight');
  });

  it('⚠️ carries no hit points, because those are live state', () => {
    const base = createGameState('FABRIC');
    const hex = beside(base);
    const found = rememberVisible(withCity(base, { hex, hp: 137 }), PLAYER_FACTION_ID);

    const seen = memoryOf(found, PLAYER_FACTION_ID).seenCities.get(hexKey(hex))! as unknown as Record<string, unknown>;
    expect(seen.hp).toBeUndefined();
    expect(seen.wallHp).toBeUndefined();
  });

  it('⚠️ gives a save from before the feature an EMPTY memory, not a full one', () => {
    /*
     * The tempting migration is to photograph every town on explored ground.
     * It would be a lie in the player's favour: a picture of towns as they are
     * today, labelled as something seen on turn four, including places that
     * have changed hands since. Blank is simply true.
     */
    const base = createGameState('FABRIC');
    const found = rememberVisible(withCity(base, { hex: beside(base) }), PLAYER_FACTION_ID);

    /*
     * A version-9 save, built by taking the current one apart.
     *
     * ⚠️ The fixture is ASSERTED to be legacy-shaped below before anything is
     * concluded from it. A hand-rolled \"old\" save that quietly still carries
     * the new fields would pass this test by skipping the migration entirely,
     * and would report the migration as working on the day it stopped.
     */
    const current = JSON.parse(serialise(found)) as Record<string, unknown>;
    const memory = memoryOf(found, PLAYER_FACTION_ID);
    const old: Record<string, unknown> = {
      ...current,
      version: 9,
      explored: [...memory.explored],
      factions: [...found.factions.values()].map(({ control, ...rest }) => ({
        ...rest,
        isPlayer: control === 'human',
      })),
    };
    delete old.memory;
    delete old.seenCities;

    expect(old.memory, 'the fixture must predate per-seat memory').toBeUndefined();
    expect(
      (old.factions as readonly { isPlayer?: boolean }[]).some((f) => f.isPlayer === true),
      'the fixture must carry the old isPlayer flag',
    ).toBe(true);
    expect(memory.seenCities.size, 'and the town really was remembered before').toBeGreaterThan(0);

    const loaded = deserialise(JSON.stringify(old));
    expect(memoryOf(loaded, PLAYER_FACTION_ID).seenCities.size).toBe(0);
    // The ground survives the migration even though the pictures do not.
    expect(memoryOf(loaded, PLAYER_FACTION_ID).explored.size).toBe(memory.explored.size);
  });
});
