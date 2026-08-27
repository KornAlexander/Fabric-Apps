import { describe, it, expect } from 'vitest';
import {
  ANTAGONIST_FACTION_ID,
  PLAYER_FACTION_ID,
  checkOutcome,
  createGameState,
  endTurn,
  foundCity,
  unitsOf,
  type GameState,
} from '../src/index.js';

/**
 * Winning and losing.
 *
 * ⚠️ Each case is built by removing or adding the thing the rule is about,
 * then asserting the outcome flips. A rule that always returned undefined
 * would satisfy "the game is still being played" on every ordinary state, so
 * the tests that matter are the ones that force an ending.
 */

const withoutUnitsOf = (state: GameState, factionId: string): GameState => {
  const units = new Map(state.units);
  for (const [id, unit] of units) if (unit.factionId === factionId) units.delete(id);
  return { ...state, units };
};

const allTopicsKnown = (state: GameState): GameState => ({
  ...state,
  research: { ...state.research, known: state.topics.nodes.map((n) => n.id) },
});

/**
 * Wipe a faction's settlements.
 *
 * ⚠ Needed because every antagonist now holds a village. Killing their units
 * no longer removes them from the map, which is the entire point: Conquest
 * used to be won by hunting fourteen wandering raiders, and is now won by
 * taking or burning seven places.
 */
const withoutCitiesOf = (state: GameState, factionId: string): GameState => {
  const cities = new Map(state.cities);
  for (const [id, city] of cities) {
    if (city.factionId === factionId) cities.delete(id);
  }
  return { ...state, cities };
};

describe('while the game is being played', () => {
  it('reports nothing on a fresh map', () => {
    expect(checkOutcome(createGameState('FABRIC'), PLAYER_FACTION_ID)).toBeUndefined();
  });

  it('reports nothing through an ordinary turn', () => {
    const { report } = endTurn(createGameState('FABRIC'));
    expect(report.outcome).toBeUndefined();
  });
});

describe('defeat', () => {
  it('is losing every unit and every city', () => {
    const state = withoutUnitsOf(createGameState('FABRIC'), PLAYER_FACTION_ID);
    expect(checkOutcome(state, PLAYER_FACTION_ID)?.kind).toBe('defeat');
  });

  it('is not losing your units while a city still stands', () => {
    const base = createGameState('FABRIC');
    const architect = unitsOf(base, PLAYER_FACTION_ID).find((u) => u.typeId === 'architect')!;
    const founded = foundCity(base, architect.id);
    expect(founded.ok).toBe(true);
    if (!founded.ok) return;

    const stripped = withoutUnitsOf(founded.state, PLAYER_FACTION_ID);
    expect(
      [...stripped.cities.values()].filter((c) => c.factionId === PLAYER_FACTION_ID),
    ).toHaveLength(1);
    expect(checkOutcome(stripped, PLAYER_FACTION_ID)).toBeUndefined();
  });

  it('arrives through actual play, on the turn the last unit dies', () => {
    // The horde wipes out a passive player somewhere around turn 11 to 22.
    let state = createGameState('HORDE');
    let ending;
    for (let i = 0; i < 30 && !ending; i++) {
      const turn = endTurn(state);
      state = turn.state;
      ending = turn.report.outcome;
    }
    expect(ending?.kind).toBe('defeat');
    expect(unitsOf(state, PLAYER_FACTION_ID)).toHaveLength(0);
  });
});

describe('conquest', () => {
  it('is driving every rival off the map', () => {
    // Every rival, not just the nearest one. There are seven.
    let state = createGameState('FABRIC');
    for (const id of state.factions.keys()) {
      if (id !== PLAYER_FACTION_ID) {
        state = withoutCitiesOf(withoutUnitsOf(state, id), id);
      }
    }
    expect(checkOutcome(state, PLAYER_FACTION_ID)?.kind).toBe('conquest');
  });

  it('is not declared while a rival still holds a village', () => {
    // Killing every raider is not enough any more. The village is the empire.
    let state = createGameState('FABRIC');
    for (const id of state.factions.keys()) {
      if (id !== PLAYER_FACTION_ID) state = withoutUnitsOf(state, id);
    }
    expect(checkOutcome(state, PLAYER_FACTION_ID)).toBeUndefined();
  });

  it('is not declared while one rival still stands', () => {
    // Clearing six of seven is not a victory, and this is the assertion that
    // would have caught a check that only ever looked at the Silo Horde.
    let state = createGameState('FABRIC');
    const rivals = [...state.factions.keys()].filter((id) => id !== PLAYER_FACTION_ID);
    expect(rivals.length).toBeGreaterThan(1);
    for (const id of rivals.slice(0, -1)) {
      state = withoutCitiesOf(withoutUnitsOf(state, id), id);
    }
    expect(checkOutcome(state, PLAYER_FACTION_ID)).toBeUndefined();
  });

  it('is not declared in a sandbox that never had a rival', () => {
    /*
     * ⚠️ The case that would only have shown up in a demo. With no antagonists
     * every rival is trivially gone, so a naive check hands the player a
     * victory on turn one.
     */
    const state = createGameState('FABRIC', { spawnAntagonists: false });
    expect(state.factions.size).toBe(1);
    expect(checkOutcome(state, PLAYER_FACTION_ID)).toBeUndefined();
    expect(endTurn(state).report.outcome).toBeUndefined();
  });

  it('is not declared while one enemy unit is still alive', () => {
    const state = createGameState('FABRIC');
    expect(unitsOf(state, ANTAGONIST_FACTION_ID).length).toBeGreaterThan(0);
    expect(checkOutcome(state, PLAYER_FACTION_ID)).toBeUndefined();
  });
});

describe('mastery', () => {
  it('is researching the whole tree', () => {
    const state = allTopicsKnown(createGameState('FABRIC'));
    expect(checkOutcome(state, PLAYER_FACTION_ID)?.kind).toBe('mastery');
  });

  it('is not researching most of it', () => {
    const base = createGameState('FABRIC');
    const state: GameState = {
      ...base,
      research: { ...base.research, known: base.topics.nodes.slice(0, -1).map((n) => n.id) },
    };
    expect(checkOutcome(state, PLAYER_FACTION_ID)).toBeUndefined();
  });
});

describe('precedence', () => {
  it('calls it a defeat when the last unit dies on the turn the tree completes', () => {
    // Both conditions at once. An empire with nothing left cannot claim a
    // victory in the same breath.
    const state = withoutUnitsOf(allTopicsKnown(createGameState('FABRIC')), PLAYER_FACTION_ID);
    expect(checkOutcome(state, PLAYER_FACTION_ID)?.kind).toBe('defeat');
  });
});
