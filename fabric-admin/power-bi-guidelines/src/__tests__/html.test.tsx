/**
 * The plain HTML files: the same guide as the app, one file, nothing that
 * runs or loads from anywhere.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AppRoutes } from '@/App';
import { SECTIONS } from '@/guidelines/content';
import { SECTIONS_DE } from '@/guidelines/content.de';
import { FIGURE_IDS } from '@/guidelines/figureIds';
import { StoreProvider } from '@/guidelines/useConventions';
import { HTML_LOCALES, htmlFileName, renderDocument } from '@/html/render';
import { I18nProvider } from '@/i18n';
import { PATHS } from '@/paths';

const CSS = '.text-blue-700{color:blue}';
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

describe('the plain HTML files', () => {
  it('are a whole document with the styles inline and no script', () => {
    for (const locale of HTML_LOCALES) {
      const html = renderDocument(locale, CSS, '0.1.0');
      expect(html.startsWith('<!doctype html>\n<html lang="' + locale + '">')).toBe(true);
      expect(html).toContain(`<style>${CSS}`);
      expect(html).toContain('@media print');
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/<link\b/i);
      expect(html).not.toMatch(/\son[a-z]+=/i);
      // Nothing is loaded: the only addresses are anchors in the page and links readers follow.
      expect(html).not.toMatch(/\ssrc=/i);
      for (const [, href] of html.matchAll(/href="([^"]*)"/g)) expect(href.startsWith('#') || href.startsWith('https://'), href).toBe(true);
      expect(html).not.toContain('http://');
    }
  });

  it('carry every area and topic, in their own language, with a working table of contents', () => {
    const en = renderDocument('en', CSS, '0.1.0');
    const de = renderDocument('de', CSS, '0.1.0');
    for (const [html, sections] of [
      [en, SECTIONS],
      [de, SECTIONS_DE],
    ] as const) {
      for (const section of sections) {
        expect(html).toContain(escape(section.title));
        expect(html).toContain(`id="guideline-${section.id}"`);
        expect(html).toContain(`href="#guideline-${section.id}"`);
        for (const sub of section.subs) {
          expect(html).toContain(escape(sub.title));
          const id = `topic-${sub.num.replace(/\./g, '-')}`;
          expect(html).toContain(`id="${id}"`);
          expect(html).toContain(`href="#${id}"`);
        }
      }
    }
    // A German topic title that differs from the English one does not appear in the English file, and the other way round.
    const pairs = SECTIONS.flatMap((s, i) => s.subs.map((sub, j) => [sub.title, SECTIONS_DE[i].subs[j].title] as const)).filter(([a, b]) => a !== b);
    expect(pairs.length).toBeGreaterThan(5);
    for (const [english, german] of pairs) {
      expect(de).not.toContain(`>${escape(english)}<`);
      expect(en).not.toContain(`>${escape(german)}<`);
    }
    expect(en).toContain('<title>Power BI Guidelines</title>');
    expect(de).toContain('<title>Power BI-Leitfaden</title>');
  });

  it('carry every drawing, with its text alternative', () => {
    const html = renderDocument('en', CSS, '0.1.0');
    const drawings = html.match(/role="img"/g) ?? [];
    // The drawings plus the meters in the header.
    expect(drawings.length).toBeGreaterThanOrEqual(FIGURE_IDS.length);
    expect(html).toMatch(/aria-label="Star schema: a fact table linked directly to four dimensions/);
  });

  it('have a document outline: one h1, areas as h2, topics as h3', () => {
    const html = renderDocument('en', CSS, '0.1.0');
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain('<h2 id="guideline-integration-title"'.replace('integration', SECTIONS[0].id));
    expect((html.match(/<h3 class="text-base font-semibold text-slate-900">/g) ?? []).length).toBe(SECTIONS.reduce((n, s) => n + s.subs.length, 0));
    expect(html).not.toMatch(/<h4[ >]/);
  });

  it('show standard values marked as standard, and no team answers', () => {
    const html = renderDocument('en', CSS, '0.1.0');
    expect(html).toContain('title="Standard. Your team has not set this."');
    expect(html).not.toContain('title="Set by your team"');
    expect(html).not.toContain('Your team: ');
  });

  it('have no em or en dashes, and are the same bytes every time', () => {
    for (const locale of HTML_LOCALES) {
      const html = renderDocument(locale, CSS, '0.1.0');
      expect(html).not.toMatch(/[–—]/);
      expect(renderDocument(locale, CSS, '0.1.0')).toBe(html);
    }
  });

  it('cannot be broken out of by the stylesheet', () => {
    const html = renderDocument('en', 'a{}</style><script>alert(1)</script>', '0.1.0');
    // The style element ends exactly once, where the document ends it; the text before stays style text.
    expect(html.match(/<\/style>/gi)).toHaveLength(1);
    expect(html.split(/<\/style>/i)[1]).not.toMatch(/<script/i);
  });

  it('are offered from the app header in the language of the interface', async () => {
    for (const locale of HTML_LOCALES) {
      const { unmount } = render(
        <I18nProvider initialLocale={locale}>
          <StoreProvider store={{ read: async () => undefined, write: async () => true, available: () => true }}>
            <MemoryRouter initialEntries={[PATHS.guide]}>
              <AppRoutes />
            </MemoryRouter>
          </StoreProvider>
        </I18nProvider>
      );
      const link = await screen.findByRole('link', { name: locale === 'de' ? 'Einfaches HTML' : 'Plain HTML' });
      expect(link).toHaveAttribute('href', `./${htmlFileName(locale)}`);
      expect(link).toHaveAttribute('target', '_blank');
      unmount();
    }
  });
});
