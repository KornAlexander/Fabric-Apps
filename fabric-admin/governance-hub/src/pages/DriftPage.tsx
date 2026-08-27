import { useMemo, useState } from 'react';

import { SEVERITY_ORDER, summariseDrift, type DriftType, type Severity } from '@/domain/drift';
import { useAnalysis } from '@/hooks/useAnalysis';
import { useT } from '@/i18n';

const SEVERITY_STYLE: Record<Severity, string> = {
  Critical: 'bg-rose-50 text-rose-800 ring-rose-600/20',
  High: 'bg-amber-50 text-amber-900 ring-amber-600/20',
  Medium: 'bg-blue-50 text-blue-800 ring-blue-600/20',
  Low: 'bg-gray-100 text-gray-600 ring-gray-500/20',
};

const TYPES: DriftType[] = ['Missing', 'Extra', 'Blocked', 'Unknown'];

/**
 * Drift — desired entitlements versus collected reality (PLAN.md §11.3).
 *
 * The page makes one rule impossible to miss: **`Extra` access is never
 * auto-removed**. Auto-revoking is how a governance tool causes an outage at
 * 03:00, so removal is always an explicit human decision.
 */
export function DriftPage() {
  const t = useT();
  const { state, drift, assignments, assignmentsUnavailable, failures, reload } =
    useAnalysis();
  const [severity, setSeverity] = useState<Severity | 'all'>('all');
  const [driftType, setDriftType] = useState<DriftType | 'all'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const summary = useMemo(() => summariseDrift(drift), [drift]);
  const rows = useMemo(
    () =>
      drift
        .filter((d) => severity === 'all' || d.severity === severity)
        .filter((d) => driftType === 'all' || d.driftType === driftType),
    [drift, severity, driftType]
  );

  const noEntitlements = assignments.length === 0;

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{t('drift.title')}</h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">{t('drift.intro')}</p>
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={state === 'loading'}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {state === 'loading' ? t('common.loading') : t('inventory.refresh')}
        </button>
      </section>

      {state === 'no-model' && (
        <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-600/20 ring-inset">
          {t('model.notProvisioned')}
        </p>
      )}

      {assignmentsUnavailable ? (
        <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-600/20 ring-inset">
          {t('drift.noStore')}
        </p>
      ) : (
        noEntitlements &&
        state === 'ready' && (
          <p className="rounded-xl bg-blue-50 p-4 text-sm text-blue-900 ring-1 ring-blue-600/20 ring-inset">
            {t('drift.noEntitlements')}
          </p>
        )
      )}

      {failures.length > 0 && (
        <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-900 ring-1 ring-rose-600/20 ring-inset">
          {t('cando.incomplete')}
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-4">
        {SEVERITY_ORDER.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => setSeverity(severity === level ? 'all' : level)}
            className={`rounded-xl bg-white p-4 text-left shadow-sm ring-1 ${
              severity === level ? 'ring-2 ring-blue-500' : 'ring-gray-200'
            }`}
          >
            <p className="text-xs tracking-wide text-gray-500 uppercase">{level}</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">
              {summary.bySeverity[level]}
            </p>
          </button>
        ))}
      </section>

      <section className="flex flex-wrap gap-2">
        {TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setDriftType(driftType === type ? 'all' : type)}
            className={`rounded-full px-3 py-1 text-xs ring-1 ring-inset ${
              driftType === type
                ? 'bg-blue-600 text-white ring-blue-700'
                : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'
            }`}
          >
            {t(`drift.type.${type}`)} · {summary.byType[type]}
          </button>
        ))}
      </section>

      <section>
        {state === 'loading' ? (
          <p className="text-sm text-gray-500">{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm ring-1 ring-gray-200">
            {t('drift.none')}
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.id} className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${SEVERITY_STYLE[row.severity]}`}
                      >
                        {row.severity}
                      </span>
                      <span className="text-xs font-medium text-gray-700">
                        {t(`drift.type.${row.driftType}`)}
                      </span>
                      <span className="font-medium text-gray-900">{row.principalName}</span>
                    </div>
                    <p className="mt-0.5 font-mono text-xs text-gray-600">
                      {row.capabilityId} · {row.scopeType} {row.scopeName}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-600">{row.detail}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {row.driftType === 'Extra' ? (
                      <span className="rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600">
                        {t('drift.neverAuto')}
                      </span>
                    ) : row.autoRemediable ? (
                      <span className="rounded-lg bg-emerald-50 px-2 py-1 text-xs text-emerald-800 ring-1 ring-emerald-600/20 ring-inset">
                        {t('drift.autoRemediable')}
                      </span>
                    ) : null}
                    {row.path && (
                      <button
                        type="button"
                        onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
                      >
                        {t(expanded === row.id ? 'cando.hidePath' : 'cando.showPath')}
                      </button>
                    )}
                  </div>
                </div>
                {expanded === row.id && row.path && (
                  <ol className="mt-3 space-y-1 border-t border-gray-100 pt-3">
                    {row.path.map((step, index) => (
                      <li key={index} className="font-mono text-xs text-gray-700">
                        {index + 1}. {step.label}
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-gray-500">{t('drift.extraNote')}</p>
    </div>
  );
}

export default DriftPage;
