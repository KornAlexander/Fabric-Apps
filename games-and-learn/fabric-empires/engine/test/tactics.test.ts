import { describe, expect, it } from 'vitest';
import {
  chooseTactic,
  createGameState,
  damageFrom,
  maxWallHp,
  previewAttack,
  resolveAttack,
  tacticProfile,
  ASSAULT_TACTICS,
  DEFAULT_TACTIC,
  MAX_WALL_LEVEL,
  MIN_DAMAGE,
  PLAYER_FACTION_ID,
  TACTICS,
  type City,
  type GameState,
  type Unit,
} from '../src/index.js';

/**
 * Assault tactics.
 *
 * Section 19.3 wants going at a wall to be a decision. The test that matters is
 * not that each tactic does something, it is that **no tactic is simply best**:
 * if one dominates, the choice is decoration and the wall is back to being a
 * number that makes another number smaller.
 */

function walledCity(over: Partial<City> = {}): City {
  return {
    id: 'target',
    factionId: 'silo-horde',
    hex: { q: 0, r: 0 },
    name: 'Bastion',
    kind: 'workspace',
    hp: 200,
    wallLevel: MAX_WALL_LEVEL,
    wallHp: maxWallHp(MAX_WALL_LEVEL),
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

function field(
  typeId: Unit['typeId'],
  over: Partial<City> = {},
): { state: GameState; attackerId: string } {
  const base = createGameState('tactics');
  const units = new Map<string, Unit>();
  units.set('a', {
    id: 'a',
    typeId,
    factionId: PLAYER_FACTION_ID,
    hex: { q: 1, r: 0 },
    hp: 100,
    movesLeft: 2,
    fortified: false,
  });
  const cities = new Map<string, City>();
  cities.set('target', walledCity(over));
  return {
    state: { ...base, units, cities, activeFactionId: PLAYER_FACTION_ID },
    attackerId: 'a',
  };
}

describe('the default changes nothing', () => {
  it('is batter, and batter is what an attack always did', () => {
    expect(DEFAULT_TACTIC).toBe('batter');
    const p = tacticProfile('batter');
    expect(p.wallShare).toBe(1);
    expect(p.strength).toBe(1);
    expect(p.cityCounter).toBe(0);
  });

  it('gives the same preview with no tactic as with batter', () => {
    const { state, attackerId } = field('pipelineRunner');
    const none = previewAttack(state, attackerId, { q: 0, r: 0 })!;
    const batter = previewAttack(state, attackerId, { q: 0, r: 0 }, { tactic: 'batter' })!;
    expect(batter.expectedDamageToDefender).toBe(none.expectedDamageToDefender);
    expect(batter.expectedDamageToAttacker).toBe(none.expectedDamageToAttacker);
  });
});

describe('each tactic is best at something', () => {
  it('sap breaks the most wall', () => {
    /*
     * ⚠️ **Needs an attacker above the damage floor.** A Pipeline Runner
     * against a level-three wall is clamped to `MIN_DAMAGE` whatever it does,
     * so sap's strength bonus is invisible and this failed against working
     * code. Third time this clamp has hidden a real mechanic; it is now
     * asserted below rather than worked around.
     */
    const { state, attackerId } = field('directLakeTitan');
    const wallLeft = (tactic: 'batter' | 'escalade' | 'sap'): number => {
      const out = resolveAttack(state, attackerId, { q: 0, r: 0 }, { tactic });
      if (!out.ok) throw new Error(out.reason);
      return out.result.state.cities.get('target')!.wallHp;
    };
    expect(wallLeft('sap')).toBeLessThan(wallLeft('batter'));
    expect(wallLeft('batter')).toBeLessThan(wallLeft('escalade'));
  });

  it('⚠️ is worth something even to a unit at the damage floor', () => {
    /*
     * This test used to assert the opposite, and was right to: the floor
     * flattened every weak blow to the same 10, so a Profiler sapping a wall
     * and a Profiler battering it achieved exactly the same thing. The assault
     * prompt was asking the player a question whose answer could not matter
     * until they fielded a much heavier unit.
     *
     * The floor now scales with the tactic (see `damageFrom`), because a floor
     * is a floor on *effort* and a technique changes what that effort achieves.
     * A starting unit can now tell its choices apart on the first siege.
     */
    const { state, attackerId } = field('pipelineRunner');
    const wallLeft = (tactic: 'batter' | 'sap'): number => {
      const out = resolveAttack(state, attackerId, { q: 0, r: 0 }, { tactic });
      if (!out.ok) throw new Error(out.reason);
      return out.result.state.cities.get('target')!.wallHp;
    };
    expect(wallLeft('sap')).toBeLessThan(wallLeft('batter'));
  });

  it('escalade reaches the town while the wall still stands', () => {
    const { state, attackerId } = field('pipelineRunner');
    const cityHp = (tactic: 'batter' | 'escalade' | 'sap'): number => {
      const out = resolveAttack(state, attackerId, { q: 0, r: 0 }, { tactic });
      if (!out.ok) throw new Error(out.reason);
      return out.result.state.cities.get('target')!.hp;
    };
    // Batter and sap put everything into the masonry, so the town is untouched.
    expect(cityHp('batter')).toBe(200);
    expect(cityHp('sap')).toBe(200);
    expect(cityHp('escalade')).toBeLessThan(200);
  });

  it('⚠️ and escalade is the only one that costs you anything', () => {
    // A city does not counterattack. Escalade is the tactic that puts men on
    // the parapet, so it is the one that can.
    const { state, attackerId } = field('pipelineRunner');
    const back = (tactic: 'batter' | 'escalade' | 'sap'): number =>
      previewAttack(state, attackerId, { q: 0, r: 0 }, { tactic })!.expectedDamageToAttacker;
    expect(back('batter')).toBe(0);
    expect(back('sap')).toBe(0);
    expect(back('escalade')).toBeGreaterThan(0);
  });
});

describe('⚠️ no tactic dominates', () => {
  it('⚠️ sap becomes the WORST way in once the breach is open', () => {
    /*
     * The previous version of this test only asserted that both tactics did
     * *some* damage to an unwalled city, which is true of anything, and that
     * weakness is exactly how the contradiction survived: with a single
     * strength number, a sapper's masonry bonus kept applying after the wall
     * was gone, so `sap` was quietly the best tactic in every situation and its
     * own description ("almost no use once the breach is open") was a lie.
     */
    const open = field('directLakeTitan', { wallLevel: 2, wallHp: 0 });
    const hpAfter = (tactic: 'batter' | 'escalade' | 'sap'): number => {
      const out = resolveAttack(open.state, open.attackerId, { q: 0, r: 0 }, { tactic });
      if (!out.ok) throw new Error(out.reason);
      return out.result.state.cities.get('target')!.hp;
    };
    // Higher remaining hit points means less was achieved.
    expect(hpAfter('sap')).toBeGreaterThan(hpAfter('batter'));
    expect(hpAfter('sap')).toBeGreaterThan(hpAfter('escalade'));
  });

  it('and is still the best way in while the wall stands', () => {
    const walled = field('directLakeTitan');
    const wallAfter = (tactic: 'batter' | 'sap'): number => {
      const out = resolveAttack(walled.state, walled.attackerId, { q: 0, r: 0 }, { tactic });
      if (!out.ok) throw new Error(out.reason);
      return out.result.state.cities.get('target')!.wallHp;
    };
    expect(wallAfter('sap')).toBeLessThan(wallAfter('batter'));
  });

  it('escalade trades worse against a fresh wall than against a broken one', () => {
    // ⚠️ Again above the clamp: against a Pipeline Runner the city's counter
    // is pinned at MAX_DAMAGE in both cases, so the comparison is meaningless.
    const fresh = field('directLakeTitan');
    const broken = field('directLakeTitan', { wallHp: 1 });
    const cost = (f: { state: GameState; attackerId: string }): number =>
      previewAttack(f.state, f.attackerId, { q: 0, r: 0 }, { tactic: 'escalade' })!
        .expectedDamageToAttacker;
    expect(cost(fresh)).toBeGreaterThan(cost(broken));
  });
});

describe('⚠️ the odds shown are the odds fought', () => {
  /*
   * `resolveAttack` recomputes damage rather than reading it off the preview,
   * so any factor added to one and not the other silently splits them. That
   * happened the moment tactics were wired: `sap` previewed 33 damage and
   * resolved for 17, and `escalade` showed the player a hundred points of
   * counterattack and then charged nothing at all.
   *
   * The roll is 0.9 to 1.1, so resolution is allowed to differ from the
   * preview by that much and no more.
   */
  const ROLL = 0.1 + 1e-6;

  for (const tactic of ASSAULT_TACTICS) {
    it(`matches between preview and resolution for ${tactic}`, () => {
      const { state, attackerId } = field('directLakeTitan');
      const before = state.cities.get('target')!;
      const preview = previewAttack(state, attackerId, { q: 0, r: 0 }, { tactic })!;

      const out = resolveAttack(state, attackerId, { q: 0, r: 0 }, { tactic });
      if (!out.ok) throw new Error(out.reason);
      const after = out.result.state.cities.get('target')!;

      // Everything the blow actually did, wherever it landed.
      const dealt = before.wallHp - after.wallHp + (before.hp - after.hp);
      expect(dealt).toBeGreaterThan(preview.expectedDamageToDefender * (1 - ROLL) - 1);
      expect(dealt).toBeLessThan(preview.expectedDamageToDefender * (1 + ROLL) + 1);

      // And what it cost, which is the half that was quietly never charged.
      const attackerAfter = out.result.state.units.get(attackerId);
      const paid = 100 - (attackerAfter?.hp ?? 0);
      if (preview.expectedDamageToAttacker === 0) {
        expect(paid).toBe(0);
      } else {
        expect(paid).toBeGreaterThan(0);
      }
    });
  }

  it('never leaves a fractional hit point anywhere', () => {
    // A share of a whole number is not one: an unrounded 20% wall share left
    // cities standing on 191.2 hit points behind 117.8 of wall.
    for (const tactic of ASSAULT_TACTICS) {
      const { state, attackerId } = field('directLakeTitan');
      const out = resolveAttack(state, attackerId, { q: 0, r: 0 }, { tactic });
      if (!out.ok) throw new Error(out.reason);
      const city = out.result.state.cities.get('target')!;
      expect(Number.isInteger(city.wallHp)).toBe(true);
      expect(Number.isInteger(city.hp)).toBe(true);
    }
  });
});

describe('⚠️ the AI gets the same three choices', () => {
  /*
   * Without a chooser every antagonist attack used the default, so a player who
   * walled up was never escaladed and never sapped. Walls were strictly better
   * for the player than for the seven factions that also build them, which is
   * the same asymmetry as the AI not building walls at all, one layer up.
   */
  it('saps a standing wall, because that is what moves the siege along', () => {
    const { state, attackerId } = field('directLakeTitan');
    expect(chooseTactic(state, attackerId, { q: 0, r: 0 })).toBe('sap');
  });

  it('stops sapping once the breach is open', () => {
    const { state, attackerId } = field('directLakeTitan', { wallLevel: 2, wallHp: 0 });
    expect(chooseTactic(state, attackerId, { q: 0, r: 0 })).not.toBe('sap');
  });

  it('⚠️ never picks a tactic that would kill the attacker', () => {
    // Escalade against a fresh wall costs a full counterattack, which is lethal
    // to most of the roster. An AI that storms a fortress with scouts is not
    // aggressive, it is broken.
    const { state, attackerId } = field('pipelineRunner');
    const chosen = chooseTactic(state, attackerId, { q: 0, r: 0 });
    const cost = previewAttack(state, attackerId, { q: 0, r: 0 }, { tactic: chosen })!
      .expectedDamageToAttacker;
    expect(cost).toBeLessThan(state.units.get(attackerId)!.hp);
  });

  it('leaves an unwalled city alone and just attacks it', () => {
    const { state, attackerId } = field('pipelineRunner', { wallLevel: 0, wallHp: 0 });
    expect(chooseTactic(state, attackerId, { q: 0, r: 0 })).toBe(DEFAULT_TACTIC);
  });
});

describe('⚠️ the floor scales with the technique', () => {
  /*
   * `MIN_DAMAGE` guarantees a fight makes progress. Flattening every weak blow
   * to the same number also flattened away *how* it was struck, which hid the
   * entire tactic system from every unit the player can field early. It was
   * measured four separate times before it was believed.
   */
  it('separates all three tactics for a starting unit', () => {
    const { state, attackerId } = field('pipelineRunner');
    const wall = (tactic: 'batter' | 'escalade' | 'sap'): number => {
      const out = resolveAttack(state, attackerId, { q: 0, r: 0 }, { tactic });
      if (!out.ok) throw new Error(out.reason);
      return out.result.state.cities.get('target')!.wallHp;
    };
    // Sap bites deepest, escalade barely touches the masonry, batter between.
    expect(wall('sap')).toBeLessThan(wall('batter'));
    expect(wall('batter')).toBeLessThan(wall('escalade'));
  });

  it('still guarantees every blow does something', () => {
    // The floor's original job. A tactic may scale it; nothing may erase it.
    const { state, attackerId } = field('pipelineRunner');
    for (const tactic of ASSAULT_TACTICS) {
      const p = previewAttack(state, attackerId, { q: 0, r: 0 }, { tactic })!;
      expect(p.expectedDamageToDefender).toBeGreaterThan(0);
    }
  });

  it('leaves a plain unit fight exactly as it was', () => {
    // floorScale defaults to 1, so nothing outside a city assault moved.
    expect(damageFrom(1, 1000)).toBe(MIN_DAMAGE);
    expect(damageFrom(1, 1000, 1, 1)).toBe(MIN_DAMAGE);
  });

  it('scales the floor by the tactic, not past the ceiling', () => {
    expect(damageFrom(1, 1000, 1, 1.55)).toBe(Math.round(MIN_DAMAGE * 1.55));
    expect(damageFrom(1, 1000, 1, 0.7)).toBe(Math.round(MIN_DAMAGE * 0.7));
    expect(damageFrom(10_000, 1, 1, 1.55)).toBe(100);
  });
});

describe('the tactic list', () => {
  it('offers every profile that exists, so none can be forgotten', () => {
    expect([...ASSAULT_TACTICS].sort()).toEqual(Object.keys(TACTICS).sort());
  });

  it('is ignored entirely against a unit', () => {
    const base = createGameState('tactics');
    const units = new Map<string, Unit>();
    units.set('a', {
      id: 'a', typeId: 'pipelineRunner', factionId: PLAYER_FACTION_ID,
      hex: { q: 1, r: 0 }, hp: 100, movesLeft: 2, fortified: false,
    });
    units.set('d', {
      id: 'd', typeId: 'pipelineRunner', factionId: 'silo-horde',
      hex: { q: 0, r: 0 }, hp: 100, movesLeft: 1, fortified: false,
    });
    const state: GameState = {
      ...base, units, cities: new Map(), activeFactionId: PLAYER_FACTION_ID,
    };
    const a = previewAttack(state, 'a', { q: 0, r: 0 }, { tactic: 'sap' })!;
    const b = previewAttack(state, 'a', { q: 0, r: 0 }, { tactic: 'escalade' })!;
    expect(a.expectedDamageToDefender).toBe(b.expectedDamageToDefender);
    expect(a.expectedDamageToAttacker).toBe(b.expectedDamageToAttacker);
  });
});
