/**
 * The guide and the questionnaire that tailors it. Content and answer
 * handling are checked as data; the views run against an in-memory store.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppRoutes } from '@/App';
import { DRAFT_KEY } from '@/components/GuidelinesSetup';
import { SECTIONS, type GuideItem, type GuideSection } from '@/guidelines/content';
import { SECTIONS_DE } from '@/guidelines/content.de';
import { MAX_TEXT, answeredGroups, cleanAnswers, defaultValue, isQuestion, progressOf, readConventions, sameAnswers, summaryText, teamAnswer, toStored } from '@/guidelines/conventions';
import { FIGURE_IDS, FIGURE_PLACES } from '@/guidelines/figureIds';
import { countRules, plainText, searchGuide, sectionsFor, textParts, tokensIn } from '@/guidelines/guide';
import { GUIDELINE_QUESTIONS, QUESTION_CATEGORIES } from '@/guidelines/questions';
import { CATEGORIES_DE, QUESTIONS_DE } from '@/guidelines/questions.de';
import { FILE_KIND, MAX_IMPORT_BYTES, STORAGE_KEY, browserStore, exportText, parseImport, readFileText, readLocal, toSaved, type ConventionsStore } from '@/guidelines/store';
import { StoreProvider } from '@/guidelines/useConventions';
import { optionLabel, questionWords } from '@/guidelines/words';
import { I18nProvider } from '@/i18n';
import { PATHS } from '@/paths';

// Every wording a drawing asks for in German and does not find is noted here.
const { missingGerman } = vi.hoisted(() => ({ missingGerman: new Set<string>() }));
vi.mock('@/guidelines/figures.de', async (original) => {
  const actual = await original<typeof import('@/guidelines/figures.de')>();
  return {
    FIGURES_DE: new Proxy(actual.FIGURES_DE, {
      get(target, key) {
        if (typeof key === 'string' && !(key in target)) missingGerman.add(key);
        return target[key as string];
      },
    }),
  };
});

// The questionnaire keeps unsaved answers for the browser tab; no test inherits another's.
beforeEach(() => window.sessionStorage.clear());

/** A store in memory, so a test can look at and change what is "in the browser". */
function memoryStore(initial?: unknown): ConventionsStore & { value: unknown } {
  const store = {
    value: initial,
    async read() {
      return store.value;
    },
    async write(value: unknown) {
      store.value = JSON.parse(JSON.stringify(value));
      return true;
    },
    available() {
      return true;
    },
  };
  return store;
}

function renderApp(path: string, options: { locale?: 'en' | 'de'; store?: ConventionsStore } = {}) {
  const store = options.store ?? memoryStore();
  render(
    <I18nProvider initialLocale={'locale' in options ? options.locale : 'en'}>
      <StoreProvider store={store}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </StoreProvider>
    </I18nProvider>
  );
  return store;
}

function everyItem(items: readonly GuideItem[]): GuideItem[] {
  return items.flatMap((item) => [item, ...everyItem(item.children ?? [])]);
}
const ALL_ITEMS = SECTIONS.flatMap((s) => s.subs.flatMap((sub) => everyItem(sub.items)));
const textsOf = (sections: GuideSection[]) => [
  ...sections.flatMap((s) => [s.title, ...s.subs.flatMap((sub) => [sub.title, sub.intro ?? '', sub.link?.label ?? ''])]),
  ...sections.flatMap((s) => s.subs.flatMap((sub) => everyItem(sub.items))).flatMap((item) => [item.title ?? '', item.text ?? '', item.link?.label ?? '']),
];
const ALL_TEXTS = textsOf(SECTIONS);

/** Everything about the guide except its words. */
function shape(sections: GuideSection[]): unknown {
  const item = (it: GuideItem): unknown => ({
    marker: it.marker,
    q: it.q,
    title: !!it.title,
    text: !!it.text,
    tokens: [...tokensIn(it.title), ...tokensIn(it.text)].sort(),
    href: it.link?.href,
    children: (it.children ?? []).map(item),
  });
  return sections.map((s) => ({ id: s.id, num: s.num, icon: s.icon, subs: s.subs.map((sub) => ({ num: sub.num, intro: !!sub.intro, href: sub.link?.href, items: sub.items.map(item) })) }));
}

describe('guideline content', () => {
  it('has three areas with unique ids and topic numbers', () => {
    expect(SECTIONS.map((s) => s.title)).toEqual(['Data Integration', 'Data Modeling', 'Data Visualization']);
    expect(SECTIONS.map((s) => s.num)).toEqual(['1', '2', '3']);
    // The style guide is the last topic of the model area, not an area of its own.
    expect(SECTIONS[1].subs[SECTIONS[1].subs.length - 1].title).toBe('Tabular Style Guide');
    expect(new Set(SECTIONS.map((s) => s.id)).size).toBe(SECTIONS.length);
    const nums = SECTIONS.flatMap((s) => s.subs.map((sub) => sub.num));
    expect(new Set(nums).size).toBe(nums.length);
    for (const s of SECTIONS) for (const sub of s.subs) expect(sub.num.startsWith(`${s.num}.`)).toBe(true);
  });

  it('refers only to questions that exist', () => {
    const referenced = [...ALL_ITEMS.flatMap((item) => (item.q ? [item.q] : [])), ...ALL_TEXTS.flatMap((text) => tokensIn(text))];
    expect(referenced.length).toBeGreaterThan(30);
    for (const qid of referenced) expect(isQuestion(qid), qid).toBe(true);
  });

  it('places every drawing once, at a topic or a rule that exists, the same in both languages', () => {
    const figures = Object.values(FIGURE_PLACES).flat();
    // Every drawing is used, and none twice.
    expect([...figures].sort()).toEqual([...FIGURE_IDS].sort());
    for (const guide of [sectionsFor('en'), sectionsFor('de')]) {
      const places = new Set(guide.flatMap((s) => s.subs.flatMap((sub) => [sub.num, ...sub.items.map((item) => item.place ?? '')])));
      for (const place of Object.keys(FIGURE_PLACES)) expect(places.has(place), place).toBe(true);
    }
    // A rule keeps its place when a search narrows the list around it.
    const found = searchGuide(sectionsFor('en'), 'nested IF', {}).flatMap((s) => s.subs.flatMap((sub) => sub.items.map((item) => item.place)));
    expect(found).toEqual(['2.6/3']);
    // Also when only something below the rule matches.
    const below = searchGuide(sectionsFor('en'), 'Outlined bar', {}).flatMap((s) => s.subs.flatMap((sub) => sub.items.map((item) => item.place)));
    expect(below).toEqual(['3.3/3']);
  });

  it('links only to https addresses', () => {
    const links = [...SECTIONS.flatMap((s) => s.subs.flatMap((sub) => (sub.link ? [sub.link] : []))), ...ALL_ITEMS.flatMap((item) => (item.link ? [item.link] : []))];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.href.startsWith('https://')).toBe(true);
  });

  it('is the same guide in German: same structure, markers, question links, drawings and addresses', () => {
    expect(shape(SECTIONS_DE)).toEqual(shape(SECTIONS));
    for (const sub of SECTIONS_DE.flatMap((s) => s.subs)) if (sub.link) expect(sub.link.label.length).toBeGreaterThan(5);
    expect(sectionsFor('de').map((s) => s.title)).toEqual(SECTIONS_DE.map((s) => s.title));
    expect(sectionsFor('en').map((s) => s.title)).toEqual(SECTIONS.map((s) => s.title));
    // Translated, not copied: the area titles differ, and most of the prose does.
    for (let i = 0; i < SECTIONS.length; i += 1) expect(SECTIONS_DE[i].title).not.toBe(SECTIONS[i].title);
    const en = textsOf(SECTIONS);
    const same = textsOf(SECTIONS_DE).filter((text, i) => text !== '' && text === en[i]);
    expect(same.length).toBeLessThan(25);
  });

  it('uses no em or en dashes in its prose, and neither do the questions', () => {
    const dash = /[–—]/;
    for (const text of [...ALL_TEXTS, ...textsOf(SECTIONS_DE)]) expect(dash.test(text), text).toBe(false);
    for (const words of Object.values(QUESTIONS_DE)) expect(dash.test([words.label, words.question, words.help ?? '', words.placeholder ?? '', ...(words.options ?? [])].join(' ')), words.label).toBe(false);
    for (const q of GUIDELINE_QUESTIONS) expect(dash.test([q.label, q.question, q.help ?? '', q.placeholder ?? '', ...(q.options ?? [])].join(' ')), q.id).toBe(false);
  });

  it('counts what says something as a rule, not a bare heading', () => {
    expect(countRules([{ marker: '', title: 'Heading', children: [{ text: 'a' }, { text: 'b' }] }])).toBe(2);
    expect(countRules([{ title: 'Create explicit measures.' }])).toBe(1);
    expect(countRules([{ title: 'Rule', text: 'with text', children: [{ text: 'detail' }] }])).toBe(2);
  });
});

describe('the question bank', () => {
  it('has fifty questions with unique ids in known groups', () => {
    expect(GUIDELINE_QUESTIONS).toHaveLength(50);
    expect(new Set(GUIDELINE_QUESTIONS.map((q) => q.id)).size).toBe(50);
    for (const q of GUIDELINE_QUESTIONS) {
      expect(QUESTION_CATEGORIES).toContain(q.category);
      if (q.type !== 'text') expect(q.options?.length ?? 0).toBeGreaterThan(1);
    }
  });
});

describe('the questions in German', () => {
  it('has words for every question, and for every choice in the same order', () => {
    expect(Object.keys(QUESTIONS_DE).sort()).toEqual(GUIDELINE_QUESTIONS.map((q) => q.id).sort());
    expect(Object.keys(CATEGORIES_DE)).toEqual([...QUESTION_CATEGORIES]);
    for (const q of GUIDELINE_QUESTIONS) {
      const de = QUESTIONS_DE[q.id];
      expect(de.options?.length ?? 0, q.id).toBe(q.options?.length ?? 0);
      expect(!!de.help, q.id).toBe(!!q.help);
      expect(de.label.length, q.id).toBeGreaterThan(0);
      expect(de.question.endsWith('?'), q.id).toBe(true);
    }
  });

  it('shows a stored English choice in German without changing what is stored', () => {
    const q = GUIDELINE_QUESTIONS.find((g) => g.id === 'hide-keys')!;
    expect(optionLabel(q, 'No', 'de')).toBe('Nein');
    expect(optionLabel(q, 'No', 'en')).toBe('No');
    expect(optionLabel(q, 'something else', 'de')).toBe('something else');
    // A few pairs by name, so a reordered list does not pass on count alone.
    const byId = (id: string) => GUIDELINE_QUESTIONS.find((g) => g.id === id)!;
    expect(optionLabel(byId('page-size'), '1280×720 (16:9, default)', 'de')).toBe('1280×720 (16:9, Standard)');
    expect(optionLabel(byId('remove-unused'), 'Ad-hoc', 'de')).toBe('Bei Gelegenheit');
    expect(optionLabel(byId('db-type-prefixes'), 'None', 'de')).toBe('Keine');
    expect(optionLabel(byId('schema-approach'), 'Snowflake allowed', 'de')).toBe('Schneeflocke erlaubt');
    expect(optionLabel(byId('fiscal-start'), 'July', 'de')).toBe('Juli');
    expect(questionWords(q, 'de').label).toBe('Schlüsselspalten ausblenden');
    const answers = cleanAnswers({ 'hide-keys': { choice: 'No' }, 'db-type-prefixes': { choices: ['FACT_', 'None'], other: 'STG_' }, 'fiscal-usage': { choice: 'Both' } });
    expect(teamAnswer(answers, 'hide-keys', 'de')).toBe('Nein');
    expect(teamAnswer(answers, 'db-type-prefixes', 'de')).toBe('FACT_, Keine, STG_');
    expect(teamAnswer(answers, 'db-type-prefixes')).toBe('FACT_, None, STG_');
    expect(answeredGroups(answers, 'de').map((g) => g.category)).toEqual(['Tabellen & Schema', 'Kalender & Zeit', 'Spalten & Schlüssel']);
    expect(progressOf(answers, 'de').byCategory[0]).toMatchObject({ category: 'Naming & General', label: 'Benennung & Allgemeines' });
    expect(summaryText(answers, 'de')).toContain('- Geschäftsjahr: Beides');
    expect(defaultValue('measure-table-name', 'de')).toBe('Measure');
    expect(defaultValue('schema-approach', 'de')).toBe('Striktes Sternschema');
  });
});

describe('stored answers are treated as untrusted', () => {
  it('keeps only known questions, offered choices and bounded text', () => {
    const cleaned = cleanAnswers({
      'naming-casing': { choice: 'PascalCase', other: '  with exceptions\u0007 ' },
      'words-spaces': { choice: 'Maybe' },
      'db-type-prefixes': { choices: ['DIM_', 'DROP TABLE', 'FACT_', 'DIM_'] },
      'object-language': { text: 'x'.repeat(MAX_TEXT + 50) },
      'measure-table-name': { text: '   ' },
      'not-a-question': { choice: 'Yes' },
      'schema-approach': 'Strict star schema',
      'has-date-dim': { choice: 'Yes', other: 'ignored, the question offers no notes' },
    });
    expect(cleaned['naming-casing']).toEqual({ choice: 'PascalCase', other: 'with exceptions' });
    expect(cleaned['words-spaces']).toBeUndefined();
    // In the order the question offers them, each once.
    expect(cleaned['db-type-prefixes']).toEqual({ choices: ['FACT_', 'DIM_'] });
    expect(cleaned['object-language'].text).toHaveLength(MAX_TEXT);
    expect(cleaned['measure-table-name']).toBeUndefined();
    expect(cleaned['not-a-question']).toBeUndefined();
    expect(cleaned['schema-approach']).toBeUndefined();
    expect(cleaned['has-date-dim']).toEqual({ choice: 'Yes' });
  });

  it('reads only the questions it knows, whatever else the stored object carries', () => {
    const hostile = JSON.parse('{"__proto__":{"choice":"Yes"},"constructor":{"choice":"Yes"},"toString":{"text":"x"},"has-date-dim":{"choice":"Yes"}}') as unknown;
    expect(cleanAnswers(hostile)).toEqual({ 'has-date-dim': { choice: 'Yes' } });
    expect(({} as Record<string, unknown>).choice).toBeUndefined();
  });

  it('drops invisible characters and never cuts a character in half', () => {
    const cleaned = cleanAnswers({ 'object-language': { text: 'Eng\u202Elish\u200B\nGerman\u2028' }, 'extra-standards': { text: '😀'.repeat(MAX_TEXT + 5) } });
    expect(cleaned['object-language'].text).toBe('English German');
    expect(Array.from(cleaned['extra-standards'].text ?? '')).toHaveLength(MAX_TEXT);
    expect(cleaned['extra-standards'].text?.endsWith('😀')).toBe(true);
  });

  it('reads anything unexpected as "nothing set"', () => {
    for (const raw of [undefined, null, true, 'text', 42, [], { answers: 'x' }, { answers: null }]) expect(readConventions(raw).answers).toEqual({});
    expect(readConventions({ answers: {}, updatedAt: 'yesterday', updatedBy: 7 })).toEqual({ answers: {} });
  });

  it('round-trips what the questionnaire stores', () => {
    const stored = toStored({ 'page-size': { choice: '1280×720 (16:9, default)' }, 'extra-standards': { text: ' Reviews before release ' } }, 'ada@x.example', new Date('2026-10-12T09:00:00Z'));
    expect(stored).toEqual({ v: 1, answers: { 'page-size': { choice: '1280×720 (16:9, default)' }, 'extra-standards': { text: 'Reviews before release' } }, updatedBy: 'ada@x.example', updatedAt: '2026-10-12T09:00:00.000Z' });
    const back = readConventions(JSON.parse(JSON.stringify(stored)));
    expect(back).toEqual({ answers: stored.answers, updatedBy: 'ada@x.example', updatedAt: '2026-10-12T09:00:00.000Z' });
    expect(sameAnswers(back.answers, { 'extra-standards': { text: 'Reviews before release  ' }, 'page-size': { choice: '1280×720 (16:9, default)' } })).toBe(true);
  });

  it('reports progress per group and lists the answers', () => {
    const answers = cleanAnswers({ 'naming-casing': { choice: 'Title Case' }, 'measure-table-name': { text: 'Kennzahlen' }, 'fiscal-start': { other: 'March' } });
    const progress = progressOf(answers);
    expect(progress).toMatchObject({ answered: 3, total: 50 });
    expect(progress.byCategory.find((c) => c.category === 'Naming & General')).toEqual({ category: 'Naming & General', label: 'Naming & General', answered: 2, total: 10 });
    expect(progress.byCategory.reduce((n, c) => n + c.total, 0)).toBe(50);
    expect(answeredGroups(answers).map((g) => g.category)).toEqual(['Naming & General', 'Calendar & Time']);
    expect(summaryText(answers)).toContain('- Measure table name: Kennzahlen');
    expect(teamAnswer(answers, 'fiscal-start')).toBe('March');
    expect(teamAnswer(answers, 'ibcs')).toBeNull();
    expect(defaultValue('measure-table-name')).toBe('Measure');
    expect(defaultValue('naming-casing')).toBe('Title Case');
  });
});

describe('filling in and searching', () => {
  const answers = cleanAnswers({ 'measure-table-name': { text: 'Kennzahlen' } });

  it('fills a text with the answer, or with the marked standard', () => {
    const text = 'Use the table "{{measure-table-name}}" and {{naming-casing}}.';
    expect(textParts(text, answers)).toEqual([
      { kind: 'text', text: 'Use the table "' },
      { kind: 'team', text: 'Kennzahlen', qid: 'measure-table-name' },
      { kind: 'text', text: '" and ' },
      { kind: 'default', text: 'Title Case', qid: 'naming-casing' },
      { kind: 'text', text: '.' },
    ]);
    expect(plainText(text, {})).toBe('Use the table "Measure" and Title Case.');
  });

  it('narrows the guide to what mentions the query, including filled-in answers', () => {
    expect(searchGuide(SECTIONS, '  ', answers)).toHaveLength(SECTIONS.length);
    const divide = searchGuide(SECTIONS, 'divide', answers);
    expect(divide.flatMap((s) => s.subs.map((sub) => sub.num))).toEqual(['2.6']);
    // A match on the topic title keeps the whole topic.
    // A match on a group inside the style guide keeps that group, not the whole topic.
    const hierarchies = searchGuide(SECTIONS, 'Hierarchies', answers);
    expect(hierarchies.flatMap((s) => s.subs.map((sub) => sub.num))).toEqual(['2.11']);
    expect(hierarchies[0].subs[0].items.map((item) => item.title)).toEqual(['Hierarchies']);
    expect(searchGuide(SECTIONS, 'Tabular Style Guide', answers).flatMap((s) => s.subs).find((sub) => sub.num === '2.11')?.items.length).toBe(9);
    expect(searchGuide(SECTIONS, 'kennzahlen', answers).flatMap((s) => s.subs.map((sub) => sub.num))).toEqual(['2.5']);
    expect(searchGuide(SECTIONS, 'kennzahlen', {})).toEqual([]);
    expect(searchGuide(SECTIONS, 'no such thing anywhere', answers)).toEqual([]);
  });
});

describe('the browser store', () => {
  it('writes, reads back and reports blocked storage', async () => {
    const store = browserStore();
    expect(store.available()).toBe(true);
    expect(await store.read()).toBeUndefined();
    const saved = toSaved({ 'naming-casing': { choice: 'PascalCase' } }, new Date('2026-10-27T09:00:00Z'));
    expect(await store.write(saved)).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '')).toEqual(saved);
    expect(readLocal(await store.read()).answers).toEqual({ 'naming-casing': { choice: 'PascalCase' } });

    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(await store.write(saved)).toBe(false);
    expect(store.available()).toBe(false);
    setItem.mockRestore();
  });

  it('reads a damaged value as something that is there and cannot be read', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');
    expect(await browserStore().read()).toBe('{not json');
    expect(readLocal('{not json').answers).toEqual({});
  });

  it('keeps no "saved by", whatever the stored value claims', () => {
    expect(toSaved({}, new Date('2026-10-27T09:00:00Z'))).not.toHaveProperty('updatedBy');
    expect(readLocal({ answers: {}, updatedBy: 'The Admin', updatedAt: '2026-10-27T09:00:00Z' })).toEqual({ answers: {}, updatedAt: '2026-10-27T09:00:00.000Z' });
  });
});

describe('an imported file is treated as untrusted', () => {
  it('round-trips what is exported', () => {
    const answers = { 'naming-casing': { choice: 'snake_case' }, 'measure-table-name': { text: 'Kennzahlen' } };
    const text = exportText(answers, new Date('2026-10-27T09:00:00Z'));
    expect(JSON.parse(text)).toMatchObject({ kind: FILE_KIND, v: 1, updatedAt: '2026-10-27T09:00:00.000Z' });
    expect(parseImport(text)).toEqual({ ok: true, conventions: { answers, updatedAt: '2026-10-27T09:00:00.000Z' } });
  });

  it("reads the Power BI Fixer's questionnaire file too", () => {
    const fixer = JSON.stringify({ answers: { 'hide-keys': { choice: 'No' } }, completed: true });
    expect(parseImport(fixer)).toEqual({ ok: true, conventions: { answers: { 'hide-keys': { choice: 'No' } } } });
  });

  it('refuses what is not a conventions file', () => {
    expect(parseImport('not json')).toEqual({ ok: false, reason: 'notJson' });
    expect(parseImport('[1,2,3]')).toEqual({ ok: false, reason: 'notJson' });
    expect(parseImport('null')).toEqual({ ok: false, reason: 'notJson' });
    expect(parseImport('{"name":"package","version":"1.0.0"}')).toEqual({ ok: false, reason: 'notJson' });
    expect(parseImport('{"answers":[]}')).toEqual({ ok: false, reason: 'notJson' });
    expect(parseImport(`{"answers":{},"pad":"${'x'.repeat(MAX_IMPORT_BYTES)}"}`)).toEqual({ ok: false, reason: 'tooLarge' });
    expect(parseImport('{"answers":{"no-such-question":{"text":"x"}}}')).toEqual({ ok: false, reason: 'empty' });
  });

  it('keeps only known questions, offered choices and bounded text from a hostile file', () => {
    const deep = JSON.parse('{"a":'.repeat(500) + '1' + '}'.repeat(500));
    const hostile = JSON.stringify({
      kind: FILE_KIND,
      v: 1,
      updatedBy: 'Your administrator',
      answers: {
        __proto__: { polluted: true },
        constructor: { text: 'x' },
        'naming-casing': { choice: 'rm -rf' },
        'hide-keys': { choice: 'No', extra: deep },
        'measure-table-name': { text: `‮evil${'y'.repeat(MAX_TEXT * 3)}` },
        'db-type-prefixes': { choices: ['DIM_', 'NOPE_', 42] },
      },
    });
    const result = parseImport(hostile);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { answers } = result.conventions;
    expect(Object.keys(answers).sort()).toEqual(['db-type-prefixes', 'hide-keys', 'measure-table-name']);
    expect(answers['hide-keys']).toEqual({ choice: 'No' });
    expect(answers['db-type-prefixes']).toEqual({ choices: ['DIM_'] });
    expect(answers['measure-table-name'].text?.startsWith('evil')).toBe(true);
    // Cut to the limit first, then the direction override is dropped.
    expect(answers['measure-table-name'].text?.length).toBeLessThanOrEqual(MAX_TEXT);
    expect(answers['measure-table-name'].text).not.toMatch(/‮/);
    expect(result.conventions).not.toHaveProperty('updatedBy');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('the guide', () => {
  it('shows the standard guide and the way to tailor it', async () => {
    renderApp(PATHS.guide);
    const nav = await screen.findByRole('navigation', { name: 'Sections of the app' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Guide', 'Team conventions']);
    expect(await screen.findByRole('heading', { level: 2, name: 'Power BI Guidelines' })).toBeInTheDocument();
    for (const section of SECTIONS) expect(screen.getByRole('heading', { level: 3, name: section.title })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Standard guidelines' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tailor to your team' })).toBeInTheDocument();
    // The drawings carry a text alternative.
    expect(screen.getByRole('img', { name: /Star schema: a fact table linked directly to four dimensions/ })).toBeInTheDocument();
    expect(screen.getAllByText('Avoid').length).toBeGreaterThan(2);
    // A drawing that belongs to a topic, and one that belongs to a rule.
    expect(screen.getByText('Three ways to connect')).toBeInTheDocument();
    expect(screen.getByText('Almost never')).toBeInTheDocument();
    expect(screen.getByText('Time with its deviations')).toBeInTheDocument();
    expect(screen.getByText('Answers stay in this browser. The app sends nothing anywhere.')).toBeInTheDocument();
  });

  it('searches the guide', async () => {
    const user = userEvent.setup();
    renderApp(PATHS.guide);
    await user.type(await screen.findByRole('searchbox', { name: 'Search the guidelines' }), 'treatas');
    expect(screen.getByText('1 topics mention this.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'DAX' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: 'Data Visualization' })).not.toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Search the guidelines' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search the guidelines' }), 'zzzz');
    expect(screen.getByText('Nothing in the guidelines mentions this.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show everything' }));
    expect(screen.getByRole('heading', { level: 3, name: 'Data Visualization' })).toBeInTheDocument();
  });

  it('shows stored conventions in the text, and ignores what does not belong there', async () => {
    const store = memoryStore({
      v: 1,
      answers: { 'measure-table-name': { text: 'Kennzahlen' }, 'hide-keys': { choice: 'No' }, ibcs: { choice: '<img src=x onerror=alert(1)>' }, 'extra-standards': { text: '<img src=x onerror=alert(1)>' } },
      updatedBy: 'Your administrator',
      updatedAt: '2026-10-12T09:00:00.000Z',
    });
    renderApp(PATHS.guide, { store });
    expect(await screen.findByRole('heading', { name: 'Tailored to your team' })).toBeInTheDocument();
    expect(screen.getByText('3 of 50 conventions are set in this browser. They are marked in the text below.')).toBeInTheDocument();
    expect(screen.getByText(/Last saved on/)).toBeInTheDocument();
    expect(screen.queryByText(/Your administrator/)).not.toBeInTheDocument();
    // In the sentence, in the field list drawing and in the summary at the end.
    expect(screen.getAllByText('Kennzahlen').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByTitle('Set by your team')).toHaveTextContent('Kennzahlen');
    const summary = screen.getByRole('region', { name: "Your team's conventions" });
    expect(within(summary).getByText('Hide key columns')).toBeInTheDocument();
    // A choice that was never offered is dropped. Free text is shown as text, never as markup.
    expect(within(summary).queryByText('IBCS standards')).not.toBeInTheDocument();
    expect(within(summary).getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('link', { name: 'Edit conventions' })).toBeInTheDocument();
  });

  it('shows the standard when the browser does not let the page read storage', async () => {
    const store = { ...memoryStore(), read: () => Promise.reject(new Error('blocked')) };
    renderApp(PATHS.guide, { store });
    expect(await screen.findByRole('heading', { name: 'Standard guidelines' })).toBeInTheDocument();
  });

  it('picks up answers saved in another tab', async () => {
    const store = memoryStore();
    renderApp(PATHS.guide, { store });
    expect(await screen.findByRole('heading', { name: 'Standard guidelines' })).toBeInTheDocument();
    store.value = toSaved({ 'hide-keys': { choice: 'No' } }, new Date('2026-10-27T09:00:00Z'));
    fireEvent(window, new StorageEvent('storage', { key: STORAGE_KEY }));
    expect(await screen.findByRole('heading', { name: 'Tailored to your team' })).toBeInTheDocument();
  });

  it('is in German from the title to the drawings when the interface is', async () => {
    const user = userEvent.setup();
    const store = memoryStore(toSaved({ 'hide-keys': { choice: 'No' } }, new Date('2026-10-12T09:00:00Z')));
    missingGerman.clear();
    renderApp(PATHS.guide, { locale: 'de', store });
    expect(await screen.findByRole('heading', { level: 2, name: 'Power BI-Leitfaden' })).toBeInTheDocument();
    for (const section of SECTIONS_DE) expect(screen.getByRole('heading', { level: 3, name: section.title })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Benennung: das Wichtigste' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: 'Data Modeling' })).not.toBeInTheDocument();
    // The drawings: words and numbers.
    expect(screen.getByRole('img', { name: /Sternschema: eine Faktentabelle, direkt mit vier Dimensionen verbunden/ })).toBeInTheDocument();
    expect(screen.getAllByText('Vermeiden').length).toBeGreaterThan(2);
    expect(screen.getAllByText('12,4').length).toBeGreaterThan(0);
    expect(screen.getByText('31.536.000')).toBeInTheDocument();
    expect(screen.getByText('Drei Arten der Verbindung')).toBeInTheDocument();
    expect(screen.getByText('1.204')).toBeInTheDocument();
    expect(screen.getByText('Mär')).toBeInTheDocument();
    expect([...missingGerman]).toEqual([]);
    // A stored English choice is shown in German.
    expect(await screen.findByText('1 von 50 Konventionen sind in diesem Browser festgelegt. Sie sind im Text unten markiert.')).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Die Konventionen Ihres Teams' });
    expect(within(summary).getByText('Schlüsselspalten ausblenden')).toBeInTheDocument();
    expect(within(summary).getByText('Nein')).toBeInTheDocument();
    // Search runs over the German text.
    await user.type(screen.getByRole('searchbox', { name: 'Leitfaden durchsuchen' }), 'Sternschema');
    expect(screen.getByRole('heading', { level: 4, name: 'Schema' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: 'Datenvisualisierung' })).not.toBeInTheDocument();
  });

  it('still renders when the browser throws on any access to storage', async () => {
    const getItem = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    renderApp(PATHS.guide, { locale: undefined, store: { ...memoryStore(), read: () => Promise.reject(new Error('blocked')) } });
    expect(await screen.findByRole('heading', { name: 'Standard guidelines' })).toBeInTheDocument();
    getItem.mockRestore();
  });

  it('switches the language from the header', async () => {
    const user = userEvent.setup();
    renderApp(PATHS.guide);
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Language' }), 'de');
    expect(await screen.findByRole('heading', { level: 2, name: 'Power BI-Leitfaden' })).toBeInTheDocument();
    expect(window.localStorage.getItem('power-bi-guidelines.locale')).toBe('de');
  });
});

describe('the questionnaire', () => {
  it('is reached from the guide', async () => {
    const user = userEvent.setup();
    renderApp(PATHS.guide);
    await user.click(await screen.findByRole('link', { name: 'Tailor to your team' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Tailor the guidelines' })).toBeInTheDocument();
  });

  it('saves answers in the browser, with when, and the guide shows them', async () => {
    const user = userEvent.setup();
    const store = renderApp(PATHS.conventions) as ReturnType<typeof memoryStore>;
    const save = await screen.findByRole('button', { name: 'Save in this browser' });
    expect(save).toBeDisabled();
    expect(screen.getByText('Nothing answered yet')).toBeInTheDocument();

    await user.click(within(screen.getByRole('group', { name: 'Which casing convention do you use for visible object names?' })).getByRole('radio', { name: 'PascalCase' }));
    await user.type(screen.getByRole('textbox', { name: 'What do you name your measure container table?' }), 'Kennzahlen');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByText('2 of 50 answered')).toBeInTheDocument();

    // Another group: several choices at once.
    await user.click(within(screen.getByRole('navigation', { name: 'Question groups' })).getByRole('button', { name: /Tables & Schema/ }));
    await user.click(screen.getByRole('checkbox', { name: 'DIM_' }));
    await user.click(screen.getByRole('checkbox', { name: 'FACT_' }));

    expect(store.value).toBeUndefined();
    await user.click(save);
    expect(await screen.findByText('Saved in this browser. The guide now shows these answers.')).toBeInTheDocument();
    expect(screen.getByText('Everything saved')).toBeInTheDocument();

    const stored = readConventions(store.value);
    expect(stored.answers).toEqual({ 'naming-casing': { choice: 'PascalCase' }, 'measure-table-name': { text: 'Kennzahlen' }, 'db-type-prefixes': { choices: ['FACT_', 'DIM_'] } });
    expect(stored.updatedBy).toBeUndefined();
    expect(Number.isNaN(Date.parse(stored.updatedAt ?? ''))).toBe(false);

    await user.click(screen.getByRole('link', { name: 'Guide' }));
    expect(await screen.findByText('3 of 50 conventions are set in this browser. They are marked in the text below.')).toBeInTheDocument();
    expect(screen.getAllByText('PascalCase').length).toBeGreaterThan(0);
  });

  it('clears one answer, discards changes and clears all', async () => {
    const user = userEvent.setup();
    const store = memoryStore(toSaved({ 'naming-casing': { choice: 'snake_case' }, 'words-spaces': { choice: 'No' } }, new Date('2026-10-01T08:00:00Z')));
    renderApp(PATHS.conventions, { store });
    await waitFor(() => expect(screen.getByRole('radio', { name: 'snake_case' })).toBeChecked());
    expect(screen.getByText(/Last saved on/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear answer: Casing convention' }));
    expect(screen.getByRole('radio', { name: 'snake_case' })).not.toBeChecked();
    expect(screen.getByText('1 of 50 answered')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByRole('radio', { name: 'snake_case' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Clear all answers' }));
    expect(screen.getByText('0 of 50 answered')).toBeInTheDocument();
    // Nothing is removed until it is saved.
    expect(readConventions(store.value).answers).toHaveProperty('naming-casing');
    await user.click(screen.getByRole('button', { name: 'Save in this browser' }));
    await waitFor(() => expect(readConventions(store.value).answers).toEqual({}));
  });

  it('does not write over answers another tab saved in the meantime', async () => {
    const user = userEvent.setup();
    const store = renderApp(PATHS.conventions) as ReturnType<typeof memoryStore>;
    await user.click(await screen.findByRole('radio', { name: 'camelCase' }));
    store.value = toSaved({ 'naming-casing': { choice: 'Title Case' } }, new Date('2026-10-12T10:00:00Z'));

    await user.click(screen.getByRole('button', { name: 'Save in this browser' }));
    expect(await screen.findByText(/Other answers were saved in another tab in the meantime/)).toBeInTheDocument();
    expect(readConventions(store.value).answers).toEqual({ 'naming-casing': { choice: 'Title Case' } });

    await user.click(screen.getByRole('button', { name: 'Load their answers' }));
    expect(screen.getByRole('radio', { name: 'Title Case' })).toBeChecked();
    expect(screen.getByText('Everything saved')).toBeInTheDocument();
  });

  it('keeps changes in the form when another tab saves, and asks before replacing its answers', async () => {
    const user = userEvent.setup();
    const store = renderApp(PATHS.conventions) as ReturnType<typeof memoryStore>;
    await user.click(await screen.findByRole('radio', { name: 'camelCase' }));
    store.value = toSaved({ 'naming-casing': { choice: 'Title Case' } }, new Date('2026-10-12T10:00:00Z'));
    fireEvent(window, new StorageEvent('storage', { key: STORAGE_KEY }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole('radio', { name: 'camelCase' })).toBeChecked();
    expect(screen.queryByText(/Your unsaved answers from before are back/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save in this browser' }));
    expect(await screen.findByText(/Other answers were saved in another tab in the meantime/)).toBeInTheDocument();
    expect(readConventions(store.value).answers).toEqual({ 'naming-casing': { choice: 'Title Case' } });
  });

  it('follows another tab when the form has no changes', async () => {
    const store = renderApp(PATHS.conventions) as ReturnType<typeof memoryStore>;
    await screen.findByRole('radio', { name: 'camelCase' });
    store.value = toSaved({ 'naming-casing': { choice: 'Title Case' } }, new Date('2026-10-12T10:00:00Z'));
    fireEvent(window, new StorageEvent('storage', { key: STORAGE_KEY }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Title Case' })).toBeChecked());
    expect(screen.getByText('Everything saved')).toBeInTheDocument();
  });

  it('can still save when the stored answers were removed or damaged', async () => {
    const user = userEvent.setup();
    const store = memoryStore(toSaved({ 'naming-casing': { choice: 'snake_case' } }, new Date('2026-10-01T08:00:00Z')));
    renderApp(PATHS.conventions, { store });
    await waitFor(() => expect(screen.getByRole('radio', { name: 'snake_case' })).toBeChecked());
    await user.click(screen.getByRole('radio', { name: 'camelCase' }));
    store.value = 'not an object';

    await user.click(screen.getByRole('button', { name: 'Save in this browser' }));
    expect(await screen.findByText(/The answers that were saved before cannot be read now/)).toBeInTheDocument();
    expect(store.value).toBe('not an object');
    expect(screen.queryByRole('button', { name: 'Load their answers' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save mine anyway' }));
    expect(await screen.findByText('Saved in this browser. The guide now shows these answers.')).toBeInTheDocument();
    expect(readConventions(store.value).answers).toEqual({ 'naming-casing': { choice: 'camelCase' } });
  });

  it('keeps unsaved answers when the guide is looked at in between', async () => {
    const user = userEvent.setup();
    const store = renderApp(PATHS.conventions) as ReturnType<typeof memoryStore>;
    await user.click(await screen.findByRole('radio', { name: 'camelCase' }));
    await user.click(screen.getByRole('link', { name: 'Guide' }));
    expect(await screen.findByRole('heading', { name: 'Standard guidelines' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Tailor to your team' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'camelCase' })).toBeChecked());
    expect(screen.getByText('Your unsaved answers from before are back in the form. They are not saved yet.')).toBeInTheDocument();
    expect(store.value).toBeUndefined();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByRole('radio', { name: 'camelCase' })).not.toBeChecked();
    expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('imports a file into the form, and saves it only when asked', async () => {
    const user = userEvent.setup();
    const store = renderApp(PATHS.conventions) as ReturnType<typeof memoryStore>;
    await screen.findByRole('button', { name: 'Save in this browser' });
    const file = new File([exportText({ 'naming-casing': { choice: 'snake_case' }, 'hide-keys': { choice: 'No' } }, new Date())], 'team.json', { type: 'application/json' });
    await user.upload(screen.getByLabelText('Choose a conventions file to import'), file);
    expect(await screen.findByText('Imported 2 answers into the form. They are not saved yet.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'snake_case' })).toBeChecked();
    expect(store.value).toBeUndefined();
    await user.click(screen.getByRole('button', { name: 'Save in this browser' }));
    expect(await screen.findByText('Saved in this browser. The guide now shows these answers.')).toBeInTheDocument();
    expect(readConventions(store.value).answers).toEqual({ 'naming-casing': { choice: 'snake_case' }, 'hide-keys': { choice: 'No' } });
  });

  it('says so when an imported file is not a conventions file, and keeps the form', async () => {
    const user = userEvent.setup();
    renderApp(PATHS.conventions);
    await user.click(await screen.findByRole('radio', { name: 'camelCase' }));
    await user.upload(screen.getByLabelText('Choose a conventions file to import'), new File(['{"name":"x"}'], 'other.json', { type: 'application/json' }));
    expect(await screen.findByText('This file is not a conventions file. Nothing was imported.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'camelCase' })).toBeChecked();
  });

  it('exports what is in the form as a file', async () => {
    const user = userEvent.setup();
    const created: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return 'blob:test';
    });
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderApp(PATHS.conventions);
    const exportButton = await screen.findByRole('button', { name: 'Export as file' });
    expect(exportButton).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'camelCase' }));
    await user.click(exportButton);
    expect(click).toHaveBeenCalledOnce();
    const file = parseImport(await readFileText(created[0]));
    expect(file).toMatchObject({ ok: true, conventions: { answers: { 'naming-casing': { choice: 'camelCase' } } } });
    click.mockRestore();
  });

  it('asks in German and stores the same English choice', async () => {
    const user = userEvent.setup();
    const store = renderApp(PATHS.conventions, { locale: 'de' }) as ReturnType<typeof memoryStore>;
    expect(await screen.findByRole('heading', { level: 2, name: 'Leitfaden zuschneiden' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'In diesem Browser speichern' })).toBeDisabled();
    expect(screen.getByText('Noch nichts beantwortet')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Benennung & Allgemeines' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('group', { name: 'Trennen Sie Wörter in sichtbaren Objektnamen durch Leerzeichen?' })).getByRole('radio', { name: 'Nein' }));
    await user.click(screen.getByRole('button', { name: 'In diesem Browser speichern' }));
    expect(await screen.findByText('In diesem Browser gespeichert. Der Leitfaden zeigt jetzt diese Antworten.')).toBeInTheDocument();
    expect(readConventions(store.value).answers).toEqual({ 'words-spaces': { choice: 'No' } });
  });

  it('says so when saving fails', async () => {
    const user = userEvent.setup();
    const store = { ...memoryStore(), write: async () => false };
    renderApp(PATHS.conventions, { store });
    await user.click(await screen.findByRole('radio', { name: 'camelCase' }));
    await user.click(screen.getByRole('button', { name: 'Save in this browser' }));
    expect(await screen.findByText(/The answers could not be saved/)).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('says so up front when the browser keeps nothing, and still lets the form be used', async () => {
    const user = userEvent.setup();
    renderApp(PATHS.conventions, { store: { ...memoryStore(), available: () => false } });
    expect(await screen.findByText(/This browser does not allow the app to keep answers/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'camelCase' }));
    expect(screen.getByRole('button', { name: 'Save in this browser' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export as file' })).toBeEnabled();
  });
});

describe('the wording', () => {
  it('has the same keys in both languages, and no em or en dashes', async () => {
    const { en, de } = await import('@/i18n');
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
    for (const text of [...Object.values(en), ...Object.values(de)]) expect(text).not.toMatch(/[–—]/);
  });
});
