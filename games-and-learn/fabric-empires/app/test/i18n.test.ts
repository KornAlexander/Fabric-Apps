/**
 * Two languages.
 *
 * ⚠️ **The design choice being tested is that a missing translation is
 * harmless.** Translations are keyed by the English string itself, so `t()`
 * falls back to the text it was handed. That is what let a 250 string pass
 * happen ten days before a deadline without the game being broken in between,
 * and it is also the thing most likely to hide a gap: an untranslated string
 * looks exactly like a translated one until you play in German.
 *
 * So the coverage check below is not decoration. It is the only thing standing
 * between "falls back gracefully" and "half the game is quietly English".
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lang, plural, setLang, t, translatedKeys } from '../src/i18n.js';

afterEach(() => setLang('en'));

const source = (relative: string): string =>
  readFileSync(resolve(process.cwd(), `app/src/${relative}`), 'utf8');

/**
 * Every `.ts` file under `app/src`, found rather than listed.
 *
 * ⚠️ **This used to be eight filenames written out by hand**, and the list is
 * what failed. `ui/raidAlert.ts` was never on it, so the banner that names the
 * attacking faction sat there in English inside a German game and every test
 * passed: a file that calls `t()` nowhere contributes no literals, so a
 * hand-kept list cannot notice that a whole module was never translated. It is
 * the same failure as every other list in this project that was maintained in
 * two places.
 *
 * Walking the tree means a new UI file is covered the day it is written, which
 * is the only moment anybody remembers what its strings say.
 */
function appSourceFiles(dir = ''): string[] {
  const here = resolve(process.cwd(), 'app/src', dir);
  const out: string[] = [];
  for (const entry of readdirSync(here, { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...appSourceFiles(rel));
    else if (entry.name.endsWith('.ts')) out.push(rel);
  }
  return out;
}

/** Every string literal handed to `t(...)` anywhere in the app. */
function literalsPassedToT(): string[] {
  const found = new Set<string>();
  for (const file of appSourceFiles()) {
    const code = source(file);
    // t('...') and plural(n, '...', '...') with single quotes only, which is
    // the house style for these strings.
    for (const m of code.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) found.add(m[1]!);
    for (const m of code.matchAll(/\bplural\([^,]+,\s*'((?:[^'\\]|\\.)*)',\s*'((?:[^'\\]|\\.)*)'/g)) {
      found.add(m[1]!);
      found.add(m[2]!);
    }
  }
  return [...found];
}

describe('the switch', () => {
  it('starts in one of the two languages', () => {
    expect(['en', 'de']).toContain(lang());
  });

  it('changes what comes back', () => {
    setLang('en');
    expect(t('End turn')).toBe('End turn');
    setLang('de');
    expect(t('End turn')).toBe('Zug beenden');
  });

  it('⚠️ falls back to English rather than to a broken key', () => {
    setLang('de');
    const nonsense = 'A sentence nobody has translated yet.';
    expect(t(nonsense)).toBe(nonsense);
  });

  it('fills placeholders in both languages', () => {
    setLang('en');
    expect(t('Turn {n}', { n: 7 })).toBe('Turn 7');
    setLang('de');
    expect(t('Turn {n}', { n: 7 })).toBe('Runde 7');
  });

  it('leaves an unknown placeholder alone instead of printing undefined', () => {
    expect(t('Turn {n}', {})).toBe('Turn {n}');
  });

  it('picks singular and plural before translating', () => {
    setLang('de');
    expect(plural(1, '{n} more citizen', '{n} more citizens')).toBe('1 Einwohner mehr');
    expect(plural(3, '{n} more citizen', '{n} more citizens')).toBe('3 Einwohner mehr');
  });
});

describe('⚠️ coverage', () => {
  it('translates every string the app asks it to translate', () => {
    const asked = literalsPassedToT();
    const known = new Set(translatedKeys());
    const missing = asked.filter((s) => !known.has(s)).sort();

    expect(asked.length, 'no t() calls found, the scan must be broken').toBeGreaterThan(40);
    expect(
      missing,
      `${missing.length} strings reach t() with no German behind them`,
    ).toEqual([]);
  });

  it('has no German entry that is just the English again', () => {
    /*
     * A few are legitimately identical, and they are listed here so that
     * adding a new one is a decision rather than an oversight. "Land",
     * "Standard" and "Pause" really are the same word in German; the rest are
     * product terms that must not be translated at all.
     *
     * "Cheat" is a loanword German gamers use unchanged, and the message it
     * carries is the cheat console's own English output. Forcing a German
     * word here would be a worse label, not a better one.
     */
    const allowed = new Set(['Standard', 'Land', 'Pause', 'Data', 'DAX', 'Cheat: {message}']);
    setLang('de');
    const lazy = translatedKeys().filter((k) => !allowed.has(k) && t(k) === k);
    expect(lazy, 'these look untranslated').toEqual([]);
  });

  it('⚠️ writes no untranslated prose straight to the DOM', () => {
    /*
     * The gap every other test in this file was blind to.
     *
     * Everything above checks strings that were handed to `t()`. A string
     * assigned straight to `textContent` never reaches `t()`, contributes no
     * key, and is therefore invisible: `ui/endScreen.ts` and
     * `ui/questionModal.ts` between them put an entire victory screen and the
     * most-used screen in the game on display in English, inside a German
     * game, with every test green.
     *
     * So this looks for the opposite of a translation: prose going to the DOM
     * on a line that never mentions `t(`. Two words of three or more letters
     * is the test for prose, which lets ids, class names and single product
     * words through.
     */
    const assign = /\.(textContent|innerText|placeholder)\s*=\s*(['"`])(.+?)\2/gs;
    const prose = /[A-Za-z]{3,}\s+[A-Za-z]{3,}/;

    /*
     * Names, not sentences. The game's own title is the same in both
     * languages, and a campaign blurb is content that arrives already written
     * in the language of its own course.
     */
    const allowed = new Set(['Fabric Empires']);

    const offenders: string[] = [];
    for (const file of appSourceFiles()) {
      const code = source(file);
      for (const m of code.matchAll(assign)) {
        const text = m[3]!.trim();
        if (!prose.test(text) || allowed.has(text)) continue;
        // Interpolations of already-translated values are fine.
        if (text.includes('${')) continue;
        const lineStart = code.lastIndexOf('\n', m.index!) + 1;
        const lineEnd = code.indexOf('\n', m.index! + m[0].length);
        const line = code.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
        if (line.includes('t(')) continue;
        offenders.push(`${file}: ${text.slice(0, 60)}`);
      }
    }
    expect(offenders, 'these reach the screen without being translated').toEqual([]);
  });

  it('⚠️ never logs a bare template literal', () => {
    /*
     * The gap the test above was blind to, in its turn.
     *
     * That one skips any string containing `${`, on the reasonable grounds
     * that an interpolation is usually an already-translated value being
     * placed. The unreasonable consequence is that a whole sentence written
     * as a template literal is exempt, and `log()` does not touch the DOM
     * directly so nothing else looked at it either.
     *
     * Fifteen log lines were sitting in English inside a German game because
     * of it, including the one that reports a failed review and the one that
     * greets a returning player. They were found by reading a screenshot,
     * which is not a repeatable technique.
     *
     * A sentence with holes in it is still a sentence: it belongs in `t()`
     * with named parameters, so the German can put the holes somewhere else.
     */
    const offenders: string[] = [];
    for (const file of appSourceFiles()) {
      source(file).split(/\r?\n/).forEach((line, i) => {
        if (!/\b(log|adopt)\(/.test(line)) return;
        if (!line.includes('`')) return;
        // `t(` anywhere on the line means the sentence went through the
        // translator; the backtick is then just how a value was built.
        if (/\bt\(/.test(line)) return;
        offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 72)}`);
      });
    }

    expect(offenders, [
      'A log line written as a template literal never reaches t(), so it stays',
      'English in a German game. Use t() with named parameters instead.',
      '',
      ...offenders,
    ].join('\n')).toEqual([]);
  });

  it('⚠️ leaves the exam vocabulary in English', () => {
    /*
     * The DP-600 paper is sat in English and its terminology is the subject.
     * Somebody who revises a translated "Direktsee" has learned a word that
     * will not appear on it. Product names are not words.
     */
    setLang('de');
    for (const term of ['Compute', 'Lakehouse', 'Direct Lake', 'Workspace']) {
      expect(t(term), `${term} must not be translated`).toBe(term);
    }
  });
});

describe('German text quality', () => {
  it('uses real umlauts and eszett, never ae oe ue ss', () => {
    setLang('de');
    // If a translation had been typed with ASCII replacements this catches it:
    // every one of these is a word that must contain a real umlaut.
    expect(t('Cities')).toBe('Städte');
    expect(t('Size')).toBe('Größe');
    expect(t('Skip')).toBe('Überspringen');
  });

  it('never uses an em dash or en dash', () => {
    // House rule, and it applies to generated interface text too.
    const offenders = translatedKeys().filter((k) => /[—–]/.test(t(k)));
    expect(offenders).toEqual([]);
  });
});
