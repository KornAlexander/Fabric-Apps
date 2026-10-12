/**
 * Does the release gate tell the real-data report's id from the demo site's, in a bundle?
 *
 * `check_release.mjs` only ever meets the bundle of the day, and in the internal posture that
 * bundle never exercises the direction that matters: a build that WITHHOLDS the TUM data and still
 * carries the address of the real-data report. So the rule (`tools/report_ids.mjs`) is fed crafted
 * bundles here, in the two shapes Vite produces: the inlined environment object, and the minified
 * object literal of `SITE_REPORTS`.
 *
 * The ids are built from parts so no file in this repository contains a whole one that could be
 * mistaken for a tenant's.
 *
 *     node tools/tests/test_report_ids.mjs
 */
import { governedReportIds } from '../report_ids.mjs';

const id = (digit) => [8, 4, 4, 4, 12].map((n) => String(digit).repeat(n)).join('-');
const GARCHING = id(1);
const DEMO = id(9);
const DEMO_EN = id(7);

let failures = 0;
const check = (what, text, expected, governedId = '') => {
  const got = [...governedReportIds(text, governedId)].sort();
  const ok = JSON.stringify(got) === JSON.stringify([...expected].sort());
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `: governed ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`}`);
  if (!ok) failures += 1;
};

const literal = (demoEn, { site = '"campus-demo"', between = '' } = {}) =>
  `garching:{reportId:"${GARCHING}",pageName:"gebaeude",realData:"navigatum"},` +
  `${site}:{reportId:"${DEMO}",${between}variants:{en:{reportId:"${demoEn}"}},pageName:"gebaeude"}`;
const env = (demoEn) =>
  `{VITE_PBI_REPORT_DEMO:"${DEMO}",VITE_PBI_REPORT_DEMO_EN:"${demoEn}",VITE_PBI_REPORT_GARCHING:"${GARCHING}"}`;

console.log('object literal, as the minifier writes SITE_REPORTS');
check('Garching is governed, both demo reports are not', literal(DEMO_EN), [GARCHING]);
check('quoted keys change nothing', literal(DEMO_EN).replace(/(\w+):/g, '"$1":').replace('""campus-demo""', '"campus-demo"'), [GARCHING]);
// ⚠️ THE MIRROR. Without these, a rule that exempted every `variants` id would pass the two above.
check('the same shape under another site is governed', literal(DEMO_EN, { site: 'elsewhere' }), [GARCHING, DEMO, DEMO_EN]);
check('a variant not directly after the site id is governed', literal(DEMO_EN, { between: 'pageName:"x",' }), [GARCHING, DEMO_EN]);

console.log('inlined environment object');
check('Garching is governed, both demo reports are not', env(DEMO_EN), [GARCHING]);

console.log("Garching's id in the demo site's slot");
// Judged by the slot alone it is exempt: that is the gap the configured id closes.
check('exempt by slot when nothing names it', literal(GARCHING).replace(`garching:{reportId:"${GARCHING}"`, 'garching:{reportId:""'), []);
check('governed once the configuration names it (literal)',
  literal(GARCHING).replace(`garching:{reportId:"${GARCHING}"`, 'garching:{reportId:""'), [GARCHING], GARCHING.toUpperCase());
check('governed once the configuration names it (environment)',
  `{VITE_PBI_REPORT_DEMO:"${DEMO}",VITE_PBI_REPORT_DEMO_EN:"${GARCHING}"}`, [GARCHING], ` ${GARCHING} `);

console.log('a bundle without reports');
check('carries nothing', 'const a={pageName:"gebaeude"};', []);

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
