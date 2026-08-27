/**
 * Records the opening title sequence to a video file.
 *
 * ⚠️ **This exists because the last intro video was made by hand, and drifted.**
 *
 * `media/fabric-empires-intro.mp4` was 31.18 s long and carried a baked-in AAC
 * copy of the *free-tier* anthem. When the anthem was re-generated on the Pro
 * plan the recording became wrong twice over: mistimed, because the new take
 * runs roughly 1.6x slower through the same words, and unlicensed, because the
 * free-tier terms do not grant commercial use and Pro ownership is not
 * retroactive. Neither fault was visible in the file. It played perfectly.
 *
 * That is the same failure this codebase keeps meeting: a fact kept in two
 * places, where the copy looks checked because it looks finished. A hand-made
 * recording of a generated film IS a second copy of the film. So the answer is
 * not to record it again more carefully, it is to make the recording
 * derivable.
 *
 * Two properties make that true, and both are structural rather than
 * disciplinary:
 *
 *   1. ⚠️ **No timing constants live here.** Not one. The film is driven by
 *      the anthem's own playback clock, so this script watches the running
 *      game and takes its cues from it: it starts when the sequence starts and
 *      stops when the sequence stops. `ANTHEM_MARKS` can be re-measured, beats
 *      can be added or dropped, and this script does not need to be told.
 *
 *   2. ⚠️ **The audio is the shipped file, not a re-recording.** Playwright
 *      captures video only, with no audio track at all, which sounds like a
 *      limitation and is actually the feature: the soundtrack can only get
 *      into the video by being muxed in from `app/public/audio/anthem.mp3`.
 *      That is the Pro-owned file the game itself serves. There is no path by
 *      which a stale or differently-licensed take reaches the deliverable.
 *
 * Usage:
 *
 *     npm run build
 *     npm run serve:standalone          # http://localhost:4173
 *     npm run record:intro
 *
 * Requires ffmpeg and ffprobe on PATH.
 */

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

const url = process.argv[2] ?? 'http://localhost:4173/';
const WIDTH = 1600;
const HEIGHT = 900;

/** The anthem exactly as the game serves it. See the header: this is the point. */
const ANTHEM = join(REPO, 'app', 'public', 'audio', 'anthem.mp3');
const RAW_DIR = join(REPO, 'media', '.raw-intro');
const OUT = join(REPO, 'media', 'fabric-empires-intro.mp4');
const OUT_720 = join(REPO, 'media', 'fabric-empires-intro-720.mp4');

/**
 * How long the sync flash is held, in milliseconds.
 *
 * Long enough to be certain of catching whole frames at any capture rate,
 * short enough that cutting it out costs an unnoticeable sliver of the first
 * approach shot. See `findFlash` for what it is for.
 */
const FLASH_MS = 140;

function ff(bin, args) {
  return execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function seconds(file) {
  const out = ff('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ]);
  return Number.parseFloat(out.trim());
}

/**
 * Finds the sync flash in the raw capture, and returns the video time at which
 * it ENDS.
 *
 * ⚠️ **Why a flash at all, rather than trusting the clock.**
 *
 * The film and the song are the same performance, so the video is only correct
 * if the muxed audio starts at the exact frame the film did. Wall-clock
 * arithmetic cannot supply that: the capture does not begin at the instant the
 * context is created, encoder start-up is not free, and the error is variable.
 * An error of a second here puts every card ahead of the line it names, which
 * is precisely the bug this film has already shipped with once.
 *
 * So the page paints the whole screen white the moment the anthem's clock
 * first moves, and reports what the anthem's clock said at that instant. The
 * flash is a timestamp written in the only ink the recorder can read. Finding
 * the brightest frames converts it back into video time, and the two clocks
 * are then pinned to each other on a known frame rather than an assumed one.
 */
function findFlash(raw) {
  const log = ff('ffmpeg', [
    '-v', 'error', '-i', raw,
    '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
    '-f', 'null', '-',
  ]);

  const times = [];
  let pending = null;
  for (const line of log.split(/\r?\n/)) {
    const t = /pts_time:([0-9.]+)/.exec(line);
    if (t) { pending = Number.parseFloat(t[1]); continue; }
    const y = /YAVG=([0-9.]+)/.exec(line);
    if (y && pending !== null) {
      times.push({ t: pending, y: Number.parseFloat(y[1]) });
      pending = null;
    }
  }
  if (!times.length) throw new Error('no frame statistics; is this a video?');

  // A white frame sits near 235+. A lit game frame in this scene is well under
  // 100. The gap is wide enough that the threshold does not need tuning.
  const lit = times.filter((f) => f.y > 150);
  if (!lit.length) {
    const brightest = times.reduce((a, b) => (b.y > a.y ? b : a));
    throw new Error(
      `no sync flash found (brightest frame YAVG=${brightest.y.toFixed(1)} at ${brightest.t}s). ` +
      'The recording probably started after the flash, or the page never ran it.',
    );
  }
  return { start: lit[0].t, end: lit[lit.length - 1].t, frames: lit.length };
}

async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel, headless: false });
    } catch { /* try the next one */ }
  }
  return chromium.launch({ headless: false });
}

rmSync(RAW_DIR, { recursive: true, force: true });
mkdirSync(RAW_DIR, { recursive: true });

const browser = await launch();
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  // ⚠️ An English film. The game gives a German browser a German game without
  // asking (i18n `load()`), and this machine is German, so without the locale
  // the deliverable silently comes out in the wrong language for its audience.
  // The Latin titles are unaffected, being the anthem's own words.
  locale: 'en-US',
  recordVideo: { dir: RAW_DIR, size: { width: WIDTH, height: HEIGHT } },
});

await context.addInitScript(({ flashMs }) => {
  Object.defineProperty(window, '__recFlash', {
    value: () => {
      const el = document.createElement('div');
      el.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;background:#fff;pointer-events:none';
      document.body.append(el);
      setTimeout(() => el.remove(), flashMs);
    },
  });
}, { flashMs: FLASH_MS });

const page = await context.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));

console.log(`opening ${url}`);
await page.goto(url, { waitUntil: 'domcontentloaded' });

// The setup screen is the gate. Clicking its button is also the user gesture
// the browser requires before any audio will play, which is why the film can
// only ever start from here.
await page.waitForSelector('.fe-setup-card button', { timeout: 30_000 });
await page.waitForFunction(() => typeof window.__fabricEmpires?.anthemTime === 'function');
const startButton = page.locator('.fe-setup-card button').last();
console.log(`starting: "${(await startButton.textContent())?.trim()}"`);
await startButton.click();

// Wait for the anthem's clock to move, then mark the frame. Both halves happen
// inside the page so that no round trip sits between the observation and the
// flash it is timestamping.
console.log('waiting for the anthem to start...');
const anthemAtFlash = await page.evaluate(async () => {
  const h = window.__fabricEmpires;
  const deadline = performance.now() + 90_000;
  while (performance.now() < deadline) {
    const at = h.anthemTime();
    if (at > 0) {
      window.__recFlash();
      return at;
    }
    await new Promise((r) => setTimeout(r, 4));
  }
  throw new Error('the anthem never started');
});
console.log(`flash at anthem t=${anthemAtFlash.toFixed(3)}s`);

// The film is over when the letterbox closes. Nothing here knows how long that
// should take, and that is the design.
await page.waitForSelector('.fe-cine[data-open="true"]', { timeout: 30_000 });
console.log('sequence running...');
await page.waitForSelector('.fe-cine[data-open="true"]', { state: 'detached', timeout: 180_000 })
  .catch(async () => {
    await page.waitForFunction(
      () => document.querySelector('.fe-cine')?.dataset.open !== 'true',
      { timeout: 180_000 },
    );
  });
const anthemAtEnd = await page.evaluate(() => window.__fabricEmpires.anthemTime());
console.log(`sequence ended at anthem t=${anthemAtEnd.toFixed(3)}s`);

// A moment of the settled board after the letterbox lifts, so the film has
// somewhere to fade out to rather than cutting on the last card.
await page.waitForTimeout(1_200);

const video = page.video();
await context.close();
await browser.close();
const raw = await video.path();
console.log(`raw capture: ${raw} (${seconds(raw).toFixed(2)}s)`);

if (problems.length) {
  console.log(`\n⚠️ page errors during capture:\n  ${problems.join('\n  ')}\n`);
}

const flash = findFlash(raw);
console.log(`flash: ${flash.frames} frames, ${flash.start.toFixed(3)}s..${flash.end.toFixed(3)}s`);

/*
 * Pinning the two clocks together.
 *
 * At video time `flash.end` the anthem read `anthemAtFlash + flashHeld`, where
 * the held time is measured from the capture rather than assumed to be
 * FLASH_MS. Cutting the video there and starting the audio there makes the
 * first surviving frame and the first sample of audio describe the same
 * instant of the same performance.
 */
const flashHeld = flash.end - flash.start;
const videoFrom = flash.end;
const audioFrom = anthemAtFlash + flashHeld;
const filmLength = (anthemAtEnd - audioFrom) + 1.2;

console.log(`trimming video from ${videoFrom.toFixed(3)}s, audio from ${audioFrom.toFixed(3)}s`);
console.log(`film length ${filmLength.toFixed(2)}s`);

const anthemLength = seconds(ANTHEM);
if (audioFrom + filmLength > anthemLength + 0.5) {
  throw new Error(
    `the film outlasts the anthem (${(audioFrom + filmLength).toFixed(1)}s of ` +
    `${anthemLength.toFixed(1)}s). Wrong anthem file?`,
  );
}

const fadeAt = Math.max(0, filmLength - 1.6);
mkdirSync(dirname(OUT), { recursive: true });

console.log('encoding...');
ff('ffmpeg', [
  '-y', '-v', 'error',
  '-ss', String(videoFrom), '-i', raw,
  '-ss', String(audioFrom), '-i', ANTHEM,
  '-t', String(filmLength),
  '-map', '0:v:0', '-map', '1:a:0',
  '-vf', `fps=30,fade=t=in:st=0:d=0.6,fade=t=out:st=${fadeAt}:d=1.4`,
  '-af', `afade=t=in:st=0:d=0.4,afade=t=out:st=${fadeAt}:d=1.4`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k',
  '-movflags', '+faststart',
  OUT,
]);

console.log('encoding 720p...');
ff('ffmpeg', [
  '-y', '-v', 'error', '-i', OUT,
  '-vf', 'scale=1280:-2',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p',
  '-c:a', 'copy', '-movflags', '+faststart',
  OUT_720,
]);

// The raw capture is large and reproducible. Keep the directory tidy.
for (const f of readdirSync(RAW_DIR)) unlinkSync(join(RAW_DIR, f));
rmSync(RAW_DIR, { recursive: true, force: true });

for (const f of [OUT, OUT_720]) {
  if (!existsSync(f)) throw new Error(`missing output ${f}`);
  console.log(`${f}  ${seconds(f).toFixed(2)}s`);
}
console.log('done');
