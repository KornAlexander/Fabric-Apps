/**
 * Which Power BI report ids a built bundle carries that count as GOVERNED, i.e. as the real-data
 * report's. Used by `check_release.mjs`; its own file so the rule can be tested on crafted bundles
 * (`tools/tests/test_report_ids.mjs`) instead of only on whatever today's build happens to contain.
 *
 * ⚠️ EVERY REPORT ID IS GARCHING'S UNTIL IT IS SHOWN TO BE ANOTHER SITE'S. Other sites have reports
 * too (the demo site's is synthetic and ships in every posture), so not every id in a bundle is the
 * real-data one. But looking only for the shapes Garching's id is known to take would pass a
 * withheld build the day a minifier quotes a key or reorders an object: that is a false pass in the
 * one direction that matters. So all ids that look like report ids are collected, the ones that
 * demonstrably belong to an ungoverned site are taken out, and whatever is left counts as governed.
 */
const ID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';

const ANY_REPORT = new RegExp(`(?:VITE_PBI_REPORT_[A-Z0-9_]+|reportId)["']?\\s*:\\s*["']${ID}["']`, 'gi');

const UNGOVERNED_REPORT = new RegExp(
  `(?:VITE_PBI_REPORT_(?!GARCHING)[A-Z0-9_]+["']?\\s*:\\s*|["']?campus-demo["']?\\s*:\\s*\\{\\s*["']?reportId["']?\\s*:\\s*)["']${ID}["']`,
  'gi'
);

/*
  The demo site's report in a second language (`variants` in src/config/powerbi.ts): another id of
  the same ungoverned site, written directly after the site's own. It is named here by that exact
  shape, so an id under `variants` of any OTHER site is still found by ANY_REPORT above and still
  counts as governed.
*/
const UNGOVERNED_VARIANT = new RegExp(
  `["']?campus-demo["']?\\s*:\\s*\\{\\s*["']?reportId["']?\\s*:\\s*["'][^"']*["']\\s*,\\s*["']?variants["']?\\s*:\\s*\\{\\s*["']?[a-z]{2}["']?\\s*:\\s*\\{\\s*["']?reportId["']?\\s*:\\s*["']${ID}["']`,
  'gi'
);

/**
 * The governed report ids in `text`, lower-cased.
 *
 * ⚠️ AN ID IS EXEMPT BY THE SLOT IT SITS IN, AND A SLOT CAN HOLD THE WRONG ID. If Garching's id is
 * ever configured as the demo site's (a pasted line, `VITE_PBI_REPORT_DEMO_EN` set to the wrong
 * report), the shapes above would wave the real-data report through under the demo site's name. So
 * an id the configuration names as Garching's is governed wherever it stands. `governedId` is that
 * id when one is configured; without it only the slot can be judged.
 */
export function governedReportIds(text, governedId = '') {
  const all = new Set();
  const ungoverned = new Set();
  for (const m of text.matchAll(ANY_REPORT)) all.add(m[1].toLowerCase());
  for (const m of text.matchAll(UNGOVERNED_REPORT)) ungoverned.add(m[1].toLowerCase());
  for (const m of text.matchAll(UNGOVERNED_VARIANT)) ungoverned.add(m[1].toLowerCase());
  ungoverned.delete(governedId.trim().toLowerCase());
  return new Set([...all].filter((id) => !ungoverned.has(id)));
}
