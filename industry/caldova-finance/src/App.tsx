import { useRef, useState } from 'react';

import { ActionDrawer } from '@/components/ActionDrawer';
import { AuthPage } from '@/components/AuthPage';
import { Header, PAGES, type PageId, type View } from '@/components/Header';
import { OriginalStatement } from '@/components/OriginalStatement';
import { useAuth } from '@/hooks/AuthContext';
import { FinanceProvider, useFinance } from '@/hooks/FinanceContext';
import { BalancePage } from '@/pages/BalancePage';
import { CashFlowPage } from '@/pages/CashFlowPage';
import { IncomePage } from '@/pages/IncomePage';
import { OFFLINE } from '@/services/bootstrap';
import { copyTable } from '@/services/clipboard';
import { exportExcel, exportPowerPoint, statementCopyTable } from '@/services/exports';
import { useWide } from '@/hooks/useWide';

function Shell() {
  const f = useFinance();
  const [page, setPage] = useState<PageId>('PL');
  // Per page: our IBCS table with actions (default) or Michael Tenner's original visual (read only).
  const [views, setViews] = useState<Record<PageId, View>>({ PL: 'table', BS: 'table', CF: 'table' });
  const view = views[page];
  // Income statement and cash flow open with their bars as a bridge (the cash bridge, the net income bridge).
  const [waterfall, setWaterfall] = useState<Record<PageId, boolean>>({ PL: true, BS: false, CF: true });
  const wide = useWide();
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const onExport = (kind: 'xlsx' | 'pptx' | 'copy') => {
    const input = { snapshot: f.snapshot, current: f.current, records: f.records, period: f.period, comparison: f.comparison, currentCode: f.currentCode };
    if (kind === 'copy') {
      // Synchronous inside the click (no import or await first), or the Fabric portal's iframe refuses the copy.
      const name = PAGES.find((p) => p.id === page)?.label ?? page;
      void copyTable(statementCopyTable(input, page)).then((ok) => {
        setNotice(ok ? `${name} copied: paste into Excel` : 'Copy failed: use the Excel export instead');
        clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => setNotice(null), 4000);
      });
      return;
    }
    setExporting(true);
    (kind === 'xlsx' ? exportExcel(input) : exportPowerPoint(input))
      .catch((e: unknown) => alert(`Export failed: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setExporting(false));
  };

  return (
    // Wide windows: one screen, nothing scrolls (PLAN.md §5.1). Narrow windows: the page grows and scrolls.
    <div className={`grid gap-2 px-4 pb-1 pt-2 ${wide ? 'h-full grid-rows-[auto_minmax(0,1fr)_auto]' : 'min-h-dvh grid-rows-[auto_1fr_auto]'}`}>
      <Header
        page={page}
        onPage={(p) => {
          setPage(p);
          f.select(null);
        }}
        view={view}
        onView={(v) => {
          setViews((s) => ({ ...s, [page]: v }));
          f.select(null);
        }}
        onExport={onExport}
      />
      <main className="relative min-h-0">
        <div className={wide ? 'h-full min-h-0' : view === 'visual' ? 'h-[max(560px,calc(100dvh-9rem))]' : ''}>
          {view === 'visual' ? (
            <OriginalStatement statement={page} />
          ) : page === 'PL' ? (
            <IncomePage waterfall={waterfall.PL} onWaterfall={(on) => setWaterfall((s) => ({ ...s, PL: on }))} />
          ) : page === 'BS' ? (
            <BalancePage />
          ) : (
            <CashFlowPage waterfall={waterfall.CF} onWaterfall={(on) => setWaterfall((s) => ({ ...s, CF: on }))} />
          )}
        </div>
        {/* Wide: over the chart column (36 % of the page) below the title row with its switch, never over the table. Narrow: a sheet over the window. */}
        {f.selection && view === 'table' && (
          <div className={wide ? 'absolute bottom-0 right-0 top-[3.25rem] w-[calc(36%-0.5rem)] bg-paper' : 'fixed inset-y-0 right-0 z-30 w-[min(28rem,100%)] bg-paper p-3 shadow-xl'}>
            <ActionDrawer />
          </div>
        )}
      </main>
      <footer className={`flex justify-between gap-x-4 text-[10px] text-muted ${wide ? 'truncate' : 'flex-wrap'}`}>
        <span>
          {f.error ? (
            <span className="text-bad">{f.error}</span>
          ) : exporting ? (
            'Preparing the export…'
          ) : notice ? (
            <span role="status">{notice}</span>
          ) : (
            `Records as of ${f.records.readAt.toLocaleTimeString('en-GB')}`
          )}
          {OFFLINE && ' · Offline demo: records stay in this browser'}
        </span>
        <span>
          Fictional data · IBCS notation, not certified · After Michael Tenner's IBCS Finance Cockpit (DatenWG) · Statements baked{' '}
          {new Date(f.snapshot.meta.bakedAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
        </span>
      </footer>
    </div>
  );
}

export default function App() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div className="grid h-full place-items-center text-muted">Signing in…</div>;
  if (!isAuthenticated) return <AuthPage />;
  return (
    <FinanceProvider>
      <Shell />
    </FinanceProvider>
  );
}
