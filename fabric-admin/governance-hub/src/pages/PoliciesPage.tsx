import { useMemo, useState } from 'react';

import { SEVERITY_ORDER, type Severity } from '@/domain/drift';
import { POLICY_RULES, pendingRules } from '@/domain/policies';
import { useAnalysis } from '@/hooks/useAnalysis';
import { useT } from '@/i18n';

const SEVERITY_STYLE: Record<Severity, string> = {
  Critical: 'bg-rose-50 text-rose-800 ring-rose-600/20',
  High: 'bg-amber-50 text-amber-900 ring-amber-600/20',
  Medium: 'bg-blue-50 text-blue-800 ring-blue-600/20',
  Low: 'bg-gray-100 text-gray-600 ring-gray-500/20',
};

/**
 * The policy rule pack (PLAN.md §16).
 *
 * Rules whose data is not collectable yet are listed as **pending**, not
 * hidden. A pack that silently drops half its rules produces a clean report and
 * a false sense of safety.
 */
export function PoliciesPage() {
  const t = useT();
  const { state, findings } = useAnalysis();
  const [severity, setSeverity] = useState<Severity | 'all'>('all');

  const pending = useMemo(() => pendingRules(), []);
  const byRule = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of findings) map.set(f.policyId, (map.get(f.policyId) ?? 0) + 1);
    return map;
  }, [findings]);

  const shown = useMemo(
    () => findings.filter((f) => severity === 'all' || f.severity === severity),
    [findings, severity]
  );

  const bySeverity = useMemo(() => {
    const counts: Record<Severity, number> = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    for (const f of findings) counts[f.severity] += 1;
    return counts;
  }, [findings]);

  const active = POLICY_RULES.length - pending.length;

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-xl font-semibold text-gray-900">{t('policies.title')}</h2>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">{t('policies.intro')}</p>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs tracking-wide text-gray-500 uppercase">
            {t('policies.stat.rules')}
          </p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{POLICY_RULES.length}</p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs tracking-wide text-gray-500 uppercase">
            {t('policies.stat.active')}
          </p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{active}</p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs tracking-wide text-gray-500 uppercase">
            {t('policies.stat.findings')}
          </p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{findings.length}</p>
        </div>
      </section>

      <section className="flex flex-wrap gap-2">
        {SEVERITY_ORDER.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => setSeverity(severity === level ? 'all' : level)}
            className={`rounded-full px-3 py-1 text-xs ring-1 ring-inset ${
              severity === level
                ? 'bg-blue-600 text-white ring-blue-700'
                : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'
            }`}
          >
            {level} · {bySeverity[level]}
          </button>
        ))}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-900">{t('policies.findings')}</h3>
        {state === 'loading' ? (
          <p className="text-sm text-gray-500">{t('common.loading')}</p>
        ) : shown.length === 0 ? (
          <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm ring-1 ring-gray-200">
            {t('policies.noFindings')}
          </p>
        ) : (
          <ul className="space-y-2">
            {shown.map((f, index) => (
              <li
                key={`${f.policyId}:${f.objectId}:${index}`}
                className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${SEVERITY_STYLE[f.severity]}`}
                  >
                    {f.severity}
                  </span>
                  <span className="font-mono text-xs font-medium text-gray-700">
                    {f.policyId}
                  </span>
                  <span className="font-medium text-gray-900">{f.objectName}</span>
                  <span className="text-xs text-gray-500">{f.objectType}</span>
                </div>
                <p className="mt-1 text-sm text-gray-600">{f.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-900">{t('policies.rules')}</h3>
        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs tracking-wide text-gray-500 uppercase">
              <tr>
                <th className="px-3 py-2">{t('policies.col.id')}</th>
                <th className="px-3 py-2">{t('policies.col.statement')}</th>
                <th className="px-3 py-2">{t('policies.col.module')}</th>
                <th className="px-3 py-2">{t('policies.col.findings')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {POLICY_RULES.map((rule) => (
                <tr key={rule.id} className={rule.requiresData ? 'bg-gray-50/60' : undefined}>
                  <td className="px-3 py-2 font-mono text-xs text-gray-700">{rule.id}</td>
                  <td className="px-3 py-2 text-gray-700">
                    {rule.statement}
                    {rule.requiresData && (
                      <span className="mt-0.5 block text-xs text-amber-800">
                        {t('policies.pending')}: {rule.requiresData}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{rule.module}</td>
                  <td className="px-3 py-2 text-gray-700">
                    {rule.requiresData ? '—' : (byRule.get(rule.id) ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500">
          {t('policies.pendingNote', { count: String(pending.length) })}
        </p>
      </section>
    </div>
  );
}

export default PoliciesPage;
