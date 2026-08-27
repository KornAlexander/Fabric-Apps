import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  CAPABILITIES,
  CORE_MODULE,
  type CapabilityDef,
} from '@/domain/capabilities';
import {
  compilePersona,
  RISK_TIERS,
  type Persona,
  type RiskTier,
} from '@/domain/personas';
import { useAuth } from '@/hooks/AuthContext';
import { useGovernance } from '@/hooks/GovernanceContext';
import { useT, type TranslationKey } from '@/i18n';
import { getModule } from '@/modules';
import {
  isSeedPersona,
  loadPersonas,
  resetPersona,
  savePersona,
} from '@/services/personas';

const MODE_STYLE: Record<CapabilityDef['controlMode'], string> = {
  'preventive-auto': 'text-emerald-700',
  'preventive-manual': 'text-amber-700',
  detective: 'text-rose-700',
};

const MODE_LABEL: Record<CapabilityDef['controlMode'], TranslationKey> = {
  'preventive-auto': 'mode.preventiveAuto',
  'preventive-manual': 'mode.preventiveManual',
  detective: 'mode.detective',
};

const RISK_STYLE: Record<RiskTier, string> = {
  Low: 'bg-gray-100 text-gray-700 ring-gray-500/20',
  Medium: 'bg-blue-50 text-blue-800 ring-blue-600/20',
  High: 'bg-amber-50 text-amber-900 ring-amber-600/20',
  Critical: 'bg-rose-50 text-rose-800 ring-rose-600/20',
};

/**
 * Personas & Recipes (PLAN.md §13, page 4).
 *
 * The editor exists because personas are customer data — "Report Author" means
 * something different in every org. Capabilities and binding recipes are not
 * editable here on purpose: they encode Microsoft's documented behaviour, and
 * letting someone "fix" a documented impossibility would be the worst kind of
 * feature.
 *
 * A capability whose module is switched off is struck through with the reason,
 * never hidden. Hiding it would make the persona look smaller than it is.
 */
export function PersonasPage() {
  const t = useT();
  const { user } = useAuth();
  const { config } = useGovernance();

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [backendReachable, setBackendReachable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<Persona | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  const enabledModules = useMemo(
    () => [...config.modulesEnabled, CORE_MODULE],
    [config.modulesEnabled]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await loadPersonas();
    setPersonas(result.personas);
    setBackendReachable(result.backendReachable);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const compiled = useMemo(
    () =>
      new Map(
        personas.map((p) => [p.id, compilePersona(p, { enabledModules })])
      ),
    [personas, enabledModules]
  );

  const brokenCount = [...compiled.values()].filter((r) => !r.ok).length;

  async function handleSave(persona: Persona) {
    const ok = await savePersona(
      {
        id: persona.id,
        name: persona.name,
        description: persona.description,
        riskTier: persona.riskTier,
        capabilityIds: persona.capabilityIds,
        isActive: persona.isActive,
      },
      user?.email ?? 'unknown'
    );
    setSaveFailed(!ok);
    setEditing(null);
    await refresh();
  }

  async function handleReset(personaId: string) {
    await resetPersona(personaId);
    await refresh();
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{t('personas.title')}</h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">{t('personas.intro')}</p>
        </div>
        <button
          type="button"
          onClick={() =>
            setEditing({
              id: '',
              name: '',
              description: '',
              riskTier: 'Medium',
              capabilityIds: [],
              isActive: true,
              isSeed: false,
            })
          }
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          {t('personas.add')}
        </button>
      </section>

      {!backendReachable && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-600/20 ring-inset">
          {t('personas.seedOnly')}
        </p>
      )}
      {saveFailed && (
        <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-900 ring-1 ring-rose-600/20 ring-inset">
          {t('personas.saveFailed')}
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs tracking-wide text-gray-500 uppercase">
            {t('personas.stat.total')}
          </p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{personas.length}</p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs tracking-wide text-gray-500 uppercase">
            {t('personas.stat.capabilities')}
          </p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{CAPABILITIES.length}</p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs tracking-wide text-gray-500 uppercase">
            {t('personas.stat.broken')}
          </p>
          <p
            className={`mt-1 text-2xl font-semibold ${
              brokenCount > 0 ? 'text-rose-700' : 'text-gray-900'
            }`}
          >
            {brokenCount}
          </p>
        </div>
      </section>

      {loading ? (
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      ) : (
        <ul className="space-y-3">
          {personas.map((persona) => {
            const result = compiled.get(persona.id);
            const isOpen = expanded === persona.id;
            return (
              <li
                key={persona.id}
                className="rounded-xl bg-white shadow-sm ring-1 ring-gray-200"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900">{persona.name}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${RISK_STYLE[persona.riskTier]}`}
                      >
                        {persona.riskTier}
                      </span>
                      {!persona.isSeed && (
                        <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-800 ring-1 ring-violet-600/20 ring-inset">
                          {t('personas.custom')}
                        </span>
                      )}
                      {!persona.isActive && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 ring-1 ring-gray-500/20 ring-inset">
                          {t('personas.inactive')}
                        </span>
                      )}
                      {result && !result.ok && (
                        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-800 ring-1 ring-rose-600/20 ring-inset">
                          {t('personas.compileError')}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gray-600">{persona.description}</p>
                    <p className="mt-1 font-mono text-xs text-gray-400">{persona.id}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : persona.id)}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      {t(isOpen ? 'personas.hide' : 'personas.show')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(persona)}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      {t('personas.edit')}
                    </button>
                    {isSeedPersona(persona.id) && (
                      <button
                        type="button"
                        onClick={() => void handleReset(persona.id)}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        {t('personas.reset')}
                      </button>
                    )}
                  </div>
                </div>

                {isOpen && result && (
                  <div className="border-t border-gray-100 p-4">
                    <ul className="space-y-2">
                      {persona.capabilityIds.map((capabilityId) => {
                        const capability = CAPABILITIES.find((c) => c.id === capabilityId);
                        const dark = result.darkCapabilityIds.includes(capabilityId);
                        const owner =
                          capability && capability.module !== CORE_MODULE
                            ? getModule(capability.module)
                            : undefined;

                        if (!capability) {
                          return (
                            <li key={capabilityId} className="text-sm text-rose-700">
                              <code className="font-mono text-xs">{capabilityId}</code>{' '}
                              {t('personas.unknownCapability')}
                            </li>
                          );
                        }

                        return (
                          <li key={capabilityId} className="text-sm">
                            <div className="flex flex-wrap items-baseline gap-2">
                              <code
                                className={`font-mono text-xs ${
                                  dark ? 'text-gray-400 line-through' : 'text-gray-900'
                                }`}
                              >
                                {capability.id}
                              </code>
                              <span
                                className={`text-xs ${MODE_STYLE[capability.controlMode]}`}
                              >
                                {t(MODE_LABEL[capability.controlMode])}
                              </span>
                              <span className="text-xs text-gray-400">
                                {capability.scopeTypes.join(' · ')}
                              </span>
                            </div>
                            <p
                              className={`mt-0.5 text-xs ${
                                dark ? 'text-gray-400' : 'text-gray-600'
                              }`}
                            >
                              {t(capability.descriptionKey)}
                            </p>
                            {dark && (
                              <p className="mt-0.5 text-xs text-amber-700">
                                {t('personas.moduleOff', {
                                  module: owner ? t(owner.nameKey) : capability.module,
                                })}
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>

                    <div className="mt-4 rounded-lg bg-slate-50 p-3">
                      <p className="text-xs font-semibold tracking-wide text-slate-600 uppercase">
                        {t('personas.compilesTo', { count: result.bindings.length })}
                      </p>
                      <ul className="mt-2 space-y-1">
                        {result.bindings.map((binding, index) => (
                          <li
                            key={`${binding.capabilityId}:${binding.bindingKind}:${binding.scopeType}:${index}`}
                            className="font-mono text-xs text-slate-700"
                          >
                            <span className={binding.moduleEnabled ? '' : 'line-through opacity-50'}>
                              {binding.scopeType} → {binding.bindingKind}
                              {binding.roleValue ? ` (${binding.roleValue})` : ''}
                              {binding.isPerUser ? ' · per user' : ' · per scope'}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {result.issues.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {result.issues.map((issue, index) => (
                            <li key={index} className="text-xs text-rose-700">
                              {issue.detail}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <PersonaEditor
          persona={editing}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

function PersonaEditor({
  persona,
  onCancel,
  onSave,
}: {
  persona: Persona;
  onCancel: () => void;
  onSave: (persona: Persona) => void | Promise<void>;
}) {
  const t = useT();
  const [draft, setDraft] = useState<Persona>(persona);

  const toggle = (capabilityId: string) =>
    setDraft((d) => ({
      ...d,
      capabilityIds: d.capabilityIds.includes(capabilityId)
        ? d.capabilityIds.filter((c) => c !== capabilityId)
        : [...d.capabilityIds, capabilityId],
    }));

  const canSave = draft.id.trim().length > 0 && draft.name.trim().length > 0;

  return (
    <section className="rounded-xl bg-white p-4 shadow-sm ring-2 ring-blue-500/30">
      <h3 className="text-sm font-semibold tracking-wide text-gray-500 uppercase">
        {t('personas.editor.title')}
      </h3>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-500">{t('personas.field.id')}</span>
          <input
            value={draft.id}
            disabled={persona.id !== ''}
            onChange={(e) => setDraft((d) => ({ ...d, id: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-mono text-xs text-gray-800 disabled:bg-gray-50"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-500">
            {t('personas.field.name')}
          </span>
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-gray-800"
          />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block text-xs text-gray-500">
            {t('personas.field.description')}
          </span>
          <input
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-gray-800"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-500">
            {t('personas.field.riskTier')}
          </span>
          <select
            value={draft.riskTier}
            onChange={(e) =>
              setDraft((d) => ({ ...d, riskTier: e.target.value as RiskTier }))
            }
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-gray-800"
          >
            {RISK_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {tier}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-end gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(e) => setDraft((d) => ({ ...d, isActive: e.target.checked }))}
            className="h-4 w-4 rounded border-gray-300"
          />
          <span className="text-gray-700">{t('personas.field.active')}</span>
        </label>
      </div>

      <fieldset className="mt-4">
        <legend className="text-xs text-gray-500">
          {t('personas.field.capabilities')}
        </legend>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          {CAPABILITIES.map((capability) => (
            <label key={capability.id} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.capabilityIds.includes(capability.id)}
                onChange={() => toggle(capability.id)}
                className="mt-1 h-4 w-4 rounded border-gray-300"
              />
              <span>
                <code className="font-mono text-xs text-gray-900">{capability.id}</code>
                <span className={`ml-2 text-xs ${MODE_STYLE[capability.controlMode]}`}>
                  {t(MODE_LABEL[capability.controlMode])}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={!canSave}
          onClick={() => void onSave(draft)}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {t('personas.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          {t('personas.cancel')}
        </button>
      </div>
    </section>
  );
}

export default PersonasPage;
