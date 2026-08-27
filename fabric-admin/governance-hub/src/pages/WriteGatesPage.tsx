import { useCallback, useEffect, useMemo, useState } from 'react';

import { AUDIT_OUTCOMES, dryRunState, filterAudit, summariseAudit } from '@/domain/audit';
import { licenceCostOf } from '@/domain/licenceCost';
import { evaluateWriteGates, type WriteGateId } from '@/domain/writeGates';
import { useAuth } from '@/hooks/AuthContext';
import { useGovernance } from '@/hooks/GovernanceContext';
import { useT } from '@/i18n';
import { allBindingKinds } from '@/modules';
import { loadLedgers, submitWrite, type LedgerData } from '@/services/writes';

const EMPTY_LEDGERS: LedgerData = { audit: [], dryRuns: [], noModel: false, failures: [] };

const OUTCOME_STYLE: Record<string, string> = {
  Success: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  Planned: 'bg-blue-50 text-blue-800 ring-blue-600/20',
  Refused: 'bg-amber-50 text-amber-900 ring-amber-600/20',
  Failed: 'bg-rose-50 text-rose-800 ring-rose-600/20',
};

/**
 * The arming console (PLAN.md §8.7, §14).
 *
 * Everything here changes what the **actuator** will accept. Nothing here
 * writes to a control plane: the notebook re-reads this same configuration
 * server-side on every call and decides again. Arming a kind in this page and
 * then tampering with the client buys you nothing.
 */
export function WriteGatesPage() {
  const t = useT();
  const { user } = useAuth();
  const { config, writeConfig, setWriteConfig, backendReachable } = useGovernance();
  const [ledgers, setLedgers] = useState<LedgerData>(EMPTY_LEDGERS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scopeDraft, setScopeDraft] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [search, setSearch] = useState('');

  const actor = user?.email ?? user?.name ?? 'unknown';
  // Only kinds belonging to an enabled module: a disabled plane's kinds cannot
  // be armed (gate `moduleOff` would refuse them anyway), and offering the
  // switch would imply otherwise.
  const kinds = useMemo(
    () => allBindingKinds().filter((k) => config.modulesEnabled.includes(k.module as never)),
    [config.modulesEnabled]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setLedgers(await loadLedgers());
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const audit = useMemo(
    () => filterAudit(ledgers.audit, { outcome: outcomeFilter || undefined, search }),
    [ledgers.audit, outcomeFilter, search]
  );
  const summary = useMemo(() => summariseAudit(ledgers.audit), [ledgers.audit]);

  /** Scopes gate 4 must be satisfied for. `*` is not a scope you can dry-run. */
  const concreteScopes = config.writeScopeAllowlist.filter((s) => s !== '*');

  async function persist(
    patch: Parameters<typeof setWriteConfig>[0],
    label: string
  ) {
    setBusy(label);
    setError(null);
    setMessage(null);
    const ok = await setWriteConfig(patch, actor);
    setBusy(null);
    if (ok) setMessage(t('settings.saved'));
    else setError(t('writes.saveFailed'));
  }

  function toggleKind(kindId: string, armed: boolean) {
    const next = armed
      ? Array.from(new Set([...config.writeKinds, kindId]))
      : config.writeKinds.filter((k) => k !== kindId);
    void persist({ writeKinds: next }, kindId);
  }

  function addScope() {
    const value = scopeDraft.trim();
    if (!value) return;
    setScopeDraft('');
    void persist(
      { writeScopeAllowlist: Array.from(new Set([...config.writeScopeAllowlist, value])) },
      'scope'
    );
  }

  async function runDryRun(kindId: string, module: string, scopeId: string, writable: boolean) {
    setBusy(`${kindId}:${scopeId}`);
    setError(null);
    setMessage(null);
    const outcome = await submitWrite({
      binding: {
        kind: kindId,
        module,
        targetId: scopeId,
        targetType: 'Scope',
        writable,
      },
      dryRun: true,
      actor,
    });
    setBusy(null);

    if (outcome.state === 'not-configured') setError(t('writes.actuatorMissing'));
    else if (outcome.state === 'transport-error') setError(outcome.message);
    else if (outcome.state === 'no-exit-value') setError(t('writes.noExitValue'));
    else if (outcome.result.ok) setMessage(t('writes.dryRunOk'));
    else setError(outcome.result.error ?? t('common.error'));

    await refresh();
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{t('writes.title')}</h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">{t('writes.intro')}</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? t('common.loading') : t('inventory.refresh')}
        </button>
      </section>

      <p className="rounded-xl bg-blue-50 p-4 text-sm text-blue-900 ring-1 ring-blue-600/20 ring-inset">
        {t('writes.serverSideNotice')}
      </p>

      {!backendReachable && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-600/20 ring-inset">
          {t('settings.readOnlyNotice')}
        </p>
      )}
      {message && (
        <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900 ring-1 ring-emerald-600/20 ring-inset">
          {message}
        </p>
      )}
      {error && (
        <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-900 ring-1 ring-rose-600/20 ring-inset">
          {error}
        </p>
      )}

      {/* ── Gate 1 ─────────────────────────────────────────────────────── */}
      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{t('writes.gate1.title')}</h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-600">{t('writes.gate1.help')}</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={config.writesEnabled}
              disabled={!backendReachable || busy === 'master'}
              onChange={(e) => void persist({ writesEnabled: e.target.checked }, 'master')}
              className="h-5 w-5"
            />
            <span>{t(config.writesEnabled ? 'writes.armed' : 'writes.disarmed')}</span>
          </label>
        </div>
      </section>

      {/* ── Gate 3 ─────────────────────────────────────────────────────── */}
      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
        <h3 className="text-sm font-semibold text-gray-900">{t('writes.gate3.title')}</h3>
        <p className="mt-1 max-w-2xl text-sm text-gray-600">{t('writes.gate3.help')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {config.writeScopeAllowlist.length === 0 && (
            <span className="text-sm text-gray-500">{t('writes.noScopes')}</span>
          )}
          {config.writeScopeAllowlist.map((scope) => (
            <span
              key={scope}
              className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 font-mono text-xs text-gray-800"
            >
              {scope}
              <button
                type="button"
                disabled={!backendReachable}
                onClick={() =>
                  void persist(
                    {
                      writeScopeAllowlist: config.writeScopeAllowlist.filter(
                        (s) => s !== scope
                      ),
                    },
                    'scope'
                  )
                }
                className="text-gray-500 hover:text-rose-700 disabled:opacity-40"
                aria-label={t('writes.removeScope', { scope })}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={scopeDraft}
            onChange={(e) => setScopeDraft(e.target.value)}
            placeholder={t('writes.scopePlaceholder')}
            className="w-72 rounded-lg border border-gray-200 px-3 py-1.5 font-mono text-sm"
          />
          <button
            type="button"
            disabled={!backendReachable || !scopeDraft.trim()}
            onClick={addScope}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {t('writes.addScope')}
          </button>
        </div>
        {config.writeScopeAllowlist.includes('*') && (
          <p className="mt-2 text-xs text-amber-800">{t('writes.wildcardWarning')}</p>
        )}
      </section>

      {/* ── Gates 2 + 4 ────────────────────────────────────────────────── */}
      <section>
        <h3 className="text-sm font-semibold text-gray-900">{t('writes.gate2.title')}</h3>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">{t('writes.gate2.help')}</p>
        <ul className="mt-3 space-y-2">
          {kinds.map((kind) => {
            const armed = config.writeKinds.includes(kind.id);
            const licence = licenceCostOf(kind.id);
            return (
              <li
                key={kind.id}
                className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-medium text-gray-900">{kind.id}</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {kind.module} ·{' '}
                      {t(
                        kind.controlMode === 'preventive-auto'
                          ? 'mode.preventiveAuto'
                          : kind.controlMode === 'preventive-manual'
                            ? 'mode.preventiveManual'
                            : 'mode.detective'
                      )}
                    </p>
                    <p className="mt-1 max-w-2xl text-xs text-gray-600">{kind.description}</p>
                    {licence.cost === 'enables-premium-requirement' && (
                      // The one kind whose licence consequence must be read
                      // before it is armed, not discovered on the invoice.
                      <p className="mt-1 max-w-2xl text-xs text-amber-800">
                        {t('writes.licenceWarning')} {licence.detail}
                      </p>
                    )}
                  </div>
                  {kind.writable ? (
                    <label className="flex shrink-0 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={armed}
                        disabled={!backendReachable || busy === kind.id}
                        onChange={(e) => toggleKind(kind.id, e.target.checked)}
                        className="h-4 w-4"
                      />
                      <span>{t(armed ? 'writes.armed' : 'writes.disarmed')}</span>
                    </label>
                  ) : (
                    <span className="shrink-0 rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600">
                      {t('writes.notWritable')}
                    </span>
                  )}
                </div>

                {armed && kind.writable && (
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    <p className="text-xs font-medium text-gray-700">
                      {t('writes.gate4.title')}
                    </p>
                    {concreteScopes.length === 0 ? (
                      <p className="mt-1 text-xs text-gray-500">{t('writes.gate4.noScopes')}</p>
                    ) : (
                      <ul className="mt-2 space-y-1">
                        {concreteScopes.map((scope) => {
                          const state = dryRunState(kind.id, scope, ledgers.dryRuns);
                          const decision = evaluateWriteGates(
                            {
                              bindingKind: kind.id,
                              module: kind.module,
                              scopeId: scope,
                              dryRun: false,
                              writable: kind.writable,
                            },
                            writeConfig,
                            ledgers.dryRuns
                          );
                          return (
                            <li
                              key={scope}
                              className="flex flex-wrap items-center justify-between gap-2 text-xs"
                            >
                              <span className="font-mono text-gray-700">{scope}</span>
                              <span className="flex items-center gap-2">
                                <span
                                  className={
                                    state.status === 'fresh'
                                      ? 'text-emerald-700'
                                      : state.status === 'expired'
                                        ? 'text-amber-800'
                                        : 'text-gray-500'
                                  }
                                >
                                  {state.status === 'fresh'
                                    ? t('writes.dryRun.fresh', {
                                        days: String(state.daysRemaining),
                                      })
                                    : t(`writes.dryRun.${state.status}`)}
                                </span>
                                <span className="text-gray-400">·</span>
                                <span
                                  className={
                                    decision.allowed ? 'text-emerald-700' : 'text-gray-600'
                                  }
                                >
                                  {decision.allowed
                                    ? t('writes.allowed')
                                    : t(
                                        decision.reasonKey ??
                                          ('writes.gate.master' as const)
                                      )}
                                </span>
                                <button
                                  type="button"
                                  disabled={busy === `${kind.id}:${scope}`}
                                  onClick={() =>
                                    void runDryRun(
                                      kind.id,
                                      kind.module,
                                      scope,
                                      kind.writable
                                    )
                                  }
                                  className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                                >
                                  {busy === `${kind.id}:${scope}`
                                    ? t('common.checking')
                                    : t('writes.runDryRun')}
                                </button>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Audit ──────────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-900">{t('writes.audit.title')}</h3>
        <p className="max-w-3xl text-sm text-gray-600">{t('writes.audit.help')}</p>

        {ledgers.noModel && (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-600/20 ring-inset">
            {t('model.notProvisioned')}
          </p>
        )}
        {ledgers.failures.length > 0 && (
          <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-900 ring-1 ring-rose-600/20 ring-inset">
            {t('writes.audit.unreadable', { tables: ledgers.failures.join(', ') })}
          </p>
        )}

        {Object.keys(summary.refusalsByGate).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(summary.refusalsByGate).map(([gate, count]) => (
              <span
                key={gate}
                className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-900 ring-1 ring-amber-600/20 ring-inset"
              >
                {t(GATE_LABEL[gate as WriteGateId] ?? 'writes.gate.master')} · {count}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <select
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value)}
            className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
          >
            <option value="">{t('inventory.filter.all')}</option>
            {AUDIT_OUTCOMES.map((outcome) => (
              <option key={outcome} value={outcome}>
                {t(`writes.outcome.${outcome}`)}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('writes.audit.search')}
            className="w-64 rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
          />
        </div>

        {audit.length === 0 ? (
          <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm ring-1 ring-gray-200">
            {t('writes.audit.empty')}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs tracking-wide text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2">{t('writes.audit.when')}</th>
                  <th className="px-3 py-2">{t('writes.audit.actor')}</th>
                  <th className="px-3 py-2">{t('writes.audit.action')}</th>
                  <th className="px-3 py-2">{t('writes.audit.target')}</th>
                  <th className="px-3 py-2">{t('writes.audit.outcome')}</th>
                  <th className="px-3 py-2">{t('writes.audit.detail')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {audit.map((entry) => (
                  <tr key={entry.auditId}>
                    <td className="px-3 py-2 text-xs whitespace-nowrap text-gray-600">
                      {entry.ts.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700">{entry.actor}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-700">
                      {entry.action}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600">
                      {entry.targetId}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${
                          OUTCOME_STYLE[entry.outcome] ?? 'bg-gray-100 text-gray-600 ring-gray-500/20'
                        }`}
                      >
                        {entry.outcome}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">{entry.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const GATE_LABEL: Partial<Record<WriteGateId, Parameters<ReturnType<typeof useT>>[0]>> = {
  master: 'writes.gate.master',
  kind: 'writes.gate.kind',
  scope: 'writes.gate.scope',
  dryRun: 'writes.gate.dryRun',
  deniedRole: 'writes.gate.deniedRole',
  moduleOff: 'writes.gate.moduleOff',
  notWritable: 'writes.gate.kind',
};

export default WriteGatesPage;
