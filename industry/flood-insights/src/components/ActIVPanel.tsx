import { useEffect, useMemo, useState } from 'react';

import { useI18n } from '@/i18n';
import { peakDischargeForScenario } from '@/twin3d/hydrograph';
import type { FlowFieldMeta } from '@/twin3d/terrainLoader';
import {
  DEFAULT_LEVERS,
  runWhatIf,
  type Levers,
  type PortfolioBundle,
  type WhatIfResult,
} from '@/twin3d/whatif';

/**
 * Act IV — "Was hätte geholfen?" (PLAN §3, §7.4).
 *
 * The act the whole application exists for. Each lever is labelled with the lesson it belongs to,
 * and every KPI is shown against the 2021 baseline so the change is the message rather than the
 * absolute number.
 *
 * Tone (PLAN §2.3): descriptive only. The panel shows what the data does when a lever moves. It
 * never argues for a policy, and there is no imperative mood anywhere in the copy.
 */

interface Props {
  portfolio: PortfolioBundle;
  flow: FlowFieldMeta;
  onStageOffsetChange?: (metres: number) => void;
}

function formatEur(value: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    notation: 'compact',
    maximumFractionDigits: 1,
    style: 'currency',
    currency: 'EUR',
  }).format(value);
}

function Delta({ value, invert = false }: { value: number; invert?: boolean }) {
  if (!isFinite(value) || Math.abs(value) < 0.05) return null;
  // "Better" is fewer people and less loss, so a fall is the good direction unless inverted.
  const good = invert ? value > 0 : value < 0;
  return (
    <span className={good ? 'text-emerald-700' : 'text-amber-700'}>
      {value > 0 ? '+' : ''}
      {value.toFixed(0)}%
    </span>
  );
}

export function ActIVPanel({ portfolio, flow, onStageOffsetChange }: Props) {
  const { t, locale } = useI18n();
  const [levers, setLevers] = useState<Levers>(DEFAULT_LEVERS);
  const [open, setOpen] = useState(false);

  const common = useMemo(
    () => ({
      portfolio,
      bedProfileM: flow.bedProfileM,
      ratingDischargeM3s: flow.ratingDischargeM3s,
      ratingStageM: flow.ratingStageM,
      basePeakM3s: peakDischargeForScenario(),
      reachLengthM: flow.riverLengthKm * 1000,
    }),
    [portfolio, flow]
  );

  const baseline: WhatIfResult = useMemo(
    () => runWhatIf({ ...common, levers: DEFAULT_LEVERS }),
    [common]
  );
  const result: WhatIfResult = useMemo(() => runWhatIf({ ...common, levers }), [common, levers]);

  useEffect(() => {
    onStageOffsetChange?.(levers.stageOffsetM);
  }, [levers.stageOffsetM, onStageOffsetChange]);

  const pct = (now: number, before: number) => (before === 0 ? 0 : ((now - before) / before) * 100);
  const nf1 = useMemo(
    () =>
      new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    [locale]
  );
  const set = <K extends keyof Levers>(key: K, value: Levers[K]) =>
    setLevers((prev) => ({ ...prev, [key]: value }));

  const kpis = [
    {
      id: 'people',
      label: t('act4.people'),
      value: result.peopleInAffectedArea.toLocaleString(locale === 'de' ? 'de-DE' : 'en-GB'),
      delta: pct(result.peopleInAffectedArea, baseline.peopleInAffectedArea),
    },
    {
      id: 'loss',
      label: t('act4.loss'),
      value: formatEur(result.estimatedLossEur, locale),
      delta: pct(result.estimatedLossEur, baseline.estimatedLossEur),
    },
    {
      id: 'uncovered',
      label: t('act4.uncovered'),
      value: formatEur(result.uncoveredEur, locale),
      delta: pct(result.uncoveredEur, baseline.uncoveredEur),
    },
    {
      id: 'buildings',
      label: t('act4.buildings'),
      value: result.floodedBuildings.toLocaleString(locale === 'de' ? 'de-DE' : 'en-GB'),
      delta: pct(result.floodedBuildings, baseline.floodedBuildings),
    },
  ];

  return (
    <div
      data-testid="act4-panel"
      className="pointer-events-auto absolute left-5 top-5 w-[22rem] rounded border border-stone-300 bg-stone-50/92 p-4 text-xs shadow-sm backdrop-blur"
    >
      <button
        type="button"
        data-testid="act4-toggle"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline justify-between gap-3 text-left"
      >
        <span className="font-semibold text-stone-800">{t('act4.heading')}</span>
        <span className="text-stone-500">{open ? '−' : '+'}</span>
      </button>

      <div data-testid="act4-kpis" className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        {kpis.map((kpi) => (
          <div key={kpi.id} data-testid={`act4-kpi-${kpi.id}`}>
            <div className="text-[0.65rem] uppercase tracking-wide text-stone-500">{kpi.label}</div>
            <div className="flex items-baseline gap-2">
              <span className="text-sm text-stone-900">{kpi.value}</span>
              <Delta value={kpi.delta} />
            </div>
          </div>
        ))}
      </div>

      {open && (
        <div data-testid="act4-levers" className="mt-4 space-y-4">
          <Lever
            id="warning"
            label={t('act4.lever.warning')}
            lesson={t('act4.lesson1')}
            value={levers.warningHours}
            min={0}
            max={12}
            step={1}
            display={`+${levers.warningHours} h`}
            onChange={(v) => set('warningHours', v)}
          />
          <Lever
            id="stage"
            label={t('act4.lever.stage')}
            lesson={t('act4.lesson2')}
            value={levers.stageOffsetM}
            min={-1}
            max={1}
            step={0.1}
            // Localised, not `toFixed`. "0.0 m" with a full stop is not German, and this panel is
            // German by default — the same defect the Steinbachtalsperre panel had.
            display={`${levers.stageOffsetM > 0 ? '+' : ''}${nf1.format(levers.stageOffsetM)} m`}
            onChange={(v) => set('stageOffsetM', v)}
          />
          <Lever
            id="elementar"
            label={t('act4.lever.elementar')}
            lesson={t('act4.lesson3')}
            value={levers.elementarShare ?? result.elementarSharePct / 100}
            min={0}
            max={1}
            step={0.05}
            display={`${Math.round((levers.elementarShare ?? result.elementarSharePct / 100) * 100)} %`}
            onChange={(v) => set('elementarShare', v)}
          />
          <Lever
            id="retention"
            label={t('act4.lever.retention')}
            lesson={t('act4.lesson5Retention')}
            value={levers.retentionShare}
            min={0}
            max={0.4}
            step={0.05}
            // The minus belongs to the number, not to the label. Hard-coded it printed "−0 %" at
            // rest, which reads as a defect rather than as "no retention".
            display={`${levers.retentionShare > 0 ? '−' : ''}${Math.round(
              levers.retentionShare * 100
            )} %`}
            onChange={(v) => set('retentionShare', v)}
          />
          <Lever
            id="resilient"
            label={t('act4.lever.resilient')}
            lesson={t('act4.lesson5Resilient')}
            value={levers.resilientShare}
            min={0}
            max={1}
            step={0.05}
            display={`${Math.round(levers.resilientShare * 100)} %`}
            onChange={(v) => set('resilientShare', v)}
          />

          <button
            type="button"
            data-testid="act4-reset"
            onClick={() => setLevers(DEFAULT_LEVERS)}
            className="rounded border border-stone-300 px-3 py-1 text-xs text-stone-600 hover:text-stone-900"
          >
            {t('act4.reset')}
          </button>

          <p className="leading-relaxed text-stone-500">{t('act4.note')}</p>
        </div>
      )}
    </div>
  );
}

function Lever({
  id,
  label,
  lesson,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  id: string;
  label: string;
  lesson: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={`act4-${id}`} className="text-stone-700">
          {label}
        </label>
        <span data-testid={`act4-value-${id}`} className="font-mono text-stone-900">
          {display}
        </span>
      </div>
      <input
        id={`act4-${id}`}
        data-testid={`act4-lever-${id}`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full accent-stone-600"
      />
      <p className="text-[0.65rem] leading-relaxed text-stone-500">{lesson}</p>
    </div>
  );
}
