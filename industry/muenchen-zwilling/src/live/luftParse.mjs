/**
 * Pure parsing for the two air-quality sources.
 *
 * ⚠️ PLAIN `.mjs` ON PURPOSE, exactly like `src/geo/utm32.mjs`. These functions carry the parts
 * of the layers that are worth testing — every one of them encodes a trap that was hit against
 * the live services and that fails silently in a 3D scene. Node's test runner can import a
 * `.mjs` module directly; importing a `.ts` module would need explicit `.ts` specifiers, which
 * `tsc` then refuses. Keeping the logic here means it is testable without a browser, without a
 * network and without a build step.
 *
 * Nothing in this file may invent a value. A missing measurement returns null and the caller
 * says so; it never becomes a zero, a default or a carried-forward reading.
 */

/**
 * @typedef {object} Station
 * @property {string} id
 * @property {string} name
 * @property {string} city
 * @property {number} lat
 * @property {number} lon
 * @property {string} setting
 * @property {string} type
 * @property {string} street
 */

/**
 * @typedef {object} ComponentMeta
 * @property {string} symbol
 * @property {string} unit
 * @property {string} name
 */

/**
 * @typedef {object} Reading
 * @property {string} start
 * @property {string} end
 * @property {number|null} totalIndex
 * @property {boolean} incomplete True when the source flags the hour's data as incomplete.
 * @property {{ componentId: string, value: number, index: number|null }[]} values
 */

/**
 * @typedef {object} CitizenSensor
 * @property {string} id
 * @property {number} lat
 * @property {number} lon
 * @property {number} at
 * @property {string} timestamp
 * @property {string} model
 * @property {number|null} pm10
 * @property {number|null} pm25
 * @property {boolean} blurred
 */

/**
 * A measured number, or null.
 *
 * ⚠️ STRICT ON PURPOSE. A bare `Number(value)` turns `''`, `'   '` and `false` into **0** and
 * `true` into 1. For a feed of concentrations that is the worst possible failure mode: an empty
 * PM2.5 cell becomes a measured zero, gets the cleanest colour on the map, and is indistinguishable
 * from a real reading of nothing in the air. Only a genuine number, or a non-empty string that is
 * entirely numeric, is accepted. A real zero still parses as zero.
 *
 * @param {unknown} value @returns {number|null}
 */
function numberOrNull(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Read a self-describing table by COLUMN NAME rather than by position.
 *
 * ⚠️ Reading by name means a column inserted upstream cannot silently shift latitude into the
 * longitude slot. That failure does not throw; it puts every station in the North Sea, which
 * looks like a projection bug and costs hours.
 *
 * @param {unknown} indices
 * @returns {(row: unknown[], column: string) => string|null}
 */
export function columnReader(indices) {
  const names = Array.isArray(indices) ? indices.map((value) => String(value)) : [];
  return (row, column) => {
    const at = names.indexOf(column);
    if (at < 0 || !Array.isArray(row) || at >= row.length) return null;
    const value = row[at];
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    // ⚠️ The API sends the STRING "null" for an empty cell, not JSON null. An emptiness check
    // that only tests for nullish keeps every retired station in the list.
    return text.length === 0 || text === 'null' ? null : text;
  };
}

/**
 * Does this station's `station city` name the city we are mapping?
 *
 * ⚠️ NOT AN EQUALITY TEST, AND THAT COST A STATION. Measured 2026-09-21: four Munich stations
 * carry the city `"München"`, but station 523 carries `"München, Stadtteil Johanneskirchen"`.
 * An `=== 'München'` filter drops it without any error, and the layer reports four stations as
 * though four were all there is.
 *
 * The comma is required rather than using a prefix test, so that a different town whose name
 * merely begins the same way cannot be pulled onto the map.
 *
 * @param {string|null} value
 * @param {string} city
 */
function matchesCity(value, city) {
  if (value === null) return false;
  return value === city || value.startsWith(`${city},`);
}

/**
 * Active stations of one city, from `/stations/json`.
 *
 * ⚠️ Rows are nested under `data` here. `/components/json` does it differently; see below.
 *
 * @param {{ indices?: unknown, data?: Record<string, unknown> }} payload
 * @param {string} city
 * @returns {Station[]}
 */
export function parseStations(payload, city) {
  const read = columnReader(payload?.indices);
  const rows = payload?.data ?? {};
  /** @type {Station[]} */
  const stations = [];
  for (const [id, row] of Object.entries(rows)) {
    if (!Array.isArray(row)) continue;
    if (!matchesCity(read(row, 'station city'), city)) continue;
    // A station with an "active to" date has been retired; its last reading is history.
    if (read(row, 'station active to') !== null) continue;
    const lat = numberOrNull(read(row, 'station latitude'));
    const lon = numberOrNull(read(row, 'station longitude'));
    if (lat === null || lon === null) continue;
    const street = read(row, 'station street');
    const streetNr = read(row, 'station street nr');
    stations.push({
      id,
      name: read(row, 'station name') ?? id,
      city,
      lat,
      lon,
      setting: read(row, 'station setting name') ?? '',
      type: read(row, 'station type name') ?? '',
      street: [street, streetNr].filter(Boolean).join(' '),
    });
  }
  return stations.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/**
 * The component dictionary, from `/components/json`.
 *
 * ⚠️ THIS ENDPOINT PUTS ITS ROWS AT THE TOP LEVEL, next to `indices`, rather than under `data`.
 * Two conventions in one API. Iterating the object without filtering for numeric keys turns the
 * `indices` array itself into a bogus component.
 *
 * @param {Record<string, unknown>} payload
 * @returns {Map<string, ComponentMeta>}
 */
export function parseComponents(payload) {
  const read = columnReader(payload?.indices);
  /** @type {Map<string, ComponentMeta>} */
  const meta = new Map();
  for (const [key, row] of Object.entries(payload ?? {})) {
    if (!/^\d+$/.test(key) || !Array.isArray(row)) continue;
    meta.set(key, {
      symbol: read(row, 'component symbol') ?? key,
      unit: read(row, 'component unit') ?? '',
      name: read(row, 'component name') ?? '',
    });
  }
  return meta;
}

/**
 * The newest hour published for a station, or null when the window came back empty.
 *
 * Row shape, read from the response's own `indices`:
 * `[date end (CET), total index, data incomplete, [component id, value, index, y-value], ...]`
 *
 * ⚠️ FIELD 2 IS "DATA INCOMPLETE", NOT "DATA COMPLETE", AND READING IT THE WRONG WAY ROUND
 * INVERTS A WARNING SHOWN TO THE PUBLIC. The response's `indices` names it literally. Measured
 * over a week at the five Munich stations: 328 hours flagged 0 and 577 flagged 1, so it varies
 * and does carry information. It also tracks what a station actually measures — 471 and 535
 * report components 1, 5 and 9 with no ozone, while 473 and 523 add component 3 — which is
 * consistent with the flag meaning "the index could not be formed from the full component set"
 * rather than "this hour is still being assembled".
 *
 * @param {{ data?: Record<string, Record<string, unknown>> }} payload
 * @param {string} stationId
 * @returns {Reading|null}
 */
export function newestReading(payload, stationId) {
  const byTime = payload?.data?.[stationId];
  if (!byTime || typeof byTime !== 'object') return null;
  // Timestamps are fixed-width `YYYY-MM-DD HH:MM:SS`, so lexical order is chronological order.
  const starts = Object.keys(byTime).sort();
  const start = starts[starts.length - 1];
  if (!start) return null;
  const row = byTime[start];
  if (!Array.isArray(row)) return null;

  /** @type {Reading['values']} */
  const values = [];
  for (const entry of row.slice(3)) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const value = numberOrNull(entry[1]);
    if (value === null) continue;
    values.push({ componentId: String(entry[0]), value, index: numberOrNull(entry[2]) });
  }
  return {
    start,
    end: String(row[0] ?? ''),
    totalIndex: numberOrNull(row[1]),
    // Reported as the source names it. `true` means the source says the data is INCOMPLETE.
    incomplete: numberOrNull(row[2]) === 1,
    values,
  };
}

/**
 * The request window, in the API's own clock.
 *
 * ⚠️ THE API RUNS ON CET ALL YEAR, NOT ON LOCAL TIME, and it counts hours 1..24 rather than
 * 0..23, where hour H means the interval ENDING at H:00. Measured 2026-09-21: at 11:00 local
 * (CEST, UTC+2) the newest published interval was labelled `09:00:00`. Treating the parameter as
 * a local 0..23 hour asks for the wrong window and, near midnight, for the wrong day.
 *
 * A generous window is requested and the newest entry taken, rather than guessing exactly which
 * hour is published. Publication lags, and asking for a single hour means an empty answer
 * whenever it lags a little more than usual.
 *
 * @param {Date} now
 * @param {number} hoursBack
 * @returns {{ dateFrom: string, hourFrom: number, dateTo: string, hourTo: number }}
 */
export function requestWindow(now, hoursBack) {
  const asParam = (instant) => {
    // Shift into CET, then read UTC fields, so no local timezone is involved anywhere.
    const cet = new Date(instant.getTime() + 60 * 60 * 1000);
    return { date: cet.toISOString().slice(0, 10), hour: cet.getUTCHours() + 1 };
  };
  const from = asParam(new Date(now.getTime() - hoursBack * 60 * 60 * 1000));
  const to = asParam(now);
  return { dateFrom: from.date, hourFrom: from.hour, dateTo: to.date, hourTo: to.hour };
}

// ------------------------------------------------------------------ Sensor.Community

/**
 * Colour breakpoints in µg/m³ PM2.5.
 *
 * ⚠️ THE APP'S OWN SCALE, AND THE NUMBERS ARE SHOWN SO IT CAN BE CHECKED. This is not an
 * official classification: the layer deliberately does not dress uncalibrated citizen readings
 * in the wording of a regulatory limit value. The legend prints these breakpoints and the panel
 * always shows the measured number, so nobody has to trust the colour.
 */
export const PM25_STEPS = [
  { upTo: 5, colour: 0x2e9e5b },
  { upTo: 10, colour: 0x9ccb3b },
  { upTo: 20, colour: 0xf2c230 },
  { upTo: 40, colour: 0xff0000 },
  { upTo: Infinity, colour: 0x8a0033 },
];

export const UNKNOWN_COLOUR = 0x9aa3ab;

/** @param {number|null} value @returns {number} */
export function colourForPm25(value) {
  if (value === null) return UNKNOWN_COLOUR;
  for (const step of PM25_STEPS) if (value <= step.upTo) return step.colour;
  return UNKNOWN_COLOUR;
}

/**
 * Parse one area response into at most one current record per sensor.
 *
 * ⚠️ THE FEED REPEATS A SENSOR. Measured 2026-09-21: 223 records for 104 distinct sensors in the
 * city area, because each sensor publishes several rows. Drawing them all stacks markers and
 * inflates the reported count by more than double.
 *
 * @param {unknown} payload
 * @param {number} now Epoch milliseconds.
 * @param {number} maxAgeMs
 * @returns {CitizenSensor[]}
 */
export function parseArea(payload, now, maxAgeMs) {
  if (!Array.isArray(payload)) return [];
  /** @type {Map<string, CitizenSensor>} */
  const newest = new Map();

  for (const record of payload) {
    const location = record?.location;
    if (!location) continue;
    // An indoor reading is not outdoor air. The feed says which is which.
    if (Number(location.indoor) === 1) continue;

    const lat = numberOrNull(location.latitude);
    const lon = numberOrNull(location.longitude);
    const id = record?.sensor?.id;
    if (lat === null || lon === null || id === null || id === undefined) continue;

    let pm10 = null;
    let pm25 = null;
    for (const entry of record.sensordatavalues ?? []) {
      // P1 is PM10 and P2 is PM2.5 in this feed's vocabulary.
      if (entry?.value_type === 'P1') pm10 = numberOrNull(entry.value);
      if (entry?.value_type === 'P2') pm25 = numberOrNull(entry.value);
    }
    // A record without particulate values is a temperature, humidity or noise row.
    if (pm10 === null && pm25 === null) continue;

    const timestamp = String(record.timestamp ?? '');
    // ⚠️ The feed stamps in UTC WITHOUT a zone marker. Letting the browser read that as local
    // time shifts every reading by an hour or two and silently ages half of them out.
    const at = Date.parse(`${timestamp.replace(' ', 'T')}Z`);
    if (!Number.isFinite(at)) continue;
    if (now - at > maxAgeMs) continue;

    const key = String(id);
    const existing = newest.get(key);
    if (existing && existing.at >= at) continue;

    newest.set(key, {
      id: key,
      lat,
      lon,
      at,
      timestamp,
      model: String(record.sensor?.sensor_type?.name ?? '').trim(),
      pm10,
      pm25,
      // `exact_location: 0` means the source rounded the coordinate for privacy.
      blurred: Number(location.exact_location) !== 1,
    });
  }
  return [...newest.values()];
}
