/**
 * Copy a table so it pastes into Excel cell by cell, numbers as numbers.
 *
 * Adapted from the finance-analytics template of awesome-rayfin (src/finance/lib/clipboard.ts, Copyright (c)
 * Microsoft Corporation, MIT; see NOTICE). Two representations go onto the clipboard in one gesture: an HTML
 * table (Excel, Word, Outlook) and tab-separated text (any editor). Added here: an Excel number format per cell
 * (mso-number-format), so kEUR and percentages arrive formatted, and leading spaces for the account levels.
 */
export type Cell = string | number | null;

export interface CopyColumn {
  label: string;
  numeric: boolean;
}

export interface CopyTable {
  /** One line above the header (company, statement, period, unit). */
  caption: string;
  columns: CopyColumn[];
  rows: { cells: Cell[]; depth?: number; bold?: boolean; italic?: boolean; formats?: (string | undefined)[] }[];
}

/** Guard against formula injection on paste (=, +, -, @, tab or CR leading). */
function deFormula(value: Cell): Cell {
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * Number text as a fallback for Excel: the decimal separator of the browser's language, Latin digits, no grouping.
 * Excel parses pasted text by the Windows regional format ("1028.594" is 1,028,594 in German Excel), which a page
 * cannot read; the HTML carries the locale-free x:num value as well, which Excel prefers when it reads it.
 */
function numberText(v: number, locale: string | undefined): string {
  return new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 6, numberingSystem: 'latn' })
    .format(v === 0 ? 0 : v)
    .replace(/−/g, '-');
}

const defaultLocale = () => (typeof navigator !== 'undefined' ? navigator.language : undefined);
const text = (v: Cell, locale?: string) =>
  v === null || v === undefined ? '' : typeof v === 'number' ? numberText(v, locale) : String(deFormula(v));
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Tab-separated text; tabs and newlines inside a cell become spaces so the grid cannot break. */
export function tableToTsv(t: CopyTable, locale = defaultLocale()): string {
  const flat = (s: string) => s.replace(/[\t\r\n]+/g, ' ');
  const lines = [flat(text(t.caption)), t.columns.map((c) => flat(text(c.label))).join('\t')];
  for (const r of t.rows) lines.push(r.cells.map((v, i) => (i === 0 ? '  '.repeat(r.depth ?? 0) : '') + flat(text(v, locale))).join('\t'));
  return lines.join('\r\n');
}

/**
 * An Excel HTML document: raw numbers, right-aligned, with their number format. The Office header (ProgId and the
 * x namespace) makes Excel take x:num, the value without locale; German Excel ignores x:num without it.
 */
export function tableToHtml(t: CopyTable, locale = defaultLocale()): string {
  const td = 'border:1px solid #d4d4d4;padding:2px 6px';
  const head = t.columns
    .map((c) => `<th style="${td};text-align:${c.numeric ? 'right' : 'left'};font-weight:bold">${escapeHtml(text(c.label))}</th>`)
    .join('');
  const body = t.rows
    .map((r) => {
      const font = `${r.bold ? ';font-weight:bold' : ''}${r.italic ? ';font-style:italic' : ''}`;
      const cells = r.cells
        .map((v, i) => {
          const c = t.columns[i];
          const fmt = r.formats?.[i];
          const num = c?.numeric && typeof v === 'number' && Number.isFinite(v);
          const style = `${td};text-align:${c?.numeric ? 'right' : 'left'}${font}${num && fmt ? `;mso-number-format:'${escapeHtml(fmt)}'` : ''}`;
          const shown = (i === 0 ? '&nbsp;&nbsp;'.repeat(r.depth ?? 0) : '') + escapeHtml(text(v, locale));
          return `<td style="${style}"${num ? ` x:num="${v === 0 ? 0 : v}"` : ''}>${shown}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return (
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">` +
    `<head><meta charset="utf-8"><meta name="ProgId" content="Excel.Sheet"></head><body>` +
    `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:11px">` +
    `<tr><td colspan="${t.columns.length}" style="font-weight:bold">${escapeHtml(text(t.caption))}</td></tr>` +
    `<tr>${head}</tr>${body}</table></body></html>`
  );
}

/** Put both representations onto a copy event's clipboardData. */
export function writeClipboardPayload(data: Pick<DataTransfer, 'setData'> | null | undefined, html: string, tsv: string): void {
  if (!data) return;
  data.setData('text/html', html);
  data.setData('text/plain', tsv);
}

/**
 * Synchronous copy through a copy-event listener and execCommand('copy'). The only path that works when the app
 * runs in the Fabric portal's cross-origin iframe, which withholds the async Clipboard API's clipboard-write
 * permission. It must run inside the click, with no await before it.
 */
function copyViaCopyEvent(html: string, tsv: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const onCopy = (event: Event) => {
    event.preventDefault();
    writeClipboardPayload((event as ClipboardEvent).clipboardData, html, tsv);
  };
  let ta: HTMLTextAreaElement | undefined;
  const previous = document.activeElement as HTMLElement | null;
  try {
    document.addEventListener('copy', onCopy, true);
    // execCommand only fires a copy event when something is selected: a hidden, focused textarea provides that.
    ta = document.createElement('textarea');
    ta.value = tsv;
    ta.setAttribute('readonly', '');
    ta.setAttribute('aria-hidden', 'true');
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.focus({ preventScroll: true });
    ta.select();
    return document.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    document.removeEventListener('copy', onCopy, true);
    ta?.remove();
    previous?.focus?.({ preventScroll: true });
  }
}

/** Copy as HTML table + TSV. The synchronous path first (portal iframe), then the async Clipboard API. */
export async function copyTable(t: CopyTable): Promise<boolean> {
  const tsv = tableToTsv(t);
  const html = tableToHtml(t);
  if (copyViaCopyEvent(html, tsv)) return true;
  try {
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (clip && 'write' in clip && typeof ClipboardItem !== 'undefined') {
      await clip.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([tsv], { type: 'text/plain' }) })]);
      return true;
    }
    if (clip?.writeText) {
      await clip.writeText(tsv);
      return true;
    }
  } catch {
    // nothing more to try
  }
  return false;
}
