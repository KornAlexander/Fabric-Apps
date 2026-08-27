/**
 * Smoke test: does the SHIPPED BUNDLE actually play?
 *
 * Run against the production preview, not the dev server:
 *
 *     npm run build
 *     npm run serve:standalone          # http://localhost:4173
 *     npm run smoke -- http://localhost:4173/
 *
 * ⚠️ **This exists because `npm run serve:standalone` was broken and nothing
 * noticed.** The script passed `--root app`, which `vite preview` does not
 * accept, so the one command the README gives a player to start the game exited
 * immediately. A unit test had checked that the script *existed*. Checking that
 * a command is present is not checking that it runs, and every other check this
 * project makes had gone through Vite's dev pipeline, which is not what anybody
 * downloads.
 *
 * ⚠️ It also encodes two measurements that looked fine and meant nothing:
 *
 *   - `renderer.info.render.triangles` read after a frame reports the LAST
 *     `render()` call, which with a post chain is the final fullscreen quad.
 *     It returned 1 on a fully drawn scene. `info.memory` is cumulative and is
 *     the honest signal.
 *   - `/api/*` returning 404 is correct here. The standalone edition has no
 *     capacity host, so a test that forbids all 404s fails on healthy output.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const url = process.argv[2] ?? 'http://localhost:4173/';
const problems = [];
const pageErrors = [];
const badResponses = [];

// playwright-core ships no browsers. Use one already on the machine.
async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel, headless: false });
    } catch {
      /* try the next one */
    }
  }
  // A downloaded chromium, if `npx playwright install` has been run.
  return chromium.launch({ headless: false });
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1333, height: 768 } });

page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/404|500/.test(m.text())) pageErrors.push(m.text().slice(0, 200));
});
page.on('response', (r) => {
  // Two absences are the design, not a fault, and both are probed for and
  // handled:
  //
  //   /api/*   the standalone edition has no capacity host, so there is no
  //            coach and no question bank to talk to.
  //   terra-nostra.mp3
  //            the one soundtrack slot whose file does not exist. Its Pro
  //            regeneration was stopped by a human verification challenge,
  //            and `soundtrack.ts` drops tracks whose file is missing.
  //
  // ⚠️ The exemption is deliberately **one filename**, not all of `/audio/*`.
  // It used to be the whole folder, because the public build stripped the
  // soundtrack on licence grounds. Now that every track is owned outright and
  // ships, a blanket exemption would quietly swallow the case where the audio
  // failed to deploy at all, which is exactly the class of silent hole this
  // smoke test exists to catch.
  //
  // ⚠️ A missing file comes back **500**, not 404, because the host errors on
  // a missing file rather than reporting it missing. `audio.ts` treats any
  // not-ok response the same way, so the game is correct either way, but the
  // browser still writes the failed request to the console and nothing in
  // JavaScript can stop it. Cosmetic, and worth knowing before somebody opens
  // devtools on the public URL and concludes the app is broken.
  if (r.status() >= 400 && !r.url().includes('/api/') && !r.url().includes('terra-nostra.mp3')) {
    badResponses.push(`HTTP ${r.status()} ${r.url().slice(0, 110)}`);
  }
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

const play = page.locator('button.fe-setup-play');
if (!(await play.count())) {
  problems.push('no setup screen: the bundle did not boot');
} else {
  await play
    .click({ force: true, timeout: 15000 })
    .catch((e) => problems.push('could not start a game: ' + e.message.split('\n')[0]));
}

await page
  .waitForFunction(
    () => {
      const c = document.getElementById('controls');
      return c ? getComputedStyle(c).opacity === '1' : false;
    },
    undefined,
    { timeout: 180000 },
  )
  .catch(() => problems.push('the game UI never appeared'));

for (let i = 0; i < 8; i += 1) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}
await page.waitForTimeout(3500);

const state = await page.evaluate(() => {
  const h = window.__fabricEmpires;
  if (!h) return { error: 'no harness on the page' };
  const w = h.gfx?.();
  const info = w?.renderer?.info;
  return {
    seed: h.seed?.(),
    turn: h.turn?.(),
    cities: h.cityCount?.(),
    explored: h.exploredCount?.(),
    // Cumulative, unlike info.render, which resets every render() call.
    geometries: info?.memory?.geometries,
    textures: info?.memory?.textures,
    programs: info?.programs?.length,
    frameMs: h.lastFrameMs?.(),
  };
});

if (state.error) problems.push(state.error);
if (!state.seed) problems.push('no seed: a game never started');
if (!(state.cities > 0)) problems.push(`no cities on the map (${state.cities})`);
if (!(state.explored > 0)) problems.push(`nothing explored (${state.explored})`);
if (!(state.geometries > 50)) problems.push(`only ${state.geometries} geometries: the world is not built`);
if (!(state.programs > 20)) problems.push(`only ${state.programs} shader programs: the scene is not shaded`);

const before = state.turn;
// ⚠️ Optional all the way down. On a page that is not the game there is no
// harness at all, and `__fabricEmpires.endTurn?.()` throws on the property
// access before the optional call ever helps. That turned a clean "this is not
// the game" report into an unhandled exception with a stack trace.
await page.evaluate(() => window.__fabricEmpires?.endTurn?.());
await page.waitForTimeout(3500);
const after = await page.evaluate(() => window.__fabricEmpires?.turn?.());
if (!(after > before)) problems.push(`ending a turn did nothing (${before} -> ${after})`);

if (pageErrors.length) problems.push(`${pageErrors.length} page error(s): ${pageErrors[0]}`);
if (badResponses.length) problems.push(`${badResponses.length} failed request(s): ${badResponses[0]}`);

console.log('state:', JSON.stringify(state));
console.log(`turn ${before} -> ${after}`);

await browser.close();

if (problems.length) {
  console.log('\nSMOKE FAILED:');
  for (const p of problems) console.log('  -', p);
  process.exit(1);
}
console.log('\nSmoke passed: the bundle boots, builds a world, renders and advances a turn.');
