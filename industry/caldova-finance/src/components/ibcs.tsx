// IBCS building blocks, after Michael Tenner's Finance Cockpit (MIT, see NOTICE): scenario notation
// AC solid, PY grey, PL outlined, FC hatched; variances point by their sign and are coloured by their impact.

import type { Span } from '@/domain/waterfall';
import type { CurrentCode } from '@/hooks/FinanceContext';

export type Mark = 'AC' | 'PY' | 'PL' | 'FC' | 'AC&FC';

/** Scenario swatch for table heads and legends. */
export function ScenarioMark({ s }: { s: Mark | CurrentCode }) {
  const base = 'inline-block size-[10px] shrink-0 align-[-1px]';
  if (s === 'AC') return <span className={`${base} bg-ac`} aria-hidden="true" />;
  if (s === 'PY') return <span className={`${base} bg-py`} aria-hidden="true" />;
  if (s === 'PL') return <span className={`${base} border-[1.5px] border-ac bg-paper`} aria-hidden="true" />;
  if (s === 'FC') return <span className={`${base} hatch border border-ac`} aria-hidden="true" />;
  return (
    <span className={`${base} flex overflow-hidden border border-ac`} aria-hidden="true">
      <span className="h-full w-1/2 bg-ac" />
      <span className="hatch h-full w-1/2" />
    </span>
  );
}

export function ScenarioLabel({ s, children }: { s: Mark | CurrentCode; children?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 font-semibold tracking-wide">
      <ScenarioMark s={s} />
      {children ?? s}
    </span>
  );
}

/** SVG hatch patterns; put once into every chart svg with its own id prefix. */
export function HatchDefs({ id }: { id: string }) {
  const pat = (name: string, color: string) => (
    <pattern id={`${id}-${name}`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="4" height="4" fill="var(--paper)" />
      <line x1="0" y1="0" x2="0" y2="4" stroke={color} strokeWidth="2" />
    </pattern>
  );
  return (
    <defs>
      {pat('fc', 'var(--ac)')}
      {pat('good', 'var(--good)')}
      {pat('bad', 'var(--bad)')}
    </defs>
  );
}

/** good / bad by impact; neutral for lines without a direction and for zero. */
export type Tone = 'good' | 'bad' | 'neutral';

/** The tone of a variance: by impact, neutral when the line has no direction or the variance rounds to zero. */
export function toneOf(delta: number | undefined, goodUp: boolean | null, zero = 500): Tone {
  if (delta === undefined || !Number.isFinite(delta) || goodUp === null || Math.abs(delta) < zero) return 'neutral';
  return (delta > 0) === goodUp ? 'good' : 'bad';
}

const toneColor = (t: Tone) => (t === 'good' ? 'var(--good)' : t === 'bad' ? 'var(--bad)' : 'var(--py)');

/** Text width of a label in px, roughly (tabular digits are about 0.6 em). */
export const labelWidth = (font: number, chars = 7) => Math.ceil(font * 0.6 * chars) + 6;

/**
 * One row's bar on a value axis shared by the whole column, its value at the far end of the bar: right of a bar
 * that ends on the right (positive), left of one that ends on the left (negative). Plain variance bars start at
 * zero; waterfall bars start at the running sum and get grey connectors to the rows above and below. Colour by
 * impact (tone), or ink for movements that are not variances; hatched for forecast.
 */
export function BarCell({
  span,
  domain,
  width,
  height,
  font,
  label,
  labelRight = true,
  tone,
  ink = false,
  hatched = false,
  thin = false,
  bridge = false,
}: {
  span: Span | undefined;
  domain: [number, number];
  width: number;
  height: number;
  font: number;
  label: string;
  /** Where the label goes when there is no bar (KPI rows): by the sign of their value. */
  labelRight?: boolean;
  tone: Tone;
  ink?: boolean;
  hatched?: boolean;
  thin?: boolean;
  /** Waterfall: steps end anywhere on the axis, so both sides keep room for a label. */
  bridge?: boolean;
}) {
  // Room for labels only on the sides the bars reach; a short margin for the zero labels beside the axis.
  const [lo, hi] = domain;
  const full = labelWidth(font);
  const short = labelWidth(font, 2);
  const left = lo < 0 || bridge ? full : short;
  const right = hi > 0 || bridge ? full : short;
  const x = (v: number) => left + ((v - lo) / (hi - lo || 1)) * Math.max(1, width - left - right);
  const color = ink ? 'var(--ac)' : toneColor(tone);
  const key = ink ? 'ink' : tone;
  const bh = thin ? Math.max(4, Math.round(height * 0.24)) : Math.max(6, Math.min(14, Math.round(height * 0.46)));
  const cy = height / 2;
  const x0 = span ? Math.min(x(span.from), x(span.to)) : 0;
  const w = span ? Math.max(0.8, Math.abs(x(span.to) - x(span.from))) : 0;
  // Rows without a bar (KPI) put their label on their sign's side if there is room for it there.
  const endRight = span ? span.to >= span.from : labelRight ? right === full || left !== full : left !== full;
  const end = span ? x(span.to) : x(0);
  return (
    <svg width={width} height={height} aria-hidden="true" className="block">
      {hatched && (
        <defs>
          <pattern id={`bc-${key}`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="4" fill="var(--paper)" />
            <line x1="0" y1="0" x2="0" y2="4" stroke={color} strokeWidth="2" />
          </pattern>
        </defs>
      )}
      <line x1={x(0)} x2={x(0)} y1={0} y2={height} stroke="var(--ink)" strokeWidth={1} />
      {span?.linkAbove && <line x1={x(span.total ? span.to : span.from)} x2={x(span.total ? span.to : span.from)} y1={0} y2={cy - bh / 2} stroke="var(--py)" strokeWidth={1} />}
      {span?.linkBelow && <line x1={x(span.to)} x2={x(span.to)} y1={cy + bh / 2} y2={height} stroke="var(--py)" strokeWidth={1} />}
      {span && (
        <rect
          x={x0}
          y={cy - bh / 2}
          width={w}
          height={bh}
          fill={hatched ? `url(#bc-${key})` : color}
          stroke={hatched ? color : 'none'}
          strokeWidth={hatched ? 0.8 : 0}
        />
      )}
      {label && (
        <text
          x={endRight ? end + 4 : end - 4}
          y={cy + font * 0.36}
          textAnchor={endRight ? 'start' : 'end'}
          fontSize={font}
          fill="var(--ink)"
          fontWeight={span?.total ? 600 : 400}
          // A paper halo, so an axis or connector behind the label never strikes through it.
          stroke="var(--paper)"
          strokeWidth={3}
          paintOrder="stroke"
        >
          {label}
        </text>
      )}
    </svg>
  );
}

/**
 * Relative variance as a pin ("needle"), its percentage beyond the head on the side it points to; for a variance
 * that rounds to zero only the axis and the label.
 *
 * IBCS: colour carries the impact, the head carries the scenario. The STEM is green, red, or grey for lines without
 * a direction; the HEAD is in the notation of the minuend (the scenario compared): solid ink for AC, hatched with an
 * ink outline for FC and for AC&FC periods that contain forecast months. Same split as the ChartKitchen visuals.
 */
export function VariancePin({
  value,
  max,
  width,
  height = 12,
  font = 11,
  label = '',
  tone,
  minuend = 'AC',
}: {
  value: number | undefined;
  max: number;
  width: number;
  height?: number;
  font?: number;
  label?: string;
  tone: Tone;
  minuend?: Mark;
}) {
  const half = width / 2;
  const cy = height / 2;
  // The label goes beyond the head; with too little room for both, the pin keeps its length and drops the label.
  const roomWith = half - 5 - labelWidth(font, 6);
  if (roomWith < 18) label = '';
  const room = Math.max(4, label ? roomWith : half - 5);
  const text = (x: number, right: boolean) =>
    label ? (
      <text x={right ? x + 6 : x - 6} y={cy + font * 0.36} textAnchor={right ? 'start' : 'end'} fontSize={font} fill="var(--muted)" stroke="var(--paper)" strokeWidth={3} paintOrder="stroke">
        {label}
      </text>
    ) : null;
  if (value === undefined || !Number.isFinite(value) || max <= 0 || Math.abs(value) < 0.0005)
    return (
      <svg width={width} height={height} aria-hidden="true" className="block">
        <line x1={half} x2={half} y1={0} y2={height} stroke="var(--ink)" strokeWidth={1} />
        {value !== undefined && text(half - 2, true)}
      </svg>
    );
  const capped = Math.abs(value) > max;
  const len = Math.min(room, (Math.abs(value) / max) * room);
  const x = value >= 0 ? half + len : half - len;
  const hatched = minuend === 'FC' || minuend === 'AC&FC';
  const head = { fill: hatched ? 'url(#pin-head-fc)' : 'var(--ink)', stroke: 'var(--ink)', strokeWidth: hatched ? 0.9 : 0 };
  return (
    <svg width={width} height={height} aria-hidden="true" className="block">
      {hatched && (
        <defs>
          <pattern id="pin-head-fc" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="3" height="3" fill="var(--paper)" />
            <line x1="0" y1="0" x2="0" y2="3" stroke="var(--ink)" strokeWidth="1.5" />
          </pattern>
        </defs>
      )}
      <line x1={half} x2={x} y1={cy} y2={cy} stroke={toneColor(tone)} strokeWidth={2} />
      {capped ? (
        <path d={value >= 0 ? `M${x - 3.5},${cy - 4.5} L${x + 3.5},${cy} L${x - 3.5},${cy + 4.5} Z` : `M${x + 3.5},${cy - 4.5} L${x - 3.5},${cy} L${x + 3.5},${cy + 4.5} Z`} {...head} />
      ) : (
        <rect x={x - 3.5} y={cy - 3.5} width={7} height={7} {...head} />
      )}
      <line x1={half} x2={half} y1={0} y2={height} stroke="var(--ink)" strokeWidth={1} />
      {text(x, value >= 0)}
    </svg>
  );
}

/**
 * Outlier cap for a column of relative variances: with at least 4 values, if the largest is more than 2.5x the
 * next one, scale to the next one (the capped pin gets an arrow head).
 */
export function relCap(values: (number | undefined)[]): number {
  const a = values.filter((v): v is number => v !== undefined && Number.isFinite(v)).map(Math.abs).sort((x, y) => y - x);
  if (a.length === 0) return 1;
  if (a.length >= 4 && a[0] > 2.5 * a[1] && a[1] > 0) return a[1];
  return a[0] || 1;
}
