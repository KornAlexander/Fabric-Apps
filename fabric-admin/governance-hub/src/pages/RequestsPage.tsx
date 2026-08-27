import { useEffect, useMemo, useState } from 'react';

import { CAPABILITY_BY_ID } from '@/domain/capabilities';
import { canAct, compileRequest, type AccessRequest } from '@/domain/requests';
import { useAnalysis } from '@/hooks/useAnalysis';
import { useAuth } from '@/hooks/AuthContext';
import { useGovernance } from '@/hooks/GovernanceContext';
import { useT, type TranslationKey } from '@/i18n';
import { loadRequests, submitRequest } from '@/services/requests';
import { withdrawRequest } from '@/services/approvals';

const STATUS_STYLE: Record<string, string> = {
  Pending: 'bg-blue-50 text-blue-800 ring-blue-600/20',
  Approved: 'bg-amber-50 text-amber-900 ring-amber-600/20',
  Verified: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  Denied: 'bg-gray-100 text-gray-600 ring-gray-500/20',
  Withdrawn: 'bg-gray-100 text-gray-600 ring-gray-500/20',
  Failed: 'bg-rose-50 text-rose-800 ring-rose-600/20',
};

/**
 * The request front door (PLAN.md §13, page 6).
 *
 * "I want to be able to create X in scope Y." The picker is deliberately
 * persona-first rather than capability-first: a customer's role model is the
 * thing they can reason about, and it is what an approver can actually judge.
 */
export function RequestsPage() {
  const t = useT();
  const { user } = useAuth();
  const { config } = useGovernance();
  const { snapshot, personas } = useAnalysis();

  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [reachable, setReachable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [personaId, setPersonaId] = useState('');
  const [scopeKey, setScopeKey] = useState('');
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const actorId = user?.email ?? user?.name ?? 'unknown';

  async function refresh() {
    setLoading(true);
    const result = await loadRequests();
    setRequests(result.requests);
    setReachable(result.backendReachable);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const scopes = useMemo(() => {
    const list = [{ type: 'Tenant', id: 'tenant', name: 'Tenant' }];
    for (const w of snapshot.workspaces) {
      list.push({ type: 'Workspace', id: w.workspace_id, name: w.workspace_name });
    }
    for (const e of snapshot.environments) {
      list.push({ type: 'Environment', id: e.environment_id, name: e.environment_name });
    }
    return list;
  }, [snapshot]);

  const mine = useMemo(
    () =>
      requests
        .filter((r) => r.requesterId === actorId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [requests, actorId]
  );

  const selectedScope = scopes.find((s) => `${s.type}:${s.id}` === scopeKey);
  const selectedPersona = personas.find((p) => p.id === personaId);

  /** What the requester would actually get — shown before they ask for it. */
  const preview = useMemo(() => {
    if (!selectedPersona || !selectedScope) return null;
    return compileRequest(
      {
        id: 'preview',
        requesterId: actorId,
        requesterName: actorId,
        personaId: selectedPersona.id,
        scopeType: selectedScope.type,
        scopeId: selectedScope.id,
        scopeName: selectedScope.name,
        justification: '',
        status: 'Pending',
        createdAt: new Date().toISOString(),
      },
      personas,
      config.modulesEnabled
    );
  }, [selectedPersona, selectedScope, personas, config.modulesEnabled, actorId]);

  const canSubmit =
    Boolean(personaId && scopeKey && justification.trim().length >= 10) && !busy;

  async function submit() {
    if (!selectedScope) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const ok = await submitRequest({
      requesterId: actorId,
      requesterName: user?.name ?? actorId,
      personaId,
      scopeType: selectedScope.type,
      scopeId: selectedScope.id,
      scopeName: selectedScope.name,
      justification: justification.trim(),
    });
    setBusy(false);
    if (!ok) {
      setError(t('requests.submitFailed'));
      return;
    }
    setMessage(t('requests.submitted'));
    setPersonaId('');
    setScopeKey('');
    setJustification('');
    await refresh();
  }

  async function withdraw(request: AccessRequest) {
    setBusy(true);
    const ok = await withdrawRequest(request, { actorId, isApprover: false });
    setBusy(false);
    if (!ok) setError(t('requests.withdrawFailed'));
    await refresh();
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-xl font-semibold text-gray-900">{t('requests.title')}</h2>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">{t('requests.intro')}</p>
      </section>

      {!reachable && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-600/20 ring-inset">
          {t('requests.storeUnavailable')}
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

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
        <h3 className="text-sm font-semibold text-gray-900">{t('requests.new')}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="block text-xs text-gray-500">{t('requests.field.persona')}</span>
            <select
              value={personaId}
              onChange={(e) => setPersonaId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5"
            >
              <option value="">—</option>
              {personas
                .filter((p) => p.isActive)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-gray-500">{t('requests.field.scope')}</span>
            <select
              value={scopeKey}
              onChange={(e) => setScopeKey(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5"
            >
              <option value="">—</option>
              {scopes.map((s) => (
                <option key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>
                  {s.type} · {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-3 block text-sm">
          <span className="block text-xs text-gray-500">
            {t('requests.field.justification')}
          </span>
          <textarea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={3}
            placeholder={t('requests.justificationPlaceholder')}
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
        </label>

        {selectedPersona && (
          <div className="mt-3 rounded-lg bg-gray-50 p-3">
            <p className="text-xs font-medium text-gray-700">{t('requests.youWouldGet')}</p>
            <ul className="mt-1 space-y-0.5">
              {selectedPersona.capabilityIds.map((id) => (
                <li key={id} className="text-xs text-gray-600">
                  · {t(`cap.${id}` as TranslationKey)}
                </li>
              ))}
            </ul>
            {preview && preview.bindings.length === 0 && (
              // Better to say so now than to have an approver discover it.
              <p className="mt-2 text-xs text-amber-800">{t('requests.noBindings')}</p>
            )}
            {preview && preview.darkCount > 0 && (
              <p className="mt-2 text-xs text-amber-800">
                {t('requests.darkBindings', { count: String(preview.darkCount) })}
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className="mt-3 rounded-lg bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {t('requests.submit')}
        </button>
        {justification.trim().length > 0 && justification.trim().length < 10 && (
          <p className="mt-2 text-xs text-gray-500">{t('requests.justificationTooShort')}</p>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-900">{t('requests.mine')}</h3>
        {loading ? (
          <p className="mt-2 text-sm text-gray-500">{t('common.loading')}</p>
        ) : mine.length === 0 ? (
          <p className="mt-2 rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm ring-1 ring-gray-200">
            {t('requests.none')}
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {mine.map((request) => {
              const persona = personas.find((p) => p.id === request.personaId);
              const capability = persona?.capabilityIds
                .map((id) => CAPABILITY_BY_ID.get(id)?.id)
                .filter(Boolean).length;
              return (
                <li
                  key={request.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${
                          STATUS_STYLE[request.status] ?? 'bg-gray-100 text-gray-600 ring-gray-500/20'
                        }`}
                      >
                        {t(`requests.status.${request.status}`)}
                      </span>
                      <span className="font-medium text-gray-900">
                        {persona?.name ?? request.personaId}
                      </span>
                      <span className="text-xs text-gray-500">
                        {request.scopeType} · {request.scopeName}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-600">{request.justification}</p>
                    {capability !== undefined && (
                      <p className="mt-0.5 text-xs text-gray-500">
                        {t('requests.capabilityCount', { count: String(capability) })}
                      </p>
                    )}
                    {request.decisionNote && (
                      <p className="mt-0.5 text-xs text-amber-800">{request.decisionNote}</p>
                    )}
                  </div>
                  {canAct(request, 'withdraw', { actorId, isApprover: false }).allowed && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void withdraw(request)}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                    >
                      {t('requests.withdraw')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

export default RequestsPage;
