import { useEffect, useState } from 'react';

import { useI18n } from '@/i18n';
import { ValidationExplainer } from './ValidationExplainer';

/**
 * Where the model and the observation disagree, measured by `validate_simulation.py`.
 *
 * Optional because an older `validation.json` will not have it, and a missing diagnostic block
 * must degrade to "no explainer" rather than to a crash.
 */
export interface ValidationDiagnostics {
  falseAlarmKm2: number;
  overStatementFactor: number;
  agreementMedianDepthM: number;
  falseAlarmMedianDepthM?: number;
  falseAlarmP75DepthM?: number;
  falseAlarmShallowShare?: number;
  builtUpShareOfFalseAlarm?: number;
  iouExcludingBuiltUp?: number;
  depthThresholdSweep?: { thresholdM: number; iou: number }[];
}

export interface ValidationResult {
  iou: number;
  hitRate: number;
  falseAlarmRatio: number;
  observedKm2: number;
  simulatedKm2: number;
  intersectionKm2: number;
  target: number;
  meetsTarget: boolean;
  product: string;
  gridResolutionM: number;
  peakDischargeM3s: number;
  caveats: string[];
  attribution: string;
  diagnostics?: ValidationDiagnostics;
}

/**
 * PLAN §6.5 — the validation panel.
 *
 * This shows the model failing its own target. That is deliberate: the plan says an honest number
 * with its explanation is more credible than a flattering one, and §2 forbids precision theatre.
 * The panel therefore leads with the metric, states plainly whether the target was met, and lists
 * the caveats that bound what the number means.
 */
export function ValidationPanel({ aoiId }: { aoiId: string }) {
  const { t, locale } = useI18n();
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [open, setOpen] = useState(false);
  const [explaining, setExplaining] = useState(false);

  useEffect(() => {
    fetch(`/terrain/${aoiId}/validation.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setResult)
      .catch(() => setResult(null));
  }, [aoiId]);

  if (!result) return null;

  const nf = new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    maximumFractionDigits: 2,
  });

  return (
    <div
      data-testid="validation-panel"
      // Positioned by the right-hand rail in Twin3DView rather than by itself, so it and the
      // village list share one column and cannot overlap each other.
      className="pointer-events-auto w-full shrink-0 rounded border border-stone-300 bg-stone-50/92 p-4 text-xs shadow-sm backdrop-blur"
    >
      <button
        type="button"
        data-testid="validation-toggle"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline justify-between gap-3 text-left"
      >
        <span className="text-stone-700">{t('validation.heading')}</span>
        <span
          data-testid="validation-iou"
          className={result.meetsTarget ? 'text-stone-900' : 'text-amber-700'}
        >
          IoU {nf.format(result.iou)}
        </span>
      </button>

      <p data-testid="validation-verdict" className="mt-2 leading-relaxed text-stone-500">
        {result.meetsTarget
          ? t('validation.met', { target: nf.format(result.target) })
          : t('validation.notMet', { target: nf.format(result.target) })}{' '}
        {/*
          Inline, inside the verdict sentence, rather than a button of its own. As a separate block
          it added a row to a panel that shares a fixed-height rail with the village list, and the
          pair grew far enough down the screen to clip the hazard legend in the bottom strip. It
          also reads better here: the question follows the statement that provokes it.
        */}
        <button
          type="button"
          data-testid="validation-explain"
          onClick={() => setExplaining(true)}
          className="underline decoration-stone-400 underline-offset-2 hover:text-stone-900"
        >
          {t('validation.explain.open')}
        </button>
      </p>

      {explaining && (
        <ValidationExplainer result={result} onClose={() => setExplaining(false)} />
      )}

      {open && (
        <div data-testid="validation-detail" className="mt-3 space-y-3 text-stone-500">
          <dl className="space-y-1">
            <div className="flex justify-between gap-3">
              <dt>{t('validation.hitRate')}</dt>
              <dd className="text-stone-800">{nf.format(result.hitRate)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>{t('validation.falseAlarm')}</dt>
              <dd className="text-stone-800">{nf.format(result.falseAlarmRatio)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>{t('validation.observed')}</dt>
              <dd className="text-stone-800">{nf.format(result.observedKm2)} km²</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>{t('validation.simulated')}</dt>
              <dd className="text-stone-800">{nf.format(result.simulatedKm2)} km²</dd>
            </div>
          </dl>

          <ul data-testid="validation-caveats" className="list-disc space-y-1.5 pl-4">
            {result.caveats.map((caveat) => (
              <li key={caveat} className="leading-relaxed">
                {caveat}
              </li>
            ))}
          </ul>

          <p className="leading-relaxed text-stone-400">{result.attribution}</p>
        </div>
      )}
    </div>
  );
}
