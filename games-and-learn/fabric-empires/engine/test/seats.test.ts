/**
 * Seats: taking over an empire nobody is playing.
 *
 * The single-player game had one human and asked "is this the player" all over
 * the rules. Seats make that question "is anybody playing this", which is the
 * same question with a different number of possible answers, and these tests
 * pin the consequences of that change rather than the rename itself.
 *
 * ⚠️ The one that matters most is the memory. Two people sharing one fog is
 * not a cosmetic bug: it hands each of them the other's scouting, silently,
 * and nothing on screen says it happened.
 */

import { describe, expect, it } from 'vitest';
import {
  ANTAGONIST_FACTION_ID,
  PLAYER_FACTION_ID,
  createGameState,
  deserialise,
  endTurn,
  humanFactionIds,
  memoryOf,
  rememberVisible,
  serialise,
  standings,
  takeSeat,
  vacateSeat,
  vacantFactionIds,
  type GameState,
} from '../src/index.js';

const start = (): GameState => createGameState('FABRIC');

describe('who is playing what', () => {
  it('seats one person at the start, and leaves the rest to the machine', () => {
    const state = start();
    expect(humanFactionIds(state)).toEqual([PLAYER_FACTION_ID]);
    expect(vacantFactionIds(state).length).toBeGreaterThan(0);
    expect(vacantFactionIds(state)).toContain(ANTAGONIST_FACTION_ID);
  });

  it('lets somebody sit down in an empty one', () => {
    const state = takeSeat(start(), ANTAGONIST_FACTION_ID);
    expect(humanFactionIds(state)).toContain(ANTAGONIST_FACTION_ID);
    expect(vacantFactionIds(state)).not.toContain(ANTAGONIST_FACTION_ID);
  });

  it('⚠️ refuses a seat somebody is already in, rather than sharing it', () => {
    /*
     * Two people racing for the same chair both get a response; only one of
     * them can be in it. Returning the state unchanged means the loser's click
     * costs nothing, which is the correct answer to a stale join button.
     */
    const once = takeSeat(start(), ANTAGONIST_FACTION_ID);
    const twice = takeSeat(once, ANTAGONIST_FACTION_ID);
    expect(twice).toBe(once);
  });

  it('ignores a seat that does not exist', () => {
    const state = start();
    expect(takeSeat(state, 'nobody-at-all')).toBe(state);
    expect(vacateSeat(state, 'nobody-at-all')).toBe(state);
  });

  it('hands a vacated empire back to the machine, board and all', () => {
    const state = start();
    const townsBefore = [...state.cities.values()].filter(
      (c) => c.factionId === PLAYER_FACTION_ID,
    ).length;

    const left = vacateSeat(state, PLAYER_FACTION_ID);
    expect(humanFactionIds(left)).toEqual([]);
    // The empire is untouched. That is the point of the AI taking it over
    // rather than the seat freezing: it carries on without you.
    expect(
      [...left.cities.values()].filter((c) => c.factionId === PLAYER_FACTION_ID).length,
    ).toBe(townsBefore);
  });
});

describe('what a new arrival knows', () => {
  it('⚠️ starts blind, rather than inheriting what the machine could see', () => {
    /*
     * The AI does not use fog at all (section 21.3), so there is no memory to
     * hand over. Inventing one from its omniscience would gift a joiner the
     * whole map, which is both a cheat and the exact opposite of what the fog
     * is for.
     */
    const state = takeSeat(start(), ANTAGONIST_FACTION_ID);
    expect(memoryOf(state, ANTAGONIST_FACTION_ID).explored.size).toBe(0);
  });

  it('⚠️ does not see through the other seat, which is the whole reason for the change', () => {
    const state = takeSeat(start(), ANTAGONIST_FACTION_ID);
    const looked = rememberVisible(state, PLAYER_FACTION_ID);

    const mine = memoryOf(looked, PLAYER_FACTION_ID).explored;
    const theirs = memoryOf(looked, ANTAGONIST_FACTION_ID).explored;
    expect(mine.size).toBeGreaterThan(0);
    expect(theirs.size).toBe(0);
    for (const key of mine) expect(theirs.has(key)).toBe(false);
  });

  it('gives a seat nobody is playing no memory to pay for', () => {
    // Seven antagonists each carrying a set of hex keys nothing reads is a
    // cost on every turn and in every save.
    const state = endTurn(start()).state;
    for (const id of vacantFactionIds(state)) {
      expect(state.memory.has(id), id).toBe(false);
    }
  });

  it('drops the memory when the chair is given up', () => {
    let state = takeSeat(start(), ANTAGONIST_FACTION_ID);
    state = rememberVisible(state, ANTAGONIST_FACTION_ID);
    expect(memoryOf(state, ANTAGONIST_FACTION_ID).explored.size).toBeGreaterThan(0);

    /*
     * ⚠️ Not kept "in case they come back". Keeping it would let somebody
     * look, leave, and have the next occupant inherit their scouting, and it
     * would carry several thousand hex keys in every save for a person who is
     * no longer in the game.
     */
    state = vacateSeat(state, ANTAGONIST_FACTION_ID);
    expect(state.memory.has(ANTAGONIST_FACTION_ID)).toBe(false);
  });

  it('carries every seat through a save and back', () => {
    let state = takeSeat(start(), ANTAGONIST_FACTION_ID);
    state = rememberVisible(rememberVisible(state, PLAYER_FACTION_ID), ANTAGONIST_FACTION_ID);

    const loaded = deserialise(serialise(state), state.topics);
    expect(humanFactionIds(loaded).sort()).toEqual(
      [PLAYER_FACTION_ID, ANTAGONIST_FACTION_ID].sort(),
    );
    for (const id of humanFactionIds(state)) {
      expect(memoryOf(loaded, id).explored.size, id).toBe(memoryOf(state, id).explored.size);
    }
  });
});

describe('the machine plays what nobody is playing', () => {
  it('⚠️ turns on a vacated empire, so the board never has a dead seat', () => {
    /*
     * A frozen seat would be neither a rival nor a ruin: an empire on the map
     * taking no turns, that everybody else has to walk around. The AI picking
     * it up is what makes leaving a game something other players survive.
     */
    const left = vacateSeat(start(), PLAYER_FACTION_ID);
    const after = endTurn(left).state;
    expect(after.turn).toBe(left.turn + 1);
  });

  it('leaves a seated human alone', () => {
    // `endTurn` runs every faction except the one ending its turn. A human in
    // one of those chairs must not have their army moved for them.
    let state = takeSeat(start(), ANTAGONIST_FACTION_ID);
    const before = [...state.units.values()]
      .filter((u) => u.factionId === ANTAGONIST_FACTION_ID)
      .map((u) => `${u.id}@${u.hex.q},${u.hex.r}`)
      .sort();

    state = endTurn(state).state;
    const after = [...state.units.values()]
      .filter((u) => u.factionId === ANTAGONIST_FACTION_ID)
      .map((u) => `${u.id}@${u.hex.q},${u.hex.r}`)
      .sort();
    expect(after).toEqual(before);
  });
});

describe('how everybody is doing', () => {
  it('ranks the board strongest first, and the shares add up', () => {
    const rows = standings(start());
    expect(rows.length).toBe(start().factions.size);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1]!.share).toBeGreaterThanOrEqual(rows[i]!.share);
    }
    const total = rows.reduce((sum, r) => sum + r.share, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('⚠️ counts an army by health, not by headcount', () => {
    /*
     * Six units at a tenth each is not an army. A joiner who picked that seat
     * on a unit count would sit down into a rout with no warning.
     */
    const state = start();
    const wounded = new Map(state.units);
    for (const [id, unit] of wounded) {
      if (unit.factionId !== ANTAGONIST_FACTION_ID) continue;
      wounded.set(id, { ...unit, hp: 1 });
    }
    const hurt = standings({ ...state, units: wounded }).find(
      (r) => r.factionId === ANTAGONIST_FACTION_ID,
    )!;
    const whole = standings(state).find((r) => r.factionId === ANTAGONIST_FACTION_ID)!;

    expect(hurt.units).toBe(whole.units);
    expect(hurt.strength).toBeLessThan(whole.strength);
  });

  it('⚠️ bands against an even share, not against the leader', () => {
    /*
     * Measured against the leader, a game with one runaway winner would call
     * every other empire "struggling", which is true of none of them except by
     * comparison and tells a joiner nothing about which chair to pick.
     *
     * The seven antagonists start identically: one village, two citizens, two
     * units each. So the honest assertion is that the banding invents no
     * difference between empires that have none.
     */
    const rows = standings(start()).filter((r) => r.control === 'ai');
    expect(rows.length).toBeGreaterThan(1);
    const bands = new Set(rows.map((r) => r.band));
    expect([...bands]).toEqual(['holding']);
  });

  it('⚠️ calls the player struggling on turn one, and that is CORRECT', () => {
    /*
     * Surprising, and true: the player opens with an Architect and no town,
     * while every antagonist opens holding a village. Until that Architect
     * founds something, the player really does hold nothing.
     *
     * Written down because it looks exactly like a scoring bug, and the first
     * instinct on seeing "struggling" over a fresh empire is to weight the
     * formula until it goes away. The number is not wrong; the empire is
     * genuinely empty for a turn or two. Anybody using this screen is judging
     * an empire that has been played for thirty turns, where it says something.
     */
    const player = standings(start()).find((r) => r.factionId === PLAYER_FACTION_ID)!;
    expect(player.cities).toBe(0);
    expect(player.band).toBe('struggling');
  });

  it('says who is playing each one, which is what the join screen filters on', () => {
    const state = takeSeat(start(), ANTAGONIST_FACTION_ID);
    const rows = standings(state);
    expect(rows.find((r) => r.factionId === ANTAGONIST_FACTION_ID)!.control).toBe('human');
    const vacant = rows.filter((r) => r.control === 'ai').map((r) => r.factionId);
    expect(vacant).toEqual(vacantFactionIds(state));
  });
});
