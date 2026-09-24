/**
 * Parsing tests for the two air-quality layers.
 *
 * Every case here is a trap that was actually hit while building these layers against the live
 * services on 2026-09-21, not an invented edge case. They are worth keeping because all of them
 * fail SILENTLY in a 3D scene: the layer draws nothing, or draws the wrong thing in the right
 * place, and there is no error anywhere to notice.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  colourForPm25, newestReading, parseArea, parseComponents, parseStations, requestWindow,
} from '../src/live/luftParse.mjs';

/** The layer drops a reading older than an hour rather than drawing it as current. */
const MAX_AGE_MS = 60 * 60 * 1000;

const STATION_INDICES = [
  'station id', 'station code', 'station name', 'station city', 'station synonym',
  'station active from', 'station active to', 'station longitude', 'station latitude',
  'network id', 'station setting id', 'station type id', 'network code', 'network name',
  'station setting name', 'station setting short name', 'station type name',
  'station street', 'station street nr', 'station zip code',
];

const stationRow = (over = {}) => {
  const row = [
    '471', 'DEBY115', 'München/Stachus', 'München', '', '1988-01-01', null,
    '11.5649', '48.1373', '2', '1', '1', 'BY', 'Bayern',
    'städtisches Gebiet', 'städtisch', 'Verkehr', 'Sonnenstraße', '', '80331',
  ];
  for (const [column, value] of Object.entries(over)) {
    row[STATION_INDICES.indexOf(column)] = value;
  }
  return row;
};

test('a retired station is dropped even though the API sends the STRING "null" for active ones', () => {
  const payload = {
    indices: STATION_INDICES,
    data: {
      471: stationRow({ 'station active to': 'null' }),
      473: stationRow({ 'station id': '473', 'station name': 'München/Lothstraße', 'station active to': null }),
      999: stationRow({ 'station id': '999', 'station name': 'München/Stillgelegt', 'station active to': '2021-03-22' }),
    },
  };
  const stations = parseStations(payload, 'München');
  // Both flavours of "still running" survive; the one with a real end date does not. Testing only
  // for JSON null would keep station 999 and show a reading that stopped five years ago.
  assert.deepEqual(stations.map((s) => s.id).sort(), ['471', '473']);
});

test('stations of another city are not drawn on a Munich map', () => {
  const payload = {
    indices: STATION_INDICES,
    data: {
      471: stationRow(),
      7: stationRow({ 'station id': '7', 'station city': 'Elsterwerda', 'station name': 'Elsterwerda' }),
    },
  };
  assert.deepEqual(parseStations(payload, 'München').map((s) => s.id), ['471']);
});

test('a city name with a district qualifier still counts as that city', () => {
  // ⚠️ MEASURED, AND IT COST A STATION. Four Munich stations carry the city "München"; station
  // 523 carries "München, Stadtteil Johanneskirchen". An equality filter dropped it silently and
  // the layer confidently reported four stations.
  const payload = {
    indices: STATION_INDICES,
    data: {
      523: stationRow({
        'station id': '523',
        'station name': 'München/Johanneskirchen',
        'station city': 'München, Stadtteil Johanneskirchen',
      }),
      // A different town that merely starts the same way must NOT be pulled in, which is why the
      // match requires the comma rather than being a bare prefix test.
      900: stationRow({ 'station id': '900', 'station city': 'Münchenstein', 'station name': 'Münchenstein' }),
    },
  };
  assert.deepEqual(parseStations(payload, 'München').map((s) => s.id), ['523']);
});

test('columns are read by NAME, so an inserted upstream column cannot swap lat and lon', () => {
  // The same data, with one extra column spliced in ahead of the coordinates.
  const shifted = ['station id', 'station code', 'station name', 'station city', 'station synonym',
    'station active from', 'station active to', 'station elevation',
    'station longitude', 'station latitude', 'network id', 'station setting id',
    'station type id', 'network code', 'network name', 'station setting name',
    'station setting short name', 'station type name', 'station street',
    'station street nr', 'station zip code'];
  const row = ['471', 'DEBY115', 'München/Stachus', 'München', '', '1988-01-01', null, '520',
    '11.5649', '48.1373', '2', '1', '1', 'BY', 'Bayern', 'städtisches Gebiet', 'städtisch',
    'Verkehr', 'Sonnenstraße', '', '80331'];
  const [station] = parseStations({ indices: shifted, data: { 471: row } }, 'München');
  assert.equal(station.lat, 48.1373);
  assert.equal(station.lon, 11.5649);
  assert.equal(station.type, 'Verkehr');
});

test('components come from NUMBERED TOP-LEVEL KEYS and `indices` is not read as a row', () => {
  // ⚠️ `/stations` nests rows under `data` and `/components` does not. Two conventions, one API.
  const payload = {
    indices: ['component id', 'component code', 'component symbol', 'component unit', 'component name'],
    1: ['1', 'PM10', 'PM₁₀', 'µg/m³', 'Feinstaub'],
    5: ['5', 'NO2', 'NO₂', 'µg/m³', 'Stickstoffdioxid'],
  };
  const components = parseComponents(payload);
  assert.equal(components.size, 2);
  assert.equal(components.get('5').symbol, 'NO₂');
  assert.equal(components.get('5').unit, 'µg/m³');
  assert.equal(components.get('5').name, 'Stickstoffdioxid');
  assert.equal(components.has('indices'), false);
});

test('the newest published hour wins, and its component values are carried through', () => {
  const payload = {
    data: {
      471: {
        '2026-09-21 08:00:00': ['2026-09-21 09:00:00', 1, 1, [5, 27, 1, '1.316']],
        '2026-09-21 09:00:00': ['2026-09-21 10:00:00', 2, 0, [5, 24, 1, '1.158'], [9, 10, 0, '1']],
      },
    },
  };
  const reading = newestReading(payload, '471');
  assert.equal(reading.start, '2026-09-21 09:00:00');
  assert.equal(reading.totalIndex, 2);
  // ⚠️ FIELD 2 IS "data incomplete", per the response's own `indices`. A 0 therefore means the
  // source does NOT flag the data as incomplete. An earlier version read this the wrong way
  // round, so the panel warned about complete hours and stayed silent about incomplete ones.
  assert.equal(reading.incomplete, false);
  assert.deepEqual(reading.values, [
    { componentId: '5', value: 24, index: 1 },
    { componentId: '9', value: 10, index: 0 },
  ]);
});

test('the "data incomplete" flag is reported as the source names it', () => {
  // Measured over a week at the five Munich stations: 328 hours flagged 0 and 577 flagged 1, so
  // the field varies and carries information. Stations 471 and 535 measure no ozone, which is
  // consistent with the flag meaning the index lacked a full component set.
  const of = (flagValue) => newestReading(
    { data: { 471: { '2026-09-21 09:00:00': ['2026-09-21 10:00:00', 1, flagValue, [5, 24, 1, '1.1']] } } },
    '471',
  ).incomplete;
  assert.equal(of(1), true);
  assert.equal(of(0), false);
});

test('a total index of 0 is a real published value, not a missing one', () => {
  // Measured: total index 0 occurred 351 times in a week at these stations, mostly overnight.
  // Treating it as absent painted the cleanest hours in the "no data" grey.
  const reading = newestReading(
    { data: { 471: { '2026-09-21 00:00:00': ['2026-09-21 01:00:00', 0, 1, [5, 12, 0, '0.6']] } } },
    '471',
  );
  assert.equal(reading.totalIndex, 0);
  assert.notEqual(reading.totalIndex, null);
  assert.deepEqual(reading.values, [{ componentId: '5', value: 12, index: 0 }]);
});

test('an empty window yields null rather than a fabricated reading', () => {
  assert.equal(newestReading({ data: {} }, '471'), null);
  assert.equal(newestReading({}, '471'), null);
  assert.equal(newestReading({ data: { 471: {} } }, '471'), null);
});

test('the request window is built in CET on a 1..24 clock, not in local time', () => {
  // 2026-09-21 10:30 UTC. Local Munich time is 12:30 CEST, but the API runs on CET all year,
  // so this is 11:30 CET and the hour parameter for "now" is 12.
  const now = new Date('2026-09-21T10:30:00Z');
  const window_ = requestWindow(now, 8);
  assert.equal(window_.dateTo, '2026-09-21');
  assert.equal(window_.hourTo, 12);
  assert.equal(window_.dateFrom, '2026-09-21');
  assert.equal(window_.hourFrom, 4);
});

test('a window that reaches back over midnight asks the previous day, on a valid hour', () => {
  // 03:30 CET on the 21st, reaching eight hours back into the 20th.
  const window_ = requestWindow(new Date('2026-09-21T02:30:00Z'), 8);
  assert.equal(window_.dateTo, '2026-09-21');
  assert.equal(window_.hourTo, 4);
  assert.equal(window_.dateFrom, '2026-09-20');
  assert.equal(window_.hourFrom, 20);
  // The relay rejects anything outside 1..24, so an off-by-one here is a 400, not a wrong answer.
  for (const hour of [window_.hourFrom, window_.hourTo]) {
    assert.ok(Number.isInteger(hour) && hour >= 1 && hour <= 24, `hour ${hour} out of range`);
  }
});

// ------------------------------------------------------------------ Sensor.Community

const NOW = Date.parse('2026-09-21T12:40:00Z');

const record = (over = {}) => ({
  timestamp: '2026-09-21 12:36:01',
  sensor: { id: 7444, sensor_type: { name: 'SDS011' } },
  location: { latitude: '48.126', longitude: '11.594', indoor: 0, exact_location: 0 },
  sensordatavalues: [
    { value: '3.38', value_type: 'P1' },
    { value: '1.63', value_type: 'P2' },
  ],
  ...over,
});

test('a sensor that publishes several rows is drawn once, at its newest reading', () => {
  // ⚠️ Measured: 223 records for 104 distinct sensors. Without this, markers stack and the
  // reported count is more than double the truth.
  const sensors = parseArea([
    record({ timestamp: '2026-09-21 12:10:00', sensordatavalues: [{ value: '9.9', value_type: 'P2' }] }),
    record(),
  ], NOW, MAX_AGE_MS);
  assert.equal(sensors.length, 1);
  assert.equal(sensors[0].pm25, 1.63);
  assert.equal(sensors[0].pm10, 3.38);
});

test('indoor sensors, stale rows and non-particulate rows are excluded', () => {
  const sensors = parseArea([
    record({ sensor: { id: 1, sensor_type: { name: 'SDS011' } }, location: { latitude: '48.1', longitude: '11.5', indoor: 1, exact_location: 0 } }),
    record({ sensor: { id: 2, sensor_type: { name: 'DHT22' } }, sensordatavalues: [{ value: '18.2', value_type: 'temperature' }] }),
    record({ sensor: { id: 3, sensor_type: { name: 'SDS011' } }, timestamp: '2026-09-21 09:00:00' }),
    record({ sensor: { id: 4, sensor_type: { name: 'SDS011' } } }),
  ], NOW, MAX_AGE_MS);
  assert.deepEqual(sensors.map((s) => s.id), ['4']);
});

test('the timestamp is read as UTC, not as local time', () => {
  // ⚠️ The feed writes "2026-09-21 12:36:01" with no zone. Letting the browser read that as local
  // time shifts every reading by one or two hours and silently ages half of them out.
  const [sensor] = parseArea([record()], NOW, MAX_AGE_MS);
  assert.equal(sensor.at, Date.parse('2026-09-21T12:36:01Z'));
});

test('the blurred-location flag is carried so the panel can say the position is rounded', () => {
  const [blurred] = parseArea([record()], NOW, MAX_AGE_MS);
  assert.equal(blurred.blurred, true);
  const [exact] = parseArea([
    record({ location: { latitude: '48.126', longitude: '11.594', indoor: 0, exact_location: 1 } }),
  ], NOW, MAX_AGE_MS);
  assert.equal(exact.blurred, false);
});

test('the PM2.5 colour steps are inclusive at each breakpoint and grey when unknown', () => {
  assert.equal(colourForPm25(5), colourForPm25(0));
  assert.notEqual(colourForPm25(5.1), colourForPm25(5));
  assert.equal(colourForPm25(10), colourForPm25(5.1));
  assert.notEqual(colourForPm25(20.1), colourForPm25(20));
  assert.equal(colourForPm25(null), 0x9aa3ab);
});

test('an empty or non-numeric measurement never becomes a measured zero', () => {
  // ⚠️ `Number('')`, `Number('   ')` and `Number(false)` are all 0. A blank PM2.5 cell parsed
  // that way becomes a reading of zero, is painted in the cleanest colour, and is impossible to
  // tell apart from genuinely clean air.
  const withP2 = (raw) => parseArea([
    record({ sensordatavalues: [{ value: raw, value_type: 'P2' }, { value: '5.0', value_type: 'P1' }] }),
  ], NOW, MAX_AGE_MS)[0]?.pm25;

  assert.equal(withP2(''), null);
  assert.equal(withP2('   '), null);
  assert.equal(withP2(false), null);
  assert.equal(withP2(true), null);
  assert.equal(withP2('n/a'), null);
  assert.equal(withP2(null), null);
  // A genuine zero must still survive: it is a legitimate measurement.
  assert.equal(withP2('0'), 0);
  assert.equal(withP2('0.00'), 0);
  assert.equal(withP2(1.63), 1.63);
});

test('a station coordinate that is blank does not become 0,0 in the Gulf of Guinea', () => {
  const payload = {
    indices: STATION_INDICES,
    data: { 471: stationRow({ 'station latitude': '', 'station longitude': '  ' }) },
  };
  assert.deepEqual(parseStations(payload, 'München'), []);
});
