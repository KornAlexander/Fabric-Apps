import { describe, expect, it } from 'vitest';
import {
  ANTAGONIST_FACTION_ID,
  HOPELESS_ASSAULT_TURNS,
  MAX_WALL_LEVEL,
  PLAYER_FACTION_ID,
  createGameState,
  hexKey,
  hexNeighbours,
  maxWallHp,
  planUnitAction,
  previewAttack,
  type City,
  type GameState,
  type Unit,
} from '../src/index.js';

/*
  Whether the antagonists are WILLING to storm a walled town.

  ⚠️ This is a different question from the one `siege.test.ts` answers, and the
  gap between them is where the bug lived. Those tests call `resolveAttack`
  directly and prove a level-three wall can be broken. They say nothing about
  whether anybody ever decides to swing at it, and the answer was no: building
  walls made the AI stop attacking the town altogether, so the player watched
  enemies gather outside and mill about for the rest of the game.

  "Every unit test passed while it was true" is the lesson the neighbouring
  file already records about walls. This is the same lesson one level up: the
  combat maths was never wrong, the choice to enter combat was.
*/

const SEED = 'FABRIC';

/** A full city record, so nothing downstream reads an undefined field. */
function town(over: Partial<City>): City {
  return {
    id: 'target',
    factionId: PLAYER_FACTION_ID,
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
  } as City;
}

/** A player town with the given walls, and hostile raiders beside it. */
function investment(
  wallLevel: number,
  raiders = 1,
  cityOver: Partial<City> = {},
): { state: GameState; foes: string[]; hex: City['hex'] } {
  const base = createGameState(SEED);
  const anchor = [...base.units.values()].find((u) => u.factionId === PLAYER_FACTION_ID)!;

  const cities = new Map(base.cities);
  cities.set(
    'target',
    town({ hex: anchor.hex, wallLevel, wallHp: maxWallHp(wallLevel), ...cityOver }),
  );

  // Clear the board so only the siege is on it: no other target can be the
  // reason a raider chose something else.
  const units = new Map<string, Unit>();
  const foes: string[] = [];
  const spots = hexNeighbours(anchor.hex).filter((h) => base.map.tiles.has(hexKey(h)));
  for (let i = 0; i < raiders && i < spots.length; i += 1) {
    const id = `foe-${i}`;
    units.set(id, {
      id,
      typeId: 'pipelineRunner',
      factionId: ANTAGONIST_FACTION_ID,
      hex: spots[i]!,
      hp: 100,
      movesLeft: 2,
      fortified: false,
    });
    foes.push(id);
  }

  /*
   * ⚠️ The attacking faction must be ACTIVE, or nothing attacks anything.
   *
   * `runFactionTurn` sets `activeFactionId` before it plans, and combat checks
   * it. Leaving it as the player made `previewAttack` report zero damage for
   * every wall level including none at all, which reads exactly like the bug
   * being investigated and is really a broken fixture. Two separate attempts
   * at measuring this reached a confident wrong conclusion that way.
   */
  return {
    state: {
      ...base,
      cities,
      units,
      activeFactionId: ANTAGONIST_FACTION_ID,
    } as GameState,
    foes,
    hex: anchor.hex,
  };
}

const attacks = (state: GameState, id: string): boolean =>
  planUnitAction(state, id)?.kind === 'raid';

describe('willingness to assault a town', () => {
  it('attacks an unwalled town', () => {
    const { state, foes } = investment(0);
    expect(attacks(state, foes[0]!)).toBe(true);
  });

  it('⚠️ still attacks a walled town rather than ignoring it', () => {
    /*
     * The player's complaint, in one assertion. Fortifying is meant to make a
     * town hard to take, not invisible: a defence that makes the game stop
     * happening is worse than no defence, because the reason to build it was
     * to survive an assault that now never comes.
     *
     * ⚠️ Two raiders, not one, and the difference is the whole point. A single
     * line unit does `MIN_DAMAGE` into a wall that mends faster than that, so
     * declining alone is CORRECT. What was broken is that a pair, who together
     * out-damage the repairs, each declined privately as well.
     */
    for (let level = 1; level <= MAX_WALL_LEVEL; level += 1) {
      const { state, foes } = investment(level, 2);
      expect(foes.some((id) => attacks(state, id)), `walls level ${level}`).toBe(true);
    }
  });

  it('⚠️ a lone raider still declines the heaviest wall, which is right', () => {
    /*
     * Kept as an assertion so the fix cannot drift into "everybody always
     * attacks". One unit doing floor damage into `WALL_MEND_PER_CYCLE` is the
     * pathological case the guard exists for, and it must survive.
     */
    const { state, foes } = investment(MAX_WALL_LEVEL, 1);
    expect(attacks(state, foes[0]!)).toBe(false);
  });

  it('⚠️ counts the besieging army, not each raider alone', () => {
    /*
     * The arithmetic that was wrong. Six units around a town break it in a
     * sixth of the time, and the guard asked each of them privately whether
     * IT could do the job. Every answer was no, so nobody attacked, which is
     * the one outcome six-to-one should never produce.
     */
    const { state, foes } = investment(MAX_WALL_LEVEL, 6);
    expect(foes.length).toBeGreaterThan(1);
    expect(foes.some((id) => attacks(state, id))).toBe(true);
  });

  it('⚠️ does not pool the arithmetic of factions that are not allies', () => {
    /*
     * The seven antagonists plan separately. Counting somebody else's army as
     * part of yours would have them besiege as a coalition the game does not
     * model, and the player would face a coordinated assault that nothing in
     * the rules ever agreed to.
     */
    const { state, foes, hex } = investment(MAX_WALL_LEVEL, 6);
    const units = new Map(state.units);
    // Leave one raider from the acting faction; hand the rest to a rival.
    foes.slice(1).forEach((id) => {
      units.set(id, { ...units.get(id)!, factionId: 'open-gate' });
    });
    const split: GameState = { ...state, units };

    expect(hex).toBeDefined();
    expect(attacks(split, foes[0]!)).toBe(false);
  });

  it('still refuses a genuinely hopeless assault', () => {
    /*
     * The guard has to keep working, or an army spends the rest of the game
     * hitting a wall at the damage floor while a soft target waits one hex
     * away. One raider against an absurd shield is still a no.
     */
    const { state, foes } = investment(0, 1, { hp: 100_000 });
    expect(attacks(state, foes[0]!)).toBe(false);
  });

  it('records what the guard is actually judging', () => {
    /*
     * Not really an assertion. It exists so a future change to unit strength
     * or wall hit points shows up here as a number, rather than silently as a
     * siege that stopped happening.
     */
    const seen: string[] = [];
    for (let level = 0; level <= MAX_WALL_LEVEL; level += 1) {
      const { state, foes, hex } = investment(level);
      const city = state.cities.get('target')!;
      const perHit = previewAttack(state, foes[0]!, hex)?.expectedDamageToDefender ?? 0;
      const shield = city.wallHp + city.hp;
      seen.push(
        `walls ${level}: shield ${shield}, perHit ${perHit.toFixed(1)}, ` +
          `alone ${perHit > 0 ? (shield / perHit).toFixed(1) : 'inf'} turns`,
      );
    }
    console.log(`limit ${HOPELESS_ASSAULT_TURNS} turns\n  ${seen.join('\n  ')}`);
    expect(seen).toHaveLength(MAX_WALL_LEVEL + 1);
  });
});
