/**
 * Marching orders: "go there", over as many turns as it takes.
 *
 * `findPath` has claimed since it was written that it existed "for multi-turn
 * orders", and until now nothing used it that way. Sending a Profiler across
 * the map meant clicking the furthest lit hex, ending the turn, finding the
 * unit and clicking again, for six turns, and the Profiler is the unit whose
 * entire job is to be somewhere else.
 *
 * ⚠️ **The claim worth defending is that the drawing and the walking agree.**
 * The numbers on the map are a promise about where the unit will be at the end
 * of each turn. If the preview uses one cost model and the movement uses
 * another, the promise is broken in the least visible way possible: everything
 * still works, the unit simply arrives on a different turn than the map said.
 */

import { describe, expect, it } from 'vitest';
import {
  PLAYER_FACTION_ID,
  advanceMarch,
  advanceMarches,
  clearMarch,
  createGameState,
  hexKey,
  marchLegs,
  planMarch,
  setMarch,
  unitType,
  unitsOf,
  type GameState,
  type Hex,
} from '../src/index.js';

const start = (): GameState => createGameState('FABRIC');

const scout = (state: GameState): string =>
  unitsOf(state, PLAYER_FACTION_ID).find((u) => u.typeId === 'profiler')!.id;

/** Somewhere far enough away that no unit could get there in one turn. */
function farTarget(state: GameState, from: Hex): Hex | undefined {
  const unit = state.units.get(scout(state))!;
  for (const tile of state.map.tiles.values()) {
    const d = Math.max(
      Math.abs(tile.hex.q - from.q),
      Math.abs(tile.hex.r - from.r),
      Math.abs(tile.hex.q + tile.hex.r - from.q - from.r),
    );
    if (d < 6 || d > 10) continue;
    if (planMarch(state, unit, tile.hex)) return tile.hex;
  }
  return undefined;
}

describe('planning the journey', () => {
  it('breaks a long walk into turns', () => {
    const state = start();
    const unit = state.units.get(scout(state))!;
    const target = farTarget(state, unit.hex);
    expect(target, 'the map should offer somewhere far to walk').toBeDefined();

    const plan = planMarch(state, unit, target!)!;
    expect(plan.path.length).toBeGreaterThan(2);
    expect(plan.legs.length).toBeGreaterThan(1);
    // The last leg ends on the target, or the numbers are lying.
    expect(hexKey(plan.legs.at(-1)!.at)).toBe(hexKey(target!));
  });

  it('⚠️ every leg ends where the previous one left off', () => {
    /*
     * The legs are what the map numbers. A gap between one leg's end and the
     * next leg's start would draw a unit teleporting between turns.
     */
    const state = start();
    const unit = state.units.get(scout(state))!;
    const target = farTarget(state, unit.hex)!;
    const plan = planMarch(state, unit, target)!;

    const walked = plan.legs.flatMap((leg) => leg.hexes.map(hexKey));
    expect(walked).toEqual(plan.path.slice(1).map(hexKey));
  });

  it('⚠️ counts the turn a spent unit cannot move, rather than hiding it', () => {
    /*
     * A unit that has already used its movement marches nowhere this turn, so
     * its first leg is empty and the first place it actually reaches is two
     * turns away. Collapsing that would label the arrival "1" and be wrong by
     * a whole turn, which is precisely the sort of quiet lie this feature
     * exists to avoid.
     */
    const state = start();
    const id = scout(state);
    const unit = state.units.get(id)!;
    const target = farTarget(state, unit.hex)!;

    const spent = { ...unit, movesLeft: 0 };
    const legs = marchLegs(state, spent, planMarch(state, unit, target)!.path);
    expect(legs[0]!.hexes).toEqual([]);
    expect(legs.length).toBeGreaterThan(1);
  });

  it('refuses a destination it cannot reach', () => {
    const state = start();
    const unit = state.units.get(scout(state))!;
    // Far outside the map.
    expect(planMarch(state, unit, { q: 9_999, r: -9_999 })).toBeUndefined();
    // And standing still is not a journey.
    expect(planMarch(state, unit, unit.hex)).toBeUndefined();
  });
});

describe('the order itself', () => {
  it('is carried on the unit and survives a save', () => {
    const state = start();
    const id = scout(state);
    const target = farTarget(state, state.units.get(id)!.hex)!;
    const ordered = setMarch(state, id, target);
    expect(ordered.units.get(id)!.order?.target).toEqual(target);
  });

  it('⚠️ needs no save migration, because an absent order IS no order', () => {
    // The field is optional, so JSON omits it and an older save loads with a
    // unit that simply has nothing to do.
    const state = start();
    expect(state.units.get(scout(state))!.order).toBeUndefined();
  });

  it('is not given for somewhere unreachable', () => {
    const state = start();
    const id = scout(state);
    expect(setMarch(state, id, { q: 9_999, r: -9_999 })).toBe(state);
  });

  it('can be called off', () => {
    const state = start();
    const id = scout(state);
    const target = farTarget(state, state.units.get(id)!.hex)!;
    const ordered = setMarch(state, id, target);
    expect(clearMarch(ordered, id).units.get(id)!.order).toBeUndefined();
    // And clearing nothing changes nothing.
    expect(clearMarch(state, id)).toBe(state);
  });
});

describe('walking it', () => {
  it('moves along the route and keeps the order until it arrives', () => {
    const state = start();
    const id = scout(state);
    const before = state.units.get(id)!;
    const target = farTarget(state, before.hex)!;

    const result = advanceMarch(setMarch(state, id, target), id);
    const after = result.state.units.get(id)!;
    expect(hexKey(after.hex), 'it should have moved').not.toBe(hexKey(before.hex));
    if (result.stop === 'out-of-moves') {
      expect(after.order, 'still going').toBeDefined();
      expect(after.movesLeft).toBe(0);
    }
  });

  /**
   * ⚠️ **The route walked has to be reported, not just the start and the end.**
   *
   * A hand-driven move hands its whole route to the app, which is what lets a
   * Profiler dig up a chest it crossed. A march reported only where it began
   * and where it stopped, so anything buried in between was walked straight
   * past: the tile was crossed, the fog opened, and nothing happened. From
   * outside that reads as the treasure being broken rather than as the march
   * never having mentioned the middle of its own journey.
   */
  it('⚠️ reports every hex it stood on, not just where it stopped', () => {
    const state = start();
    const id = scout(state);
    const before = state.units.get(id)!;
    const target = farTarget(state, before.hex)!;

    const result = advanceMarch(setMarch(state, id, target), id);
    const after = result.state.units.get(id)!;

    expect(hexKey(result.walked[0]!), 'starts where the unit stood').toBe(hexKey(before.hex));
    expect(
      hexKey(result.walked[result.walked.length - 1]!),
      'ends where the unit stands now',
    ).toBe(hexKey(after.hex));

    // The whole point: a multi-step turn reports the steps between the ends.
    if (hexKey(after.hex) !== hexKey(before.hex)) {
      expect(result.walked.length, 'a move that went somewhere walked somewhere').toBeGreaterThan(1);
    }

    // Every entry is a real step, never a jump.
    for (let i = 1; i < result.walked.length; i++) {
      const a = result.walked[i - 1]!;
      const b = result.walked[i]!;
      const distance = (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
      expect(distance, 'consecutive hexes must be neighbours').toBe(1);
    }
  });

  it('⚠️ arrives on the turn the preview promised', () => {
    /*
     * The whole point. Walk the plan out turn by turn, refreshing movement the
     * way the pipeline does, and the unit must reach the target on the leg the
     * map numbered. A second cost model in the preview would show up here and
     * nowhere else.
     */
    const state = start();
    const id = scout(state);
    const unit = state.units.get(id)!;
    const target = farTarget(state, unit.hex)!;
    const promised = planMarch(state, unit, target)!.legs.length;

    let current = setMarch(state, id, target);
    let turns = 0;
    for (let i = 0; i < promised + 3; i += 1) {
      turns += 1;
      current = advanceMarch(current, id).state;
      const now = current.units.get(id)!;
      if (hexKey(now.hex) === hexKey(target)) break;
      /*
       * ⚠️ Refreshed to the unit's REAL allowance, not a number picked by hand.
       *
       * This test first refreshed to a flat 2 and then failed, reporting six
       * turns against a promise of four. The preview was right and the test was
       * simulating a slower game than the one being previewed, which is the
       * same class of mistake the test exists to catch, made in the test.
       */
      const units = new Map(current.units);
      units.set(id, { ...now, movesLeft: unitType(now.typeId).movement });
      current = { ...current, units };
    }
    expect(hexKey(current.units.get(id)!.hex)).toBe(hexKey(target));
    expect(turns, `promised ${promised} turns`).toBeLessThanOrEqual(promised);
  });

  it('drops the order on arrival', () => {
    const state = start();
    const id = scout(state);
    const unit = state.units.get(id)!;
    // One hex away, so a single advance finishes it.
    const near = planMarch(state, unit, farTarget(state, unit.hex)!)!.path[1]!;
    const done = advanceMarch(setMarch(state, id, near), id);
    expect(done.stop).toBe('arrived');
    expect(done.state.units.get(id)!.order).toBeUndefined();
  });
});

describe('⚠️ a new enemy stops the march', () => {
  it('halts when something hostile comes into view', () => {
    const state = start();
    const id = scout(state);
    const unit = state.units.get(id)!;
    const target = farTarget(state, unit.hex)!;
    const path = planMarch(state, unit, target)!.path;

    /*
     * Put a raider on the far end of the route, out of sight now and certain
     * to be seen on the way. Marching into it without stopping is the failure
     * this rule exists to prevent.
     */
    const ambushAt = path.at(-1)!;
    const units = new Map(state.units);
    units.set('ambush', {
      id: 'ambush',
      typeId: 'pipelineRunner',
      factionId: 'silo-horde',
      hex: ambushAt,
      hp: 100,
      movesLeft: 1,
      fortified: false,
    });

    let current = setMarch({ ...state, units }, id, path.at(-2)!);
    let stopped = false;
    for (let i = 0; i < 12; i += 1) {
      const result = advanceMarch(current, id);
      current = result.state;
      if (result.stop === 'spotted') { stopped = true; break; }
      if (result.stop === 'arrived' || result.stop === 'blocked') break;
      const now = current.units.get(id)!;
      const refreshed = new Map(current.units);
      refreshed.set(id, { ...now, movesLeft: unitType(now.typeId).movement });
      current = { ...current, units: refreshed };
    }
    expect(stopped, 'the march should have halted on sighting the raider').toBe(true);
    expect(current.units.get(id)!.order, 'and forgotten the order').toBeUndefined();
  });

  it('⚠️ does NOT halt for an enemy it could already see', () => {
    /*
     * The test is what is NEWLY in sight, not whether anything is. A scout
     * walking a border it has watched for ten turns would otherwise refuse to
     * take a single step, which reads as the order being ignored.
     */
    const state = start();
    const id = scout(state);
    const unit = state.units.get(id)!;
    const target = farTarget(state, unit.hex)!;

    // A raider standing right next to the scout, plainly in view before it sets off.
    const units = new Map(state.units);
    units.set('watched', {
      id: 'watched',
      typeId: 'pipelineRunner',
      factionId: 'silo-horde',
      hex: { q: unit.hex.q + 1, r: unit.hex.r },
      hp: 100,
      movesLeft: 1,
      fortified: false,
    });

    const result = advanceMarch(setMarch({ ...state, units }, id, target), id);
    expect(result.stop).not.toBe('spotted');
    expect(hexKey(result.state.units.get(id)!.hex)).not.toBe(hexKey(unit.hex));
  });
});

describe('moving everybody', () => {
  it('⚠️ walks them in a stable order, so a replay matches', () => {
    /*
     * Units block each other, so which one walks first decides who gets the
     * pass. Map iteration order is not something a rule should depend on when
     * the same seed is meant to replay the same way (D39).
     */
    const state = start();
    const id = scout(state);
    const target = farTarget(state, state.units.get(id)!.hex)!;
    const ordered = setMarch(state, id, target);

    const once = advanceMarches(ordered, PLAYER_FACTION_ID);
    const twice = advanceMarches(ordered, PLAYER_FACTION_ID);
    expect(twice.reports).toEqual(once.reports);
  });

  it('says nothing about units with no orders', () => {
    const state = start();
    expect(advanceMarches(state, PLAYER_FACTION_ID).reports).toEqual([]);
  });
});
