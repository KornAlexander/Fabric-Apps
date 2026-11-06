import { useId } from 'react';

import { fmtDeltaK, fmtK, monthShort } from '@/domain/format';
import { useSize } from '@/hooks/useSize';

import { HatchDefs } from './ibcs';

const LABEL = 11;

/* ───────────────────────────── monthly columns ───────────────────────────── */

export interface MonthPoint {
  month: string;
  /** AC for closed months, FC after the cut-off. */
  cur?: number;
  isForecast: boolean;
  pl?: number;
  py?: number;
}

/**
 * Where each scenario's column sits in a month's group: PL, PY, then AC or FC, from LEFT TO RIGHT and from BACK TO
 * FRONT (Michael Tenner's rule, cockpit commit 5394e02). The array order is the drawing order. Every column is opaque,
 * so the hatched FC in front never shows the plan outline through it.
 */
export function columnLayout(bw: number): { code: 'PL' | 'PY' | 'CUR'; dx: number }[] {
  const step = bw * 0.28;
  return [
    { code: 'PL', dx: -step },
    { code: 'PY', dx: 0 },
    { code: 'CUR', dx: step },
  ];
}

/**
 * IBCS: ONE scale for both tiers of {@link MonthColumns}. A kEUR of variance is exactly as tall as a kEUR of column, so
 * the variance strip's height follows from the data, never from a fixed share of the panel (which stretched a
 * 50 kEUR variance to look like a 3,000 kEUR column). Returns px per kEUR, the variance baseline and the columns' top.
 */
export function monthColumnsScale(o: { height: number; max: number; min: number; dPos: number; dNeg: number; label: number }) {
  const headPad = 4 + o.label; // label above the tallest positive variance
  const gap = o.label + 8 + (o.max > 0 ? o.label : 0); // label below the deepest negative variance, then the AC/FC labels
  const footPad = o.label + 6 + 4 + (o.min < 0 ? o.label + 2 : 0);
  const span = o.max - o.min || 1;
  const k = Math.max(0, o.height - headPad - gap - footPad) / (span + o.dPos + o.dNeg);
  const dMid = headPad + o.dPos * k;
  return { k, dMid, top: dMid + o.dNeg * k + gap };
}

/**
 * Twelve months of one line in the order of {@link columnLayout}: the variance against the comparison in a strip
 * ABOVE the columns (IBCS: variances on top of the time series), then the columns with the value above each AC/FC
 * column, at one scale. `goodUp` colours the variance by impact.
 */
export function MonthColumns({ points, comparison, goodUp }: { points: MonthPoint[]; comparison: 'PL' | 'PY'; goodUp: boolean | null }) {
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  const uid = useId().replace(/:/g, '');
  const n = points.length || 1;
  const vals = points.flatMap((p) => [p.cur, p.pl, p.py]).filter((v): v is number => v !== undefined);
  const max = Math.max(0, ...vals);
  const min = Math.min(0, ...vals);
  const deltas = points.map((p) => (p.cur !== undefined && p[comparison === 'PL' ? 'pl' : 'py'] !== undefined ? p.cur - (p[comparison === 'PL' ? 'pl' : 'py'] as number) : undefined));
  const dPos = Math.max(0, ...deltas.map((d) => d ?? 0));
  const dNeg = Math.max(0, ...deltas.map((d) => -(d ?? 0)));
  const { k, dMid, top } = monthColumnsScale({ height, max, min, dPos, dNeg, label: LABEL });
  const y = (v: number) => top + (max - v) * k;
  const slot = width / n;
  const bw = Math.max(6, Math.min(30, slot * 0.46));
  const layout = columnLayout(bw);
  const curDx = layout.find((c) => c.code === 'CUR')!.dx;
  const dScale = k;

  return (
    <div ref={ref} className="panel h-full">
      {width > 0 && height > 0 && (
        <svg width={width} height={height} role="img" aria-label="Monthly columns">
          <HatchDefs id={uid} />
          {points.map((p, i) => {
            const cx = slot * i + slot / 2;
            const col = (v: number | undefined, dx: number, fill: string, stroke = 'none', sw = 0) =>
              v === undefined ? null : <rect x={cx - bw / 2 + dx} y={Math.min(y(v), y(0))} width={bw} height={Math.max(0.5, Math.abs(y(v) - y(0)))} fill={fill} stroke={stroke} strokeWidth={sw} />;
            const d = deltas[i];
            const good = d === undefined || goodUp === null ? true : (d >= 0) === goodUp;
            const top3 = Math.max(p.cur ?? 0, p.pl ?? 0, p.py ?? 0);
            const low3 = Math.min(p.cur ?? 0, p.pl ?? 0, p.py ?? 0);
            return (
              <g key={p.month}>
                {layout.map(({ code, dx }) =>
                  code === 'PL'
                    ? <g key={code}>{col(p.pl, dx, 'var(--paper)', 'var(--ac)', 1.2)}</g>
                    : code === 'PY'
                      ? <g key={code}>{col(p.py, dx, 'var(--py)')}</g>
                      : <g key={code}>{p.isForecast ? col(p.cur, dx, `url(#${uid}-fc)`, 'var(--ac)', 0.8) : col(p.cur, dx, 'var(--ac)')}</g>
                )}
                {p.cur !== undefined && (
                  <text x={cx + curDx} y={p.cur >= 0 ? y(top3) - 3 : y(low3) + LABEL} textAnchor="middle" fontSize={LABEL - 1} fill="var(--ink)">
                    {fmtK(p.cur)}
                  </text>
                )}
                {d !== undefined && (
                  <>
                    <rect
                      x={cx + curDx - bw / 2}
                      y={d >= 0 ? dMid - Math.abs(d) * dScale : dMid}
                      width={bw}
                      height={Math.max(0.5, Math.abs(d) * dScale)}
                      fill={p.isForecast ? `url(#${uid}-${good ? 'good' : 'bad'})` : good ? 'var(--good)' : 'var(--bad)'}
                      stroke={p.isForecast ? (good ? 'var(--good)' : 'var(--bad)') : 'none'}
                      strokeWidth={0.8}
                    />
                    <text
                      x={cx + curDx}
                      y={d >= 0 ? dMid - Math.abs(d) * dScale - 3 : dMid + Math.abs(d) * dScale + LABEL - 1}
                      textAnchor="middle"
                      fontSize={LABEL - 2}
                      fill="var(--ink)"
                    >
                      {fmtDeltaK(d)}
                    </text>
                  </>
                )}
                <text x={cx} y={height - 4} textAnchor="middle" fontSize={LABEL} fill="var(--muted)">
                  {monthShort(p.month)}
                </text>
              </g>
            );
          })}
          <line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke="var(--ink)" strokeWidth={1} />
          <line x1={0} x2={width} y1={dMid} y2={dMid} stroke="var(--ink)" strokeWidth={comparison === 'PY' ? 3 : 1} opacity={comparison === 'PY' ? 0.35 : 1} />
          <text x={2} y={LABEL - 1} fontSize={LABEL - 1} fill="var(--muted)">
            Δ{comparison}
          </text>
        </svg>
      )}
    </div>
  );
}

/* ───────────────────────────── balance sheet structure ───────────────────────────── */

export interface Stack {
  label: string;
  code: 'cur' | 'py' | 'pl';
  hatched?: boolean;
  parts: { label: string; value: number }[];
}

/**
 * Balance sheet structure: for each scenario a pair of stacked columns, assets and equity & liabilities, at one
 * scale; segments in ink shades, labelled with their value.
 */
export function StructureColumns({ pairs }: { pairs: { title: string; left: Stack; right: Stack }[] }) {
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  const uid = useId().replace(/:/g, '');
  const totals = pairs.flatMap((p) => [p.left, p.right].map((s) => s.parts.reduce((a, b) => a + Math.max(0, b.value), 0)));
  const max = Math.max(1, ...totals);
  const top = 18;
  const bottom = height - 30;
  const k = (bottom - top) / max;
  // The pairs sit side by side in the middle with room for the segment names outside; no gap between them
  // grows with the panel.
  const names = 84;
  const gap = 56;
  const n = pairs.length || 1;
  const bw = Math.max(24, Math.min(96, (width - 2 * names - (n - 1) * gap - n * 6) / (2 * n)));
  const pairW = 2 * bw + 6;
  const x0 = (width - (n * pairW + (n - 1) * gap)) / 2;
  const shades = ['#404040', '#6a6a6a', '#8f8f8f', '#b3b3b3', '#d0d0d0', '#e6e6e6'];

  /** One stacked column; `names` puts the segment names beside it (left of assets, right of equity & liabilities). */
  const stack = (s: Stack, x: number, names?: 'left' | 'right') => {
    let acc = 0;
    return (
      <g>
        {s.parts.map((p, i) => {
          const h = Math.max(0, p.value) * k;
          const y0 = bottom - (acc + Math.max(0, p.value)) * k;
          acc += Math.max(0, p.value);
          const dark = i < 2;
          return (
            <g key={p.label}>
              <rect x={x} y={y0} width={bw} height={h} fill={s.code === 'pl' ? 'var(--paper)' : shades[i % shades.length]} stroke={s.code === 'pl' ? 'var(--ac)' : 'var(--paper)'} strokeWidth={s.code === 'pl' ? 1 : 0.6} />
              {s.hatched && <rect x={x} y={y0} width={bw} height={h} fill={`url(#${uid}-fc)`} opacity={0.35} />}
              {h > 13 && (
                <text x={x + bw / 2} y={y0 + h / 2 + 4} textAnchor="middle" fontSize={10} fill={dark && s.code !== 'pl' ? '#fff' : 'var(--ink)'}>
                  {fmtK(p.value)}
                </text>
              )}
              {names && h > 11 && (
                <text x={names === 'left' ? x - 5 : x + bw + 5} y={y0 + h / 2 + 4} textAnchor={names === 'left' ? 'end' : 'start'} fontSize={10} fill="var(--muted)">
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
        <text x={x + bw / 2} y={bottom - acc * k - 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink)">
          {fmtK(acc)}
        </text>
      </g>
    );
  };

  return (
    <div ref={ref} className="panel h-full">
      {width > 0 && height > 0 && (
        <svg width={width} height={height} role="img" aria-label="Balance sheet structure">
          <HatchDefs id={uid} />
          {pairs.map((p, i) => {
            const gx = x0 + i * (pairW + gap) + pairW / 2;
            const last = i === pairs.length - 1;
            return (
              <g key={p.title}>
                {stack(p.left, gx - bw - 3, i === 0 ? 'left' : undefined)}
                {stack(p.right, gx + 3, last ? 'right' : undefined)}
                <text x={gx} y={height - 16} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink)">
                  {p.title}
                </text>
                <text x={gx - bw / 2 - 3} y={height - 4} textAnchor="middle" fontSize={10} fill="var(--muted)">
                  Assets
                </text>
                <text x={gx + bw / 2 + 3} y={height - 4} textAnchor="middle" fontSize={10} fill="var(--muted)">
                  Eq. & liab.
                </text>
              </g>
            );
          })}
          <line x1={0} x2={width} y1={bottom} y2={bottom} stroke="var(--ink)" strokeWidth={1} />
        </svg>
      )}
    </div>
  );
}
