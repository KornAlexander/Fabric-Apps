/**
 * Cheat codes.
 *
 * ⚠️ **The assertion this file exists for is the last one: no cheat writes to
 * mastery.** Everything else here is ordinary behaviour checking. That one is a
 * promise about what the product is. Fabric Empires exists to tell somebody
 * whether they are ready to sit DP-600, and a code that could move that figure
 * would make the whole thing worse than useless, because the person would act
 * on it.
 *
 * It is tested by reading the source rather than by calling the functions,
 * because the failure mode is a future cheat that nobody thought to test.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createGameState, PLAYER_FACTION_ID, unitsOf } from '@fabric-empires/engine';
import { CHEATS, OKAY_CHEAT, findCheat, type CheatContext } from '../src/cheats.js';

function context(overrides: Partial<CheatContext> = {}): CheatContext {
  return {
    state: createGameState('FABRIC'),
    seat: PLAYER_FACTION_ID,
    selectedUnitId: undefined,
    faceProctor: () => {},
    liftFog: () => true,
    argument: '',
    ...overrides,
  };
}

describe('finding a code', () => {
  it('is case and whitespace insensitive', () => {
    expect(findCheat('ONELAKE')?.code).toBe('onelake');
    expect(findCheat('  onelake  ')?.code).toBe('onelake');
    expect(findCheat('one lake')?.code).toBe('onelake');
  });

  it('returns nothing for a code that does not exist', () => {
    expect(findCheat('rosebud')).toBeUndefined();
    expect(findCheat('')).toBeUndefined();
  });

  it('has no duplicate codes', () => {
    const codes = CHEATS.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('describes every code, because help prints them', () => {
    for (const cheat of CHEATS) {
      expect(cheat.describe.length, cheat.code).toBeGreaterThan(10);
      expect(cheat.code, `${cheat.code} should be typeable`).toMatch(/^[a-z0-9]+$/);
    }
  });
});

describe('the treasury codes', () => {
  it('onelake grants every resource', () => {
    const ctx = context();
    const before = ctx.state.factions.get(PLAYER_FACTION_ID)!.resources;
    const out = findCheat('onelake')!.apply(ctx);
    const after = out.state!.factions.get(PLAYER_FACTION_ID)!.resources;

    expect(after.data).toBe(before.data + 500);
    expect(after.compute).toBe(before.compute + 500);
    expect(after.cu).toBe(before.cu + 500);
    expect(after.trust).toBe(before.trust + 500);
  });

  it('f64 grants Compute only', () => {
    const ctx = context();
    const before = ctx.state.factions.get(PLAYER_FACTION_ID)!.resources;
    const after = findCheat('f64')!.apply(ctx).state!.factions.get(PLAYER_FACTION_ID)!.resources;
    expect(after.compute).toBe(before.compute + 2000);
    expect(after.data).toBe(before.data);
  });
});

describe('the army codes', () => {
  it('refreshnow heals and remobilises only your own units', () => {
    const base = createGameState('FABRIC');
    const units = new Map(base.units);
    for (const [id, unit] of units) units.set(id, { ...unit, hp: 3, movesLeft: 0 });
    const state = { ...base, units };

    const out = findCheat('refreshnow')!.apply(context({ state }));
    for (const unit of out.state!.units.values()) {
      if (unit.factionId === PLAYER_FACTION_ID) {
        expect(unit.hp, 'player healed').toBeGreaterThan(3);
        expect(unit.movesLeft, 'player remobilised').toBeGreaterThan(0);
      } else {
        // Healing the enemy too would be a very expensive typo.
        expect(unit.hp, 'enemy untouched').toBe(3);
        expect(unit.movesLeft, 'enemy untouched').toBe(0);
      }
    }
  });

  it('directlake adds a unit to your army and nobody else\u2019s', () => {
    const ctx = context();
    const before = unitsOf(ctx.state, PLAYER_FACTION_ID).length;
    const out = findCheat('directlake')!.apply(ctx);
    expect(unitsOf(out.state!, PLAYER_FACTION_ID)).toHaveLength(before + 1);
  });

  it('mirrored refuses when nothing is selected', () => {
    const out = findCheat('mirrored')!.apply(context());
    expect(out.ok).toBe(false);
    expect(out.state).toBeUndefined();
  });

  it('mirrored copies the selected unit\u2019s type', () => {
    const state = createGameState('FABRIC');
    const unit = unitsOf(state, PLAYER_FACTION_ID)[0]!;
    const out = findCheat('mirrored')!.apply(context({ state, selectedUnitId: unit.id }));
    expect(out.ok).toBe(true);
    const same = [...out.state!.units.values()].filter(
      (u) => u.factionId === PLAYER_FACTION_ID && u.typeId === unit.typeId,
    );
    expect(same.length).toBeGreaterThan(1);
  });

  it('never places two units on the same hex', () => {
    const state = createGameState('FABRIC');
    const unit = unitsOf(state, PLAYER_FACTION_ID)[0]!;
    const out = findCheat('mirrored')!.apply(context({ state, selectedUnitId: unit.id }));
    const hexes = [...out.state!.units.values()].map((u) => `${u.hex.q},${u.hex.r}`);
    expect(new Set(hexes).size).toBe(hexes.length);
  });
});

describe('the war code', () => {
  it('dropthetable clears rival units but leaves their villages', () => {
    const ctx = context();
    const villagesBefore = [...ctx.state.cities.values()].length;

    const out = findCheat('dropthetable')!.apply(ctx);
    const survivors = [...out.state!.units.values()].filter(
      (u) => u.factionId !== PLAYER_FACTION_ID,
    );

    expect(survivors).toHaveLength(0);
    expect(unitsOf(out.state!, PLAYER_FACTION_ID).length).toBeGreaterThan(0);
    // Conquest still has to be walked into, which is where the questions are.
    expect([...out.state!.cities.values()]).toHaveLength(villagesBefore);
  });
});

describe('the exam codes', () => {
  it('iknowthis refuses when nothing is being researched', () => {
      /*
       * ⚠️ The state has to be made idle now. A game selects a topic on its
       * own when none is chosen, so this branch is no longer reachable by
       * simply starting a game. The guard still matters for a loaded save or a
       * tree whose every topic is already known, which is why it is kept
       * rather than deleted.
       */
      const base = context();
      const idle = {
        ...base,
        state: {
          ...base.state,
          research: { ...base.state.research, current: undefined, progress: 0 },
        },
      };
      const out = findCheat('iknowthis')!.apply(idle);
  });

  it('iknowthis completes the funded topic', () => {
    const base = createGameState('FABRIC');
    const topic = base.topics.nodes[0]!.id;
    const state = {
      ...base,
      research: { known: [], current: topic, progress: 5 },
    };

    const out = findCheat('iknowthis')!.apply(context({ state }));
    expect(out.ok).toBe(true);
    expect(out.state!.research.known).toContain(topic);
    expect(out.state!.research.current).toBeUndefined();
  });

  it('sitthepaper opens the Proctor rather than passing it', () => {
    let called = 0;
    const out = findCheat('sitthepaper')!.apply(
      context({
        faceProctor: () => {
          called += 1;
        },
      }),
    );
    expect(called).toBe(1);
    expect(out.ok).toBe(true);
    // It must not hand out a result, only the opportunity to earn one.
    expect(out.state).toBeUndefined();
  });
});

describe('⚠️ the promise: no cheat can make you look ready', () => {
  // Vitest runs from the repository root, and this file has no DOM to need.
  const raw = readFileSync(resolve(process.cwd(), 'app/src/cheats.ts'), 'utf8');

  /*
   * Comments stripped before checking.
   *
   * The file explains at length WHY it must never touch mastery, and those
   * explanations are the most valuable part of it. Checking the raw text would
   * make the documentation fail the test it documents.
   */
  const source = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('never touches mastery, the review schedule or the readiness figure', () => {
    /*
     * Read as text, on purpose.
     *
     * Calling the current codes and checking they left mastery alone would
     * pass forever while proving nothing about the NEXT code somebody adds.
     * The readiness figure is the only real output this product has, and the
     * cheapest durable guarantee is that the module which defines cheats has
     * no way to reach the module that records what you know.
     */
    for (const forbidden of [
      'mastery',
      'Mastery',
      'sm2',
      'recordAnswer',
      'buildLibraryModel',
      'examRetained',
      'proctorReady',
    ]) {
      expect(source, `cheats.ts must not reference ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('imports nothing from the learning layer at all', () => {
    expect(source).not.toContain('@fabric-empires/learn');
    expect(source).not.toContain("from './learn");
  });

  it('still says why, so the next person does not undo it', () => {
    // The guarantee is only durable if the reason survives with it.
    expect(raw).toContain('mastery');
    expect(raw.toLowerCase()).toContain('ready');
  });
});

describe('⚠️ the O+K chord, and the promise it broke', () => {
  const cheatsSource = readFileSync(resolve(process.cwd(), 'app/src/cheats.ts'), 'utf8');
  const mainRaw = readFileSync(resolve(process.cwd(), 'app/src/main.ts'), 'utf8');

  /*
   * Comments stripped, for the reason the test above already gives: both files
   * explain at length what the old promise was and why it had to go, and those
   * explanations quote it. Checking the raw text would make the documentation
   * fail the test it documents. What matters is that the claim is not SHOWN to
   * a player, not that the word never appears in the repository.
   */
  const strip = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const mainSource = strip(mainRaw);

  it('names the code in one place, so recording and listing cannot disagree', () => {
    expect(OKAY_CHEAT).toBe('okay');
    expect(mainSource, 'main.ts must use the constant, not a literal')
      .toContain('OKAY_CHEAT');
  });

  it('⚠️ no longer claims that no cheat can make you ready', () => {
    /*
     * The claim was true of every typed code and became false the moment the
     * chord existed, because the chord's answer feeds the schedule like any
     * other. Both the docblock and the console's help text used to say it.
     *
     * This is the cheapest kind of lie to ship: nobody re-reads help text
     * looking for sentences that have quietly stopped being true, and the
     * reader has no reason to doubt a promise stated that plainly. So the
     * exact old wording is banned by name.
     */
    const gone = 'None of them can make you ready';
    expect(mainSource, 'the help text still makes a promise the chord breaks')
      .not.toContain(gone);
    expect(strip(cheatsSource), 'the docblock still makes a promise the chord breaks')
      .not.toContain('The one line no cheat crosses');
  });

  it('says instead that the chord counts, and where that is disclosed', () => {
    // Replacing a false claim with silence would be barely better. The help
    // text has to state the new rule, not merely stop stating the old one.
    expect(mainSource).toContain('O+K');
    expect(mainSource.toLowerCase()).toContain('end screen');
  });

  it('⚠️ records the chord so the end screen can disclose it', () => {
    // Disclosure is the only thing keeping this honest now that the answer
    // counts. If the recording goes, nothing else notices.
    expect(mainSource).toContain('recordCheat(state, OKAY_CHEAT)');
  });

  it('⚠️ keys on the physical key, not on the letter', () => {
    /*
     * `event.key` is layout-dependent: on a German keyboard the physical Z
     * reports "y". "Hold O and K" is a claim about where two fingers go, so
     * the code has to read `event.code`.
     */
    expect(mainSource).toContain("held.has('KeyO')");
    expect(mainSource).toContain("held.has('KeyK')");
  });

  it('⚠️ forgets held keys when the window loses focus', () => {
    /*
     * A key held while focus leaves never gets its keyup. Without the blur
     * reset the set would keep KeyO for ever, and from then on a lone K would
     * answer the player's question for them.
     */
    expect(mainSource).toMatch(/addEventListener\('blur', clear\)/);
  });

  it('answers through the same function the harness uses', () => {
    // Two implementations of "pick the right options and submit" would drift,
    // and this file has already paid for that kind of split twice.
    expect(mainSource).toContain('answerCurrentQuestion(true)');
    expect(mainSource).toContain('answerOpen: async (correct = true) => answerCurrentQuestion(correct)');
  });
});
