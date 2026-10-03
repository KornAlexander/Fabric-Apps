/**
 * The stings: the sounds the game makes while you are playing it.
 *
 * ⚠️ **The complaint that produced these was "the music is too loud", and the
 * music was not too loud.** It was the only thing playing. Three cinematic cues
 * fired once each per game, over a continuous orchestral bed, so a whole turn
 * of moving, fighting and building made no sound at all. A bed with nothing on
 * top of it is a bed you notice.
 *
 * So the fix is two-sided, and both halves are tested here: the score came
 * down, the sounds went up, and the game gained a foreground to put in front
 * of it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CUES, LAST_ONSET_SECONDS, STINGS, createCues } from '../src/cues.js';
import { MUSIC_VOLUME } from '../src/soundtrack.js';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');
const main = read('app/src/main.ts');
const cuesSource = read('app/src/cues.ts');

describe('a sting is not a cinematic cue', () => {
  it('⚠️ lives in its own table, so the cinematic coverage tests still mean something', () => {
    /*
     * Two tests hold `CUES` to the set of cinematics exactly: every film must
     * have a cue, and every cue must have a film. A combat sound in that table
     * would be an orphan by definition, and relaxing the orphan test to allow
     * it would throw away the thing that catches a renamed cinematic playing
     * in silence.
     */
    for (const id of Object.keys(STINGS)) {
      expect(CUES[id], `${id} must not also be a cinematic cue`).toBeUndefined();
    }
    expect(Object.keys(STINGS).length).toBeGreaterThan(0);
  });

  it('⚠️ is SHORT, because it fires mid-turn and possibly twice in a row', () => {
    /*
     * A cinematic cue has the screen to itself for four seconds. A sting does
     * not, and anything with a long tail turns a busy turn into mud.
     */
    for (const [id, events] of Object.entries(STINGS)) {
      for (const e of events) {
        expect(e.seconds, `${id} rings for ${e.seconds}s`).toBeLessThanOrEqual(1);
        expect(e.at, `${id} starts a voice at ${e.at}s`).toBeLessThanOrEqual(0.2);
      }
    }
  });

  it('is comfortably inside the onset rule the films follow', () => {
    for (const [id, events] of Object.entries(STINGS)) {
      const last = Math.max(...events.map((e) => e.at));
      expect(last, id).toBeLessThanOrEqual(LAST_ONSET_SECONDS);
    }
  });

  it('never asks for a silent or an overdriven voice', () => {
    for (const [id, events] of Object.entries(STINGS)) {
      for (const e of events) {
        expect(e.gain, `${id} gain`).toBeGreaterThan(0);
        expect(e.gain, `${id} gain`).toBeLessThanOrEqual(1);
        expect(e.hz, `${id} hz`).toBeGreaterThan(0);
      }
    }
  });

  it('plays through the same entry point, and an unknown id is still silence', () => {
    /*
     * ⚠️ Muted, deliberately. Playing an unmuted sting here would reach for a
     * real `AudioContext`, which this environment does not have, and the test
     * would then be measuring jsdom rather than the lookup. What matters is
     * that a sting id is a thing `play` recognises and an unknown one is not
     * an error.
     */
    const cues = createCues();
    cues.setMuted(true);
    for (const id of Object.keys(STINGS)) {
      expect(() => cues.play(id), id).not.toThrow();
    }
    expect(() => cues.play('no-such-sound')).not.toThrow();
  });

  it('is muted by the same switch as the music', () => {
    // One mute for everything the game makes. Two would be a settings screen.
    const cues = createCues();
    cues.setMuted(true);
    expect(cues.muted).toBe(true);
    expect(() => cues.play('clash')).not.toThrow();
  });
});

describe('⚠️ the mix moved in BOTH directions', () => {
  it('brought the score down', () => {
    /*
     * Dropping the score alone would leave the game quiet rather than
     * balanced, which is why this is asserted next to the lift below.
     *
     * ⚠️ The real constant, not a regex over the source. The soundtrack test
     * used to hard-code this number and broke the day it changed.
     */
    expect(MUSIC_VOLUME).toBeLessThan(0.28);
    expect(MUSIC_VOLUME).toBeGreaterThan(0);
  });

  it('and brought the sounds up', () => {
    // Lifting this alone would make the films shout.
    const match = /master\.gain\.value = ([\d.]+)/.exec(cuesSource);
    expect(match, 'the cue bus still sets a master gain').not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThan(0.5);
  });
});

describe('the game actually makes these noises', () => {
  it('⚠️ sounds a blow on IMPACT, not when the attack was ordered', () => {
    /*
     * The lesson this repository keeps relearning: a rule proven in isolation
     * says nothing about whether anything invokes it. A sting nothing plays is
     * a table of numbers.
     */
    const impact = main.slice(main.indexOf('const onImpact = (): void => {'), 900 + main.indexOf('const onImpact = (): void => {'));
    expect(impact).toContain('cues.play(');
    expect(impact).toMatch(/'volley' : 'clash'/);
  });

  it('tells a shot apart from a hit, and a breach from both', () => {
    // ⚠️ The melee and ranged case share one call through a ternary, so the
    // literal `cues.play('volley')` does not exist and asserting it would fail
    // for a reason that has nothing to do with whether a shot makes a noise.
    expect(main).toContain("'volley' : 'clash'");
    expect(main).toContain("cues.play('breach')");
  });

  it('sounds a raid the same way it sounds your own attack', () => {
    // A blow that sounded different depending on who threw it would read as
    // two events rather than one seen from the other side. Both sites play a
    // breach on a broken wall and a clash otherwise.
    const breaches = [...main.matchAll(/cues\.play\('breach'\)/g)];
    expect(breaches.length, 'both the player attack and the raid').toBe(2);
  });

  it('⚠️ does not double up the founding sting with the founding film', () => {
    /*
     * `playOnce` fires a cinematic at most once per game. Without the guard
     * the first founding would play both at once and every later one would be
     * the silent one, which is exactly backwards.
     */
    expect(main).toContain("if (seenCinematics.has('first-city')) cues.play('settle')");
  });
});
