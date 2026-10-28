// KPI Cockpit page (former Finance KPI Cockpit): KPI row · variance chart +
// structure · KPI table + profit bridge, slicers in the shared control pane.
// Caldova Finanzen tab (PLAN-FINANZEN.md §11): Data Agent, comments, sign-off, story mode and the time
// travel scrubber are left out (decisions Q4, Q5 and shell features); PowerPoint and PDF export stay.

import { FileDown, Presentation } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { ProfitBridge } from '@finanzen/components/charts/ProfitBridge';
import { StructureChart } from '@finanzen/components/charts/StructureChart';
import { TimeChart } from '@finanzen/components/charts/TimeChart';
import { FilterPanel } from '@finanzen/components/FilterPanel';
import { KpiCards } from '@finanzen/components/KpiCards';
import { KpiTable } from '@finanzen/components/KpiTable';
import { Breadcrumb, type Crumb } from '@finanzen/components/shell/Breadcrumb';
import { PageLayout } from '@finanzen/components/shell/ControlPane';
import { ErrorBox, LoadingTiles } from '@finanzen/components/shell/States';
import { CockpitContext, type CockpitContextValue } from '@finanzen/hooks/cockpit.context';
import { usePageCommands, useShell, type Command } from '@finanzen/hooks/shell.context';
import { useCockpitData } from '@finanzen/hooks/use-cockpit-data';
import type { Cube, RefScen, Scen } from '@finanzen/lib/cockpit/cube';
import { MONTH_SHORT, periodLabel } from '@finanzen/lib/cockpit/format';
import { buildCatalogue, kpiValue, type KpiDef } from '@finanzen/lib/cockpit/kpis';
import { exportCockpitPptx } from '@finanzen/lib/export/pptx';
import { choiceOf, DEFAULT_VIEW, filterOf, fromHash, monthsOf, primaryCode, toHash, type View } from '@finanzen/lib/cockpit/view';

const REF_LABEL: Record<RefScen, string> = { PY: 'Vorjahr', PL: 'Plan', FC: 'Forecast' };

export function CockpitPage() {
  const { state, progress, refetch } = useCockpitData();
  if (state.status === 'loading') return <LoadingTiles text={`Kennzahlen werden geladen … ${progress.done} von ${progress.total} Abfragen fertig`} />;
  if (state.status === 'error')
    return <ErrorBox title="Kennzahlen konnten nicht geladen werden" message={state.message} onRetry={() => void refetch()} />;
  return <Cockpit cube={state.cube} />;
}

function Cockpit({ cube }: { cube: Cube }) {
  const { qs, setQs } = useShell();
  const [exporting, setExporting] = useState(false);
  const view = useMemo(() => fromHash(qs), [qs]);
  const setView = useCallback((patch: Partial<View>) => setQs(toHash({ ...view, ...patch }).replace(/^#/, '')), [view, setQs]);

  const catalogue = useMemo(() => buildCatalogue(cube), [cube]);
  const months = useMemo(() => monthsOf(view, cube), [view, cube]);
  const choice = useMemo(() => choiceOf(view), [view]);
  const filter = useMemo(() => filterOf(view, cube), [view, cube]);
  const kpi = catalogue.find((k) => k.id === view.kpi) ?? catalogue[0];

  const value = useCallback(
    (k: KpiDef, scen: Scen, ms?: number[], f?: CockpitContextValue['filter']) => kpiValue(cube, k, scen, ms ?? months, f ?? filter, choice),
    [cube, months, filter, choice]
  );

  const ctx: CockpitContextValue = useMemo(
    () => ({
      cube,
      catalogue,
      view,
      setView,
      months,
      choice,
      filter,
      kpi,
      primary: primaryCode(view, cube),
      value,
      refCode: (r: RefScen) => r,
      scenName: (s: Scen) => {
        if (s === 'ACT') return primaryCode(view, cube);
        if (s === 'PY') return `PY · Ist ${cube.year - 1}`;
        const id = s === 'PL' ? view.plan : view.fc;
        return `${s} · ${cube.scenarioNames[id] ?? id}`;
      },
    }),
    [cube, catalogue, view, setView, months, choice, filter, kpi, value]
  );

  const crumbs: Crumb[] = [
    { key: 'period', label: 'Zeitraum', value: periodLabel(months, cube.year), title: `Ist bis ${MONTH_SHORT[cube.lastAc - 1]} ${cube.year}` },
    { key: 'ref', label: 'Vergleich', value: `${primaryCode(view, cube)} vs ${view.ref} (${REF_LABEL[view.ref]})` },
    { key: 'plan', label: 'Plan', value: `${view.plan} · ${cube.scenarioNames[view.plan] ?? view.plan}` },
    { key: 'fc', label: 'Forecast', value: `${view.fc} · ${cube.scenarioNames[view.fc] ?? view.fc}` },
    { key: 'kpi', label: 'Kennzahl', value: kpi.label },
    ...view.markets.map((m) => ({ key: `m:${m}`, label: 'Stadtbezirk', value: m, onRemove: () => setView({ markets: view.markets.filter((x) => x !== m) }) })),
    ...view.products.map((p) => ({ key: `p:${p}`, label: 'Kategorie', value: p, onRemove: () => setView({ products: view.products.filter((x) => x !== p) }) })),
  ];

  const commands = useMemo<Command[]>(() => {
    const out: Command[] = [];
    for (const k of catalogue) out.push({ id: `kpi:${k.id}`, group: 'Kennzahl', label: k.label, keywords: `${k.id} ${k.short} ${k.group}`, run: () => setView({ kpi: k.id }) });
    for (const m of cube.markets)
      out.push({
        id: `mkt:${m.land}`,
        group: 'Stadtbezirk filtern',
        label: m.land,
        keywords: m.region,
        hint: view.markets.includes(m.land) ? 'aktiv' : m.region,
        run: () => setView({ markets: view.markets.includes(m.land) ? view.markets.filter((x) => x !== m.land) : [...view.markets, m.land] }),
      });
    for (const p of cube.products)
      out.push({
        id: `prd:${p.produkt}`,
        group: 'Kategorie filtern',
        label: p.produkt,
        keywords: p.kategorie,
        hint: view.products.includes(p.produkt) ? 'aktiv' : p.kategorie,
        run: () => setView({ products: view.products.includes(p.produkt) ? view.products.filter((x) => x !== p.produkt) : [...view.products, p.produkt] }),
      });
    out.push(
      { id: 'per:ytd', group: 'Zeitraum', label: 'YTD', keywords: 'year to date bis heute', run: () => setView({ period: 'ytd' }) },
      { id: 'per:fy', group: 'Zeitraum', label: 'Gesamtjahr', keywords: 'jahr fy', run: () => setView({ period: 'fy' }) },
      { id: 'ref:PY', group: 'Vergleich', label: 'mit Vorjahr (PY)', run: () => setView({ ref: 'PY' }) },
      { id: 'ref:PL', group: 'Vergleich', label: 'mit Plan (PL)', run: () => setView({ ref: 'PL' }) },
      { id: 'ref:FC', group: 'Vergleich', label: 'mit Forecast (FC)', run: () => setView({ ref: 'FC' }) }
    );
    for (const id of ['PL1', 'PL2'] as const) out.push({ id: `pl:${id}`, group: 'Version', label: `${id} · ${cube.scenarioNames[id] ?? id}`, keywords: 'plan', run: () => setView({ plan: id }) });
    for (const id of ['FC1', 'FC2', 'FC3'] as const)
      out.push({ id: `fc:${id}`, group: 'Version', label: `${id} · ${cube.scenarioNames[id] ?? id}`, keywords: 'forecast', run: () => setView({ fc: id }) });
    if (view.markets.length + view.products.length)
      out.push({ id: 'clear', group: 'Filter', label: 'Alle Filter aufheben', run: () => setView({ markets: [], products: [] }) });
    out.push({ id: 'reset', group: 'Filter', label: 'Sicht zurücksetzen', keywords: 'standard default', run: () => setQs(toHash(DEFAULT_VIEW).replace(/^#/, '')) });
    return out;
  }, [catalogue, cube, view, setView, setQs]);
  const runPptx = useCallback(async () => {
    setExporting(true);
    try {
      // IBCS colours live on the Finanzen tab root (finanzen.css), not on <html>.
      const css = getComputedStyle(document.querySelector<HTMLElement>("[data-tab='finanzen']") ?? document.documentElement);
      await exportCockpitPptx({
        cube,
        catalogue,
        kpi,
        months,
        filter,
        choice,
        ref: view.ref,
        periodLabel: periodLabel(months, cube.year),
        filterLabel: [...view.markets, ...view.products].join(', '),
        colors: { good: css.getPropertyValue('--ibcs-good').trim() || '#5dbb2c', bad: css.getPropertyValue('--ibcs-bad').trim() || '#c0392b' },
      });
    } finally {
      setExporting(false);
    }
  }, [cube, catalogue, kpi, months, filter, choice, view]);
  const allCommands = useMemo<Command[]>(
    () => [
      ...commands,
      { id: 'pptx', group: 'Exportieren', label: 'Als PowerPoint exportieren', keywords: 'pptx folien slides', run: () => void runPptx() },
      { id: 'pdf', group: 'Exportieren', label: 'Als PDF drucken', keywords: 'pdf print drucken', run: () => window.print() },
    ],
    [commands, runPptx]
  );
  usePageCommands('cockpit', allCommands);

  const extra = (
    <>
      <ToolButton label={exporting ? 'PowerPoint wird erstellt …' : 'Als PowerPoint exportieren'} onClick={() => void runPptx()} disabled={exporting}>
        <Presentation className="icon-size-200" />
      </ToolButton>
      <ToolButton label="Als PDF drucken" onClick={() => window.print()}>
        <FileDown className="icon-size-200" />
      </ToolButton>
    </>
  );

  return (
    <CockpitContext.Provider value={ctx}>
      <Breadcrumb crumbs={crumbs} onClearAll={() => setView({ markets: [], products: [] })} extra={extra} />
      <div className="mx-auto w-full max-w-[1920px] px-400 py-400 md:px-600 md:py-600">
        <PageLayout
          pane={
            <div className="flex flex-col gap-300">
              <FilterPanel />
            </div>
          }
        >
          <KpiCards />
          <div className="grid gap-[18px] 2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <TimeChart />
            <StructureChart />
          </div>
          <div className="grid gap-[18px] 2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <KpiTable />
            <ProfitBridge />
          </div>
        </PageLayout>
      </div>
    </CockpitContext.Provider>
  );
}

function ToolButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md p-200 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
    >
      {children}
    </button>
  );
}
