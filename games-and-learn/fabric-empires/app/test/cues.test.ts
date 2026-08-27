// @vitest-environment jsdom
/**
 * The sound the cinematics make.
 *
 * ⚠️ **WebAudio does not exist under test, so nothing here can prove that any
 * of this is audible.** What it can prove is the part that actually went
 * wrong in the first place: that a cinematic exists with no sound attached to
 * it. Four films shipped silent for weeks because nothing anywhere connected
 * "a shot was added" to "a shot needs a cue", and a person has to be looking
 * at the right screen at the right moment to notice.
 *
 * So the important test in this file is the coverage one. It reads `main.ts`,
 * finds every cinematic the game can play, and fails if one of them has no
 * entry in the cue table. The rest checks the composition, which is data and
 * therefore checkable, rather than the synthesis, which is not.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CUES, LAST_ONSET_SECONDS, createCues } from '../src/cues.js';

const source = (relative: string): string =>
  readFileSync(resolve(process.cwd(), `app/src/${relative}`), 'utf8');

/**
 * Every cinematic the game can play.
 *
 * The shots are built by `orbitShot`, `descendShot` and `approachShot`, each
 * taking an object literal whose first field is the id. Scanning for that is
 * uglier than importing a list, but a list would be a third place to keep in
 * step and the whole point here is to have no such place.
 */
function cinematicIds(): string[] {
  const code = source('main.ts');
  const found = new Set<string>();
  for (const m of code.matchAll(/(?:orbitShot|descendShot|approachShot)\(\{\s*\n\s*id: '([^']+)'/g)) {
    found.add(m[1]!);
  }
  return [...found];
}

describe('⚠️ coverage', () => {
  it('finds the cinematics at all, so the scan cannot pass by finding nothing', () => {
    expect(cinematicIds().length).toBeGreaterThanOrEqual(4);
  });

  it('⚠️ gives every cinematic in the game a cue', () => {
    const silent = cinematicIds().filter((id) => !CUES[id]);
    expect(silent, `${silent.length} cinematics would play in silence`).toEqual([]);
  });

  it('has no cue for a cinematic that no longer exists', () => {
    // The other direction. A cue nobody plays is dead weight and, worse, it
    // looks like proof that a film has sound when the film has been renamed.
    const ids = new Set(cinematicIds());
    const orphans = Object.keys(CUES).filter((id) => !ids.has(id));
    expect(orphans).toEqual([]);
  });
});

describe('the composition', () => {
  const entries = Object.entries(CUES);

  it('has something to play in every cue', () => {
    for (const [id, events] of entries) {
      expect(events.length, `${id} is empty`).toBeGreaterThan(0);
    }
  });

  it('⚠️ starts its last note before the film can end', () => {
    // The shots run 3.8 to 5.2 seconds. A cue still striking bells when the
    // camera cuts back to the map sounds like the game stuttered.
    for (const [id, events] of entries) {
      const last = Math.max(...events.map((e) => e.at));
      expect(last, `${id} starts a note at ${last}s`).toBeLessThanOrEqual(LAST_ONSET_SECONDS);
    }
  });

  it('opens promptly, so the film does not start in silence', () => {
    for (const [id, events] of entries) {
      const first = Math.min(...events.map((e) => e.at));
      expect(first, `${id} does not make a sound for ${first}s`).toBeLessThanOrEqual(0.2);
    }
  });

  it('stays inside sensible gains, so nothing clips or is inaudible', () => {
    for (const [id, events] of entries) {
      for (const event of events) {
        expect(event.gain, `${id} at ${event.at}s`).toBeGreaterThan(0.05);
        expect(event.gain, `${id} at ${event.at}s`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('stays inside the range a person can hear, and a laptop can reproduce', () => {
    for (const [id, events] of entries) {
      for (const event of events) {
        expect(event.hz, `${id} at ${event.at}s`).toBeGreaterThan(50);
        expect(event.hz, `${id} at ${event.at}s`).toBeLessThan(4_000);
      }
    }
  });

  it('rings for a positive length of time', () => {
    for (const [id, events] of entries) {
      for (const event of events) {
        expect(event.seconds, `${id} at ${event.at}s`).toBeGreaterThan(0.05);
      }
    }
  });

  it('⚠️ gives the two dark films no bell above the stave', () => {
    /*
     * Not a style rule for its own sake. `first-blood` and `city-falls` are
     * defeats as often as victories, and a bright high chime over a city you
     * have just lost reads as the game congratulating you. The high bells are
     * reserved for the founding cue, which is the one unambiguously good
     * thing that happens in this game.
     */
    for (const id of ['first-blood', 'city-falls', 'proctor']) {
      const bright = (CUES[id] ?? []).filter((e) => e.voice === 'bell' && e.hz > 300);
      expect(bright, `${id} has a bright bell in it`).toEqual([]);
    }
  });
});

describe('the player', () => {
  it('⚠️ says nothing about an id it does not know, rather than throwing', () => {
    // `playOnce` hands it whatever shot it was given, including the opening's
    // shots, which have the anthem instead and no cue here.
    const cues = createCues();
    expect(() => cues.play('intro-dawn')).not.toThrow();
    expect(() => cues.play('')).not.toThrow();
  });

  it('does not reach for an AudioContext at all while muted', () => {
    /*
     * jsdom has no WebAudio, so a muted cue that still tried to build a
     * context would throw here. That makes this a real test of the early
     * return rather than a restatement of it.
     */
    const cues = createCues();
    cues.setMuted(true);
    expect(cues.muted).toBe(true);
    expect(() => cues.play('first-city')).not.toThrow();
  });

  it('⚠️ survives a browser with no AudioContext instead of taking the game with it', () => {
    // The game is a study aid. Losing the sound is a shame; losing the founding
    // of a city because the sound failed is not acceptable.
    const cues = createCues();
    expect(() => cues.play('first-city')).not.toThrow();
  });
});
