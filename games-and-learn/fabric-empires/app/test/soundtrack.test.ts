// @vitest-environment jsdom
/**
 * The background score.
 *
 * ⚠️ **The thing worth testing here is the silence, not the music.** The audio
 * files are not in the repository (see `soundtrack.ts`), so the state every
 * clone and every CI run is actually in is "no tracks found", and the whole
 * feature has to be *absent* in that state rather than broken. A mute button
 * that throws on a checkout with no audio would be a defect nobody working on
 * this machine would ever see, because this machine has the files.
 *
 * The second thing is the shuffle. A shuffle that is subtly wrong looks
 * exactly like a shuffle that is right, for months, so it is seeded here and
 * checked rather than eyeballed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DUCK,
  MOODS,
  MUSIC_VOLUME,
  SOUNDTRACK,
  createSoundtrack,
  nextRotation,
  shuffle,
  type Track,
} from '../src/soundtrack.js';

/**
 * A stand-in for `Audio`.
 *
 * ⚠️ jsdom's `HTMLMediaElement.play` throws "Not implemented" rather than
 * returning a promise, so the real element cannot be used and the code under
 * test would blow up on a call it handles perfectly well in a browser.
 */
class FakeAudio {
  static made: FakeAudio[] = [];
  static played: string[] = [];
  src = '';
  volume = 1;
  paused = true;
  preload = '';
  loop = false;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeAudio.made.push(this);
  }
  play(): Promise<void> {
    this.paused = false;
    FakeAudio.played.push(this.src);
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

const TRACKS: readonly Track[] = [
  { file: 'audio/one.mp3', title: 'One', mood: 'calm' },
  { file: 'audio/two.mp3', title: 'Two', mood: 'tense' },
  { file: 'audio/three.mp3', title: 'Three', mood: 'calm' },
];

/**
 * Answer probes the way the real static host does.
 *
 * ⚠️ A missing file is **200 with `text/html`**, not a 404. The Fabric host
 * serves the single-page app for any unknown path, so "did the request
 * succeed" cannot tell a present track from an absent one and the content type
 * is the whole test. Modelling this faithfully is the point: the previous mock
 * replied `{ ok: false }` for a missing file, which no deployment this game
 * has ever run on actually does, and it agreed with a probe that could not
 * work in production.
 */
const serve = (present: readonly string[]): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'content-type'
              ? present.includes(url)
                ? 'audio/mpeg'
                : 'text/html; charset=utf-8'
              : null,
        },
      } as unknown as Response),
    ),
  );
};

/** Let the probe's promise chain settle. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

beforeEach(() => {
  FakeAudio.made = [];
  FakeAudio.played = [];
  vi.stubGlobal('Audio', FakeAudio);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the shuffle', () => {
  it('gives back everything it was given, once each', () => {
    const order = shuffle([1, 2, 3, 4, 5], () => 0.42);
    expect([...order].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('is driven by the randomness handed in, so it can be pinned', () => {
    const fixed = (): number => 0.999;
    expect(shuffle(['a', 'b', 'c'], fixed)).toEqual(shuffle(['a', 'b', 'c'], fixed));
  });

  it('⚠️ never opens the next pass with the track that just ended', () => {
    // With three tracks a plain reshuffle repeats about a third of the time,
    // which reads as a bug rather than as chance. Every seed is checked.
    for (let seed = 0; seed < 200; seed += 1) {
      let n = seed;
      const random = (): number => {
        n = (n * 1103515245 + 12345) % 2147483648;
        return n / 2147483648;
      };
      expect(nextRotation(['a', 'b', 'c'], random, 'c')[0]).not.toBe('c');
    }
  });

  it('cannot avoid a repeat when there is only one track, and says so by not throwing', () => {
    expect(nextRotation(['a'], Math.random, 'a')).toEqual(['a']);
  });
});

describe('a checkout with no audio files', () => {
  it('⚠️ reports nothing available and stays silent instead of failing', async () => {
    serve([]);
    const music = createSoundtrack(TRACKS);
    await settle();

    expect(music.available).toBe(false);
    expect(() => music.start()).not.toThrow();
    expect(FakeAudio.played).toEqual([]);
    expect(music.nowPlaying).toBeUndefined();
  });

  it('survives a fetch that rejects outright, not just one that 404s', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    const music = createSoundtrack(TRACKS);
    await settle();
    expect(music.available).toBe(false);
  });
});

describe('playing', () => {
  it('plays only the files that are actually there', async () => {
    serve(['audio/two.mp3']);
    const music = createSoundtrack(TRACKS);
    await settle();

    expect(music.available).toBe(true);
    music.start();
    expect(FakeAudio.played).toEqual(['audio/two.mp3']);
    expect(music.nowPlaying).toBe('Two');
  });

  it('honours a start() that arrived before the probe had finished', async () => {
    serve(['audio/one.mp3']);
    const music = createSoundtrack(TRACKS);
    music.start(); // No tracks known yet.
    expect(FakeAudio.played).toEqual([]);

    await settle();
    expect(FakeAudio.played).toEqual(['audio/one.mp3']);
  });

  it('is idempotent, so the film and the first click cannot both start it', async () => {
    serve(['audio/one.mp3']);
    const music = createSoundtrack(TRACKS);
    await settle();

    music.start();
    music.start();
    music.start();
    expect(FakeAudio.played).toHaveLength(1);
  });

  it('leaves a gap and then moves on to the next track', async () => {
    serve(['audio/one.mp3', 'audio/two.mp3']);
    const music = createSoundtrack(TRACKS);
    await settle();
    vi.useFakeTimers();

    music.start();
    const first = FakeAudio.played[0];
    const element = FakeAudio.made[0]!;

    element.onended?.();
    expect(music.nowPlaying).toBeUndefined(); // Silence in between.
    expect(FakeAudio.played).toHaveLength(1);

    vi.advanceTimersByTime(8_000);
    expect(FakeAudio.played).toHaveLength(2);
    expect(FakeAudio.played[1]).not.toBe(first);
  });

  it('⚠️ drops one unreadable file rather than the whole score', async () => {
    serve(['audio/one.mp3', 'audio/two.mp3']);
    const music = createSoundtrack(TRACKS);
    await settle();
    vi.useFakeTimers();

    music.start();
    const broken = FakeAudio.played[0]!;
    FakeAudio.made[0]!.onerror?.();

    vi.advanceTimersByTime(8_000);
    expect(FakeAudio.played[1]).not.toBe(broken);
    // And the broken one is never reached again, however long it runs.
    // ⚠️ Sliced past the first play on purpose: the file *was* played once,
    // because being played is how the failure was discovered in the first
    // place. The claim is about everything after that.
    for (let i = 0; i < 5; i += 1) {
      FakeAudio.made[0]!.onended?.();
      vi.advanceTimersByTime(8_000);
    }
    expect(FakeAudio.played.slice(1)).not.toContain(broken);
  });
});

describe('the mute button', () => {
  it('stops the sound and forgets what was playing', async () => {
    serve(['audio/one.mp3']);
    const music = createSoundtrack(TRACKS);
    await settle();

    music.start();
    expect(FakeAudio.made[0]!.paused).toBe(false);

    music.setMuted(true);
    expect(music.muted).toBe(true);
    expect(FakeAudio.made[0]!.paused).toBe(true);
    expect(music.nowPlaying).toBeUndefined();
  });

  it('⚠️ pauses rather than turning the volume to zero', async () => {
    // A muted track at volume 0 is still being decoded and still counts
    // against a metered connection, for no sound at all.
    serve(['audio/one.mp3']);
    const music = createSoundtrack(TRACKS);
    await settle();
    music.start();
    music.setMuted(true);
    expect(FakeAudio.made[0]!.paused).toBe(true);
  });

  it('is remembered for next time', async () => {
    serve(['audio/one.mp3']);
    const first = createSoundtrack(TRACKS);
    await settle();
    first.setMuted(true);

    FakeAudio.played = [];
    const second = createSoundtrack(TRACKS);
    await settle();
    expect(second.muted).toBe(true);
    second.start();
    expect(FakeAudio.played).toEqual([]);
  });

  it('starts the score when it is used to turn sound back on', async () => {
    serve(['audio/one.mp3']);
    const music = createSoundtrack(TRACKS);
    await settle();
    music.setMuted(true);

    expect(music.toggle()).toBe(false);
    expect(FakeAudio.played).toEqual(['audio/one.mp3']);
  });

  it('tells whoever is drawing the button that something changed', async () => {
    serve(['audio/one.mp3']);
    const music = createSoundtrack(TRACKS);
    const seen = vi.fn();
    music.onChange(seen);
    await settle();

    seen.mockClear();
    music.setMuted(true);
    expect(seen).toHaveBeenCalled();
  });
});

describe('ducking under a cinematic', () => {
  /*
   * ⚠️ The reason this is tested rather than eyeballed: the volume ramp shares
   * one timer with the fade-in, because two timers would race. A cinematic
   * starting within a second and a half of a new track is not a rare case,
   * it is the founding of the first city, and with two timers the winner
   * would be whichever happened to tick last.
   */
  const runUp = async (): Promise<{ music: ReturnType<typeof createSoundtrack>; el: FakeAudio }> => {
    serve(['audio/one.mp3']);
    const music = createSoundtrack(TRACKS);
    await settle();
    vi.useFakeTimers();
    music.start();
    vi.advanceTimersByTime(2_000); // Let the fade-in finish.
    return { music, el: FakeAudio.made[0]! };
  };

  it('pulls the score down, and puts it back where it was', async () => {
    const { music, el } = await runUp();
    const full = el.volume;
    // ⚠️ Against the real constant, not a magic number. This used to read
    // `> 0.2`, which was the module's volume written down a second time, and
    // lowering the music broke a ducking test for no reason.
    expect(full).toBeCloseTo(MUSIC_VOLUME, 5);

    music.duck(true);
    vi.advanceTimersByTime(600);
    expect(el.volume).toBeLessThan(full * 0.5);

    music.duck(false);
    vi.advanceTimersByTime(1_500);
    expect(el.volume).toBeCloseTo(full, 2);
  });

  it('⚠️ leaves the bed audible rather than cutting it dead', () => {
    // Silence under a cue draws more attention to itself than the cue does.
    expect(DUCK).toBeGreaterThan(0.15);
    expect(DUCK).toBeLessThan(0.6);
  });

  it('starts a new track at the ducked level if a film is already running', async () => {
    const { music, el } = await runUp();
    music.duck(true);
    vi.advanceTimersByTime(600);
    const under = el.volume;

    el.onended?.();
    vi.advanceTimersByTime(10_000); // The gap, then the next track's fade-in.
    expect(el.volume).toBeCloseTo(under, 2);
  });

  it('is safe when nothing is playing, because a film can be skipped at any frame', async () => {
    serve([]);
    const music = createSoundtrack(TRACKS);
    await settle();
    expect(() => {
      music.duck(true);
      music.duck(false);
    }).not.toThrow();
  });

  it('ignores being asked for the state it is already in', async () => {
    const { music, el } = await runUp();
    music.duck(true);
    vi.advanceTimersByTime(600);
    const under = el.volume;
    music.duck(true);
    vi.advanceTimersByTime(600);
    expect(el.volume).toBeCloseTo(under, 5);
  });
});

describe('the score itself', () => {
  it('names a mood for every track, so state-reactive music stays possible', () => {
    for (const track of SOUNDTRACK) {
      expect(MOODS as readonly string[]).toContain(track.mood);
      expect(track.file.startsWith('audio/')).toBe(true);
      expect(track.title).not.toBe('');
    }
  });

  it('has no two tracks pointing at the same file', () => {
    const files = SOUNDTRACK.map((track) => track.file);
    expect(new Set(files).size).toBe(files.length);
  });
});
