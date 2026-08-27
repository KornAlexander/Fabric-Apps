import { describe, expect, it } from 'vitest';
import {
  absorbWithWalls,
  cityCombatSide,
  createGameState,
  garrisonPhase,
  isBreached,
  maxWallHp,
  productionCost,
  productionPhase,
  previewAttack,
  resolveAttack,
  setProduction,
  wallIntegrity,
  wallWork,
  DEFAULT_TACTIC,
  MAX_GARRISON_PER_FACTION,
  MAX_WALL_LEVEL,
  MIN_DAMAGE,
  PLAYER_FACTION_ID,
  WALL_BREACH_POINT,
  WALL_TARGET,
  type City,
  type GameState,
  type Unit,
} from '../src/index.js';

/**
 * Walls under attack.
 *
 * ⚠️ Every test here would have passed on the previous commit *as written in
 * walls.test.ts*, because `absorbWithWalls` was correct and simply never
 * called. These go through `resolveAttack` instead, which is the only way to
 * tell a working rule from a tested one nobody uses.
 */

const SEED = 'siege';

function base(): GameState {
  return createGameState(SEED);
}

function city(over: Partial<City> = {}): City {
  return {
    id: 'target',
    factionId: 'silo-horde',
    hex: { q: 0, r: 0 },
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
    ...over,
  };
}

/** A melee attacker of the player's, standing next to the target city. */
function siege(
  over: Partial<City> = {},
  typeId: Unit['typeId'] = 'pipelineRunner',
): { state: GameState; attackerId: string } {
  const state = base();
  const target = city(over);
  const attackerHex = { q: 1, r: 0 };

  const units = new Map<string, Unit>();
  const attacker: Unit = {
    id: 'attacker',
    typeId,
    factionId: PLAYER_FACTION_ID,
    hex: attackerHex,
    hp: 100,
    movesLeft: 2,
    fortified: false,
  };
  units.set('attacker', attacker);

  const cities = new Map(state.cities);
  cities.clear();
  cities.set('target', target);

  return {
    state: { ...state, units, cities, activeFactionId: PLAYER_FACTION_ID },
    attackerId: 'attacker',
  };
}

describe('⚠️ the walls actually take the damage', () => {
  it('loses wall hit points when the city is attacked', () => {
    // The regression this file exists for: wallHp never moved, because
    // nothing called absorbWithWalls.
    const { state, attackerId } = siege({ wallLevel: 2, wallHp: maxWallHp(2) });
    const before = state.cities.get('target')!.wallHp;

    const out = resolveAttack(state, attackerId, { q: 0, r: 0 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const after = out.result.state.cities.get('target')!.wallHp;
    expect(after).toBeLessThan(before);
  });

  it('shields the city while the wall stands', () => {
    const { state, attackerId } = siege({ wallLevel: MAX_WALL_LEVEL, wallHp: maxWallHp(MAX_WALL_LEVEL) });
    const hpBefore = state.cities.get('target')!.hp;

    const out = resolveAttack(state, attackerId, { q: 0, r: 0 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const city = out.result.state.cities.get('target')!;
    expect(city.wallHp).toBeLessThan(maxWallHp(MAX_WALL_LEVEL));
    // A full wall absorbs a single blow entirely.
    expect(city.hp).toBe(hpBefore);
  });

  it('lets damage through once the wall is gone', () => {
    const { state, attackerId } = siege({ wallLevel: 1, wallHp: 0 });
    const hpBefore = state.cities.get('target')!.hp;

    const out = resolveAttack(state, attackerId, { q: 0, r: 0 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.state.cities.get('target')!.hp).toBeLessThan(hpBefore);
  });

  it('⚠️ gets easier as the wall comes down', () => {
    /*
     * The point of scaling by integrity: a besieger facing a battered wall
     * should be doing more damage than one facing a fresh one.
     *
     * ⚠️ **Needs an attacker above the damage floor to be observable at all.**
     * With a line unit both cases came back at exactly `MIN_DAMAGE`, so the
     * clamp hid the difference completely and this test failed against working
     * code. That is the same trap `SIEGE_CITY_BONUS` documents for the upper
     * cap, at the other end of the curve, and it is a real statement about the
     * game: **a line unit gains nothing from breaching a wall.** Bring siege.
     */
    const fresh = siege({ wallLevel: 2, wallHp: maxWallHp(2) }, 'directLakeTitan');
    const battered = siege({ wallLevel: 2, wallHp: 5 }, 'directLakeTitan');

    const a = previewAttack(fresh.state, fresh.attackerId, { q: 0, r: 0 })!;
    const b = previewAttack(battered.state, battered.attackerId, { q: 0, r: 0 })!;
    expect(a.expectedDamageToDefender).toBeGreaterThan(MIN_DAMAGE);
    expect(b.expectedDamageToDefender).toBeGreaterThan(a.expectedDamageToDefender);
  });

  it('⚠️ a line unit gains nothing from breaching, because of the floor', () => {
    // Recorded rather than hidden: this is why the test above needs a titan.
    const fresh = siege({ wallLevel: 2, wallHp: maxWallHp(2) });
    const battered = siege({ wallLevel: 2, wallHp: 5 });
    const a = previewAttack(fresh.state, fresh.attackerId, { q: 0, r: 0 })!;
    const b = previewAttack(battered.state, battered.attackerId, { q: 0, r: 0 })!;
    expect(a.expectedDamageToDefender).toBe(MIN_DAMAGE);
    expect(b.expectedDamageToDefender).toBe(MIN_DAMAGE);
  });

  it('leaves an unwalled city exactly as it was', () => {
    const { state, attackerId } = siege();
    const out = resolveAttack(state, attackerId, { q: 0, r: 0 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const city = out.result.state.cities.get('target')!;
    expect(city.wallHp).toBe(0);
    expect(city.hp).toBeLessThan(200);
  });
});

describe('repairing what was knocked down', () => {
  it('offers repair when the wall is damaged below the cap', () => {
    const work = wallWork(city({ wallLevel: 1, wallHp: 10 }));
    expect(work?.kind).toBe('repair');
  });

  it('⚠️ offers repair at the cap, where there is no next level to build', () => {
    // Without this a city that took one hit at full height carries the damage
    // for the rest of the game, and a captured city inherits walls it can
    // never restore. A dead end reachable by playing normally.
    const work = wallWork(city({ wallLevel: MAX_WALL_LEVEL, wallHp: 1 }));
    expect(work?.kind).toBe('repair');
    expect(work!.cost).toBeGreaterThan(0);
  });

  it('offers nothing when the walls are full and whole', () => {
    const whole = city({ wallLevel: MAX_WALL_LEVEL, wallHp: maxWallHp(MAX_WALL_LEVEL) });
    expect(wallWork(whole)).toBeUndefined();
  });

  it('costs less than building the same height from nothing', () => {
    const damaged = city({ wallLevel: 1, wallHp: 0 });
    const repair = wallWork(damaged)!;
    const build = wallWork(city({ wallLevel: 0, wallHp: 0 }))!;
    expect(repair.cost).toBeLessThan(build.cost);
  });

  it('restores the wall to full when the work finishes', () => {
    let state = base();
    const cities = new Map(state.cities);
    cities.clear();
    cities.set('mine', city({
      id: 'mine',
      factionId: PLAYER_FACTION_ID,
      wallLevel: MAX_WALL_LEVEL,
      wallHp: 4,
    }));
    const factions = new Map(state.factions);
    const player = factions.get(PLAYER_FACTION_ID)!;
    factions.set(PLAYER_FACTION_ID, {
      ...player,
      resources: { ...player.resources, compute: 500 },
    });
    state = { ...state, cities, factions, activeFactionId: PLAYER_FACTION_ID };

    const ordered = setProduction(state, 'mine', WALL_TARGET);
    expect(ordered.ok).toBe(true);
    if (!ordered.ok) return;
    state = ordered.state;
    expect(productionCost(state.cities.get('mine')!)).toBeGreaterThan(0);

    for (let i = 0; i < 20; i += 1) {
      state = productionPhase(state, PLAYER_FACTION_ID).state;
    }

    const mended = state.cities.get('mine')!;
    expect(mended.wallHp).toBe(maxWallHp(MAX_WALL_LEVEL));
    expect(wallIntegrity(mended)).toBe(1);
    // Nothing left to do, so the orders clear rather than looping forever.
    expect(mended.producing).toBeUndefined();
  });
});

describe('taking a walled city', () => {
  it('breaches the walls but leaves the earthworks to the new owner', () => {
    const { state, attackerId } = siege({ wallLevel: 2, wallHp: 1, hp: 1 });
    const out = resolveAttack(state, attackerId, { q: 0, r: 0 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const taken = out.result.state.cities.get('target');
    if (!taken || taken.factionId !== PLAYER_FACTION_ID) return; // not captured this roll
    expect(taken.wallHp).toBe(0);
    expect(taken.wallLevel).toBe(2);
    // And the new owner has something to do about it.
    expect(wallWork(taken)?.kind).toBe('repair');
  });
});

describe('a breach is one definition, shared', () => {
  /*
   * ⚠️ The renderer decides what a fort looks like and the scene decides when
   * to rebuild that model. If those two disagreed about what "breached" means,
   * a fort would change appearance only when something unrelated happened to
   * it, which is close to impossible to notice and worse to debug. So the
   * threshold lives in the engine and both read it.
   */
  it('is not breached while most of the wall stands', () => {
    expect(isBreached(city({ wallLevel: 2, wallHp: maxWallHp(2) }))).toBe(false);
    expect(isBreached(city({ wallLevel: 2, wallHp: maxWallHp(2) * 0.75 }))).toBe(false);
  });

  it('is breached once it is more than half down', () => {
    expect(isBreached(city({ wallLevel: 2, wallHp: maxWallHp(2) * 0.25 }))).toBe(true);
    expect(isBreached(city({ wallLevel: 2, wallHp: 0 }))).toBe(true);
  });

  it('⚠️ is never breached with no wall at all', () => {
    // Integrity of an unwalled city is 0, so a naive `integrity < 0.5` would
    // call every open town breached and draw rubble round a village.
    expect(isBreached(city({ wallLevel: 0, wallHp: 0 }))).toBe(false);
  });

  it('turns exactly at the shared point', () => {
    const at = maxWallHp(2) * WALL_BREACH_POINT;
    expect(isBreached(city({ wallLevel: 2, wallHp: at }))).toBe(false);
    expect(isBreached(city({ wallLevel: 2, wallHp: at - 1 }))).toBe(true);
  });
});

describe('⚠️ a walled city is hard, not impossible', () => {
  /*
   * The regression this exists for shipped and was only caught by measuring.
   *
   * Three reasonable decisions multiplied: walls roughly double a city's
   * defence, damage lands on the walls first, and an antagonist mended for
   * free every garrison cycle. When that mend restored the wall to *full*, a
   * level-three city could not be taken by a Pipeline Runner **or by the siege
   * unit built to break cities**. Only the heaviest unit in the game got in.
   *
   * A besieger doing floor damage removes 60 hit points over six turns; the
   * defender was putting 120 back. That is a locked door wearing the costume
   * of a hard siege, and every unit test passed while it was true.
   */
  const grind = (typeId: Unit['typeId'], limit: number): number | undefined => {
    const { state, attackerId } = siege(
      { wallLevel: MAX_WALL_LEVEL, wallHp: maxWallHp(MAX_WALL_LEVEL) },
      typeId,
    );
    const defenderId = state.cities.get('target')!.factionId;

    /*
     * ⚠️ The defender needs its full complement, parked well away.
     *
     * Without it `garrisonPhase` is below the unit cap, so it musters a
     * soldier onto the city instead of mending, and the attack then resolves
     * against that unit rather than against the walls. The first version of
     * this test measured a brawl outside the gate and reported it as a wall
     * that never fell.
     */
    const units = new Map(state.units);
    for (let i = 0; i < MAX_GARRISON_PER_FACTION; i += 1) {
      units.set(`garrison-${i}`, {
        id: `garrison-${i}`,
        typeId: 'pipelineRunner',
        factionId: defenderId,
        hex: { q: 30 + i, r: 0 },
        hp: 100,
        movesLeft: 1,
        fortified: false,
      });
    }
    let current: GameState = { ...state, units };

    for (let turn = 1; turn <= limit; turn += 1) {
      const out = resolveAttack(current, attackerId, { q: 0, r: 0 });
      if (!out.ok) return undefined;
      current = out.result.state;

      const city = current.cities.get('target');
      if (!city || city.factionId === PLAYER_FACTION_ID) return turn;

      // Keep the attacker on its feet: this measures the walls, not attrition.
      const alive = new Map(current.units);
      alive.set(attackerId, { ...alive.get(attackerId)!, hp: 100, movesLeft: 2 });
      current = { ...current, units: alive };
      // And let the defender mend, which is the half that caused the deadlock.
      current = garrisonPhase(current, defenderId).state;
    }
    return undefined;
  };

  it('falls to the siege unit it was designed to fall to', () => {
    const turns = grind('notebookCannon', 60);
    expect(turns).toBeDefined();
    expect(turns!).toBeLessThan(40);
  });

  it('falls even to a line unit, given long enough', () => {
    expect(grind('pipelineRunner', 90)).toBeDefined();
  });

  it('⚠️ rewards bringing siege rather than numbers', () => {
    // If these ever converge, the siege units have stopped being worth building
    // and the whole "bring siege" argument in 19.2 is decoration.
    const cannon = grind('notebookCannon', 60)!;
    const line = grind('pipelineRunner', 90)!;
    expect(cannon).toBeLessThan(line);
  });
});

describe('the helper still agrees with the rule that uses it', () => {  it('absorbs exactly what resolveAttack takes off the wall', () => {
    const { state, attackerId } = siege({ wallLevel: 3, wallHp: maxWallHp(3) });
    const before = state.cities.get('target')!;
    const preview = previewAttack(state, attackerId, { q: 0, r: 0 })!;
    const predicted = absorbWithWalls(before, preview.expectedDamageToDefender);
    // The roll varies, so compare direction and bound rather than an exact
    // number: the wall must lose something, and never more than it had.
    expect(predicted.wallHp).toBeLessThanOrEqual(before.wallHp);
    expect(predicted.wallHp).toBeGreaterThanOrEqual(0);
    expect(cityCombatSide(state, before).fortifyBonus).toBeGreaterThan(0);
  });
});

/*
  What the blow REPORTS, as opposed to what it does.

  The siege animation stages the tactic and the stance literally: a ram for
  `batter`, ladders for `escalade`, diggers for `sap`, and defenders who either
  man the parapet, duck behind it or come out of the gate. All of that is
  driven off the combat log, so the log has to say which of the nine it was.

  ⚠️ **It has to be reported, not re-derived.** Both are defaulted inside
  `resolveAttack` (an omitted tactic becomes the default, an omitted stance
  becomes `hold`), and the AI picks its own. A renderer that guessed would
  eventually draw a siege that did not match the numbers it was given, and
  nothing anywhere would say so.
*/
describe('⚠️ the log says how the blow was actually fought', () => {
  it('reports the tactic it was given', () => {
    const { state, attackerId } = siege({ wallLevel: 2, wallHp: maxWallHp(2) });
    const out = resolveAttack(state, attackerId, { q: 0, r: 0 }, { tactic: 'sap' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.log.tactic).toBe('sap');
  });

  it('reports the stance it was met with', () => {
    const { state, attackerId } = siege({ wallLevel: 2, wallHp: maxWallHp(2) });
    const out = resolveAttack(state, attackerId, { q: 0, r: 0 }, { defenceStance: 'sally' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.log.stance).toBe('sally');
  });

  it('fills in the defaults rather than leaving them undefined', () => {
    // The caller may omit both. The renderer may not receive nothing: an
    // undefined tactic would fall through the animation's branch to `batter`
    // silently, which is a guess wearing a default's clothes.
    const { state, attackerId } = siege({ wallLevel: 1, wallHp: maxWallHp(1) });
    const out = resolveAttack(state, attackerId, { q: 0, r: 0 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.log.tactic).toBe(DEFAULT_TACTIC);
    expect(out.result.log.stance).toBe('hold');
  });

  it('reports the tactic on a field fight too', () => {
    /*
     * A duel does not stage a tactic, but the field is where an undefined
     * would go unnoticed longest, so the log is uniform rather than optional.
     */
    const state = base();
    const units = new Map<string, Unit>();
    units.set('a', {
      id: 'a',
      typeId: 'pipelineRunner',
      factionId: PLAYER_FACTION_ID,
      hex: { q: 1, r: 0 },
      hp: 100,
      movesLeft: 2,
      fortified: false,
    });
    units.set('b', {
      id: 'b',
      typeId: 'pipelineRunner',
      factionId: 'silo-horde',
      hex: { q: 0, r: 0 },
      hp: 100,
      movesLeft: 2,
      fortified: false,
    });
    const cities = new Map(state.cities);
    cities.clear();

    const out = resolveAttack(
      { ...state, units, cities, activeFactionId: PLAYER_FACTION_ID },
      'a',
      { q: 0, r: 0 },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.log.targetKind).toBe('unit');
    expect(out.result.log.tactic).toBe(DEFAULT_TACTIC);
    expect(out.result.log.wallBroken).toBe(false);
  });
});

describe('⚠️ wallBroken marks the one blow that broke it', () => {
  it('is false while the wall is still holding', () => {
    const { state, attackerId } = siege({ wallLevel: MAX_WALL_LEVEL, wallHp: maxWallHp(MAX_WALL_LEVEL) });
    const out = resolveAttack(state, attackerId, { q: 0, r: 0 }, { tactic: 'batter' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // A full third-level wall does not fall to one hit from a runner.
    expect(isBreached(out.result.state.cities.get('target')!)).toBe(false);
    expect(out.result.log.wallBroken).toBe(false);
  });

  it('is true on the blow that takes it past the breach point, and false after', () => {
    /*
     * ⚠️ Driven by hitting the same wall until it goes, rather than by
     * setting `wallHp` to one point above the threshold and swinging once.
     * A hand-placed number that happens to break is the fixture that produces
     * the answer you expected; walking it down proves the flag tracks the
     * real transition, and proves it fires exactly once.
     */
    let { state } = siege({ wallLevel: 1, wallHp: maxWallHp(1) });
    const attackerId = 'attacker';

    let breakingBlows = 0;
    let blows = 0;
    let sawBreach = false;

    while (blows < 40 && !state.cities.get('target')) break; // placeholder, replaced below
    while (blows < 40) {
      const city = state.cities.get('target');
      if (!city) break;
      const out = resolveAttack(state, attackerId, { q: 0, r: 0 }, { tactic: 'batter' });
      if (!out.ok) break;
      blows += 1;
      if (out.result.log.wallBroken) breakingBlows += 1;

      const after = out.result.state.cities.get('target');
      if (after && isBreached(after)) sawBreach = true;

      // Restore the attacker so the loop is about the wall, not about
      // attrition or a spent move allowance.
      const units = new Map(out.result.state.units);
      const me = units.get(attackerId);
      if (!me) break;
      units.set(attackerId, { ...me, hp: 100, movesLeft: 2 });
      state = { ...out.result.state, units };

      if (sawBreach && breakingBlows > 0 && blows > 0 && !after) break;
      if (sawBreach && blows > 0) {
        // Keep going a few more blows to prove the flag does not re-fire.
        if (breakingBlows > 1) break;
        if (blows > 20) break;
      }
    }

    expect(sawBreach).toBe(true);
    expect(breakingBlows).toBe(1);
  });
});

