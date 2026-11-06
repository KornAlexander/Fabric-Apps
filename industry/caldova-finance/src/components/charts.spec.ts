import { describe, expect, it } from 'vitest';

import { columnLayout, monthColumnsScale } from './charts';

describe('scenario order in column charts', () => {
  it('draws PL, PY, AC/FC from left to right and from back to front', () => {
    const layout = columnLayout(30);
    // Array order is drawing order: the first is drawn first, i.e. furthest back.
    expect(layout.map((c) => c.code)).toEqual(['PL', 'PY', 'CUR']);
    // Left to right in the same order.
    expect(layout.map((c) => c.dx)).toEqual([...layout.map((c) => c.dx)].sort((a, b) => a - b));
    expect(new Set(layout.map((c) => c.dx)).size).toBe(3);
  });
});

describe('one scale for variances and columns', () => {
  // Net revenue 2026 as on screen: columns up to 3,236 kEUR, variances from +11 to -215 kEUR.
  const o = { height: 560, max: 3236, min: 0, dPos: 11, dNeg: 215, label: 11 };

  it('draws a kEUR of variance exactly as tall as a kEUR of column', () => {
    const { k, dMid, top } = monthColumnsScale(o);
    const columnPx = 3236 * k; // top of the largest column to the zero line
    const variancePx = 215 * k; // the -215 variance below its baseline
    expect(columnPx / 3236).toBeCloseTo(variancePx / 215, 10);
    // The variance strip only takes the room its data needs: about 7 % of the column height here, not a fixed share.
    expect((dMid + 215 * k - (dMid - 11 * k)) / columnPx).toBeCloseTo((215 + 11) / 3236, 10);
    expect(top).toBeGreaterThan(dMid + 215 * k);
  });

  it('keeps everything inside the panel', () => {
    const { k, top } = monthColumnsScale(o);
    expect(top + (o.max - o.min) * k).toBeLessThanOrEqual(o.height);
  });
});
