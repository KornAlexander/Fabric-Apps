import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
  Overlay focus behaviour.

  This is a regression guard for a bug that bit twice in one session, in two
  unrelated files, for the same reason.

  A full-screen overlay whose card is taller than the screen has to scroll.
  The moment it scrolls, a plain `element.focus()` becomes a scroll command:
  the browser brings the focused element into view, and in every one of these
  dialogs the thing we focus for keyboard users is the button at the BOTTOM.
  So the dialog opens showing its own last line.

  Measured on the deployed build before the fix:
    - setup screen at 900x700 opened at scrollTop 1086 of 1786, hiding the
      title, the blurb and the whole "if you only have five minutes" box;
    - an answered question at 390x700 is 811px tall in a 700px viewport, and
      focusing Continue put the modal top at -127, so the player was shown the
      bottom of the explanation at the exact moment they should have been
      reading the verdict.

  The fix is always the same shape: focus({ preventScroll: true }), then put
  the scroll position back where the reader should start. This test only
  checks the first half, because that is the half that is mechanical.
*/

const UI_DIR = join(__dirname, '..', 'src', 'ui');

/** Every .ts file under app/src/ui, which is where the overlays live. */
function uiSourceFiles(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(UI_DIR)) {
    const path = join(UI_DIR, entry);
    if (statSync(path).isDirectory()) continue;
    if (entry.endsWith('.ts')) out.push(path);
  }
  return out;
}

describe('overlay focus', () => {
  it('has ui source files to check', () => {
    // Guards against the scan silently covering nothing, which is how the
    // i18n test managed to miss an entire untranslated module.
    expect(uiSourceFiles().length).toBeGreaterThan(4);
  });

  it('⚠️ never calls focus() on a DOM element without preventScroll', () => {
    const offenders: string[] = [];

    for (const path of uiSourceFiles()) {
      const lines = readFileSync(path, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        // `scene.focus(hex)` is a camera move, not DOM focus. It only exists
        // in main.ts, but exclude it by shape rather than by filename so the
        // rule survives the code being moved.
        if (/\bscene\.focus\(/.test(line)) return;
        if (!/\.focus\(/.test(line)) return;
        if (/preventScroll/.test(line)) return;
        offenders.push(`${path.split(/[\\/]/).pop()}:${i + 1}  ${line.trim()}`);
      });
    }

    expect(offenders, [
      'These focus() calls can scroll their overlay to the bottom on a short',
      'screen. Use focus({ preventScroll: true }) and set scrollTop yourself.',
      '',
      ...offenders,
    ].join('\n')).toEqual([]);
  });

  it('⚠️ never gives a video element controls, and never seeks one', () => {
    /*
      Two rules, one cause: the Fabric static host does not support HTTP Range.

      Measured on the deployed build with a 21 MB faststart mp4:
      `video.seekable` is `[[0, 0]]`, and `video.currentTime = 45` fires a
      `seeked` event within 1 ms while leaving the position at 0. No error is
      raised and `video.error` stays null.

      So a native scrub bar is a control that silently restarts the film, and
      a "skip to the end" implemented as a seek does the same. Skipping must
      stop the element instead.

      Progressive playback is fine and is not what this guards: `canplay`
      arrived in 704 ms with 2.7 s of 54.6 s buffered.
    */
    const offenders: string[] = [];

    for (const path of uiSourceFiles()) {
      const lines = readFileSync(path, 'utf8').split(/\r?\n/);
      const name = path.split(/[\\/]/).pop();
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;   // commentary may discuss it
        if (/\.controls\s*=|['"]controls['"]/.test(line)) {
          offenders.push(`${name}:${i + 1}  sets controls  ${line.trim()}`);
        }
        if (/\.currentTime\s*=/.test(line)) {
          offenders.push(`${name}:${i + 1}  seeks  ${line.trim()}`);
        }
      });
    }

    expect(offenders, [
      'This host ignores Range, so seeking silently resets playback to 0 and a',
      'native scrub bar cannot work. Stop the element instead of seeking it.',
      '',
      ...offenders,
    ].join('\n')).toEqual([]);
  });

  it('⚠️ keeps every scrolling overlay anchored to the top, not centred', () => {
    /*
      The companion half of the same bug.

      `align-items: center` on a container that scrolls does not centre a
      child taller than the container: it clips it at the TOP, and the
      clipped part cannot be scrolled to at all, because the overflow is
      above the scroll origin. The card is simply unreachable.

      So any overlay that sets overflow must anchor with flex-start.
    */
    const offenders: string[] = [];

    for (const path of uiSourceFiles()) {
      const text = readFileSync(path, 'utf8');
      // Look at CSS rule bodies, which in this codebase are template literals.
      for (const block of text.split('}')) {
        if (!/position:\s*fixed/.test(block)) continue;
        if (!/overflow:\s*auto/.test(block)) continue;
        if (/align-items:\s*center/.test(block)) {
          const name = path.split(/[\\/]/).pop();
          const selector = block.trim().split(/\s|\{/)[0];
          offenders.push(`${name}  ${selector}`);
        }
      }
    }

    expect(offenders, [
      'A scrolling overlay centred with align-items: center clips its card at',
      'the top, where it cannot be scrolled to. Use align-items: flex-start',
      'and margin: auto on the card instead.',
      '',
      ...offenders,
    ].join('\n')).toEqual([]);
  });
});
