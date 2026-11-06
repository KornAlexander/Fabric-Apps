import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { forecastWithAdjustments } from './engine';
import type { Snapshot } from './types';
import { statementLines, visibleLines } from './view';
import { waterfallSpans } from './waterfall';

// Cost lines are shown as positive amounts; their variance is in cost terms and coloured by impact.
describe('cost lines in natural orientation', () => {
  const snapshot = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../public/data/statements.json'), 'utf-8')) as Snapshot;
  const period = { month: '2026-09', mode: 'YTD' as const };
  const lines = visibleLines(statementLines(snapshot, forecastWithAdjustments(snapshot, []), 'PL', period), new Set());
  const line = (id: string) => lines.find((l) => l.account.id === id)!;

  it('shows costs without a minus and a lower cost as a negative, good variance', () => {
    const cogs = line('N-COGS');
    expect(cogs.pl).toBeGreaterThan(0);
    expect(cogs.cur).toBeGreaterThan(0);
    expect(Math.round(cogs.dPl! / 1000)).toBe(-337); // kEUR, as on screen
    expect(cogs.goodUp).toBe(false); // lower is good: -337 is green
  });

  it('keeps revenue as it is: lower revenue is a negative, bad variance', () => {
    const rev = line('N-REV');
    expect(Math.round(rev.dPl! / 1000)).toBe(-377);
    expect(rev.goodUp).toBe(true);
  });

  it('bridges in profit terms: the lower cost steps towards net income', () => {
    const spans = waterfallSpans(lines, (l) => l.dPl);
    const i = lines.findIndex((l) => l.account.id === 'N-COGS');
    expect(Math.round((spans[i]!.to - spans[i]!.from) / 1000)).toBe(337);
    // The step's label in the bridge is that effect (StatementTable: orient × variance), so it reads as the bar points.
    expect(Math.round((lines[i].orient * lines[i].dPl!) / 1000)).toBe(337);
    const ni = lines.findIndex((l) => l.account.id === 'F-NI');
    expect(spans[ni]!.to).toBeCloseTo(lines[ni].dPl!, 6);
  });
});
