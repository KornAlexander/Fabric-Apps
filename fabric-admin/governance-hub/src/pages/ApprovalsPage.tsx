import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  approvalQueue,
  canAct,
  compileRequest,
  isApprover,
  summariseRequests,
  type AccessRequest,
} from '@/domain/requests';
import { licenceImpact } from '@/domain/licenceCost';
import { useAnalysis } from '@/hooks/useAnalysis';
import { useAuth } from '@/hooks/AuthContext';
import { useGovernance } from '@/hooks/GovernanceContext';
import { useT } from '@/i18n';
import { approveRequest, denyRequest, verifyAndClose } from '@/services/approvals';
import { loadRequests } from '@/services/requests';

/**
 * The approver queue (PLAN.md §13, page 7).
 *
 * Approval is where a decision becomes a change in a tenant, so this page shows
 * the approver exactly what will be written *before* they decide — and then
 * shows what actually happened, including a write that was refused by a gate.
 * An approver who cannot see the difference between "approved" and "applied"
 * cannot be held responsible for either.
 */
export function ApprovalsPage() {
  const t = useT();
  const { user } = useAuth();
  const { config } = useGovernance();
  const { personas, snapshot, reload: reloadAnalysis } = useAnalysis();

  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  const actorId = user?.email ?? user?.name ?? 'unknown';
  const approver = isApprover(actorId, config.approverEmails);
  const actor = useMemo(
    () => ({ actorId, isApprover: approver, actorName: user?.name ?? actorId }),
    [actorId, approver, user?.name]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    const loaded = await loadRequests();
    setRequests(loaded.requests);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const queue = useMemo(() => approvalQueue(requests), [requests]);
  const summary = useMemo(() => summariseRequests(requests), [requests]);
  const awaiting = useMemo(
    () => requests.filter((r) => r.status === 'Approved' || r.status === 'Failed'),
    [requests]
  );

  async function decide(request: AccessRequest, approve: boolean) {
    setBusy(request.id);
    setResult(null);

    if (!approve) {
      const ok = await denyRequest(request, actor, notes[request.id] ?? '');
      setBusy(null);
      setResult({
        id: request.id,
        ok,
        text: ok ? t('approvals.denied') : t('approvals.actionFailed'),
      });
      await refresh();
      return;
    }

    const outcome = await approveRequest({
      request,
      personas,
      enabledModules: config.modulesEnabled,
      actor,
      principalId: request.requesterId,
      principalName: request.requesterName,
      principalType: 'User',
    });
    setBusy(null);

    setResult({
      id: request.id,
      ok: outcome.ok,
      text: outcome.refusedReason
        ? outcome.refusedReason
        : outcome.ok
          ? t('approvals.applied', { count: String(outcome.outcomes.length) })
          : t('approvals.applyFailed', {
              detail:
                outcome.outcomes
                  .filter((o) => !o.ok)
                  .map((o) => `${o.bindingKind}: ${o.error}`)
                  .join('; ') || t('approvals.nothingToApply'),
            }),
    });
    await refresh();
  }

  async function verify(request: AccessRequest) {
    setBusy(request.id);
    setResult(null);
    // Re-read the plane through the same engine the Can-Do Explorer uses.
    // A stale snapshot would prove nothing, so refresh it first.
    reloadAnalysis();
    const outcome = await verifyAndClose({
      request,
      personas,
      enabledModules: config.modulesEnabled,
      snapshot,
      principalId: request.requesterId,
    });
    setBusy(null);
    setResult({
      id: request.id,
      ok: outcome.verified,
      text: outcome.verified
        ? t('approvals.verified')
        : t('approvals.notYetEffective', { missing: outcome.missing.join(', ') }),
    });
    await refresh();
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-xl font-semibold text-gray-900">{t('approvals.title')}</h2>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">{t('approvals.intro')}</p>
      </section>

      {!approver && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-600/20 ring-inset">
          {t('approvals.notApprover')}
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs tracking-wide text-gray-500 uppercase">
            {t('approvals.stat.pending')}
          </p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{summary.pending}</p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs tracking-wide text-gray-500 uppercase">
            {t('approvals.stat.awaiting')}
          </p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">
            {summary.awaitingVerification}
          </p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs tracking-wide text-gray-500 uppercase">
            {t('approvals.stat.verified')}
          </p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">
            {summary.byStatus.Verified}
          </p>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-900">{t('approvals.queue')}</h3>
        {loading ? (
          <p className="mt-2 text-sm text-gray-500">{t('common.loading')}</p>
        ) : queue.length === 0 ? (
          <p className="mt-2 rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm ring-1 ring-gray-200">
            {t('approvals.queueEmpty')}
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {queue.map((request) => {
              const persona = personas.find((p) => p.id === request.personaId);
              const compiled = compileRequest(request, personas, config.modulesEnabled);
              const decision = canAct(request, 'approve', actor);
              const applicable = compiled.bindings.filter((b) => b.moduleEnabled);
              const licence = licenceImpact(applicable.map((b) => b.bindingKind));
              return (
                <li
                  key={request.id}
                  className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900">
                        {request.requesterName}{' '}
                        <span className="text-sm font-normal text-gray-500">
                          → {persona?.name ?? request.personaId}
                        </span>
                      </p>
                      <p className="text-xs text-gray-600">
                        {request.scopeType} · {request.scopeName} ·{' '}
                        {new Date(request.createdAt).toLocaleDateString()}
                      </p>
                      <p className="mt-1 text-sm text-gray-700">{request.justification}</p>
                    </div>
                  </div>

                  {/* What approving actually writes — shown before deciding. */}
                  <div className="mt-3 rounded-lg bg-gray-50 p-3">
                    <p className="text-xs font-medium text-gray-700">
                      {t('approvals.willWrite')}
                    </p>
                    {applicable.length === 0 ? (
                      <p className="mt-1 text-xs text-amber-800">
                        {t('approvals.nothingToApply')}
                      </p>
                    ) : (
                      <ul className="mt-1 space-y-0.5">
                        {applicable.map((binding, index) => (
                          <li key={index} className="font-mono text-xs text-gray-700">
                            {binding.bindingKind}
                            {binding.roleValue ? ` = ${binding.roleValue}` : ''} @{' '}
                            {binding.scopeName}
                          </li>
                        ))}
                      </ul>
                    )}
                    {compiled.darkCount > 0 && (
                      <p className="mt-1 text-xs text-gray-500">
                        {t('approvals.darkBindings', { count: String(compiled.darkCount) })}
                      </p>
                    )}
                    {compiled.issues.map((issue, index) => (
                      <p key={index} className="mt-1 text-xs text-rose-800">
                        {issue}
                      </p>
                    ))}
                    {applicable.length > 0 &&
                      (licence.free ? (
                        <p className="mt-2 text-xs text-emerald-700">
                          {t('approvals.licenceFree')}
                        </p>
                      ) : (
                        <p className="mt-2 text-xs text-amber-800">
                          {t('approvals.licenceTrigger', {
                            kinds: licence.premiumTriggers.join(', '),
                          })}
                        </p>
                      ))}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      value={notes[request.id] ?? ''}
                      onChange={(e) =>
                        setNotes((n) => ({ ...n, [request.id]: e.target.value }))
                      }
                      placeholder={t('approvals.notePlaceholder')}
                      className="w-64 rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      disabled={!decision.allowed || busy === request.id}
                      onClick={() => void decide(request, true)}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-40"
                    >
                      {t('approvals.approve')}
                    </button>
                    <button
                      type="button"
                      disabled={!decision.allowed || busy === request.id}
                      onClick={() => void decide(request, false)}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                    >
                      {t('approvals.deny')}
                    </button>
                    {!decision.allowed && (
                      <span className="text-xs text-amber-800">
                        {decision.reasonCode === 'self-approval'
                          ? t('approvals.noSelfApproval')
                          : decision.reasonCode === 'not-approver'
                            ? t('approvals.notApprover')
                            : decision.reason}
                      </span>
                    )}
                  </div>

                  {result?.id === request.id && (
                    <p
                      className={`mt-2 text-xs ${result.ok ? 'text-emerald-700' : 'text-rose-700'}`}
                    >
                      {result.text}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-900">{t('approvals.awaiting')}</h3>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">{t('approvals.awaitingHelp')}</p>
        {awaiting.length === 0 ? (
          <p className="mt-2 rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm ring-1 ring-gray-200">
            {t('approvals.awaitingEmpty')}
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {awaiting.map((request) => (
              <li
                key={request.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {request.requesterName} · {request.scopeName}
                  </p>
                  <p className="text-xs text-gray-600">
                    {t(`requests.status.${request.status}`)}
                    {request.decisionNote ? ` — ${request.decisionNote}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {result?.id === request.id && (
                    <span
                      className={`text-xs ${result.ok ? 'text-emerald-700' : 'text-amber-800'}`}
                    >
                      {result.text}
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={busy === request.id}
                    onClick={() => void verify(request)}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                  >
                    {busy === request.id ? t('common.checking') : t('approvals.verify')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default ApprovalsPage;
