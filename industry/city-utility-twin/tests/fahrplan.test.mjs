/**
 * The parts of the vehicle layer that fail quietly.
 *
 * ⚠️ EVERY CASE HERE IS ONE THAT ALREADY WENT WRONG, OR THAT AN INDEPENDENT REVIEW SHOWED COULD.
 * None of these throw at runtime: a dropped route segment looks like a route, a misclassified
 * S-Bahn looks like a tram, and a skipped service day looks like a quiet night. That is exactly
 * why they need assertions rather than a look at the screen.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { clipPolylineToBox } from '../src/live/clip.mjs';
import {
  modeOfLine, serviceStamp, previousServiceDay, servicesOnDate,
} from '../src/live/fahrplan.mjs';
import { inheritedName, withoutApprovedPlaceNames } from '../tools/map-assets.mjs';

const BOX = { minE: 0, minN: 0, maxE: 10, maxN: 10 };

test('a segment crossing the core with BOTH ends outside is kept', () => {
  // The regression the first implementation had: it only looked for a crossing when exactly one
  // endpoint was inside, so this traversal of the whole core vanished.
  const runs = clipPolylineToBox([[-1, 5], [11, 5]], BOX);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0], [[0, 5], [10, 5]]);
});

test('entry and exit are cut at the boundary, not at the last inside vertex', () => {
  const runs = clipPolylineToBox([[-4, 5], [5, 5], [14, 5]], BOX);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0][0], [0, 5]);
  assert.deepEqual(runs[0][runs[0].length - 1], [10, 5]);
});

test('a line that leaves and re-enters becomes two runs, not one straight cheat', () => {
  const runs = clipPolylineToBox([[1, 5], [20, 5], [20, 2], [1, 2]], BOX);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[0], [[1, 5], [10, 5]]);
  assert.deepEqual(runs[1], [[10, 2], [1, 2]]);
});

test('a polyline entirely inside is returned untouched', () => {
  const points = [[1, 1], [2, 2], [3, 3]];
  assert.deepEqual(clipPolylineToBox(points, BOX), [points]);
});

test('a polyline entirely outside draws nothing', () => {
  assert.deepEqual(clipPolylineToBox([[20, 20], [30, 30]], BOX), []);
});

test('no run is ever emitted outside the box', () => {
  const awkward = [[-5, -5], [15, 15], [-5, 15], [5, 5], [5, -5]];
  for (const run of clipPolylineToBox(awkward, BOX)) {
    for (const [e, n] of run) {
      assert.ok(e >= BOX.minE - 1e-9 && e <= BOX.maxE + 1e-9, `easting ${e} outside`);
      assert.ok(n >= BOX.minN - 1e-9 && n <= BOX.maxN + 1e-9, `northing ${n} outside`);
    }
  }
});

test('a degenerate polyline cannot produce a one-point ribbon', () => {
  assert.deepEqual(clipPolylineToBox([[1, 1]], BOX), []);
  assert.deepEqual(clipPolylineToBox([], BOX), []);
  for (const run of clipPolylineToBox([[1, 1], [1, 1], [2, 2]], BOX)) {
    assert.ok(run.length >= 2);
  }
});

test('without a box the polyline is passed through rather than dropped', () => {
  const points = [[100, 100], [200, 200]];
  assert.deepEqual(clipPolylineToBox(points, null), [points]);
});

test('S-Bahn is not a tram, whatever the feed says its route_type is', () => {
  // ⚠️ Measured in gesamt_gtfs.zip on 2026-09-22: S1..S8 are published as route_type 0, the
  // same code as lines 12 and 19. Believing the type draws a 67 m unit at 37 m.
  assert.equal(modeOfLine('S8', '0'), 'sbahn');
  assert.equal(modeOfLine('S1', '0'), 'sbahn');
  assert.equal(modeOfLine('19', '0'), 'tram');
  assert.equal(modeOfLine('12', '0'), 'tram');
});

test('a replacement service is a bus even though its label starts with S', () => {
  assert.equal(modeOfLine('SEV S1', '3'), 'bus');
  assert.equal(modeOfLine('SEV S', '0'), 'bus');
});

test('underground lines are recognised by label and by type', () => {
  assert.equal(modeOfLine('U6', '1'), 'ubahn');
  assert.equal(modeOfLine('U', '1'), 'ubahn');
  assert.equal(modeOfLine('153', '3'), 'bus');
  assert.equal(modeOfLine('N17', '0'), 'tram');
});

test('the previous service day is a calendar day, not 24 hours earlier', () => {
  // ⚠️ THE BUG THIS REPLACES. In Europe/Berlin, 2026-03-30 00:30 CEST minus 86 400 000 ms is
  // 2026-03-28 23:30 CET, which skips Sunday the 29th entirely — and the wrong service set was
  // then cached until the date changed again.
  const afterSpringForward = new Date(2026, 2, 30, 0, 30, 0);
  const previous = previousServiceDay(afterSpringForward);
  assert.equal(previous.getFullYear(), 2026);
  assert.equal(previous.getMonth(), 2);
  assert.equal(previous.getDate(), 29);
  assert.equal(serviceStamp(previous), '20260329');
});

test('the previous service day crosses month and year boundaries', () => {
  assert.equal(serviceStamp(previousServiceDay(new Date(2026, 0, 1, 0, 5))), '20251231');
  assert.equal(serviceStamp(previousServiceDay(new Date(2026, 9, 1, 3, 0))), '20260930');
});

const KALENDER = {
  // Monday..Sunday. 0 = weekdays only, 1 = Sundays only.
  0: { d: '1111100', f: '20260101', u: '20261231' },
  1: { d: '0000001', f: '20260101', u: '20261231' },
  2: { d: '1111111', f: '20260901', u: '20260910' },
};

test('weekday selection uses the GTFS Monday-first order', () => {
  // 2026-09-22 is a Tuesday, 2026-09-27 a Sunday.
  assert.ok(servicesOnDate(new Date(2026, 8, 22, 12), KALENDER, {}).has(0));
  assert.ok(!servicesOnDate(new Date(2026, 8, 22, 12), KALENDER, {}).has(1));
  assert.ok(servicesOnDate(new Date(2026, 8, 27, 12), KALENDER, {}).has(1));
  assert.ok(!servicesOnDate(new Date(2026, 8, 27, 12), KALENDER, {}).has(0));
});

test('validity bounds are inclusive at both ends', () => {
  assert.ok(servicesOnDate(new Date(2026, 8, 1, 12), KALENDER, {}).has(2));
  assert.ok(servicesOnDate(new Date(2026, 8, 10, 12), KALENDER, {}).has(2));
  assert.ok(!servicesOnDate(new Date(2026, 8, 11, 12), KALENDER, {}).has(2));
});

test('an exception can both add and remove a service on the same date', () => {
  // A public holiday falling on a Tuesday: the weekday service is withdrawn and the Sunday one
  // put on. Honouring only the weekday pattern would run a full working day.
  const ausnahmen = { 20260922: { 0: 2, 1: 1 } };
  const active = servicesOnDate(new Date(2026, 8, 22, 12), KALENDER, ausnahmen);
  assert.ok(!active.has(0), 'weekday service should have been removed');
  assert.ok(active.has(1), 'Sunday service should have been added');
});

test('an added service runs even outside its own validity window', () => {
  const ausnahmen = { 20261225: { 2: 1 } };
  assert.ok(servicesOnDate(new Date(2026, 11, 25, 12), KALENDER, ausnahmen).has(2));
});

/**
 * The published-place-name exemption, with the controls that keep it narrow.
 *
 */

const TIMETABLE = 'dist/data/fahrplan.json';

test('the published terminus is exempt inside the data file', () => {
  const cleaned = withoutApprovedPlaceNames('"h":"Universität"', TIMETABLE);
  assert.ok(!inheritedName.test(cleaned));
});

test('the exemption does not apply anywhere else in the app', () => {
  for (const path of ['src/main.ts', 'index.html', 'dist/assets/main-abc.js', 'src/data/other.json']) {
    const cleaned = withoutApprovedPlaceNames('Universität', path);
    assert.ok(inheritedName.test(cleaned), `${path} must still be guarded`);
  }
});

test('a compound name is not smuggled through by the exemption', () => {
  for (const text of ['Universitätsklinikum', 'Universitätsbibliothek', 'university campus']) {
    assert.ok(inheritedName.test(withoutApprovedPlaceNames(text, TIMETABLE)), text);
  }
});

test('the exemption cannot carry other inherited identity with it', () => {
  assert.ok(inheritedName.test(withoutApprovedPlaceNames('Universität timetable', TIMETABLE)));
  assert.ok(inheritedName.test(withoutApprovedPlaceNames('Universität campus', TIMETABLE)));
});
