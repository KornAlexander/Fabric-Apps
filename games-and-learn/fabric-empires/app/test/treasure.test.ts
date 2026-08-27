/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
  Buried caches, on the app side.

  The engine already guarantees the arithmetic: `engine/test/treasure.test.ts`
  covers where chests are placed, that a win pays the full amount, that a loss
  halves what is left, and that a nearly-empty one is removed rather than left
  as a chest worth four Data. None of that is repeated here.

  What is left is the wiring, and the wiring is where this feature can be
  quietly wrong: a chest that is never triggered, a film that strands the turn,
  or a failed dig that costs nothing and so turns the question into a formality
  you grind past. Those are the claims below.

  ⚠️ Sources are read via `process.cwd()`, not `import.meta.url`. This suite
  runs under jsdom, which rewrites `import.meta.url` to an `http:` URL, and
  `fileURLToPath` then throws "The URL must be of scheme file" before a single
  test collects. Vitest's cwd is the repository root.
*/

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

const main = read('app/src/main.ts');

/** The body of `digAlong`, which is the only place any of this happens. */
function digAlong(): string {
  const start = main.indexOf('async function digAlong(');
  expect(start).toBeGreaterThan(0);
  const next = main.indexOf('\nfunction grantResource(', start);
  expect(next).toBeGreaterThan(start);
  return main.slice(start, next);
}

describe('when a cache is dug up', () => {
  it('⚠️ only the Profiler digs, so exploring stays the scout unit\'s job', () => {
    expect(digAlong()).toContain("unit.typeId !== 'profiler'");
  });

  it('⚠️ searches the whole route, not just the tile the unit stopped on', () => {
    /*
     * The player is marching into fog and cannot see the chest, so a six-hex
     * order that happens to cross one has to count. Checking only the
     * destination would make the feature look broken exactly when it fired.
     */
    const body = digAlong();
    expect(body).toMatch(/for \(const step of route\)/);
    expect(body).toContain('treasureAt(state.treasures, step)');
    // First one wins: the unit still ends up where it was sent.
    expect(body).toContain('break;');
  });

  it('⚠️ waits for the walk, so the question is never asked about a tile the unit has not reached', () => {
    const call = main.slice(main.indexOf('void walk(unit.id, from, route'));
    expect(call.slice(0, 120)).toContain('.then(() => digAlong(unit.id, route))');
  });

  it('asks a real question through the provider, so the answer reaches the schedule', () => {
    const body = digAlong();
    expect(body).toContain('await provider.present(');
    expect(body).toContain("kind: 'treasure'");
  });

  it('⚠️ a failed dig costs the Profiler its remaining moves', () => {
    /*
     * Without this the halving is the only brake and the optimal play is to
     * stand on the chest and answer until one lands, which makes the question
     * decorative. The chest itself is never taken away: retrying stays
     * possible, it just costs a turn of tempo.
     */
    const body = digAlong();
    expect(body).toContain('claim.gained === 0');
    expect(body).toContain('movesLeft: 0');
  });

  it('does not run while a question is already open', () => {
    expect(digAlong()).toContain('if (finished || modal.isOpen()) return;');
  });
});

describe('where a chest shows on the map', () => {
  it('⚠️ is gated on explored, not on current sight', () => {
    /*
     * A cache found three turns ago is still there and the player still knows
     * it. Gating on what is lit now would make chests blink out the moment the
     * Profiler walked on, which reads as somebody else having taken them.
     */
    const view = main.slice(main.indexOf('treasures: [...state.treasures.values()]'));
    expect(view.slice(0, 200)).toContain('memoryOf(state, mySeat).explored.has(hexKey(chest.hex))');
  });

  it('is drawn at a fixed pixel size, so it survives the zoom people plan at', () => {
    const scene = read('app/src/three/scene3d.ts');
    expect(scene).toContain('addSprite(hex, chestSprite(), CHEST_PIXELS');
    // `addSprite` is the screen-space helper; a patch or a ring alone would
    // shrink to nothing at map zoom, which is the settle-marker defect again.
    expect(scene).toMatch(/const CHEST_PIXELS = \d+;/);
  });

  it('⚠️ is drawn after the settle rings, so gold wins where they overlap', () => {
    const scene = read('app/src/three/scene3d.ts');
    expect(scene.indexOf('view.treasures')).toBeGreaterThan(scene.indexOf('view.settleSites'));
  });
});

describe('the two films', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    vi.resetModules();
  });

  async function film(exists: boolean) {
    vi.doMock('../src/audio.js', () => ({ mediaExists: vi.fn(async () => exists) }));
    const { createTreasureFilm } = await import('../src/ui/treasureFilm.js');
    return createTreasureFilm();
  }

  /**
   * ⚠️ `play()` probes for the file before it attaches any listener, so an
   * event dispatched in the same tick lands on nothing and the test hangs for
   * the full timeout rather than failing usefully.
   */
  async function onScreen(f: { isPlaying(): boolean }): Promise<void> {
    for (let i = 0; i < 50 && !f.isPlaying(); i += 1) await Promise.resolve();
    expect(f.isPlaying()).toBe(true);
  }

  it('⚠️ resolves rather than hanging when the clip is not in the clone', async () => {
    /*
     * The clips are ignored by git for size, so this is the state of every
     * fresh clone, not an edge case. If `play` did not resolve here the chest
     * would never be settled and the turn would be stuck behind a file that
     * was never going to arrive.
     */
    const f = await film(false);
    await expect(f.play('found')).resolves.toBeUndefined();
    expect(f.isPlaying()).toBe(false);
  });

  it('⚠️ resolves when the clip fails to decode', async () => {
    const f = await film(true);
    const video = document.querySelector('video')!;
    // jsdom has no media stack, so `play()` rejects; the player must treat
    // that as "the beat is over" rather than propagating it into the turn.
    const done = f.play('found');
    await onScreen(f);
    video.dispatchEvent(new Event('error'));
    await expect(done).resolves.toBeUndefined();
    expect(f.isPlaying()).toBe(false);
  });

  it('is muted, because the game score is already playing underneath', async () => {
    await film(true);
    expect(document.querySelector('video')!.muted).toBe(true);
  });

  it('⚠️ never seeks to skip, because this host does not serve HTTP Range', () => {
    const source = read('app/src/ui/treasureFilm.ts');
    // Setting `currentTime` here fires `seeked` within a millisecond and
    // leaves the position at zero, silently: a skip would restart the clip.
    expect(source).not.toMatch(/currentTime\s*=/);
  });

  it('hides itself again afterwards, so the board is not left behind a black panel', async () => {
    const f = await film(true);
    const root = document.querySelector<HTMLElement>('.fe-chest')!;
    const video = document.querySelector('video')!;
    const done = f.play('found');
    await onScreen(f);
    expect(root.hidden).toBe(false);
    video.dispatchEvent(new Event('ended'));
    await done;
    expect(root.hidden).toBe(true);
  });
});
