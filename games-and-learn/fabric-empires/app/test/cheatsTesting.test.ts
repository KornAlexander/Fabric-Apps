import { describe, expect, it } from 'vitest';
import {
  memoryOf,
  ANTAGONIST_FACTION_ID,
  PLAYER_FACTION_ID,
  createGameState,
  cityAt,
  hexKey,
  unitsOf,
  type GameState,
} from '@fabric-empires/engine';
import {
  CHEATS,
  CHEAT_CODE_WIDTH,
  matchCheat,
  type CheatContext,
} from '../src/cheats.js';

/*
  The codes added so the game can be exercised without playing forty turns.

  ⚠️ These are test affordances that ship, which is the point: every rule this
  project has shipped and then found broken was one nobody could reach quickly
  enough to look at. A besieged town took four turns of setup to produce, so
  nobody produced one, and the AI's refusal to attack survived for weeks.
*/

function context(overrides: Partial<CheatContext> = {}): CheatContext {
  return {
    state: createGameState('FABRIC'),
    seat: PLAYER_FACTION_ID,
    selectedUnitId: undefined,
    faceProctor: () => {},
    argument: '',
    ...overrides,
  };
}

const run = (code: string, ctx = context()) => {
  const match = matchCheat(code);
  expect(match, `${code} should resolve to a cheat`).toBeDefined();
  return match!.cheat.apply({ ...ctx, argument: match!.argument });
};

describe('codes that take an argument', () => {
  it('splits the argument off the code', () => {
    const match = matchCheat('provision profiler');
    expect(match?.cheat.code).toBe('provision');
    expect(match?.argument).toBe('profiler');
  });

  it('⚠️ leaves a typo as a typo rather than a near miss', () => {
    /*
     * If every code swallowed a suffix, `onelakes` would quietly run `onelake`
     * and the console could never tell anybody they had mistyped. Only codes
     * that declare `takesArgument` are matched by prefix.
     */
    expect(matchCheat('onelakes')).toBeUndefined();
    expect(matchCheat('rosebud')).toBeUndefined();
  });

  it('names the choices when the argument is missing', () => {
    const out = run('provision');
    expect(out.ok).toBe(false);
    expect(out.message).toContain('profiler');
  });

  it('refuses a unit that does not exist, and says so usefully', () => {
    const out = run('provision dragon');
    expect(out.ok).toBe(false);
    expect(out.message).toContain('dragon');
  });

  it('musters the unit that was asked for', () => {
    const ctx = context();
    const before = unitsOf(ctx.state, PLAYER_FACTION_ID).length;
    const out = run('provision profiler', ctx);
    expect(out.ok).toBe(true);
    const after = unitsOf(out.state!, PLAYER_FACTION_ID);
    expect(after.length).toBe(before + 1);
    expect(after.some((u) => u.typeId === 'profiler')).toBe(true);
  });
});

/** A state where the player owns a town, which most war codes need. */
function withTown(): GameState {
  const base = createGameState('FABRIC');
  const anchor = unitsOf(base, PLAYER_FACTION_ID)[0]!;
  const cities = new Map(base.cities);
  cities.set('mine', {
    id: 'mine',
    factionId: PLAYER_FACTION_ID,
    hex: anchor.hex,
    name: 'Workspace',
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
  } as never);
  return { ...base, cities } as GameState;
}

describe('putting yourself under siege', () => {
  it('rings the town with hostiles', () => {
    const out = run('noisyneighbour', context({ state: withTown() }));
    expect(out.ok).toBe(true);
    expect(unitsOf(out.state!, ANTAGONIST_FACTION_ID).length).toBeGreaterThan(1);
  });

  it('⚠️ leaves them with moves, or nothing happens next turn', () => {
    /*
     * The failure this prevents is silent and maddening: raiders spawn, the
     * player ends the turn, and nothing at all occurs because every besieger
     * had already spent its move. The code would look broken while working.
     */
    const out = run('noisyneighbour', context({ state: withTown() }));
    const foes = unitsOf(out.state!, ANTAGONIST_FACTION_ID);
    expect(foes.every((u) => u.movesLeft > 0)).toBe(true);
  });

  it('says so when there is no town to besiege', () => {
    const out = run('noisyneighbour');
    expect(out.ok).toBe(false);
  });
});

describe('the town codes', () => {
  it('spill halves the town and warns it will not mend', () => {
    const out = run('spill', context({ state: withTown() }));
    expect(out.ok).toBe(true);
    expect(out.state!.cities.get('mine')!.hp).toBe(100);
    expect(out.message).toMatch(/not mend/i);
  });

  it('⚠️ scaleup grants citizens, never the rank itself', () => {
    /*
     * Rank also needs retained knowledge, which lives on the other side of the
     * D35 line. A code that set `rank` would step over the one gate this game
     * exists to make you earn, and would leave a Township whose Library says
     * nothing is known.
     */
    const state = withTown();
    const out = run('scaleup', context({ state }));
    expect(out.ok).toBe(true);
    const town = out.state!.cities.get('mine')!;
    expect(town.population).toBeGreaterThan(state.cities.get('mine')!.population);
    expect(town.rank).toBe(state.cities.get('mine')!.rank);
  });

  it('firewall plants a walled rival town', () => {
    const ctx = context({ state: withTown() });
    const out = run('firewall', ctx);
    expect(out.ok).toBe(true);

    /*
     * ⚠️ The town that was ADDED, not the first rival on the map. Seven
     * antagonist villages already exist and none of them has walls, so
     * looking for "a rival city" found one of those and reported the code
     * broken while it worked.
     */
    const planted = [...out.state!.cities.values()].find((c) => !ctx.state.cities.has(c.id));
    expect(planted).toBeDefined();
    expect(planted!.factionId).toBe(ANTAGONIST_FACTION_ID);
    expect(planted!.wallLevel).toBeGreaterThan(0);
    expect(planted!.wallHp).toBeGreaterThan(0);
  });
});

describe('the world codes', () => {
  it('⚠️ lineage explores the map without revealing what stands on it', () => {
    /*
     * Explored, not visible. Lifting the black is a convenience; handing over
     * a live feed of every town would undo the fog rules entirely, and the
     * town memory is supposed to record what was actually seen.
     */
    const ctx = context();
    const out = run('lineage', ctx);
    expect(out.ok).toBe(true);
    expect(memoryOf(out.state!, PLAYER_FACTION_ID).explored.size).toBe(ctx.state.map.tiles.size);
    expect(memoryOf(out.state!, PLAYER_FACTION_ID).seenCities.size).toBe(
      memoryOf(ctx.state, PLAYER_FACTION_ID).seenCities.size,
    );
  });

  it('shortcut buries a cache beside a Profiler', () => {
    const ctx = context();
    const out = run('shortcut', ctx);
    expect(out.ok).toBe(true);

    const profiler = unitsOf(ctx.state, PLAYER_FACTION_ID).find((u) => u.typeId === 'profiler');
    expect(profiler, 'the opening army should include a Profiler').toBeDefined();

    const added = [...out.state!.treasures.values()].filter(
      (t) => !ctx.state.treasures.has(t.id),
    );
    expect(added).toHaveLength(1);
    // Adjacent, so one step opens it.
    const chest = added[0]!;
    const gap =
      (Math.abs(chest.hex.q - profiler!.hex.q) +
        Math.abs(chest.hex.q + chest.hex.r - profiler!.hex.q - profiler!.hex.r) +
        Math.abs(chest.hex.r - profiler!.hex.r)) /
      2;
    expect(gap).toBe(1);
  });

  it('never drops a cache on something that is already there', () => {
    const ctx = context();
    const out = run('shortcut', ctx);
    const chest = [...out.state!.treasures.values()].find((t) => !ctx.state.treasures.has(t.id))!;
    expect(cityAt(out.state!, chest.hex)).toBeUndefined();
    expect(out.state!.map.tiles.has(hexKey(chest.hex))).toBe(true);
  });
});

describe('the help listing', () => {
  it('⚠️ is wide enough for the longest code', () => {
    /*
     * `padEnd` was a hard-coded 14 while the longest code was 12. Adding
     * `noisyneighbour` would have printed the code and its description with no
     * gap between them, which is the sort of thing nobody notices in review
     * and everybody notices on screen.
     */
    const longest = Math.max(...CHEATS.map((c) => c.code.length));
    expect(CHEAT_CODE_WIDTH).toBeGreaterThan(longest);
  });

  it('gives every new code a category the help can group by', () => {
    for (const cheat of CHEATS) {
      expect(['treasury', 'army', 'war', 'world', 'exam']).toContain(cheat.category);
    }
  });
});
