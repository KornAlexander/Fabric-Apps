import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { columnWidths } from '@/components/StatementTable';

import { forecastWithAdjustments } from './engine';
import type { Snapshot } from './types';
import { statementLines, visibleLines, type Line } from './view';
import { plainSpans, spanDomain, waterfallSpans } from './waterfall';

const snapshot = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../public/data/statements.json'), 'utf-8')) as Snapshot;
const current = forecastWithAdjustments(snapshot, []);
const period = { month: '2026-09', mode: 'YTD' as const };
const byId = (lines: Line[], spans: ReturnType<typeof waterfallSpans>, id: string) => spans[lines.findIndex((l) => l.account.id === id)];

describe('waterfall inside the statement table', () => {
  it('bridges the P&L variance from PL to AC net income; totals stand on the axis and equal the running sum', () => {
    const lines = visibleLines(statementLines(snapshot, current, 'PL', period), new Set());
    const d = (l: Line) => l.dPl;
    const spans = waterfallSpans(lines, d);
    const rev = byId(lines, spans, 'N-REV')!;
    expect(rev.from).toBe(0);
    const cogs = byId(lines, spans, 'N-COGS')!;
    expect(cogs.from).toBeCloseTo(rev.to, 6);
    expect(rev.linkBelow && cogs.linkAbove).toBe(true);
    // Every Formula total equals the sum of the steps before it.
    for (const id of ['F-GP', 'F-NI']) {
      const i = lines.findIndex((l) => l.account.id === id);
      const s = spans[i]!;
      expect(s.total).toBe(true);
      expect(s.from).toBe(0);
      expect(spans[i - 1] && !spans[i - 1]!.total ? Math.abs(spans[i - 1]!.to - s.to) : 0).toBeLessThan(0.5);
    }
    expect(byId(lines, spans, 'F-NI')!.to).toBeCloseTo(lines.find((l) => l.account.id === 'F-NI')!.dPl!, 6);
    // KPI rows get no bar.
    expect(byId(lines, spans, 'K-GM')).toBeUndefined();
  });

  it('splits an expanded block: its children start where the parent starts and end where it ends', () => {
    const lines = visibleLines(statementLines(snapshot, current, 'PL', period), new Set(['N-OPEX']));
    const spans = waterfallSpans(lines, (l) => l.dPl);
    const parent = byId(lines, spans, 'N-OPEX')!;
    const kids = lines.map((l, i) => [l, spans[i]] as const).filter(([l]) => l.account.parentId === 'N-OPEX');
    expect(kids.length).toBeGreaterThan(1);
    expect(kids[0][1]!.from).toBeCloseTo(parent.from, 6);
    expect(kids[kids.length - 1][1]!.to).toBeCloseTo(parent.to, 6);
    // The next top-level line continues from the parent's end.
    const next = byId(lines, spans, 'N-OOR')!;
    expect(next.from).toBeCloseTo(parent.to, 6);
  });

  it('bridges the cash flow on AC: the flows sum to the change in cash; the cash balances get no bar', () => {
    const lines = statementLines(snapshot, current, 'CF', period);
    const spans = waterfallSpans(lines, (l) => l.cur);
    const fin = byId(lines, spans, 'C-FI')!;
    const net = byId(lines, spans, 'C-NET')!;
    expect(net.total).toBe(true);
    expect(Math.abs(fin.to - net.to)).toBeLessThan(0.5);
    // The last flow (the last child of financing, the row above the total) links into the total it adds up to.
    const div = byId(lines, spans, 'C-FI-DIV')!;
    expect(div.to).toBeCloseTo(fin.to, 6);
    expect(div.linkBelow && net.linkAbove).toBe(true);
    // Opening and closing cash are stocks ten times the flows: outside the bridge, so the flows keep the scale.
    expect(byId(lines, spans, 'C-OPEN')).toBeUndefined();
    expect(byId(lines, spans, 'C-CLOSE')).toBeUndefined();
    const [lo, hi] = spanDomain(spans);
    expect(hi - lo).toBeLessThan(Math.abs(lines.find((l) => l.account.id === 'C-OPEN')!.cur!));
  });

  it('ends every P&L subtotal where the steps before it end', () => {
    for (const expanded of [new Set<string>(), new Set(['N-OPEX']), new Set(['N-REV', 'N-REV-Allergy'])]) {
      const lines = visibleLines(statementLines(snapshot, current, 'PL', period), expanded);
      const spans = waterfallSpans(lines, (l) => l.dPl);
      let lastTop: number | undefined;
      lines.forEach((l, i) => {
        const s = spans[i];
        if (!s || l.account.parentId !== null) return;
        if (s.total && lastTop !== undefined) expect(Math.abs(s.to - lastTop)).toBeLessThan(0.5);
        lastTop = s.to;
      });
    }
  });

  it('plain bars start at zero; the domain holds zero and every bar end', () => {
    const lines = statementLines(snapshot, current, 'BS', period);
    const spans = plainSpans(lines, (l) => l.dPl);
    expect(spans.every((s) => !s || (s.from === 0 && !s.linkAbove && !s.linkBelow))).toBe(true);
    const [lo, hi] = spanDomain(spans);
    expect(lo).toBeLessThanOrEqual(0);
    expect(hi).toBeGreaterThanOrEqual(0);
    for (const s of spans) if (s) expect(s.to >= lo && s.to <= hi).toBe(true);
    expect(spanDomain([])).toEqual([-1, 1]);
  });
});

describe('statement table columns', () => {
  const bs = statementLines(snapshot, current, 'BS', period);
  it('gives the account names what they need first and never exceeds the panel', () => {
    for (const width of [760, 900, 1400]) {
      const c = columnWidths(width, 13, bs, false);
      expect(c.name + 3 * c.numW + c.bar + c.pin).toBeLessThanOrEqual(width);
      expect(c.pin).toBeGreaterThanOrEqual(0);
    }
    // "Warehouse equipment & IT" at level 2 fits untruncated at a 64 % table on a 1440 px window.
    expect(columnWidths(911, 13, bs, false).name).toBeGreaterThanOrEqual(Math.ceil(24 * 13 * 0.58 + 2 * 14 + 40));
  });

  it('makes room for the cash bridge column', () => {
    const cf = statementLines(snapshot, current, 'CF', period);
    const c = columnWidths(1400, 13, cf, true);
    expect(c.wf).toBeGreaterThan(200);
    expect(c.name + 3 * c.numW + c.wf + c.bar + c.pin).toBeLessThanOrEqual(1400);
  });
});
