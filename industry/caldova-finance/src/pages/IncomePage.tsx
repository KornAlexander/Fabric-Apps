import { useMemo, useState } from 'react';

import { MonthColumns, type MonthPoint } from '@/components/charts';
import { PageTitle, Panel, WaterfallToggle } from '@/components/layout';
import { StatementTable } from '@/components/StatementTable';
import { fmtDeltaK, fmtDeltaPct, monthLabel } from '@/domain/format';
import { periodMonths, statementRows } from '@/domain/statements';
import { orientOf, statementLines, visibleLines } from '@/domain/view';
import { useFinance } from '@/hooks/FinanceContext';
import { useMarked } from '@/hooks/useMarked';
import { useWide } from '@/hooks/useWide';

/** One block open at a time: opening a line closes every open line that is not one of its ancestors. */
export function toggleBlock(expanded: ReadonlySet<string>, id: string, parentOf: (id: string) => string | null): Set<string> {
  if (expanded.has(id)) {
    const next = new Set(expanded);
    next.delete(id);
    return next;
  }
  const ancestors = new Set<string>();
  for (let p = parentOf(id); p; p = parentOf(p)) ancestors.add(p);
  return new Set([...[...expanded].filter((e) => ancestors.has(e)), id]);
}

/** The income statement: the table (its variance bars optionally as the net income bridge) and one line by month. */
export function IncomePage({ waterfall, onWaterfall }: { waterfall: boolean; onWaterfall(on: boolean): void }) {
  const { snapshot, current, period, comparison, selection } = useFinance();
  const wide = useWide();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const lines = useMemo(() => statementLines(snapshot, current, 'PL', period), [snapshot, current, period]);
  const shown = useMemo(() => visibleLines(lines, expanded), [lines, expanded]);
  const marked = useMarked('PL');
  const parentOf = (id: string) => snapshot.accounts.find((a) => a.id === id)?.parentId ?? null;

  const ni = lines.find((l) => l.account.id === 'F-NI');
  const d = comparison === 'PL' ? ni?.dPl : ni?.dPy;
  const r = comparison === 'PL' ? ni?.rPl : ni?.rPy;
  const message =
    d === undefined
      ? ''
      : `Net income ${fmtDeltaK(d)} kEUR (${fmtDeltaPct(r)}) ${d >= 0 ? 'above' : 'below'} ${comparison === 'PL' ? 'budget' : 'previous year'}`;

  // Chart line: the selected P&L line, else net revenue.
  const chartId = selection?.statement === 'PL' ? selection.accountId : 'N-REV';
  const chartAccount = snapshot.accounts.find((a) => a.id === chartId);
  // Cost lines are charted as positive amounts, like in the table.
  const o = chartAccount ? orientOf(chartAccount) : 1;
  const asShown = (v: number | undefined) => (v === undefined ? undefined : o * v);
  const year = period.month.slice(0, 4);
  const points: MonthPoint[] = useMemo(
    () =>
      snapshot.months
        .filter((m) => m.id.startsWith(year))
        .map((m) => {
          const p = { month: m.id, mode: 'MTD' as const };
          return {
            month: m.id,
            cur: asShown(statementRows(snapshot, current, 'PL', p)[chartId]),
            isForecast: m.id > snapshot.meta.cutoff,
            pl: asShown(statementRows(snapshot, snapshot.values.PL, 'PL', p)[chartId]),
            py: asShown(statementRows(snapshot, snapshot.values.PY, 'PL', p)[chartId]),
          };
        }),
    [snapshot, current, chartId, year, o] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const chartGoodUp = chartAccount?.goodUp === null || chartAccount === undefined ? (chartAccount?.goodUp ?? true) : o === -1 ? !chartAccount.goodUp : chartAccount.goodUp;

  const months = periodMonths(period);
  const span = months.length > 1 ? `${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])}` : monthLabel(months[0]);

  return (
    <div className={wide ? 'grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2' : 'grid gap-2'}>
      <PageTitle statement="Income statement" span={span} message={message}>
        <WaterfallToggle on={waterfall} onChange={onWaterfall} what={`the variance from ${comparison} to the net income`} />
      </PageTitle>
      <div className={wide ? 'grid min-h-0 grid-cols-[minmax(0,64fr)_minmax(0,36fr)] gap-4' : 'grid gap-4'}>
        <Panel>
          <StatementTable
            lines={shown}
            expanded={expanded}
            onToggle={(id) => setExpanded((e) => toggleBlock(e, id, parentOf))}
            marked={marked}
            waterfall={waterfall ? 'delta' : 'off'}
          />
        </Panel>
        <Panel title={`${chartAccount?.name ?? ''} by month, ${year}, kEUR`} className={wide ? '' : 'h-[380px]'}>
          <MonthColumns points={points} comparison={comparison} goodUp={chartGoodUp} />
        </Panel>
      </div>
    </div>
  );
}
