/**
 * The two short films a buried cache gets: finding it, and opening it.
 *
 * ⚠️ **A separate player from `attract.ts`, and deliberately not a shared one.**
 * The attract sequence is a title card that owns the whole screen before a game
 * exists, waits for a click to unlock audio, and never returns. These play
 * mid-turn, over a live board, several times a game. Folding both into one
 * component would mean a component with a mode flag, and the two halves have
 * almost nothing in common except that a video element is involved.
 *
 * ⚠️ **Silent, and silent twice over.** The clips ship with their audio track
 * stripped, and the element is `muted` as well. Sora returns an ambient music
 * bed with every clip, and these run while the game's own score is playing:
 * two pieces of music at once is not atmosphere, it is a bug that sounds like
 * a bug. Stripping the track is what actually guarantees it; the attribute is
 * there so a replaced clip cannot reintroduce the problem quietly.
 *
 * ⚠️ **Skip is never a seek.** The Fabric host does not serve HTTP Range:
 * `video.seekable` reports `[[0, 0]]`, and setting `currentTime` fires `seeked`
 * within a millisecond while leaving the position at zero, silently. So the
 * skip stops the element and resolves rather than jumping to the end.
 *
 * ⚠️ **Ignored by git for SIZE, not licence** — the same footing as the score,
 * and unlike the teaser, which is kept out because it carries the Suno cue.
 * These were generated with Azure OpenAI, whose output we own, so they could
 * legally be committed; D59 says a clone of this repository stays a few
 * megabytes, and 4.9 MB of video for one optional flourish is not the place to
 * start making exceptions. A fresh clone therefore has neither file,
 * `mediaExists` says so, and both beats become no-ops. The chest still opens
 * and still pays out; it simply does it without a film.
 *
 * The scenes are AI-generated and NOTICE.md says so. Nothing in either clip is
 * a real place or a real object.
 */

import { mediaExists } from '../audio.js';
import { t } from '../i18n.js';

export type TreasureBeat = 'found' | 'opened';

const URLS: Readonly<Record<TreasureBeat, string>> = {
  found: 'treasure-found.mp4',
  opened: 'treasure-opened.mp4',
};

const STYLE = `
.fe-chest {
  position: fixed; inset: 0; z-index: 65;
  background: #000;
  display: flex; align-items: center; justify-content: center;
}
.fe-chest[hidden] { display: none; }
.fe-chest video {
  width: 100%; height: 100%; object-fit: contain;
  position: absolute; inset: 0; cursor: pointer;
}
.fe-chest-stop {
  position: absolute; right: 18px; bottom: 16px; z-index: 2;
  font: 600 12px/1 ui-sans-serif, system-ui, sans-serif;
  padding: 9px 18px; border-radius: 999px; cursor: pointer;
  background: rgba(10, 14, 20, 0.72); color: #cfd8e3;
  border: 1px solid rgba(207, 216, 227, 0.35);
}
.fe-chest-stop:hover { background: rgba(10, 14, 20, 0.9); color: #fff; }
`;

export interface TreasureFilm {
  /** Play a beat. Resolves when it ends, is skipped, or is missing. */
  play(beat: TreasureBeat): Promise<void>;
  /** True while a clip is on screen, so the map can ignore input. */
  isPlaying(): boolean;
}

export function createTreasureFilm(): TreasureFilm {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);

  const root = document.createElement('div');
  root.className = 'fe-chest';
  root.hidden = true;
  root.dataset.testid = 'treasure-film';

  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.preload = 'auto';

  const stop = document.createElement('button');
  stop.className = 'fe-chest-stop';
  stop.dataset.act = 'skip-film';

  root.append(video, stop);
  document.body.append(root);

  /*
   * Asked once per beat and remembered. `mediaExists` is a network round trip,
   * and a chest can be opened many times in a game: re-probing every time
   * would put a request in front of a four second clip.
   */
  const known = new Map<TreasureBeat, boolean>();
  let playing = false;

  async function available(beat: TreasureBeat): Promise<boolean> {
    const cached = known.get(beat);
    if (cached !== undefined) return cached;
    const exists = await mediaExists(URLS[beat], 'video');
    known.set(beat, exists);
    return exists;
  }

  return {
    isPlaying: () => playing,

    async play(beat) {
      if (playing) return;
      if (!(await available(beat))) return;

      playing = true;
      stop.textContent = t('Skip');
      video.src = URLS[beat];
      root.hidden = false;

      await new Promise<void>((resolve) => {
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          video.removeEventListener('ended', finish);
          video.removeEventListener('error', finish);
          window.removeEventListener('keydown', onKey, true);
          stop.removeEventListener('click', finish);
          video.removeEventListener('click', finish);
          video.pause();
          // Dropping the source frees the buffer; `load()` makes the element
          // forget the old one rather than showing its last frame next time.
          video.removeAttribute('src');
          video.load();
          root.hidden = true;
          playing = false;
          resolve();
        };

        function onKey(event: KeyboardEvent): void {
          if (event.key !== 'Escape' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          finish();
        }

        video.addEventListener('ended', finish);
        // ⚠️ An error resolves rather than rejecting. A clip that fails to
        // decode must not strand the turn: the chest still has to be settled.
        video.addEventListener('error', finish);
        video.addEventListener('click', finish);
        stop.addEventListener('click', finish);
        window.addEventListener('keydown', onKey, true);

        /*
         * ⚠️ `play()` does not always return a promise.
         *
         * It is specified to, and every current browser does, but the older
         * signature returned `undefined` and jsdom still does. Calling
         * `.catch` on that throws a TypeError out of `play()` synchronously,
         * which is worse than the rejection it was meant to handle: the beat
         * never resolves and the turn hangs behind a chest. Wrapping makes
         * both shapes a promise.
         */
        void Promise.resolve(video.play()).catch(finish);
      });
    },
  };
}
