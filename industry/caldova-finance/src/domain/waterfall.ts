import type { Line } from './view';

/** One table row's bar in a bridge: where it starts and ends on the value axis. */
export interface Span {
  from: number;
  to: number;
  /** A total stands on the axis (Formula and Balance rows); a step hangs from the running sum. */
  total: boolean;
  /** The previous shown row ends where this one starts, and the next starts where this one ends: draw connectors. */
  linkAbove: boolean;
  linkBelow: boolean;
}

/**
 * The bars of a waterfall drawn inside a statement table, row by row in table order. Top-level lines step from the
 * running sum; Formula lines are totals from zero and restart the sum; the children of an expanded line split their
 * parent's step, starting where the parent starts (balance sheet and cash flow children add with their sign, as the
 * parent's sum does). KPI rows, rows without a value and Balance rows (opening and closing cash: stocks, not
 * movements, and ten times larger) get no bar, so the movements keep the column's scale.
 * Plain bars are the same with every row from zero ({@link plainSpans}).
 */
export function waterfallSpans(lines: Line[], value: (l: Line) => number | undefined): (Span | undefined)[] {
  let run = 0;
  const cursor = new Map<string, number>();
  const raw = lines.map((l) => {
    const shown = value(l);
    const a = l.account;
    if (l.isKpi || a.rowType === 'Balance' || shown === undefined || !Number.isFinite(shown)) return undefined;
    // The bridge adds up contributions to profit: a cost line shown as a positive amount steps the other way.
    const v = shown * (l.orient ?? 1);
    let from: number;
    let total = false;
    if (a.parentId === null) {
      if (a.rowType === 'Formula') {
        from = 0;
        total = true;
        run = v;
      } else {
        from = run;
        run += v;
      }
    } else {
      const start = cursor.get(a.parentId);
      if (start === undefined) return undefined;
      from = start;
      const step = a.statement === 'PL' ? v : a.sign * v;
      cursor.set(a.parentId, from + step);
      if (l.hasChildren) cursor.set(a.id, from);
      return { from, to: from + step, total };
    }
    if (l.hasChildren) cursor.set(a.id, from);
    return { from, to: total ? v : from + v, total };
  });
  const near = (x: number, y: number) => Math.abs(x - y) < 0.5;
  return raw.map((s, i) => {
    if (!s) return undefined;
    const prev = raw[i - 1];
    const next = raw[i + 1];
    // A step links to where the previous bar ends; the last step links into the total it adds up to.
    return {
      ...s,
      linkAbove: !!prev && near(prev.to, s.total ? s.to : s.from),
      linkBelow: !!next && near(s.to, next.total ? next.to : next.from),
    };
  });
}

/** Plain variance bars: every row from zero, no connectors. */
export function plainSpans(lines: Line[], value: (l: Line) => number | undefined): (Span | undefined)[] {
  return lines.map((l) => {
    const v = value(l);
    return l.isKpi || v === undefined || !Number.isFinite(v) ? undefined : { from: 0, to: v, total: false, linkAbove: false, linkBelow: false };
  });
}

/**
 * The value range the bars need, zero included: the axis sits where the values put it (at the right edge when every
 * variance is negative), so the bars use the whole column.
 */
export function spanDomain(spans: (Span | undefined)[]): [number, number] {
  const all = spans.flatMap((s) => (s ? [s.from, s.to] : []));
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  return hi - lo < 1 ? [lo - 1, hi + 1] : [lo, hi];
}
