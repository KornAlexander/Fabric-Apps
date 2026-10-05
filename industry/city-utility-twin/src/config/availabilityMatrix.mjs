// Availability matrix: city x division -> real | synthetic | none, plus the layers that deliver it.
// config/availability.json is the only place that says which layers a city offers. This file
// checks its shape; tests/ui/availability.test.tsx checks it against the layers themselves.
// The runtime wrapper is src/config/availability.ts.

import { DIVISIONS } from './pack.mjs';

export const AVAILABILITY_MODES = Object.freeze(['real', 'synthetic', 'none']);

const TOP_KEYS = new Set(['$comment', 'cities']);
const CITY_KEYS = new Set(['divisions', 'context']);
const ENTRY_KEYS = new Set(['mode', 'source', 'layers']);
const BILINGUAL_KEYS = new Set(['de', 'en']);
const LAYER_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function known(value, keys, path, errors) {
  for (const key of Object.keys(value)) if (!keys.has(key)) errors.push(`${path}${key} is not a known property`);
}

function layerList(value, path, errors, seen) {
  if (!Array.isArray(value)) { errors.push(`${path} must be an array of layer ids`); return; }
  for (const id of value) {
    if (typeof id !== 'string' || !LAYER_ID.test(id)) { errors.push(`${path} has an invalid layer id ${JSON.stringify(id)}`); continue; }
    // ⚠️ ONE PLACE PER LAYER AND CITY. A layer listed under two divisions would be offered once
    // and counted twice, and the chip row would claim a source for a division it does not serve.
    if (seen.has(id)) errors.push(`${path} lists ${id}, which is already listed for this city`);
    seen.add(id);
  }
}

/**
 * Returns a list of problems; an empty list means the matrix is valid.
 *
 * @param {unknown} value
 * @param {readonly string[]} cities Every city (world) the app ships; each needs exactly one entry.
 */
export function validateAvailability(value, cities) {
  const errors = [];
  if (!isObject(value)) return ['availability must be an object'];
  known(value, TOP_KEYS, '', errors);
  if (!isObject(value.cities)) return [...errors, 'cities must be an object'];

  for (const city of Object.keys(value.cities)) {
    if (!cities.includes(city)) errors.push(`cities.${city} is not a city of this app`);
  }
  for (const city of cities) {
    const entry = value.cities[city];
    const path = `cities.${city}`;
    if (!isObject(entry)) { errors.push(`${path} is missing`); continue; }
    known(entry, CITY_KEYS, `${path}.`, errors);
    const seen = new Set();

    const divisions = isObject(entry.divisions) ? entry.divisions : null;
    if (!divisions) { errors.push(`${path}.divisions must be an object`); continue; }
    for (const key of Object.keys(divisions)) {
      if (!DIVISIONS.includes(key)) errors.push(`${path}.divisions.${key} is not a known division`);
    }
    // ⚠️ EVERY DIVISION, EXPLICITLY. A division left out would read as "nobody checked", which
    // is not the same statement as "there is no source here", and the chip row shows the latter.
    for (const division of DIVISIONS) {
      const cell = divisions[division];
      const cellPath = `${path}.divisions.${division}`;
      if (!isObject(cell)) { errors.push(`${cellPath} is missing`); continue; }
      known(cell, ENTRY_KEYS, `${cellPath}.`, errors);
      if (!AVAILABILITY_MODES.includes(cell.mode)) { errors.push(`${cellPath}.mode must be real, synthetic or none`); continue; }
      if (cell.mode === 'none') {
        if (cell.source !== undefined) errors.push(`${cellPath} has no source, so it must not name one`);
        if (cell.layers !== undefined && (!Array.isArray(cell.layers) || cell.layers.length > 0)) {
          errors.push(`${cellPath} has no source, so it must not list layers`);
        }
        continue;
      }
      if (!isObject(cell.source)) {
        errors.push(`${cellPath}.source must be an object with de and en`);
      } else {
        known(cell.source, BILINGUAL_KEYS, `${cellPath}.source.`, errors);
        for (const lang of ['de', 'en']) {
          if (typeof cell.source[lang] !== 'string' || !cell.source[lang].trim()) {
            errors.push(`${cellPath}.source.${lang} must be a non-empty string`);
          }
        }
      }
      if (!Array.isArray(cell.layers) || cell.layers.length === 0) {
        errors.push(`${cellPath}.layers must list at least one layer`);
      } else {
        layerList(cell.layers, `${cellPath}.layers`, errors, seen);
      }
    }
    if (entry.context !== undefined) layerList(entry.context, `${path}.context`, errors, seen);
  }
  return errors;
}

/** Throws with every problem at once, or returns the matrix unchanged. */
export function assertAvailability(value, cities) {
  const errors = validateAvailability(value, cities);
  if (errors.length) throw new Error(`Availability matrix is invalid:\n- ${errors.join('\n- ')}`);
  return value;
}
