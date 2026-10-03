// @vitest-environment jsdom
/**
 * Blending: how one piece of music hands over to the next.
 *
 * The game plays three pieces of sound in sequence, and every join between
 * them was a hard cut or a hole:
 *
 *   - the **teaser** carries its own cue, and skipping it stopped the audio
 *     dead in the middle of a bar, straight into the silence of the settings;
 *   - the **anthem** arrived at full level on its first sample, because
 *     `start()` set the volume and called `play()`;
 *   - the **score** then waited a flat 2,400 ms, which is the anthem's fade
 *     plus 800 ms of dead air, so a player heard music stop and, separately,
 *     music start.
 *
 * ⚠️ **None of this can be judged by a test; only measured by one.** Whether
 * the result sounds like one continuous piece is a question for ears. What is
 * pinned here is that each join is a ramp rather than a cut, and that the
 * numbers are related to each other rather than picked independently and left
 * to drift.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ANTHEM_FADE_IN_MS, ANTHEM_FADE_OUT_MS, createAnthem } from '../src/audio.js';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');
const main = read('app/src/main.ts');
const attract = read('app/src/ui/attract.ts');

/** jsdom's media element throws on `play`, so the anthem needs a stand-in. */
class FakeAudio {
  static made: FakeAudio[] = [];
  src = '';
  volume = 1;
  paused = true;
  preload = '';
  loop = false;
  currentTime = 0;
  constructor(src?: string) {
    if (src) this.src = src;
    FakeAudio.made.push(this);
  }
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

/** The probe: a present file answers with an audio content type. */
const servePresent = (): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        headers: { get: () => 'audio/mpeg' },
      } as unknown as Response),
    ),
  );
};

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

beforeEach(() => {
  FakeAudio.made = [];
  servePresent();
  vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the anthem rises rather than punching in', () => {
  it('⚠️ starts at silence, not at full level', async () => {
    /*
     * The failure this replaces: the anthem's first sample was its loudest,
     * arriving out of the silence of the setup screen. That reads as a speaker
     * being switched on rather than as music beginning.
     */
    const anthem = createAnthem(0.55);
    await settle();
    vi.useFakeTimers();

    anthem.start();
    const el = FakeAudio.made[0]!;
    expect(el.paused, 'it should be playing while it rises').toBe(false);
    expect(el.volume, 'the first sample must not be the loudest').toBeLessThan(0.05);
  });

  it('reaches full level by the end of the fade, and not before', async () => {
    const anthem = createAnthem(0.55);
    await settle();
    vi.useFakeTimers();
    anthem.start();
    const el = FakeAudio.made[0]!;

    vi.advanceTimersByTime(ANTHEM_FADE_IN_MS / 2);
    const half = el.volume;
    expect(half).toBeGreaterThan(0);
    expect(half, 'still climbing at the halfway point').toBeLessThan(0.55);

    vi.advanceTimersByTime(ANTHEM_FADE_IN_MS);
    expect(el.volume).toBeCloseTo(0.55, 2);
  });

  it('⚠️ still honours a zero fade, which is what a timing test wants', async () => {
    // The intro's card timing is measured against the anthem's clock, and a
    // measurement should not have to wait out a musical nicety.
    const anthem = createAnthem(0.55);
    await settle();
    anthem.start(0);
    expect(FakeAudio.made[0]!.volume).toBeCloseTo(0.55, 5);
  });

  it('leaves faster than it arrives, because leaving is a handover', async () => {
    // Music that goes faster than it came sounds interrupted rather than
    // finished.
    expect(ANTHEM_FADE_OUT_MS).toBeGreaterThan(ANTHEM_FADE_IN_MS);
  });

  it('⚠️ a fade out during the fade in does not fight it', async () => {
    /*
     * Both ramps run on the same interval handle, so starting one has to stop
     * the other. Two intervals on one volume would race, and the loser would
     * keep pushing it back the other way for ever.
     */
    const anthem = createAnthem(0.55);
    await settle();
    vi.useFakeTimers();
    anthem.start();
    vi.advanceTimersByTime(200);
    anthem.fade(400);
    vi.advanceTimersByTime(2_000);

    const el = FakeAudio.made[0]!;
    expect(el.volume).toBeCloseTo(0, 2);
    expect(el.paused, 'and it actually stops at the end').toBe(true);
  });
});

describe('the handover to the score', () => {
  it('⚠️ waits for the anthem to finish, expressed as the fade itself', () => {
    /*
     * The delay used to be a flat 2,400 ms, which is the fade length plus dead
     * air, written as one number that had no visible relationship to the fade.
     * Changing the fade would silently have left the score overlapping or the
     * gap growing.
     */
    expect(main).toContain('ANTHEM_FADE_OUT_MS + HANDOVER_BREATH_MS');
  });

  it('leaves a breath, but a short one', () => {
    const match = /const HANDOVER_BREATH_MS = (\d+)/.exec(main);
    expect(match, 'the breath is a named constant').not.toBeNull();
    const breath = Number(match?.[1]);
    // Not zero: two recordings in different keys must not overlap. Not long:
    // 800 ms was long enough to hear as music stopping and later starting.
    expect(breath).toBeGreaterThan(0);
    expect(breath).toBeLessThan(500);
  });
});

describe('the teaser does not stop dead', () => {
  it('⚠️ fades its sound instead of pausing on the spot', () => {
    const finish = attract.slice(attract.indexOf('const finish = (): void => {'));
    expect(finish.slice(0, 1200)).toContain('fadeOutAudio(video');
  });

  it('⚠️ drops the picture immediately even though the sound is held', () => {
    /*
     * A frozen frame lingering behind the settings screen for half a second
     * would look like the app had hung. Only the audio is allowed to outlive
     * the dismissal.
     */
    const finish = attract.slice(attract.indexOf('const finish = (): void => {'));
    const body = finish.slice(0, 1200);
    expect(body.indexOf("root.classList.remove('playing')")).toBeLessThan(
      body.indexOf('fadeOutAudio(video'),
    );
  });

  it('still frees the file, so a skipped film stops downloading', () => {
    // 32 MB that a player has said they do not want to watch.
    const finish = attract.slice(attract.indexOf('const finish = (): void => {'));
    expect(finish.slice(0, 1200)).toContain('video.removeAttribute');
  });

  it('is short enough not to play under the settings screen', () => {
    const match = /const TEASER_FADE_MS = (\d+)/.exec(attract);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeLessThanOrEqual(800);
  });
});
