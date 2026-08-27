/**
 * The attract sequence: a title card, then the teaser, then the game.
 *
 * ⚠️ **The card exists because of the autoplay policy, not for decoration.**
 * A browser will not play sound until the user has interacted with the page,
 * and this runs before the setup screen, i.e. before any click at all. So the
 * teaser would be silent. One button solves it: the click that starts the film
 * is also the gesture that unlocks audio for the rest of the session, which is
 * the same gesture the anthem has always relied on from the Begin button.
 *
 * ⚠️ **No `controls` attribute, and skip is never a seek.** The Fabric host
 * does not support HTTP Range: `video.seekable` reports `[[0, 0]]`, and setting
 * `currentTime` fires a `seeked` event within a millisecond while leaving the
 * position at zero. No error is raised. A native scrub bar would therefore be
 * a control that silently restarts the film, and a "skip to the end" would do
 * the same. Skipping stops the element and resolves.
 *
 * Progressive playback itself is fine: measured on this host, a 21 MB file
 * reached `canplay` in 704 ms having buffered 2.7 s of 54.6 s.
 *
 * The film is gitignored, because it carries the Suno cue. A fresh clone has
 * no file, `mediaExists` says so, and the whole sequence is skipped rather
 * than showing a broken frame.
 */

import { mediaExists } from '../audio.js';
import { t } from '../i18n.js';

const TEASER_URL = 'teaser.mp4';

const STYLE = `
.fe-attract {
  position: fixed; inset: 0; z-index: 70;
  background: #05080d;
  display: flex; align-items: flex-start; justify-content: center;
  overflow: auto;
  font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; color: #e8eaf0;
}
.fe-attract[hidden] { display: none; }
.fe-attract-card {
  margin: auto; padding: 32px 36px; text-align: center;
  max-width: min(560px, 92vw);
}
.fe-attract-card h1 {
  font: 600 34px/1.1 Georgia, 'Times New Roman', serif;
  letter-spacing: 0.16em; text-transform: uppercase; margin: 0 0 14px;
}
.fe-attract-card p { color: #b9c7d6; margin: 0 0 26px; font-size: 15px; }
.fe-attract-enter {
  font: 600 15px/1 ui-sans-serif, system-ui, sans-serif;
  padding: 13px 34px; border-radius: 999px; cursor: pointer;
  background: #e8eaf0; color: #0b1017; border: 0;
}
.fe-attract-enter:hover { background: #fff; }
.fe-attract-skip {
  display: block; margin: 18px auto 0; background: none; border: 0;
  color: #7e8c9d; font-size: 12px; cursor: pointer; text-decoration: underline;
}
.fe-attract-skip:hover { color: #b9c7d6; }

/* Playback ---------------------------------------------------------- */
.fe-attract.playing { align-items: center; background: #000; }
.fe-attract video {
  width: 100%; height: 100%; object-fit: contain;
  position: absolute; inset: 0; cursor: pointer;
}
.fe-attract-stop {
  position: absolute; right: 18px; bottom: 16px; z-index: 2;
  font: 600 12px/1 ui-sans-serif, system-ui, sans-serif;
  padding: 9px 18px; border-radius: 999px; cursor: pointer;
  background: rgba(12,16,22,0.72); color: #e8eaf0;
  border: 1px solid rgba(255,255,255,0.22);
}
.fe-attract-stop:hover { background: rgba(20,26,34,0.9); }
`;

export interface Attract {
  /** Resolves once the player has finished or skipped the sequence. */
  run(): Promise<void>;
}

export function createAttract(): Attract {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);

  const root = document.createElement('div');
  root.className = 'fe-attract';
  root.hidden = true;
  document.body.append(root);

  async function run(): Promise<void> {
    // Nothing to show in a clone without the film.
    if (!(await mediaExists(TEASER_URL, 'video'))) return;

    await showCard();
    await playFilm();
    root.hidden = true;
    root.replaceChildren();
  }

  function showCard(): Promise<void> {
    return new Promise((resolve) => {
      const card = document.createElement('div');
      card.className = 'fe-attract-card';

      const title = document.createElement('h1');
      title.textContent = 'Fabric Empires';

      const line = document.createElement('p');
      line.textContent = t('Learn Fabric. Learn as a family.');

      const enter = document.createElement('button');
      enter.className = 'fe-attract-enter';
      enter.dataset.act = 'enter';
      enter.textContent = t('Enter');

      const skip = document.createElement('button');
      skip.className = 'fe-attract-skip';
      skip.dataset.act = 'skip-card';
      skip.textContent = t('Skip to setup');

      card.append(title, line, enter, skip);
      root.replaceChildren(card);
      root.hidden = false;

      let settled = false;
      const done = (playFilmNext: boolean): void => {
        if (settled) return;
        settled = true;
        window.removeEventListener('keydown', onKey, true);
        if (playFilmNext) resolve();
        else {
          // Straight to the game. Still resolves, but marks the film skipped.
          skipped = true;
          resolve();
        }
      };
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') { e.preventDefault(); done(false); }
        if (e.key === 'Enter') { e.preventDefault(); done(true); }
      };
      window.addEventListener('keydown', onKey, true);
      enter.addEventListener('click', () => done(true));
      skip.addEventListener('click', () => done(false));

      // preventScroll, per the rule the setup screen taught: focusing the last
      // control on a card taller than the screen scrolls past everything above.
      enter.focus({ preventScroll: true });
      root.scrollTop = 0;
    });
  }

  let skipped = false;

  function playFilm(): Promise<void> {
    if (skipped) return Promise.resolve();

    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.src = TEASER_URL;
      video.autoplay = true;
      video.playsInline = true;
      // ⚠️ Deliberately NOT `controls`. See the header: the scrub bar cannot
      // work on this host and would silently restart the film.
      video.preload = 'auto';

      const stop = document.createElement('button');
      stop.className = 'fe-attract-stop';
      stop.dataset.act = 'skip-film';
      stop.textContent = t('Skip');

      root.classList.add('playing');
      root.replaceChildren(video, stop);

      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        window.removeEventListener('keydown', onKey, true);
        // Stop the download as well as the picture; a skipped film should not
        // go on pulling 32 MB in the background.
        video.pause();
        video.removeAttribute('src');
        video.load();
        root.classList.remove('playing');
        resolve();
      };
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); finish(); }
      };

      window.addEventListener('keydown', onKey, true);
      stop.addEventListener('click', finish);
      video.addEventListener('click', finish);
      video.addEventListener('ended', finish);
      // A film that cannot play must not trap the player on a black screen.
      video.addEventListener('error', finish);

      void video.play().catch(() => {
        // Autoplay refused even after the gesture: show the game rather than
        // a frozen frame.
        finish();
      });

      stop.focus({ preventScroll: true });
    });
  }

  return { run };
}
