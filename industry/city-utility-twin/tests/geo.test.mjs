/**
 * The browser projection must agree with the one that built the terrain.
 *
 * ⚠️ THE EXPECTED VALUES ARE NOT MINE. Every one was produced by the pipeline's own
 * `tools/geodata/utm.py` (`utm.set_active_zone(32); utm.wgs84_to_utm(lon, lat)`) on 2026-09-21,
 * which is the module that placed the heightmap, the buildings and the orthophoto. Checking this
 * port against remembered coordinates would prove only that two guesses agree.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { wgs84ToUtm32 } from '../src/geo/utm32.mjs';

/** lat, lon, easting, northing — straight out of tools/geodata/utm.py. */
const REFERENCE = [
  ['Messpunkt Maxvorstadt', 48.15049, 11.5798, 691874.084, 5336245.531],
  ['Munich Airport Center', 48.353789, 11.786145, 706399.485, 5359375.031],
  ['Schwelle 08L', 48.362763, 11.767573, 704987.753, 5360322.519],
  ['Schwelle 26R', 48.36687, 11.82113, 708937.416, 5360923.651],
];

test('agrees with the pipeline projection to the millimetre', () => {
  for (const [name, lat, lon, easting, northing] of REFERENCE) {
    const point = wgs84ToUtm32(lat, lon);
    assert.ok(
      Math.abs(point.easting - easting) < 0.001,
      `${name} easting ${point.easting} vs ${easting}`
    );
    assert.ok(
      Math.abs(point.northing - northing) < 0.001,
      `${name} northing ${point.northing} vs ${northing}`
    );
  }
});

test('lands inside the core the asset descriptor declares', async () => {
  // A second, independent check: the projected anchor has to fall inside the box the generated
  // heightmap says it covers. This catches a right-shaped projection pointed at the wrong grid,
  // which the millimetre test above would happily pass if both sides shared the same mistake.
  for (const [dir, lat, lon] of [
    ['munich', 48.15049, 11.5798],
    ['flughafen', 48.353789, 11.786145],
  ]) {
    const meta = JSON.parse(
      await readFile(new URL(`../public/terrain/${dir}/heightmap.json`, import.meta.url), 'utf8')
    );
    const { easting, northing } = wgs84ToUtm32(lat, lon);
    const maxE = meta.origin.easting + meta.width * meta.resolutionM;
    const maxN = meta.origin.northing + meta.height * meta.resolutionM;
    assert.ok(
      easting > meta.origin.easting && easting < maxE,
      `${dir}: easting ${easting} outside ${meta.origin.easting}..${maxE}`
    );
    assert.ok(
      northing > meta.origin.northing && northing < maxN,
      `${dir}: northing ${northing} outside ${meta.origin.northing}..${maxN}`
    );
  }
});

test('refuses a non-finite coordinate instead of returning NaN metres', () => {
  assert.throws(() => wgs84ToUtm32(Number.NaN, 11.5), /non-finite/);
  assert.throws(() => wgs84ToUtm32(48.1, Number.POSITIVE_INFINITY), /non-finite/);
});
