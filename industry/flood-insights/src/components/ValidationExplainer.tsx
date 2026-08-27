import { createPortal } from 'react-dom';

import { useI18n } from '@/i18n';
import type { ValidationResult } from './ValidationPanel';

/**
 * "What does 0.51 actually mean?" — the validation explainer (PLAN §6.5).
 *
 * The panel on the map states the number and that it misses its target. That is honest but not
 * useful: a stranger reading "IoU 0,51" learns that something scored badly, not what to trust and
 * what not to. This overlay answers three questions in order — what the number is, how badly it
 * matters, and why it cannot simply be tuned away.
 *
 * Every figure here comes from `validation.json`, which the pipeline writes. None of it is typed
 * into the front end, because a hand-copied metric drifts away from the data the moment either
 * changes.
 *
 * ⚠️ The temptation this component exists to resist is softening. The disagreement is *not* a
 * shallow rim around a basically correct flood: its median depth is over a metre. Saying so plainly
 * is the point — a flood model that oversold its own accuracy would be the worse failure.
 */

interface Props {
  result: ValidationResult;
  onClose: () => void;
}

/** A single number with a label, sized so the figure is what the eye lands on. */
function Stat({ value, label, tone }: { value: string; label: string; tone?: 'warn' | 'good' }) {
  const colour =
    tone === 'warn' ? 'text-amber-700' : tone === 'good' ? 'text-emerald-700' : 'text-stone-900';
  return (
    <div className="rounded border border-stone-200 bg-white/60 p-3">
      <div className={`text-lg font-semibold tabular-nums ${colour}`}>{value}</div>
      <div className="mt-0.5 leading-snug text-stone-500">{label}</div>
    </div>
  );
}

export function ValidationExplainer({ result, onClose }: Props) {
  const { t, locale } = useI18n();
  const tag = locale === 'de' ? 'de-DE' : 'en-GB';
  const n2 = new Intl.NumberFormat(tag, { maximumFractionDigits: 2 });
  // IoU always to two decimals. With `maximumFractionDigits` alone, 0.50 renders as "0,5" and sits
  // in the same cell as "0,51", which reads as a different precision rather than a lower score.
  const iouFmt = new Intl.NumberFormat(tag, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const pct = (v: number) =>
    new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(v * 100);

  const d = result.diagnostics;
  const missRate = 1 - result.hitRate;
  const overStatementPct = d ? (d.overStatementFactor - 1) * 100 : 0;

  /*
    Portalled to <body> on purpose. The validation panel sits inside a `backdrop-blur` container,
    and a backdrop-filter establishes a containing block for fixed-position descendants — so
    `fixed inset-0` resolved to the 18 rem wide rail instead of the viewport, and the overlay
    rendered as a clipped, scrollable sliver inside it. No amount of z-index fixes that; escaping
    the ancestor does.
  */
  return createPortal(
    <div
      data-testid="validation-explainer"
      role="dialog"
      aria-label={t('validation.explain.title')}
      className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-stone-900/30 p-6 backdrop-blur-sm"
    >
      <div className="w-full max-w-3xl rounded border border-stone-300 bg-stone-50 p-6 text-xs leading-relaxed shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-stone-900">
              {t('validation.explain.title')}
            </h2>
            <p className="mt-0.5 text-[0.7rem] uppercase tracking-[0.15em] text-stone-500">
              {t('validation.explain.subtitle', { iou: iouFmt.format(result.iou) })}
            </p>
          </div>
          <button
            type="button"
            data-testid="validation-explainer-close"
            onClick={onClose}
            className="rounded border border-stone-300 bg-stone-100 px-2 py-1 text-stone-600 hover:bg-stone-200 hover:text-stone-900"
          >
            {t('steinbach.close')}
          </button>
        </div>

        {/* TL;DR ------------------------------------------------------------------------------ */}
        <div
          data-testid="validation-tldr"
          className="mt-4 rounded border border-stone-300 bg-stone-100 p-4"
        >
          <div className="text-[0.7rem] uppercase tracking-[0.15em] text-stone-500">
            {t('validation.explain.tldrLabel')}
          </div>
          <ul className="mt-2 list-disc space-y-1.5 pl-4 text-stone-700">
            <li>{t('validation.explain.tldr1', { hit: pct(result.hitRate) })}</li>
            <li>
              {t('validation.explain.tldr2', {
                over: n2.format(overStatementPct),
                km2: n2.format(d?.falseAlarmKm2 ?? 0),
              })}
            </li>
            <li>{t('validation.explain.tldr3')}</li>
          </ul>
        </div>

        {/* What the number is ----------------------------------------------------------------- */}
        <h3 className="mt-6 text-[0.7rem] uppercase tracking-[0.15em] text-stone-500">
          {t('validation.explain.whatHeading')}
        </h3>
        <p className="mt-2 text-stone-600">{t('validation.explain.whatBody')}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            value={`${n2.format(result.observedKm2)} km²`}
            label={t('validation.explain.statObserved')}
          />
          <Stat
            value={`${n2.format(result.simulatedKm2)} km²`}
            label={t('validation.explain.statSimulated')}
          />
          <Stat
            value={`${n2.format(result.intersectionKm2)} km²`}
            label={t('validation.explain.statShared')}
          />
          <Stat
            value={iouFmt.format(result.iou)}
            label={t('validation.explain.statIou')}
            tone="warn"
          />
        </div>
        <p className="mt-2 text-[0.65rem] text-stone-500">
          {t('validation.explain.formula', {
            shared: n2.format(result.intersectionKm2),
            combined: n2.format(
              result.observedKm2 + result.simulatedKm2 - result.intersectionKm2
            ),
            iou: iouFmt.format(result.iou),
          })}
        </p>

        {/* Two kinds of error ----------------------------------------------------------------- */}
        <h3 className="mt-6 text-[0.7rem] uppercase tracking-[0.15em] text-stone-500">
          {t('validation.explain.errorHeading')}
        </h3>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded border border-stone-200 bg-white/60 p-3">
            <div className="text-lg font-semibold tabular-nums text-emerald-700">
              {pct(missRate)} %
            </div>
            <div className="mt-0.5 text-stone-600">{t('validation.explain.missTitle')}</div>
            <p className="mt-1 text-stone-500">{t('validation.explain.missBody')}</p>
          </div>
          <div className="rounded border border-stone-200 bg-white/60 p-3">
            <div className="text-lg font-semibold tabular-nums text-amber-700">
              {pct(result.falseAlarmRatio)} %
            </div>
            <div className="mt-0.5 text-stone-600">{t('validation.explain.falseTitle')}</div>
            <p className="mt-1 text-stone-500">
              {t('validation.explain.falseBody', { km2: n2.format(d?.falseAlarmKm2 ?? 0) })}
            </p>
          </div>
        </div>

        {/* How much it matters ---------------------------------------------------------------- */}
        <h3 className="mt-6 text-[0.7rem] uppercase tracking-[0.15em] text-stone-500">
          {t('validation.explain.impactHeading')}
        </h3>
        {d && (
          <>
            <p className="mt-2 text-stone-600">
              {t('validation.explain.impactBody', {
                median: n2.format(d.falseAlarmMedianDepthM ?? 0),
                p75: n2.format(d.falseAlarmP75DepthM ?? 0),
                shallow: pct(d.falseAlarmShallowShare ?? 0),
              })}
            </p>
            <p
              data-testid="validation-upper-bound"
              className="mt-2 font-medium text-stone-900"
            >
              {t('validation.explain.upperBound', { over: n2.format(overStatementPct) })}
            </p>
            <p className="mt-2 text-stone-600">{t('validation.explain.lowerBound')}</p>
          </>
        )}

        {/* Why it cannot be tuned ------------------------------------------------------------- */}
        <h3 className="mt-6 text-[0.7rem] uppercase tracking-[0.15em] text-stone-500">
          {t('validation.explain.tuningHeading')}
        </h3>
        <p className="mt-2 text-stone-600">{t('validation.explain.tuningBody')}</p>
        <table data-testid="validation-probes" className="mt-2 w-full">
          <thead>
            <tr className="text-left text-[0.65rem] uppercase tracking-wider text-stone-500">
              <th className="py-1 font-normal">{t('validation.explain.probeName')}</th>
              <th className="py-1 text-right font-normal">{t('validation.explain.probeRange')}</th>
              <th className="py-1 text-right font-normal">{t('validation.explain.probeResult')}</th>
            </tr>
          </thead>
          <tbody className="text-stone-700">
            {/*
              The first two are the physical parameters, swept in the Phase 3 validation run
              (PLAN §6.5) and reproducible with `validate_simulation.py --sweep`. The last two are
              measured in every run and read straight out of validation.json.
            */}
            <tr className="border-t border-stone-200">
              <td className="py-1.5">{t('validation.explain.probePeak')}</td>
              <td className="py-1.5 text-right tabular-nums text-stone-500">800–1.230 m³/s</td>
              <td className="py-1.5 text-right tabular-nums">0,506 → 0,504</td>
            </tr>
            <tr className="border-t border-stone-200">
              <td className="py-1.5">{t('validation.explain.probeManning')}</td>
              <td className="py-1.5 text-right tabular-nums text-stone-500">0,030–0,070</td>
              <td className="py-1.5 text-right tabular-nums">0,494 → 0,508</td>
            </tr>
            {d?.iouExcludingBuiltUp !== undefined && (
              <tr className="border-t border-stone-200">
                <td className="py-1.5">{t('validation.explain.probeBuiltUp')}</td>
                <td className="py-1.5 text-right tabular-nums text-stone-500">
                  {t('validation.explain.probeBuiltUpRange', {
                    share: pct(d.builtUpShareOfFalseAlarm ?? 0),
                  })}
                </td>
                <td className="py-1.5 text-right tabular-nums text-amber-700">
                  {iouFmt.format(result.iou)} → {iouFmt.format(d.iouExcludingBuiltUp)}
                </td>
              </tr>
            )}
            {d?.depthThresholdSweep && (
              <tr className="border-t border-stone-200">
                <td className="py-1.5">{t('validation.explain.probeThreshold')}</td>
                <td className="py-1.5 text-right tabular-nums text-stone-500">
                  0–{n2.format(d.depthThresholdSweep[d.depthThresholdSweep.length - 1].thresholdM)}{' '}
                  m
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {iouFmt.format(d.depthThresholdSweep[0].iou)} →{' '}
                  {iouFmt.format(d.depthThresholdSweep[d.depthThresholdSweep.length - 1].iou)}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <h3 className="mt-6 text-[0.7rem] uppercase tracking-[0.15em] text-stone-500">
          {t('validation.explain.residualHeading')}
        </h3>
        <ul className="mt-2 list-disc space-y-1.5 pl-4 text-stone-600">
          <li>{t('validation.explain.residual1')}</li>
          <li>{t('validation.explain.residual2')}</li>
          <li>
            {t('validation.explain.residual3', {
              share: pct(d?.builtUpShareOfFalseAlarm ?? 0),
            })}
          </li>
        </ul>

        <p
          data-testid="validation-explainer-honesty"
          className="mt-5 border-t border-stone-300 pt-3 text-stone-600"
        >
          {t('validation.explain.honesty', {
            iou: iouFmt.format(result.iou),
            target: iouFmt.format(result.target),
          })}
        </p>
        <p className="mt-2 text-[0.65rem] text-stone-500">{result.attribution}</p>
      </div>
    </div>,
    document.body
  );
}
