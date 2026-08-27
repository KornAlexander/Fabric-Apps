import { useMemo, useState } from 'react';

import { listPrincipals } from '@/domain/effective';
import { useAnalysis } from '@/hooks/useAnalysis';
import { useT } from '@/i18n';
import { useAuth } from '@/hooks/AuthContext';
import { createAssignment, deactivateAssignment } from '@/services/assignments';

interface ScopeOption {
  type: string;
  id: string;
  name: string;
}

/**
 * Entitlements — the **desired** state drift is measured against (PLAN.md §12.1).
 *
 * Recording an entitlement changes nothing in any control plane. That is the
 * point: the customer can describe intent and see the gap long before any write
 * gate is armed.
 */
export function EntitlementsPage() {
  const t = useT();
  const { user } = useAuth();
  const { state, snapshot, grants, personas, assignments, assignmentsUnavailable, reload } =
    useAnalysis();

  const [personaId, setPersonaId] = useState('');
  const [principalId, setPrincipalId] = useState('');
  const [scopeKey, setScopeKey] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const principals = useMemo(
    () => listPrincipals(grants, snapshot).filter((p) => p.id !== '*'),
    [grants, snapshot]
  );

  const scopes = useMemo<ScopeOption[]>(() => {
    const list: ScopeOption[] = [{ type: 'Tenant', id: 'tenant', name: 'Tenant' }];
    for (const w of snapshot.workspaces) {
      list.push({ type: 'Workspace', id: w.workspace_id, name: w.workspace_name });
    }
    for (const e of snapshot.environments) {
      list.push({ type: 'Environment', id: e.environment_id, name: e.environment_name });
    }
    return list;
  }, [snapshot]);

  const personaById = useMemo(() => new Map(personas.map((p) => [p.id, p])), [personas]);
  const activeAssignments = assignments.filter((a) => a.isActive);

  const canSubmit = Boolean(personaId && principalId && scopeKey) && !busy;

  async function submit() {
    const principal = principals.find((p) => p.id === principalId);
    const scope = scopes.find((s) => `${s.type}:${s.id}` === scopeKey);
    if (!principal || !scope) return;

    setBusy(true);
    setError(null);
    const ok = await createAssignment(
      {
        principalId: principal.id,
        principalName: principal.name,
        principalType: principal.type,
        personaId,
        scopeType: scope.type,
        scopeId: scope.id,
        scopeName: scope.name,
        validUntil: validUntil ? new Date(validUntil) : undefined,
      },
      user?.email ?? user?.name ?? 'unknown'
    );
    setBusy(false);
    if (!ok) {
      setError(t('entitlements.saveFailed'));
      return;
    }
    setPersonaId('');
    setPrincipalId('');
    setScopeKey('');
    setValidUntil('');
    reload();
  }

  async function revoke(id: string) {
    setBusy(true);
    const ok = await deactivateAssignment(id);
    setBusy(false);
    if (!ok) setError(t('entitlements.saveFailed'));
    else reload();
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-xl font-semibold text-gray-900">{t('entitlements.title')}</h2>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">{t('entitlements.intro')}</p>
      </section>

      <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900 ring-1 ring-blue-600/20 ring-inset">
        {t('entitlements.noWriteNotice')}
      </p>

      {assignmentsUnavailable && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-600/20 ring-inset">
          {t('entitlements.storeUnavailable')}
        </p>
      )}
      {error && (
        <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-900 ring-1 ring-rose-600/20 ring-inset">
          {error}
        </p>
      )}

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
        <h3 className="text-sm font-semibold text-gray-900">{t('entitlements.add')}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="block text-xs text-gray-500">{t('entitlements.field.principal')}</span>
            <select
              value={principalId}
              onChange={(e) => setPrincipalId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5"
            >
              <option value="">—</option>
              {principals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.type})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-gray-500">{t('entitlements.field.persona')}</span>
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
            <span className="block text-xs text-gray-500">{t('entitlements.field.scope')}</span>
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
          <label className="text-sm">
            <span className="block text-xs text-gray-500">
              {t('entitlements.field.validUntil')}
            </span>
            <input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className="mt-3 rounded-lg bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {t('entitlements.record')}
        </button>
        {principals.length === 0 && state === 'ready' && (
          <p className="mt-2 text-xs text-gray-500">{t('entitlements.noPrincipals')}</p>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-900">
          {t('entitlements.current')} ({activeAssignments.length})
        </h3>
        {activeAssignments.length === 0 ? (
          <p className="mt-2 rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm ring-1 ring-gray-200">
            {t('entitlements.none')}
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {activeAssignments.map((a) => {
              const persona = personaById.get(a.personaId);
              const expired = a.validUntil && new Date(a.validUntil) < new Date();
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">
                      {a.principalName}{' '}
                      <span className="text-sm font-normal text-gray-500">
                        → {persona?.name ?? a.personaId}
                      </span>
                    </p>
                    <p className="text-xs text-gray-600">
                      {a.scopeType} · {a.scopeName}
                      {persona && ` · ${t('personas.field.riskTier')}: ${persona.riskTier}`}
                    </p>
                    {a.validUntil && (
                      <p className={`text-xs ${expired ? 'text-rose-700' : 'text-gray-500'}`}>
                        {t(expired ? 'entitlements.expired' : 'entitlements.validUntil', {
                          date: new Date(a.validUntil).toLocaleDateString(),
                        })}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void revoke(a.id)}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                  >
                    {t('entitlements.revoke')}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

export default EntitlementsPage;
