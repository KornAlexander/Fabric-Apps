/**
 * Lifting the fog entirely, and why it is a view flag rather than a save.
 *
 * The console already had `lineage`, which marks every tile explored. That
 * lifts the black and deliberately stops there: you still have to walk past a
 * town before you know it is there, so the memory stays an honest record of
 * what was actually seen.
 *
 * `adminportal` is the other half, and the difference between them is the
 * whole design:
 *
 *   - `lineage` writes STATE. It is permanent, it is saved, and it is true
 *     afterwards: you really do know that ground.
 *   - `adminportal` flips a VIEW. Nothing in the rules changes, which is what
 *     lets it be turned off again and put the player back exactly where they
 *     were rather than leaving them holding a map they never scouted.
 *
 * ⚠️ Read from the source rather than executed. Fog is the one feature whose
 * entire content is that something is NOT drawn, so there is no return value to
 * assert on: the claims here are about which lever the app pulls, and running
 * a mocked renderer would test the mock. What it LOOKS like is a question for
 * eyes, and PLAN records what those eyes saw.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHEATS } from '../src/cheats.js';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');
const main = read('app/src/main.ts');
const cheats = read('app/src/cheats.ts');

describe('the code exists and is reachable', () => {
  it('is listed, so `help` can find it', () => {
    const cheat = CHEATS.find((c) => c.code === 'adminportal');
    expect(cheat, 'adminportal should be in the console').toBeDefined();
    expect(cheat!.category).toBe('world');
  });

  it('⚠️ says it can be turned off, because nothing else in the console can', () => {
    /*
     * Every other code is one-way. A player who assumed this one was too would
     * never try typing it again, so the reversibility has to be in the menu
     * line rather than only in the source.
     */
    const cheat = CHEATS.find((c) => c.code === 'adminportal')!;
    expect(cheat.describe.toLowerCase()).toContain('again');
  });

  it('⚠️ the app actually wires the callback up', () => {
    /*
     * The lesson this repository keeps relearning: a rule proven in isolation
     * says nothing about whether anything invokes it. The cheat calls
     * `liftFog`, and if `main.ts` never supplies one, the code is listed,
     * typeable, and does nothing at all.
     */
    const call = main.slice(main.indexOf('cheat.apply({'));
    expect(call.slice(0, 600)).toContain('liftFog:');
  });
});

describe('what it lifts', () => {
  it('⚠️ hands the scene `undefined`, which is how it is told there is no fog', () => {
    /*
     * Passing the full tile set would look identical and would cost a six
     * thousand entry lookup per unit, per town and per overlay, every frame.
     */
    expect(main).toContain('visibleHexes: fogLifted ? undefined : currentSight');
  });

  it('lights the ground as well as showing the armies', () => {
    // Both halves, or the map is a black sheet with units floating on it.
    const fog = main.slice(main.indexOf('function refreshFog('));
    expect(fog.slice(0, 900)).toContain('fogLifted');
    expect(fog.slice(0, 900)).toContain('scene.setFog([], [])');
  });

  it('⚠️ clears the fog signature, or the toggle would do nothing on screen', () => {
    /*
     * `refreshFog` returns early when the signature is unchanged, which is the
     * optimisation that stops it merging six thousand hex patches every frame.
     * A toggle that left the signature alone would flip the flag and never
     * redraw, which looks exactly like the code being broken.
     */
    const call = main.slice(main.indexOf('liftFog: () => {'));
    expect(call.slice(0, 400)).toContain('fogSignature');
  });
});

describe('what it does not touch', () => {
  it('⚠️ writes no state, which is what makes it reversible', () => {
    /*
     * A version that wrote the whole map into the seat's memory would be
     * permanent, indistinguishable from `lineage`, and a lie about what the
     * player has actually seen.
     */
    const body = cheats.slice(cheats.indexOf("code: 'adminportal'"));
    const apply = body.slice(0, body.indexOf('shortcut'));
    expect(apply).not.toContain('memory:');
    expect(apply).not.toContain('state:');
  });

  it('⚠️ is still recorded, because THAT part has to be permanent', () => {
    /*
     * The one thing this game must never do is tell somebody they are ready
     * when they are not. A code that could be used and then hidden by turning
     * it off would do exactly that, so the record lives in `cheatsUsed` on the
     * state and the reversibility applies only to the picture.
     */
    expect(cheats).toContain('cheatsUsed');
  });

  it('stays separate from the opening reveal, which lifts less', () => {
    /*
     * ⚠️ The intro lights the land and still hides every army on it, because an
     * establishing shot showing all seven camps would give away the scouting
     * game before turn one. Sharing one flag would spoil the opening.
     */
    expect(main).toContain('let revealingForOpening = false;');
    expect(main).toContain('let fogLifted = false;');
  });
});
