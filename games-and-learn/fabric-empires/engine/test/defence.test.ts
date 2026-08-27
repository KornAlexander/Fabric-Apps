import { describe, expect, it } from 'vitest';
import {
  chooseStance,
  createGameState,
  counterShare,
  maxWallHp,
  previewAttack,
  resolveAttack,
  stanceProfile,
  DEFAULT_STANCE,
  DEFENCE_STANCES,
  MAX_WALL_LEVEL,
  PLAYER_FACTION_ID,
  type City,
  type DefenceStance,
  type GameState,
  type Unit,
} from '../src/index.js';

/**
 * Defence stances.
 *
 * Section 19.4 and D143: the defender was a number. Attacking has been a
 * decision since section 59, so half of every siege was a spectator sport.
 *
 * ⚠️ The test that matters is not that each stance does something, it is that
 * **no stance is simply best**. That is the same question the tactics tests
 * ask, and it is the one that decides whether this is a choice or a menu with
 * a correct answer on it.
 */

const ANTAGONIST = 'silo-horde';

function walledCity(over: Partial<City> = {}): City {
  return {
    id: 'target',
    factionId: ANTAGONIST,
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

function unit(over: Partial<Unit> & Pick<Unit, 'id' | 'typeId' | 'factionId' | 'hex'>): Unit {
  return { hp: 100, movesLeft: 2, fortified: false, ...over };
}

/** An attacker next to a walled enemy city. */
function siege(
  typeId: Unit['typeId'] = 'pipelineRunner',
  over: Partial<City> = {},
): { state: GameState; attackerId: string; target: { q: number; r: number } } {
  const base = createGameState('defence');
  const units = new Map<string, Unit>();
  units.set('a', unit({ id: 'a', typeId, factionId: PLAYER_FACTION_ID, hex: { q: 1, r: 0 } }));
  const cities = new Map<string, City>();
  cities.set('target', walledCity(over));
  return {
    state: { ...base, units, cities, activeFactionId: PLAYER_FACTION_ID },
    attackerId: 'a',
    target: { q: 0, r: 0 },
  };
}

/** An attacker next to a defending unit, dug in. */
function skirmish(
  defenderOver: Partial<Unit> = {},
): { state: GameState; attackerId: string; target: { q: number; r: number } } {
  const base = createGameState('defence');
  const units = new Map<string, Unit>();
  units.set(
    'a',
    unit({ id: 'a', typeId: 'pipelineRunner', factionId: PLAYER_FACTION_ID, hex: { q: 1, r: 0 } }),
  );
  units.set(
    'd',
    unit({
      id: 'd',
      typeId: 'pipelineRunner',
      factionId: ANTAGONIST,
      hex: { q: 0, r: 0 },
      fortified: true,
      ...defenderOver,
    }),
  );
  return {
    state: { ...base, units, cities: new Map(), activeFactionId: PLAYER_FACTION_ID },
    attackerId: 'a',
    target: { q: 0, r: 0 },
  };
}

const look = (
  s: ReturnType<typeof siege>,
  stance: DefenceStance,
): { taken: number; dealt: number } => {
  const p = previewAttack(s.state, s.attackerId, s.target, { defenceStance: stance })!;
  return { taken: p.expectedDamageToDefender, dealt: p.expectedDamageToAttacker };
};

describe('the default changes nothing', () => {
  it('is hold, and hold is a no-op on every number', () => {
    expect(DEFAULT_STANCE).toBe('hold');
    const p = stanceProfile('hold');
    expect(p.strength).toBe(1);
    expect(p.fortifyShare).toBe(1);
    expect(p.counter).toBe(1);
    expect(p.counterFloor).toBe(0);
  });

  it('gives the same preview with no stance as with hold', () => {
    for (const s of [siege(), skirmish()]) {
      const none = previewAttack(s.state, s.attackerId, s.target)!;
      const hold = previewAttack(s.state, s.attackerId, s.target, { defenceStance: 'hold' })!;
      expect(hold.expectedDamageToDefender).toBe(none.expectedDamageToDefender);
      expect(hold.expectedDamageToAttacker).toBe(none.expectedDamageToAttacker);
    }
  });
});

describe('each stance is best at something', () => {
  it('brace takes the least, sally deals the most, and neither does both', () => {
    const s = siege('notebookCannon');
    const hold = look(s, 'hold');
    const sally = look(s, 'sally');
    const brace = look(s, 'brace');

    // Bracing is the toughest, and it returns nothing at all.
    expect(brace.taken).toBeLessThan(hold.taken);
    expect(brace.dealt).toBe(0);

    // Sallying hits hardest, and pays for it by taking more than holding.
    expect(sally.dealt).toBeGreaterThan(hold.dealt);
    expect(sally.taken).toBeGreaterThan(brace.taken);

    // ⚠️ The thing that makes this a choice: nothing wins both columns.
    expect(sally.taken).toBeGreaterThan(brace.taken);
    expect(brace.dealt).toBeLessThan(sally.dealt);
  });

  it('⚠️ sallying from a city counters where holding does not', () => {
    /*
     * The trap this stance was most likely to fall into. Cities counter only
     * against escalade, so a sally that merely multiplied the existing counter
     * would multiply zero and the option would be a button that does nothing,
     * which is exactly what section 55 found walls doing.
     */
    const s = siege('pipelineRunner');
    expect(look(s, 'hold').dealt).toBe(0);
    expect(look(s, 'sally').dealt).toBeGreaterThan(0);
  });

  it('gives up the wall when it sallies', () => {
    const s = siege();
    const hold = previewAttack(s.state, s.attackerId, s.target, { defenceStance: 'hold' })!;
    const sally = previewAttack(s.state, s.attackerId, s.target, { defenceStance: 'sally' })!;
    expect(hold.defender.fortifyBonus).toBeGreaterThan(0);
    expect(sally.defender.fortifyBonus).toBe(0);
  });

  it('gives up the dug-in position too, but not the ground', () => {
    const s = skirmish();
    const hold = previewAttack(s.state, s.attackerId, s.target, { defenceStance: 'hold' })!;
    const sally = previewAttack(s.state, s.attackerId, s.target, { defenceStance: 'sally' })!;
    expect(hold.defender.fortifyBonus).toBeGreaterThan(0);
    expect(sally.defender.fortifyBonus).toBe(0);
    // Terrain is not a choice the defender made this turn.
    expect(sally.defender.terrainBonus).toBe(hold.defender.terrainBonus);
  });
});

describe('the preview is the fight', () => {
  /*
   * ⚠️ Section 59 found the preview and the resolution had drifted apart once
   * each grew its own copy of the tactic arithmetic. The stance adds a second
   * factor to the same sum, so this asserts they still agree.
   */
  it('resolves the counter the preview promised', () => {
    for (const stance of DEFENCE_STANCES) {
      const s = siege('notebookCannon');
      const rng = { float: () => 1, int: () => 0, next: () => 0.5 } as never;
      const p = previewAttack(s.state, s.attackerId, s.target, { defenceStance: stance })!;
      const r = resolveAttack(s.state, s.attackerId, s.target, { defenceStance: stance, rng });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const attacker = r.result.state.units.get(s.attackerId);
      /*
       * ⚠️ The preview promises damage; the map can only show hit points, and
       * a unit has at most 100 of them. A sally that counters for 112 kills
       * the attacker and leaves nothing behind to subtract from, so comparing
       * `100 - hp` against the preview reads as a preview/resolve split when
       * the two actually agree. Compare against what the preview can express.
       */
      const survivable = Math.min(p.expectedDamageToAttacker, 100);
      const hpLost = attacker === undefined ? 100 : 100 - attacker.hp;
      expect(hpLost, `stance ${stance}`).toBe(survivable);
    }
  });
});

describe('counterShare', () => {
  it('leaves a unit fight alone except for the stance multiplier', () => {
    expect(counterShare(stanceProfile('hold'), 'unit', 0)).toBe(1);
    expect(counterShare(stanceProfile('brace'), 'unit', 0)).toBe(0);
    expect(counterShare(stanceProfile('sally'), 'unit', 0)).toBeGreaterThan(1);
  });

  it('honours the attacker tactic when it is the more generous of the two', () => {
    // Escalade already grants a full city counter; holding keeps exactly that.
    expect(counterShare(stanceProfile('hold'), 'city', 1)).toBe(1);
    // Bracing declines it, which is the cost of the stance.
    expect(counterShare(stanceProfile('brace'), 'city', 1)).toBe(0);
  });
});

describe('the antagonists defend themselves too (D143)', () => {
  it('braces rather than dying when the blow would be fatal', () => {
    // A city one hit from falling, against a siege engine.
    const s = siege('directLakeTitan', { hp: 12, wallHp: 0 });
    const picked = chooseStance(s.state, s.attackerId, s.target);
    expect(picked).toBe('brace');
  });

  it('does not sally into a counter that kills the defender', () => {
    const s = siege('directLakeTitan', { hp: 30, wallHp: 0 });
    expect(chooseStance(s.state, s.attackerId, s.target)).not.toBe('sally');
  });

  it('returns a real stance for every situation it is asked about', () => {
    for (const s of [siege(), siege('notebookCannon'), skirmish()]) {
      expect(DEFENCE_STANCES).toContain(chooseStance(s.state, s.attackerId, s.target));
    }
  });
});
