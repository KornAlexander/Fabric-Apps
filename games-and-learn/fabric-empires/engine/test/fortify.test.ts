/**
 * Fortifying, and getting back up again.
 *
 * ⚠️ **This file exists because a fortified unit could never move again.**
 *
 * The pieces all looked right in isolation, which is why it survived so long.
 * `fortifyUnit` sets `movesLeft: 0`, which is correct: digging in should cost
 * you the rest of your turn. The refresh phase then hands a fortified unit 0
 * movement every turn, which is also defensible: a unit that is dug in should
 * not appear in the "units still to move" nag every turn. And `moveUnit`
 * clears the `fortified` flag, so being ordered elsewhere wakes you up, which
 * is exactly the right rule.
 *
 * Put together, they deadlock. `moveUnit` rejects any unit with no movement
 * before it ever reaches the line that clears the flag, and a fortified unit
 * never has any movement. So the wake-up path was real, correct, and
 * **unreachable**, and the only thing on the map that could clear the flag was
 * being raided by an enemy.
 */

import { describe, it, expect } from 'vitest';
import {
  PLAYER_FACTION_ID,
  createGameState,
  endTurn,
  fortifyUnit,
  idleUnits,
  moveUnit,
  reachable,
  unitType,
  unitsOf,
  wakeUnit,
  type ActionResult,
  type GameState,
  type Unit,
} from '../src/index.js';

/**
 * Take the state out of an action, or fail with the engine's own reason.
 *
 * ⚠️ `ActionResult` is a discriminated union, so `result.state!` does not
 * type-check: the failure branch has no `state` at all. Narrowing here also
 * means a test that breaks reports "Civilians cannot fortify" rather than
 * "cannot read property of undefined".
 */
function done(result: ActionResult): GameState {
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

/** A state with one of the player's soldiers picked out, on a real map. */
function withSoldier(): { state: GameState; unit: Unit } {
  const state = createGameState('FABRIC', { topics: { nodes: [] } });
  const soldier = unitsOf(state, PLAYER_FACTION_ID).find(
    (u) => unitType(u.typeId).strength > 0,
  );
  if (!soldier) throw new Error('the player starts with no soldier');
  return { state, unit: soldier };
}

/** Run a whole turn, so the refresh phase gets its say. */
function nextTurn(state: GameState): GameState {
  return endTurn(state, {}).state;
}

const find = (state: GameState, id: string): Unit => {
  const unit = state.units.get(id);
  if (!unit) throw new Error(`unit ${id} is gone`);
  return unit;
};

describe('fortifying', () => {
  it('costs the rest of this turn', () => {
    const { state, unit } = withSoldier();
    const result = fortifyUnit(state, unit.id);
    expect(result.ok).toBe(true);
    const dug = find(done(result), unit.id);
    expect(dug.fortified).toBe(true);
    expect(dug.movesLeft).toBe(0);
  });

  it('keeps the unit out of the end-of-turn nag', () => {
    // The reason the refresh phase withholds movement in the first place.
    const { state, unit } = withSoldier();
    const dug = nextTurn(done(fortifyUnit(state, unit.id)));
    expect(idleUnits(dug, PLAYER_FACTION_ID).map((u) => u.id)).not.toContain(unit.id);
  });

  it('cannot be done twice', () => {
    const { state, unit } = withSoldier();
    const once = done(fortifyUnit(state, unit.id));
    expect(fortifyUnit(once, unit.id).ok).toBe(false);
  });
});

describe('⚠️ waking up', () => {
  it('gives the unit its movement back on the turn it is woken', () => {
    const { state, unit } = withSoldier();
    const dug = nextTurn(done(fortifyUnit(state, unit.id)));
    // ⚠️ The whole point. A dug-in unit gets its movement like everybody
    // else, which is what makes waking possible at all.
    expect(find(dug, unit.id).movesLeft).toBe(unitType(unit.typeId).movement);

    const woken = wakeUnit(dug, unit.id);
    expect(woken.ok).toBe(true);
    const up = find(done(woken), unit.id);
    expect(up.fortified).toBe(false);
    expect(up.movesLeft).toBe(unitType(up.typeId).movement);
  });

  it('⚠️ leaves the unit somewhere it can actually walk to', () => {
    /*
     * `movesLeft` being right is not the same claim as the unit being able to
     * move. This asks the pathfinder, which is what the interface asks when it
     * decides which tiles to light up.
     *
     * ⚠️ `reachable` includes the tile the unit is standing on, at cost zero,
     * so "cannot go anywhere" is a set of size one rather than an empty one.
     * The first version of this test asserted zero and failed for that reason,
     * which is a fact about the pathfinder and not about fortifying.
     */
    const { state, unit } = withSoldier();
    const dug = done(fortifyUnit(state, unit.id));
    const stuck = [...reachable(dug, find(dug, unit.id)).values()].filter((r) => r.cost > 0);
    expect(stuck).toEqual([]);

    const woken = nextTurn(dug);
    const free = [...reachable(woken, find(woken, unit.id)).values()].filter((r) => r.cost > 0);
    expect(free.length).toBeGreaterThan(0);
  });

  it('can then be ordered somewhere, which is the point of waking it', () => {
    const { state, unit } = withSoldier();
    const dug = nextTurn(done(fortifyUnit(state, unit.id)));
    const woken = done(wakeUnit(dug, unit.id));

    // ⚠️ `cost > 0`, because the unit's own tile is in the reachable set and
    // moving to it comes back "Already there", which is a true statement
    // about the test and not about the game.
    const target = [...reachable(woken, find(woken, unit.id)).values()].find(
      (r) => r.cost > 0,
    )!;
    const moved = moveUnit(woken, unit.id, target.hex);
    expect(moved.ok, moved.ok ? '' : moved.reason).toBe(true);
  });

  it('comes back into the nag list, having something to do again', () => {
    const { state, unit } = withSoldier();
    const dug = nextTurn(done(fortifyUnit(state, unit.id)));
    const woken = done(wakeUnit(dug, unit.id));
    expect(idleUnits(woken, PLAYER_FACTION_ID).map((u) => u.id)).toContain(unit.id);
  });

  it('refuses politely on a unit that was never dug in', () => {
    const { state, unit } = withSoldier();
    const result = wakeUnit(state, unit.id);
    expect(result.ok).toBe(false);
  });

  it('refuses on somebody else\'s unit', () => {
    const state = createGameState('FABRIC', { topics: { nodes: [] } });
    const theirs = [...state.units.values()].find(
      (u) => u.factionId !== PLAYER_FACTION_ID,
    );
    if (!theirs) throw new Error('no rival units on this seed');
    expect(wakeUnit(state, theirs.id).ok).toBe(false);
  });

  it('⚠️ does not refund the turn that was spent digging in', () => {
    /*
     * Waking must not be a way to move twice. Fortifying costs the rest of the
     * turn, so changing your mind on the same turn leaves you with the nothing
     * you just spent. Otherwise fortify-then-wake is a free movement reset for
     * a unit that had already walked.
     */
    const { state, unit } = withSoldier();
    const dug = done(fortifyUnit(state, unit.id));
    expect(find(dug, unit.id).movesLeft).toBe(0);

    const woken = done(wakeUnit(dug, unit.id));
    expect(find(woken, unit.id).movesLeft).toBe(0);
  });
});

describe('⚠️ the deadlock that was', () => {
  it('a fortified unit is not stuck for ever', () => {
    /*
     * The regression test, written as the original symptom rather than as a
     * statement about flags: play ten turns while dug in, then walk away.
     * Before the fix this failed at the last line for ever, because the
     * refresh phase handed a fortified unit zero movement and `moveUnit`
     * rejects a unit with no movement several lines before it reaches the one
     * that would have cleared the flag.
     */
    const { state, unit } = withSoldier();
    let current = done(fortifyUnit(state, unit.id));
    for (let turn = 0; turn < 10; turn += 1) current = nextTurn(current);

    expect(find(current, unit.id).fortified).toBe(true);
    const target = [...reachable(current, find(current, unit.id)).values()].find(
      (r) => r.cost > 0,
    )!;
    const moved = moveUnit(current, unit.id, target.hex);
    expect(moved.ok, moved.ok ? '' : moved.reason).toBe(true);
  });

  it('⚠️ being ordered to move is itself the wake-up', () => {
    // The documented rule, "until the unit is ordered elsewhere", and the one
    // every 4X player tries first. It was correct code that could never run.
    const { state, unit } = withSoldier();
    const dug = nextTurn(done(fortifyUnit(state, unit.id)));
    const target = [...reachable(dug, find(dug, unit.id)).values()].find((r) => r.cost > 0)!;
    const moved = done(moveUnit(dug, unit.id, target.hex));
    expect(find(moved, unit.id).fortified).toBe(false);
  });

  it('⚠️ keeps its defence bonus for as long as it stays dug in', () => {
    // The fix hands fortified units their movement back, so it must not have
    // quietly turned fortifying into a no-op.
    const { state, unit } = withSoldier();
    const dug = nextTurn(done(fortifyUnit(state, unit.id)));
    expect(find(dug, unit.id).fortified).toBe(true);
  });
});

describe('mending while dug in', () => {
  /*
   * ⚠️ **Nothing in the game healed a unit before this.** Cities repaired
   * walls and grew hit points back through rank; a wounded unit stayed wounded
   * for the rest of the game. That compounds, because `hpFactor` scales
   * strength by health, so one bad fight permanently devalued a unit and the
   * only cure was to lose it and build another.
   */

  /** The same soldier, hurt, so there is something to mend. */
  function wounded(hp: number): { state: GameState; unit: Unit } {
    const { state, unit } = withSoldier();
    const units = new Map(state.units);
    units.set(unit.id, { ...unit, hp });
    return { state: { ...state, units }, unit };
  }

  it('gives a fortified unit some of its health back each turn', () => {
    const { state, unit } = wounded(40);
    const after = nextTurn(done(fortifyUnit(state, unit.id)));
    expect(find(after, unit.id).hp).toBeGreaterThan(40);
  });

  it('⚠️ heals nothing at all when the unit has not dug in', () => {
    /*
     * The cost that makes the rule a decision. A unit that stops to recover is
     * a unit that is not moving, not scouting and not holding a line
     * elsewhere; free healing would remove the choice entirely.
     */
    const { state, unit } = wounded(40);
    expect(find(nextTurn(state), unit.id).hp).toBe(40);
  });

  it('never exceeds the unit type\u2019s own maximum', () => {
    const soldier = withSoldier();
    const max = unitType(soldier.unit.typeId).maxHp;
    const { state, unit } = wounded(max - 1);
    let running = done(fortifyUnit(state, unit.id));
    for (let i = 0; i < 4; i++) running = nextTurn(running);
    expect(find(running, unit.id).hp).toBe(max);
  });

  it('mends in a useful number of turns, not instantly and not never', () => {
    /*
     * The rate stated as behaviour rather than as a constant, so retuning
     * `FORTIFY_HEAL_SHARE` has to be a deliberate answer to this question:
     * how long should a wounded unit be out of the fight?
     */
    const { state, unit } = wounded(1);
    let running = done(fortifyUnit(state, unit.id));
    let turns = 0;
    while (find(running, unit.id).hp < unitType(unit.typeId).maxHp && turns < 40) {
      running = nextTurn(running);
      turns += 1;
    }
    expect(turns).toBeGreaterThanOrEqual(5);
    expect(turns).toBeLessThanOrEqual(12);
  });

  it('heals a big unit and a small one in the same number of turns', () => {
    /*
     * The reason the rate is a share of `maxHp` rather than a flat number: a
     * Direct Lake Titan must not take five times as long to recover as a
     * Profiler simply for being larger.
     */
    const turnsToMend = (typeId: Unit['typeId']): number => {
      const { state, unit } = withSoldier();
      const type = unitType(typeId);
      const units = new Map(state.units);
      units.set(unit.id, { ...unit, typeId, hp: 1 });
      let running = done(fortifyUnit({ ...state, units }, unit.id));
      let turns = 0;
      while (find(running, unit.id).hp < type.maxHp && turns < 60) {
        running = nextTurn(running);
        turns += 1;
      }
      return turns;
    };
    expect(turnsToMend('profiler')).toBe(turnsToMend('directLakeTitan'));
  });
});
