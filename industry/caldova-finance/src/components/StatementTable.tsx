import { useMemo } from 'react';

import { fmtDeltaK, fmtDeltaPct, fmtDeltaPp, fmtK, fmtPct } from '@/domain/format';
import type { Line } from '@/domain/view';
import { plainSpans, spanDomain, waterfallSpans } from '@/domain/waterfall';
import { useFinance } from '@/hooks/FinanceContext';
import { useSize } from '@/hooks/useSize';
import { useWide } from '@/hooks/useWide';

import { BarCell, labelWidth, relCap, ScenarioLabel, toneOf, VariancePin } from './ibcs';

const MIN_ROW = 18;
const MAX_ROW = 40;
/** Row height on narrow windows, where the page scrolls and the table takes its natural height. */
const NARROW_ROW = 26;
const HEAD = 30;
/** Space before each bar column, so one column's labels never touch the next column's axis. */
const GAP = 14;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Bars of the table: 'off' plain variance bars from zero; 'delta' the variance bars as a bridge from the comparison
 * to the current total; 'cur' an extra column with the current values as a bridge (cash flow: the movements to the
 * change in cash, then the balances).
 */
export type Waterfall = 'off' | 'delta' | 'cur';

interface Props {
  lines: Line[];
  expanded: ReadonlySet<string>;
  onToggle?(id: string): void;
  /** Lines that carry comments or adjustments get a small marker. */
  marked: ReadonlySet<string>;
  /** Head of the PY column; the balance sheet compares with the previous year-end. */
  pyLabel?: string;
  waterfall?: Waterfall;
}

/**
 * Column widths from the panel width: the account names as wide as the longest name needs, the three scenario
 * columns fixed, the rest shared by the bars (and the bridge column), so the table fills its panel at any width.
 */
export function columnWidths(width: number, font: number, lines: Line[], curBridge: boolean) {
  const numW = Math.round(font * 5.4);
  // Name width in px: about 0.58 em per character, 14 px per level, the expand arrow, the marker and padding. The
  // names get what they need first; the bars share the rest.
  const need = Math.min(340, Math.max(120, ...lines.map((l) => l.account.name.length * font * 0.58 + l.depth * 14)) + 40);
  const minBar = labelWidth(font) + labelWidth(font, 2) + 40 + GAP;
  // A pin without labels needs little; with its labels on both sides (VariancePin drops them below this) more.
  const pinBare = 40 + GAP;
  const pinLabels = 2 * (labelWidth(font - 1, 6) + 5 + 20) + GAP;
  const minWf = curBridge ? 2 * labelWidth(font) + 60 + GAP : 0;
  // Priority: the names, then the bars' minimum, then the pin labels; what is left goes to the bridge and the bars.
  const name = clamp(Math.ceil(need), 140, Math.max(140, width - 3 * numW - minBar - pinBare - minWf));
  const rest = Math.max(0, width - name - 3 * numW);
  const wf = curBridge ? Math.min(640, Math.max(minWf, Math.round((rest - minBar - pinLabels) * 0.55 + minWf * 0.45))) : 0;
  const afterWf = Math.max(0, rest - wf);
  let pin = clamp(afterWf - minBar, Math.min(pinBare, afterWf), pinLabels);
  const extra = Math.max(0, afterWf - minBar - pin);
  pin = Math.min(300, pin + Math.round(extra * 0.35));
  const bar = Math.min(420, Math.max(0, afterWf - pin));
  /** The narrowest width at which no name is cut and every bar and pin keeps its labels. */
  const min = Math.ceil(need) + 3 * numW + minBar + pinLabels + minWf;
  return { numW, name, wf, bar, pin, min };
}

/**
 * An IBCS statement table: columns PL, PY, current (AC / FC / AC&FC), then the variance against the chosen
 * comparison as a bar and as a pin, each with its value at the end it points to (left when negative, right when
 * positive). On wide windows the row height follows the panel height (PLAN.md §5.1): the table fills its panel and
 * never scrolls; on narrow windows it takes its natural height.
 */
export function StatementTable({ lines, expanded, onToggle, marked, pyLabel = 'PY', waterfall = 'off' }: Props) {
  const { currentCode, comparison, selection, select } = useFinance();
  const [ref, size] = useSize<HTMLDivElement>();
  const wide = useWide();
  const rowH = wide ? clamp(Math.floor((size.height - HEAD) / Math.max(1, lines.length)), MIN_ROW, MAX_ROW) : NARROW_ROW;
  const font = rowH >= 22 ? 13 : rowH >= 20 ? 12 : 11;
  const cellH = rowH - 1;

  const delta = (l: Line) => (comparison === 'PL' ? l.dPl : l.dPy);
  const relative = (l: Line) => (comparison === 'PL' ? l.rPl : l.rPy);
  const deltaSpans = useMemo(() => (waterfall === 'delta' ? waterfallSpans(lines, delta) : plainSpans(lines, delta)), [lines, comparison, waterfall]); // eslint-disable-line react-hooks/exhaustive-deps
  const deltaDomain = useMemo(() => spanDomain(deltaSpans), [deltaSpans]);
  const curSpans = useMemo(() => (waterfall === 'cur' ? waterfallSpans(lines, (l) => l.cur) : []), [lines, waterfall]);
  const curDomain = useMemo(() => spanDomain(curSpans), [curSpans]);
  const relMax = useMemo(() => relCap(lines.map(relative)), [lines, comparison]); // eslint-disable-line react-hooks/exhaustive-deps

  // Narrow windows: below its minimum width the table keeps that width and scrolls sideways inside its panel, so no
  // name is cut. Wide windows always fit the panel.
  const probe = columnWidths(size.width, font, lines, waterfall === 'cur');
  const tableW = wide ? size.width : Math.max(size.width, probe.min);
  const cols = tableW === size.width ? probe : columnWidths(tableW, font, lines, waterfall === 'cur');
  const hatched = currentCode !== 'AC';

  return (
    // Narrow windows: a table wider than a phone scrolls sideways inside its panel, never the page.
    <div ref={ref} className={`panel ${wide ? 'h-full' : ''}`} style={wide ? undefined : { overflowX: 'auto' }}>
      {size.width > 0 && (
        <table className="table-fixed border-collapse" style={{ fontSize: font, width: tableW }}>
          <colgroup>
            <col />
            <col style={{ width: cols.numW }} />
            <col style={{ width: cols.numW }} />
            <col style={{ width: cols.numW }} />
            {waterfall === 'cur' && <col style={{ width: cols.wf }} />}
            <col style={{ width: cols.bar }} />
            <col style={{ width: cols.pin }} />
          </colgroup>
          <thead>
            <tr style={{ height: HEAD }} className="border-b-2 border-ink text-[11px] uppercase text-muted">
              <th className="text-left font-semibold">kEUR</th>
              <th className="num px-2">
                <ScenarioLabel s="PL" />
              </th>
              <th className="num px-2">
                <ScenarioLabel s="PY">{pyLabel}</ScenarioLabel>
              </th>
              <th className="num px-2">
                <ScenarioLabel s={currentCode} />
              </th>
              {waterfall === 'cur' && <th className="text-center font-semibold" style={{ paddingLeft: GAP }}>{currentCode} bridge</th>}
              <th className="text-center font-semibold" style={{ paddingLeft: GAP }}>
                Δ{comparison}
                {waterfall === 'delta' ? ' bridge' : ''}
              </th>
              <th className="text-center font-semibold" style={{ paddingLeft: GAP }}>
                Δ{comparison}%
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const a = l.account;
              const strong = a.rowType !== 'Account' && a.rowType !== 'KPI';
              const total = a.rowType === 'Formula' || a.parentId === null;
              const d = delta(l);
              const tone = toneOf(d, l.goodUp);
              const r = relative(l);
              const isSel = selection?.accountId === a.id && selection.statement === a.statement;
              const canExpand = l.hasChildren && onToggle;
              return (
                <tr
                  key={a.id}
                  style={{ height: rowH }}
                  className={`cursor-pointer ${total && a.rowType !== 'KPI' ? 'border-t border-ink' : ''} ${isSel ? 'bg-select' : 'hover:bg-soft'}`}
                  onClick={() => select({ statement: a.statement, accountId: a.id })}
                  aria-selected={isSel}
                >
                  <td className={`truncate pr-2 ${strong ? 'font-semibold' : ''} ${a.rowType === 'KPI' ? 'italic text-muted' : ''}`} style={{ paddingLeft: 4 + l.depth * 14 }} title={a.name}>
                    {canExpand ? (
                      <button
                        type="button"
                        className="mr-1 inline-block w-3 text-muted"
                        aria-label={expanded.has(a.id) ? `Collapse ${a.name}` : `Expand ${a.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggle(a.id);
                        }}
                      >
                        {expanded.has(a.id) ? '▾' : '▸'}
                      </button>
                    ) : (
                      <span className="mr-1 inline-block w-3" />
                    )}
                    {a.name}
                    {marked.has(a.id) && <span className="ml-1 text-[10px] text-muted" title="Comments or adjustments">●</span>}
                  </td>
                  <td className="num px-2">{l.isKpi ? fmtPct(l.pl) : fmtK(l.pl)}</td>
                  <td className="num px-2 text-muted">{l.isKpi ? fmtPct(l.py) : fmtK(l.py)}</td>
                  <td className={`num px-2 ${strong ? 'font-semibold' : ''}`}>{l.isKpi ? fmtPct(l.cur) : fmtK(l.cur)}</td>
                  {waterfall === 'cur' && (
                    <td className="p-0" style={{ paddingLeft: GAP }}>
                      <BarCell
                        span={curSpans[i]}
                        domain={curDomain}
                        width={cols.wf - GAP}
                        height={cellH}
                        font={font - 1}
                        label={!curSpans[i] ? '' : curSpans[i]?.total ? fmtK(l.cur) : fmtDeltaK(l.cur)}
                        tone="neutral"
                        ink
                        hatched={hatched}
                        thin={l.depth > 0}
                        bridge
                      />
                    </td>
                  )}
                  <td className="p-0" style={{ paddingLeft: GAP }}>
                    <BarCell
                      span={deltaSpans[i]}
                      domain={deltaDomain}
                      width={cols.bar - GAP}
                      height={cellH}
                      font={font - 1}
                      // In the bridge a step is its effect on net income (a lower cost steps up, +337), so the label
                      // reads as the bar points; plain bars keep the line's own terms (a lower cost is −337, green).
                      label={l.isKpi ? fmtDeltaPp(d) : fmtDeltaK(waterfall === 'delta' && d !== undefined ? l.orient * d : d)}
                      labelRight={(d ?? 0) >= 0}
                      tone={tone}
                      hatched={hatched}
                      thin={waterfall === 'delta' && l.depth > 0}
                      bridge={waterfall === 'delta'}
                    />
                  </td>
                  <td className="p-0" style={{ paddingLeft: GAP }}>
                    {!l.isKpi && <VariancePin value={r} max={relMax} width={cols.pin - GAP} height={cellH} font={font - 1} label={fmtDeltaPct(r)} tone={tone} minuend={currentCode} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
