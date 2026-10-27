/**
 * One plain HTML document of the guide: the page as static markup, the
 * app's compiled styles inlined, nothing loaded from anywhere.
 */
import { renderToStaticMarkup } from 'react-dom/server';

import { translate, type Locale, type TranslationKey } from '@/i18n';

import { StaticGuide } from './StaticGuide';

export const HTML_LOCALES: readonly Locale[] = ['en', 'de'];

export const htmlFileName = (locale: Locale) => `power-bi-guidelines.${locale}.html`;

/** Readable on paper: no sticky bars, each area on a new page, topics kept whole where they fit. */
const PRINT_CSS = `
@media print {
  @page { margin: 14mm; }
  body, .min-h-screen { background: #fff !important; }
  .guide-hero { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .guide-contents, section[id^="guideline-"] { break-before: page; }
  article { break-inside: avoid-page; box-shadow: none !important; }
  .sticky { position: static !important; }
  a { color: inherit; }
  /* On paper a link is only useful with its address. */
  a[href^="https://"]::after { content: " (" attr(href) ")"; font-size: 0.85em; word-break: break-all; }
}`;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The whole file. The same inputs always give the same bytes. */
export function renderDocument(locale: Locale, css: string, version: string): string {
  const t = (key: TranslationKey, params?: Record<string, string | number>) => translate(locale, key, params);
  const body = renderToStaticMarkup(<StaticGuide locale={locale} t={t} version={version} />);
  // A stylesheet that closes its own tag would end the style element early.
  const styles = `${css}\n${PRINT_CSS}`.replace(/<\/style/gi, '<\\/style');
  return [
    '<!doctype html>',
    `<html lang="${locale}">`,
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<meta name="description" content="${escapeHtml(t('gl.tagline'))}" />`,
    `<title>${escapeHtml(t('gl.title'))}</title>`,
    `<style>${styles}</style>`,
    '</head>',
    `<body>${body}</body>`,
    '</html>',
    '',
  ].join('\n');
}
