import { useMemo } from 'react';

import { PageTitle, Panel, WaterfallToggle } from '@/components/layout';
import { StatementTable } from '@/components/StatementTable';
import { fmtDeltaK, fmtK, monthLabel } from '@/domain/format';
import { periodMonths, statementRows } from '@/domain/statements';
import { statementLines } from '@/domain/view';
import { useFinance } from '@/hooks/FinanceContext';
import { useMarked } from '@/hooks/useMarked';
import { useWide } from '@/hooks/useWide';

/** The cash flow statement in one table: the waterfall column draws the AC (or FC) cash bridge beside the numbers. */
export function CashFlowPage({ waterfall, onWaterfall }: { waterfall: boolean; onWaterfall(on: boolean): void }) {
  const { snapshot, current, period, comparison, selection } = useFinance();
  const wide = useWide();
  const lines = useMemo(() => statementLines(snapshot, current, 'CF', period), [snapshot, current, period]);
  const all = useMemo(() => new Set(lines.filter((l) => l.hasChildren).map((l) => l.account.id)), [lines]);
  const marked = useMarked('CF');

  const cf = statementRows(snapshot, current, 'CF', period);
  const bs = statementRows(snapshot, current, 'BS', { month: period.month, mode: 'MTD' });
  const reconciled = Math.abs((cf['C-CLOSE'] ?? NaN) - (bs['B-CA-CASH'] ?? NaN)) < 0.5 && Math.abs(cf['C-OPEN'] + cf['C-NET'] - cf['C-CLOSE']) < 0.5;

  const op = lines.find((l) => l.account.id === 'C-OP');
  const dOp = comparison === 'PL' ? op?.dPl : op?.dPy;
  const message =
    dOp === undefined
      ? ''
      : `Operating cash flow ${fmtK(op?.cur)} kEUR, ${fmtDeltaK(dOp)} kEUR vs ${comparison === 'PL' ? 'budget' : 'previous year'}`;
  const months = periodMonths(period);
  const span = months.length > 1 ? `${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])}` : monthLabel(months[0]);

  return (
    <div className={wide ? 'grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-2' : 'grid gap-2'}>
      <PageTitle statement="Cash flow statement (indirect)" span={span} message={message}>
        <WaterfallToggle on={waterfall} onChange={onWaterfall} what="the cash flow" />
      </PageTitle>
      {/* The table spans the page; with a line selected it leaves the right 36 % to the action drawer. */}
      <Panel className={selection && wide ? 'mr-[36%]' : ''}>
        <StatementTable lines={lines} expanded={all} marked={marked} waterfall={waterfall ? 'cur' : 'off'} />
      </Panel>
      <div className={`flex items-center gap-2 border-t border-ink pt-2 text-[12px] ${reconciled ? '' : 'text-bad'} ${selection && wide ? 'mr-[36%]' : ''}`} role="status">
        <span className="text-[16px]" aria-hidden="true">
          {reconciled ? '✓' : '✗'}
        </span>
        {reconciled
          ? `Closing cash ${fmtK(cf['C-CLOSE'])} kEUR equals the balance sheet cash at ${monthLabel(period.month)}; opening cash plus the cash flow equals closing cash.`
          : `Closing cash ${fmtK(cf['C-CLOSE'])} kEUR does not equal the balance sheet cash ${fmtK(bs['B-CA-CASH'])} kEUR.`}
      </div>
    </div>
  );
}
