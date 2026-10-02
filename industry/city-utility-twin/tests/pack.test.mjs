import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DIVISIONS, assertPack, validatePack } from '../src/config/pack.mjs';

const generic = JSON.parse(readFileSync(new URL('../config/packs/generic.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(generic);

test('the shipped generic pack is valid and enables all eight divisions', () => {
  assert.deepEqual(validatePack(generic), []);
  assert.deepEqual(Object.keys(generic.divisions).sort(), [...DIVISIONS].sort());
  assert.ok(Object.values(generic.divisions).every(Boolean));
});

test('the default city must exist and be ready', () => {
  const missing = clone(); missing.defaultCity = 'atlantis';
  assert.match(validatePack(missing).join('\n'), /defaultCity must be one of/);
  const planned = clone(); planned.defaultCity = 'hamburg';
  assert.match(validatePack(planned).join('\n'), /defaultCity must be ready/);
});

test('unknown divisions, empty division sets and bad colours are rejected', () => {
  const unknown = clone(); unknown.divisions.teleport = true;
  assert.match(validatePack(unknown).join('\n'), /divisions\.teleport is not a known division/);
  const none = clone(); for (const k of Object.keys(none.divisions)) none.divisions[k] = false;
  assert.match(validatePack(none).join('\n'), /at least one division/);
  const colour = clone(); colour.brand.colors.accent = 'red';
  assert.match(validatePack(colour).join('\n'), /brand\.colors\.accent must be #RRGGBB/);
});

test('texts must be bilingual and duplicate cities are caught', () => {
  const mono = clone(); delete mono.texts.tagline.en;
  assert.match(validatePack(mono).join('\n'), /texts\.tagline\.en/);
  const dup = clone(); dup.cities.push({ ...dup.cities[0] });
  assert.match(validatePack(dup).join('\n'), /duplicated/);
});

test('assertPack throws with every problem listed', () => {
  const broken = clone(); broken.id = 'Not Kebab'; broken.agent.language = 'fr';
  assert.throws(() => assertPack(broken), /id must be kebab-case[\s\S]*agent\.language/);
});
