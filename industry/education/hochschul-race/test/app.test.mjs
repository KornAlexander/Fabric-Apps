// Contract tests for the single-file app. No test framework — `node --test`.
//
// Two things in this app cannot fail loudly on their own and so are asserted
// here: the inlined dataset (a broken injection would render an empty race with
// no error) and the DE/EN dictionaries (a missing key puts a raw `nav.home` on
// screen, which no type checker and no smoke test would ever see).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url)).replace(/[\\/]test$/, '');
const html = readFileSync(join(root, 'index.html'), 'utf8');

// --- the inlined dataset -----------------------------------------------------

function inlinedData() {
  const start = html.indexOf('/*__HI_DATA__*/');
  assert.notEqual(start, -1, 'the /*__HI_DATA__*/ marker must exist');
  const from = html.indexOf('{', start);
  const end = html.indexOf('};', from);
  return JSON.parse(html.slice(from, end + 1));
}

test('the inlined snapshot parses and has the expected shape', () => {
  const hi = inlinedData();
  assert.ok(Array.isArray(hi.sem) && hi.sem.length === 6, 'six semesters');
  assert.equal(hi.semShort.length, hi.sem.length, 'short labels match semesters');
  assert.ok(hi.unis.length > 300, `expected >300 universities, got ${hi.unis.length}`);
  assert.ok(Object.keys(hi.blColors).length >= 16, 'a colour per federal state');
});

test('every university row carries a full series for every metric', () => {
  const hi = inlinedData();
  const n = hi.sem.length;
  for (const u of hi.unis) {
    for (const key of ['t', 'i', 'w', 'a']) {
      assert.equal(u[key]?.length, n, `${u.n}: ${key} must have ${n} values`);
      assert.ok(u[key].every(Number.isFinite), `${u.n}: ${key} must be all numbers`);
    }
  }
});

test('the race has something to animate — totals grow across the series', () => {
  const hi = inlinedData();
  const total = (j) => hi.unis.reduce((s, u) => s + u.t[j], 0);
  assert.ok(total(0) > 1e6, 'first semester has a plausible national total');
  assert.notEqual(total(0), total(hi.sem.length - 1), 'values must change over time');
});

// --- the DE/EN dictionaries --------------------------------------------------

function i18n() {
  // Evaluate the i18n IIFE against the smallest possible DOM stub.
  const block = /window\.HI_I18N = \(function\(\)\{[\s\S]*?\n\}\)\(\);/.exec(html);
  assert.ok(block, 'the i18n block must be findable');
  const win = {};
  const doc = { querySelectorAll: () => [], documentElement: {}, title: '' };
  new Function('window', 'document', 'navigator', 'localStorage', block[0])(
    win, doc, { language: 'de-DE' },
    { getItem: () => null, setItem: () => {} }
  );
  return win.HI_I18N;
}

test('the DE and EN catalogues have identical keys', () => {
  const { dict } = i18n();
  const de = Object.keys(dict.de).sort();
  const en = Object.keys(dict.en).sort();
  assert.deepEqual(en, de, 'every key must exist in both languages');
  assert.ok(de.length > 100, `expected a substantial catalogue, got ${de.length}`);
});

test('no catalogue value is empty', () => {
  const { dict } = i18n();
  for (const lang of ['de', 'en']) {
    for (const [k, v] of Object.entries(dict[lang])) {
      assert.ok(String(v).trim().length > 0, `${lang}.${k} is empty`);
    }
  }
});

test('every key the app asks for exists', () => {
  const { dict } = i18n();
  const used = new Set();
  // `t('m.' + metric)` also matches here and yields the bare prefix "m." — drop
  // those and check them by prefix below instead.
  for (const m of html.matchAll(/\bt\('([a-zA-Z0-9._]+)'/g)) {
    if (!m[1].endsWith('.')) used.add(m[1]);
  }
  for (const m of html.matchAll(/data-i18n(?:-title|-ph|-aria)?="([a-zA-Z0-9._]+)"/g)) used.add(m[1]);
  // Interpolated lookups: assert the whole family exists, not just one member.
  for (const [prefix, suffixes] of [['m.', ['t', 'a', 'i']], ['ms.', ['t', 'a', 'i']],
    ['d.', ['hs', 'bl', 'stadt']], ['dp.', ['hs', 'bl', 'stadt']]]) {
    for (const s of suffixes) used.add(prefix + s);
  }
  const missing = [...used].filter((k) => !(k in dict.de) || !(k in dict.en));
  assert.deepEqual(missing, [], `keys used but not defined: ${missing.join(', ')}`);
});

test('placeholders in a string survive translation', () => {
  const { dict } = i18n();
  for (const [k, de] of Object.entries(dict.de)) {
    const want = [...String(de).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const got = [...String(dict.en[k]).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(got, want, `${k}: EN must interpolate the same values as DE`);
  }
});

// Strings that are correctly the same in both languages. Key parity only proves
// a key exists, never that anyone translated the value — so an identical string
// has to be justified here rather than passing by default.
const SAME_BY_DESIGN = new Set([
  'live.snapshot',  // "WS 2024/25" is the label the semantic model itself uses
  'home.chip3',     // product names
  'b.intl.title', 'lg.intl', 'lg.intlPY' // "% International" reads the same either way
]);

test('German has not been left in the English catalogue', () => {
  const { dict } = i18n();
  // Proper nouns that are correct inside an English sentence.
  const allow = /Hochschul|Fresenius|FernUni|Hagen|Bundesamt|GENESIS/;
  for (const [k, v] of Object.entries(dict.en)) {
    if (!allow.test(v)) {
      assert.ok(!/[äöüßÄÖÜ]/.test(v), `en.${k} still contains German: "${v}"`);
    }
    if (SAME_BY_DESIGN.has(k)) continue;
    assert.equal(v === dict.de[k] && String(v).length > 14, false,
      `en.${k} is identical to the German string — probably untranslated`);
  }
});

// --- the live-data contract --------------------------------------------------

test('live data is opt-in — no endpoint is hard-coded', () => {
  assert.match(html, /fetch\('config\/live\.json'/, 'config is read at runtime');
  assert.doesNotMatch(html, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    'no tenant identifier may be baked into the app');
});

test('a placeholder config is rejected rather than used', () => {
  const example = JSON.parse(readFileSync(join(root, 'config', 'live.example.json'), 'utf8'));
  const fn = /const PLACEHOLDER = (\/.*\/);/.exec(html);
  assert.ok(fn, 'the placeholder guard must exist');
  const re = new Function(`return ${fn[1]}`)();
  assert.ok(re.test(example.clientId), 'the shipped example must be recognised as a placeholder');
});
