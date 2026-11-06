import type { ReactNode } from 'react';

import { useFinance } from '@/hooks/FinanceContext';

/** IBCS message title: who, what, when, unit on one line, the message below in bold; page controls on the right. */
export function PageTitle({ statement, span, message, children }: { statement: string; span: string; message: string; children?: ReactNode }) {
  const { snapshot } = useFinance();
  return (
    <div className="flex min-h-0 items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[12px] text-muted">
          {snapshot.meta.company} · {statement} · {span} · kEUR
        </div>
        <div className="truncate text-[17px] font-semibold leading-6">{message || ' '}</div>
      </div>
      {children}
    </div>
  );
}

/** On/off switch for the waterfall: the table's bars as a running bridge, or plain from zero. */
export function WaterfallToggle({ on, onChange, what }: { on: boolean; onChange(on: boolean): void; what: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={on ? `Showing ${what} as a waterfall` : `Show ${what} as a waterfall`}
      onClick={() => onChange(!on)}
      className="flex shrink-0 items-center gap-2 rounded border border-ink px-2 py-[3px] text-[12px] hover:bg-soft"
    >
      <span className={`relative inline-block h-[14px] w-[26px] rounded-full ${on ? 'bg-ink' : 'bg-hair'}`} aria-hidden="true">
        <span className={`absolute top-[2px] size-[10px] rounded-full bg-paper transition-[left] ${on ? 'left-[14px]' : 'left-[2px]'}`} />
      </span>
      Waterfall
    </button>
  );
}

/** A panel with an optional small title; it never scrolls. */
export function Panel({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`grid min-h-0 min-w-0 ${title ? 'grid-rows-[auto_minmax(0,1fr)]' : 'grid-rows-[minmax(0,1fr)]'} ${className}`}>
      {title && <h2 className="truncate pb-1 text-[12px] font-semibold text-ink">{title}</h2>}
      <div className="panel">{children}</div>
    </section>
  );
}
