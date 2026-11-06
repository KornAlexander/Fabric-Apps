import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { forecastWithAdjustments } from '@/domain/engine';
import type { Snapshot } from '@/domain/types';
import { copyTable, tableToHtml, tableToTsv, writeClipboardPayload, type CopyTable } from './clipboard';
import { statementCopyTable } from './exports';

const snapshot = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../public/data/statements.json'), 'utf-8')) as Snapshot;

const T: CopyTable = {
  caption: 'Caldova GmbH · Income statement · kEUR',
  columns: [
    { label: '', numeric: false },
    { label: 'AC', numeric: true },
    { label: 'ΔPL%', numeric: true },
  ],
  rows: [
    { cells: ['Net revenue', 27663, -0.013], formats: [undefined, '#,##0;-#,##0', '0.0%'] },
    { cells: ['=HYPERLINK("x")', 1, null], depth: 1 },
    { cells: ['Tab\there <b>', null, 0.5], bold: true },
  ],
};

describe('copy table for Excel', () => {
  it('writes TSV: caption, header, one line per row, levels as leading spaces, no formula injection', () => {
    const lines = tableToTsv(T).split('\r\n');
    expect(lines[0]).toBe('Caldova GmbH · Income statement · kEUR');
    expect(lines[1]).toBe('\tAC\tΔPL%');
    expect(lines[2]).toBe('Net revenue\t27663\t-0.013');
    expect(lines[3]).toBe(`  '=HYPERLINK("x")\t1\t`);
    expect(lines[4]).toBe('Tab here <b>\t\t0.5');
  });

  it('writes an HTML table with raw numbers, their Excel format, and escaped text', () => {
    const html = tableToHtml(T);
    expect(html).toContain(`>27663</td>`);
    expect(html).toContain(`mso-number-format:'#,##0;-#,##0'`);
    expect(html).toContain(`mso-number-format:'0.0%'`);
    expect(html).toContain('&nbsp;&nbsp;&#39;=HYPERLINK(&quot;x&quot;)');
    expect(html).toContain('Tab\there &lt;b&gt;');
    expect(html).not.toContain('<b>');
    expect(html.match(/<tr>/g)).toHaveLength(5);
    // The Office header makes Excel take x:num, the value without locale.
    expect(html).toMatch(/^<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"/);
    expect(html).toContain('<meta name="ProgId" content="Excel.Sheet">');
    expect(html).toContain('x:num="27663"');
  });

  it('escapes the number format and guards the caption and labels too', () => {
    const t: CopyTable = { caption: '=cmd', columns: [{ label: '', numeric: false }, { label: '@x', numeric: true }], rows: [{ cells: ['a', 1], formats: [undefined, `0"';x`] }] };
    const html = tableToHtml(t, 'en-US');
    expect(html).toContain(`mso-number-format:'0&quot;&#39;;x'`);
    expect(html).toContain('>&#39;=cmd</td>');
    expect(tableToTsv(t, 'en-US').split('\r\n').slice(0, 2)).toEqual(["'=cmd", "\t'@x"]);
  });

  it('never writes a negative zero', () => {
    const t: CopyTable = { caption: 'x', columns: [{ label: '', numeric: false }, { label: 'AC', numeric: true }], rows: [{ cells: ['a', -0] }] };
    expect(tableToTsv(t, 'en-US').endsWith('a\t0')).toBe(true);
    expect(tableToHtml(t, 'en-US')).toContain('x:num="0">0</td>');
  });

  it('writes numbers the way Excel of the same language reads them, never with grouping', () => {
    const t: CopyTable = { caption: 'x', columns: [{ label: '', numeric: false }, { label: 'AC', numeric: true }], rows: [{ cells: ['Non-current assets', 1028.594] }, { cells: ['Big', -1234567.5] }] };
    // German Excel reads "1028.594" as 1,028,594: German text must be "1028,594".
    expect(tableToTsv(t, 'de-DE').split('\r\n').slice(2)).toEqual(['Non-current assets\t1028,594', 'Big\t-1234567,5']);
    expect(tableToTsv(t, 'en-US').split('\r\n').slice(2)).toEqual(['Non-current assets\t1028.594', 'Big\t-1234567.5']);
    const html = tableToHtml(t, 'de-DE');
    expect(html).toContain('x:num="1028.594">1028,594</td>');
    expect(tableToTsv(t, 'sv-SE')).not.toContain('−');
  });

  it('puts both representations on the copy event', () => {
    const setData = vi.fn();
    writeClipboardPayload({ setData }, '<table></table>', 'a\tb');
    expect(setData).toHaveBeenCalledWith('text/html', '<table></table>');
    expect(setData).toHaveBeenCalledWith('text/plain', 'a\tb');
    expect(() => writeClipboardPayload(null, '', '')).not.toThrow();
  });

  describe('copyTable', () => {
    afterEach(() => vi.restoreAllMocks());

    it('copies synchronously through the copy event (the Fabric portal iframe path)', async () => {
      const seen: Record<string, string> = {};
      document.execCommand = vi.fn(() => {
        const e = new Event('copy', { cancelable: true }) as ClipboardEvent;
        Object.defineProperty(e, 'clipboardData', { value: { setData: (k: string, v: string) => (seen[k] = v) } });
        document.dispatchEvent(e);
        return true;
      });
      const p = copyTable(T);
      // Written before the first await, i.e. inside the click.
      expect(seen['text/plain']).toBe(tableToTsv(T));
      expect(seen['text/html']).toBe(tableToHtml(T));
      await expect(p).resolves.toBe(true);
      expect(document.querySelector('textarea')).toBeNull();
    });

    it('falls back to the async Clipboard API when execCommand fails', async () => {
      document.execCommand = vi.fn(() => false);
      const writeText = vi.fn(async () => undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      await expect(copyTable(T)).resolves.toBe(true);
      expect(writeText).toHaveBeenCalledWith(tableToTsv(T));
      vi.unstubAllGlobals();
    });
  });
});

describe('statementCopyTable', () => {
  const input = {
    snapshot,
    current: forecastWithAdjustments(snapshot, []),
    records: { adjustments: [], comments: [], signOffs: [], readAt: new Date() },
    period: { month: '2026-09', mode: 'YTD' as const },
    comparison: 'PL' as const,
    currentCode: 'AC',
  };

  it('copies the income statement in kEUR with the Excel sheet columns', () => {
    const t = statementCopyTable(input, 'PL');
    expect(t.columns.map((c) => c.label)).toEqual(['', 'PL', 'PY', 'AC', 'ΔPL', 'ΔPL%']);
    expect(t.caption).toContain('Income statement');
    const ni = t.rows.find((r) => r.cells[0] === 'Net income');
    // Whole kEUR, rounded as on screen: PL 285, PY 191, AC 245, ΔPL −40 for Jan to Sep 2026.
    expect(ni?.cells.slice(1, 5)).toEqual([285, 191, 245, -40]);
    for (const row of t.rows.filter((x) => !x.italic)) for (const c of row.cells.slice(1, 5)) expect(c === null || Number.isInteger(c)).toBe(true);
    expect(ni?.formats?.[5]).toBe('0.0%');
    const kpi = t.rows.find((r) => r.italic);
    expect(kpi?.formats?.[3]).toBe('0.0%');
    expect(typeof kpi?.cells[3]).toBe('number');
    expect(Math.abs(kpi?.cells[3] as number)).toBeLessThan(1);
  });

  it('labels the balance sheet comparison as previous year-end and ties assets to equity and liabilities', () => {
    const t = statementCopyTable({ ...input, comparison: 'PY' }, 'BS');
    expect(t.columns.map((c) => c.label)).toEqual(['', 'PL', 'PY year-end', 'AC', 'ΔPY', 'ΔPY%']);
    const val = (name: string) => t.rows.find((r) => r.cells[0] === name)?.cells[3] as number;
    expect(Math.abs(val('Total assets') - val('Total equity & liabilities'))).toBeLessThanOrEqual(1);
  });
});
