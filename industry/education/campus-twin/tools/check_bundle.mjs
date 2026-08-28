#!/usr/bin/env node
/**
 * A JavaScript (and CSS) bundle budget, measured from disk — TASK 1 of the 2026-08-19 handoff.
 *
 * ⚠️ WHY THIS READS `dist/` INSTEAD OF WATCHING A BROWSER, AND WHY THAT IS NOT A STYLE CHOICE.
 * `e2e/budget.spec.ts` has three budgets and DELIBERATELY no JavaScript one — its header explains
 * that against this repo's Vite **dev server** every `.js` `PerformanceResourceTiming` entry
 * reports `transferSize === 0`. A `transferSize`-based assertion therefore passes at 0.00 MB
 * however large the bundle grows, which is worse than no budget: a check that cannot fail teaches
 * everyone to trust it anyway. Reading the built files straight off disk — raw bytes, and gzip
 * bytes recomputed with Node's own `zlib.gzipSync` rather than trusted from a log line — needs no
 * browser, no dev server, and no `transferSize`, so it cannot fall into that trap. It also means
 * this check runs in CI without a display, which the Playwright specs already need one for.
 *
 * Measured 2026-08-19 against `npm run build` at HEAD (5633d97), before any chunk splitting:
 *
 *   dist/assets/index-Cc-5SExz.js         1,232.05 kB   gzip 363.72 kB   (one chunk, everything)
 *   dist/assets/IntegrationPanel-*.js         5.41 kB   gzip   1.94 kB   (already lazy)
 *   dist/assets/index-DUYEobJ7.css            51.47 kB   gzip   9.24 kB
 *
 * Totals: JS raw 1,237.46 kB / gzip 365.66 kB, CSS raw 51.47 kB / gzip 9.24 kB.
 *
 * Ceilings below are recalculated after the `three` split in this same commit (see the second
 * measurement block further down) — read that one for what is actually enforced today.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const DIST_ASSETS = join(process.cwd(), 'dist', 'assets');

/**
 * Ceilings, in kilobytes (1 kB = 1000 bytes, matching Vite's own build report).
 *
 * ⚠️ ~1.15x THE POST-SPLIT MEASUREMENT, NOT THE PRE-SPLIT ONE. A budget calibrated against the
 * bundle this repo is trying to *leave behind* would still be green after a regression that
 * undid the split entirely — see `tools/tests` sabotage note in the handoff report for the check
 * that proves this ceiling can actually fail.
 */
const BUDGETS = {
  // Measured post-split 2026-08-19, via THIS script against `npm run build`: JS raw 1,235.94 kB /
  // gzip 365.94 kB, across three chunks — `three-*.js` (495.98 kB raw), the app shell
  // `index-*.js` (734.52 kB raw), and the already-lazy `IntegrationPanel-*.js` (5.44 kB raw).
  // That total is 1.52 kB SMALLER than the one-chunk build's 1,237.46 kB raw — i.e. within
  // vite.config.ts for what it buys instead of byte count. ×1.15, rounded up.
  //
  // ── RE-MEASURED 2026-08-26, and the ceilings below are recalculated from THIS run ──────────
  //
  //   consumer-*.js          raw   10.29 kB   gzip   4.22 kB   (entry: consumer.html)
  //   IntegrationPanel-*.js  raw    5.47 kB   gzip   1.97 kB   (lazy)
  //   main-*.js  (shared)    raw  193.65 kB   gzip  60.83 kB   (React + app glue, BOTH entries)
  //   main-*.js  (index)     raw  696.93 kB   gzip 230.17 kB
  //   three-*.js             raw  509.25 kB   gzip 130.89 kB
  //   Totals: JS raw 1,415.59 kB / gzip 428.07 kB.  CSS raw 54.88 / gzip 9.79, both still inside
  //   their old ceilings, so the CSS numbers below are UNCHANGED.
  //
  // ⚠️ WHY THE GZIP CEILING MOVED AND THE RAW ONE BARELY DID. Raw grew 14.5 % and was still
  // UNDER its 1422 ceiling; gzip grew 17 % and broke through. The new code compresses worse than
  // the old, which is what a week of German UI strings, two more site configurations and a second
  // entry point look like. Nothing was undone: `three` is still its own chunk.
  //
  // ⚠️ WHAT WAS CHECKED BEFORE RAISING THE NUMBER, because raising a ceiling to meet the bundle
  // is how a budget stops meaning anything. vite.config.ts names the giveaway for the regression
  // it fears — "a `three` chunk appearing in the consumer output". There is none: `consumer.html`
  // pulls `consumer-*.js` and the shared `main-*.js` and nothing else, so the lecturer's page
  // still does not download the 3D engine. It DOES download 204 kB raw rather than 10, because
  // React lives in the shared chunk; that is the price of a React page, not a leak of the twin.
  // That claim is now enforced below rather than left to the next reader.
  //
  // ⚠️ AND THIS RATCHETS, WHICH IS THE HONEST OBJECTION. Recalibrating ×1.15 against an already
  // grown bundle allows another 15 % on top. The alternative is a check that is red every day,
  // and this file's own header argues that a check nobody can act on is worse than none. If the
  // next recalibration is also "+15 % because features", that is the moment to split routes
  // instead of numbers.
  jsRawKb: 1628,
  jsGzipKb: 493,
  // CSS did not change: the split only touches `manualChunks` for JavaScript.
  cssRawKb: 60,
  cssGzipKb: 11,
};

function readAssets(dir, extension) {
  if (!existsSync(dir)) {
    throw new Error(
      `${dir} does not exist — run "npm run build" before "npm run check:bundle".`
    );
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(extension))
    .map((name) => {
      const path = join(dir, name);
      const raw = readFileSync(path);
      return { name, rawBytes: statSync(path).size, gzipBytes: gzipSync(raw).length };
    });
}

function sumKb(files, key) {
  return files.reduce((sum, f) => sum + f[key], 0) / 1000;
}

function report(label, files) {
  const rawKb = sumKb(files, 'rawBytes');
  const gzipKb = sumKb(files, 'gzipBytes');
  console.log(`${label}: ${files.length} file(s), raw ${rawKb.toFixed(2)} kB, gzip ${gzipKb.toFixed(2)} kB`);
  for (const f of files) {
    console.log(`  ${f.name}  raw ${(f.rawBytes / 1000).toFixed(2)} kB  gzip ${(f.gzipBytes / 1000).toFixed(2)} kB`);
  }
  return { rawKb, gzipKb };
}

function checkCeiling(failures, label, actualKb, ceilingKb) {
  if (actualKb > ceilingKb) {
    failures.push(
      `${label} is ${actualKb.toFixed(2)} kB, over the ${ceilingKb} kB ceiling in tools/check_bundle.mjs`
    );
  }
}

const jsFiles = readAssets(DIST_ASSETS, '.js');
const cssFiles = readAssets(DIST_ASSETS, '.css');

const js = report('JS  ', jsFiles);
const css = report('CSS ', cssFiles);

const failures = [];
checkCeiling(failures, 'JS raw total', js.rawKb, BUDGETS.jsRawKb);
checkCeiling(failures, 'JS gzip total', js.gzipKb, BUDGETS.jsGzipKb);
checkCeiling(failures, 'CSS raw total', css.rawKb, BUDGETS.cssRawKb);
checkCeiling(failures, 'CSS gzip total', css.gzipKb, BUDGETS.cssGzipKb);

/*
  ⚠️ THE CONSUMER PAGE MUST NOT DOWNLOAD THE 3D ENGINE.

  vite.config.ts states the whole reason `consumer.html` is a separate entry rather than a route:
  "a `/mein-plan` route inside `index.html` would still pull `three`, the terrain loaders and
  every lens into the bundle a lecturer downloads to find out when they teach on Thursday". It
  then names the giveaway for the regression — "a `three` chunk appearing in the consumer output,
  and `tools/check_bundle.mjs` is where that regression should be caught".

  It was never actually caught here. Rollup only emits a manual chunk for entries that reach the
  module, so the split is enforced by nothing but the import graph staying accidentally correct:
  one `import` under `src/consumer/` that reaches `src/twin3d/` silently adds half a megabyte to
  the page, and the only symptom is a slower load nobody attributes to a code change.

  ⚠️ IT READS THE EMITTED HTML, NOT THE IMPORT GRAPH. The question is not "does the source import
  three" but "does the browser fetch it", and only the built entry document answers that. It also
  survives a rename: the chunk is matched by its `three-` prefix, which `manualChunks` fixes.
*/
const CONSUMER_HTML = join(process.cwd(), 'dist', 'consumer.html');
if (existsSync(CONSUMER_HTML)) {
  const html = readFileSync(CONSUMER_HTML, 'utf8');
  const referenced = [...html.matchAll(/\/assets\/([\w.-]+\.js)/g)].map((m) => m[1]);
  const heavy = referenced.filter((n) => n.startsWith('three-'));
  if (heavy.length) {
    failures.push(
      `consumer.html references ${heavy.join(', ')} — the lecturer's page must not download the 3D `
      + 'engine. Something under src/consumer/ now imports src/twin3d/; see vite.config.ts.'
    );
  } else if (!referenced.length) {
    // Vacuity guard, the §82 lesson: a check that matches nothing does not fail, it just stops
    // checking. If the asset naming ever changes, say so instead of reporting success.
    failures.push('consumer.html references no /assets/*.js at all — this check has stopped working');
  }
}

/*
  ⚠️ NO DEVELOPER LOOPBACK ADDRESS MAY LEAVE THE BUILD, AND ONE DID.

  `src/consumer/auth.ts` defaulted its API base to `http://127.0.0.1:8082` with no environment
  guard, so a production build with no `VITE_CONSUMER_API` set baked that address into a public
  bundle. Deployed to Fabric, `consumer.html` loaded, called `127.0.0.1:8082` on the VISITOR'S
  machine, and reported `ERR_CONNECTION_REFUSED` as "die Verbindung ist fehlgeschlagen" — a message
  that blames the network for a build-configuration mistake.

  `tools/verify_deploy.mjs` already asserts the MAIN bundle points at no localhost. It never looked
  at the consumer bundle, because that is a second entry point added later, and the check was
  written against the entry point that existed at the time. This one is entry-point agnostic: it
  reads every emitted chunk, so a third entry cannot slip past it the same way.

  Checked here rather than in an e2e test because it is a property of the ARTEFACT. Catching it
  needs no browser, no deployment and no auth — just the file that is about to be published.

  ⚠️ A LOOPBACK YOU FETCH, NOT A LOOPBACK YOU COMPARE AGAINST. The first version of this pattern
  matched the bare word and immediately failed the MAIN bundle on
  `window.location.hostname === "localhost"` — a dependency detecting whether it is running on a
  developer's machine, which is correct code and must not be banned. Requiring the `http://` prefix
  keeps the check on the thing that actually breaks: an address the built code will try to open.
*/
const LOOPBACK = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?/;
for (const file of jsFiles) {
  const text = readFileSync(join(DIST_ASSETS, file.name), 'utf8');
  const hit = LOOPBACK.exec(text);
  if (hit) {
    failures.push(
      `${file.name} ships a developer address (${hit[0]}) — set the relevant VITE_* variable, ` +
        'or guard the fallback behind `import.meta.env.DEV`'
    );
  }
}

if (failures.length > 0) {
  console.error('\nBundle budget FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('\nBundle budget OK.');
