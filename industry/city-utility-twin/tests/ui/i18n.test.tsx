import { act, cleanup, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { resolveLanguage } from '../../src/i18n/language';
import { MESSAGES } from '../../src/i18n/messages';
import { later, setLanguage, show } from '../../src/i18n';
import { WFS_LAYERS } from '../../src/live/wfsCatalogue';
import { SITES } from '../../src/config/world';
import { describeError, TextError } from '../../src/live/source';
import { Attribution } from '../../src/ui/Attribution';
import { inheritedName } from '../../tools/map-assets.mjs';

describe('resolveLanguage', () => {
  const base = { search: '', stored: null, preferred: [] as string[] };

  it('lets ?lang= win over everything', () => {
    expect(resolveLanguage({ search: '?lang=en', stored: 'de', preferred: ['de-DE'] })).toBe('en');
    expect(resolveLanguage({ search: '?ort=munich&lang=DE', stored: 'en', preferred: ['en-US'] })).toBe('de');
  });

  it('ignores an unknown ?lang= and falls through to the remembered choice', () => {
    expect(resolveLanguage({ ...base, search: '?lang=fr', stored: 'en', preferred: ['de-DE'] })).toBe('en');
  });

  it('uses only the FIRST browser preference: German first is German, anything else first is English', () => {
    expect(resolveLanguage({ ...base, preferred: ['de-AT', 'en'] })).toBe('de');
    expect(resolveLanguage({ ...base, preferred: ['en-US', 'de-DE'] })).toBe('en');
    expect(resolveLanguage({ ...base, preferred: ['fr-FR', 'de'] })).toBe('en');
  });

  it('falls back to German when the browser states nothing', () => {
    expect(resolveLanguage(base)).toBe('de');
    expect(resolveLanguage({ ...base, preferred: [''] })).toBe('de');
  });
});

describe('message table', () => {
  const entries = Object.entries(MESSAGES) as [string, { de: (...a: unknown[]) => string; en: (...a: unknown[]) => string }][];
  const sample = (fn: (...a: unknown[]) => string) => fn(...Array.from({ length: fn.length }, () => 3));

  it('has a non-empty German and English text for every key', () => {
    for (const [key, entry] of entries) {
      expect(sample(entry.de), `${key} de`).not.toBe('');
      expect(sample(entry.en), `${key} en`).not.toBe('');
      expect(sample(entry.en), `${key} en`).not.toContain('undefined');
    }
  });

  // The asset gate rejects words inherited from the app this one was forked from; English
  // translations are the easiest place to reintroduce one ("timetable", "schedule").
  it('introduces no word the asset gate rejects', () => {
    for (const [key, entry] of entries) {
      expect(inheritedName.test(sample(entry.en)), `${key} en`).toBe(false);
      expect(inheritedName.test(sample(entry.de)), `${key} de`).toBe(false);
    }
  });

  it('uses no em or en dash in English app text', () => {
    for (const [key, entry] of entries) {
      expect(sample(entry.en), key).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

// Labels kept next to their data (catalogue entries, sites) are app text too; the table tests
// above cannot see them, so they are resolved in both languages here.
describe('bilingual configuration labels', () => {
  const texts = (): string[] => [
    ...WFS_LAYERS.flatMap((spec) => [
      show(spec.label), show(spec.group), ...(spec.unit ? [show(spec.unit)] : []),
      ...(spec.fields ?? []).map((field) => show(field.label)),
    ]),
    ...SITES.flatMap((site) => [show(site.name), show(site.subtitle)]),
  ];

  it('resolves to different, gate-clean text in German and English', () => {
    act(() => setLanguage('de'));
    const german = texts();
    act(() => setLanguage('en'));
    const english = texts();
    expect(english).toHaveLength(german.length);
    // Pair by pair: one label left untranslated must fail, not hide among the others.
    german.forEach((value, index) => expect(english[index], value).not.toBe(value));
    for (const value of [...german, ...english]) {
      expect(value.length).toBeGreaterThan(0);
      expect(inheritedName.test(value), value).toBe(false);
    }
    for (const value of english) expect(value, value).not.toMatch(/[\u2013\u2014]/);
    act(() => setLanguage('de'));
  });

  it('renders English attribution prose without gate words or dashes outside the licensors\' verbatim lines', () => {
    act(() => setLanguage('en'));
    const { container } = render(<Attribution />);
    const prose = [...container.querySelectorAll('p')]
      .map((p) => p.textContent ?? '')
      .filter((line) => !line.startsWith('Datenquelle: Bayerische') && !line.startsWith('produced using Copernicus'));
    expect(prose.length).toBeGreaterThan(5);
    for (const line of prose) {
      expect(inheritedName.test(line), line.slice(0, 40)).toBe(false);
      expect(line, line.slice(0, 40)).not.toMatch(/[\u2013\u2014]/);
    }
    cleanup();
    act(() => setLanguage('de'));
  });

  it('words an error from a TextError in the language current when it is shown', () => {
    act(() => setLanguage('de'));
    const error = new TextError(later('error.tooLarge'));
    expect(describeError(error)).toBe('Antwort zu groß');
    act(() => setLanguage('en'));
    expect(describeError(error)).toBe('response too large');
    act(() => setLanguage('de'));
  });
});
