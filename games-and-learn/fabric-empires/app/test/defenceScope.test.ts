import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
  Which fight the turn shows you, and how far your preparation reaches.

  Two defects, and the second was live for as long as stances have existed:

  1. The turn choreographs exactly ONE incoming raid, and it took whichever
     came first in the enemy's action order. A city could be stormed in the
     same turn a scout was jumped and never be mentioned.

  2. The stance and the battle answer were handed to the WHOLE enemy phase, so
     one choice made about one siege was applied to every unrelated fight on
     the map, including defenders the player was never shown and never asked
     about.

  The engine half of (2) is measured in `engine/test/ai.test.ts`, where the
  damage numbers actually move. This file guards the app half: that the thing
  shown, the thing asked, and the tile the preparation is scoped to are all the
  same raid.
*/

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');
const main = read('app/src/main.ts');

/** The body of `doEndTurn`, up to the point the result is adopted. */
function doEndTurn(): string {
  const start = main.indexOf('async function doEndTurn(');
  expect(start).toBeGreaterThan(0);
  return main.slice(start, main.indexOf('const nextState = result.state;', start));
}

describe('choosing which raid to show', () => {
  it('⚠️ prefers a raid on a town over whatever happened to be first', () => {
    const body = doEndTurn();
    expect(body).toContain("raids.find((e) => e.intent.kind === 'raid' && cityAt(state, e.intent.target))");
    // Still falls back, or a turn with no town raid would show nothing at all.
    expect(body).toContain('?? raids[0]');
  });

  it('⚠️ fights the same raid on screen that it asked about', () => {
    /*
     * `presentEnemyTurn` used to re-derive the featured raid as "the first one
     * the player defends", which stopped agreeing with the choice above the
     * moment towns were preferred: the banner and the question would sit on a
     * city while the duel was played out over a scout.
     */
    expect(main).toContain('featuredAt?: Hex');
    expect(main).toContain('hexKey(e.intent.target) === hexKey(featuredAt)');
    const call = main.slice(main.indexOf('const presentedEnemyTurn = presentEnemyTurn('));
    expect(call.slice(0, 300)).toContain(
      "incoming?.intent.kind === 'raid' ? incoming.intent.target : undefined",
    );
  });
});

describe('the stance question', () => {
  it('⚠️ is asked only when a town is the target', () => {
    /*
     * Sally and hold are written in the language of a gate and a wall. On a
     * scout caught in a field they name something that is not there, and the
     * trade the stance exists to offer, giving up fortification you paid for,
     * has nothing to give up.
     */
    const body = doEndTurn();
    const ask = body.indexOf('defenceStance = await choice.ask(');
    expect(ask).toBeGreaterThan(0);
    // The nearest preceding condition is the town check.
    expect(body.slice(ask - 40, ask)).toContain('if (city) {');
  });

  it('leaves everything else on the default, which is a no-op in combat', () => {
    const body = doEndTurn();
    expect(body).toContain('let defenceStance: DefenceStance = DEFAULT_STANCE;');
  });
});

describe('how far the preparation reaches', () => {
  it('⚠️ names the tile it was made for', () => {
    const body = doEndTurn();
    expect(body).toContain('defendAt:');
    expect(body).toContain(
      "defendAt: incoming?.intent.kind === 'raid' ? incoming.intent.target : undefined",
    );
  });

  it('⚠️ never reaches the engine without a tile beside it', () => {
    /*
     * Every `endTurn` call that carries the score must also carry `defendAt`.
     * One that did not would silently restore the old turn-wide spread, and
     * nothing else in the app would look different.
     *
     * ⚠️ Scoped to `endTurn` calls specifically. A blunter search over the
     * whole file also matches `presentEnemyTurn(..., defenderChallengeScore,
     * ...)`, which is the ANIMATION and is correctly turn-wide: it decides how
     * the duel is drawn, not how much damage anybody takes.
     */
    const carrying = [...main.matchAll(/endTurn\(state, \{([\s\S]*?)\}\)/g)]
      .map((m) => m[1]!)
      .filter((args) => args.includes('defenderChallengeScore'));

    expect(carrying.length).toBeGreaterThan(0);
    for (const args of carrying) expect(args).toContain('defendAt');
  });
});
