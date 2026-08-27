import { useMemo, useState } from 'react';

import { CheckRow } from '@/components/CheckRow';
import { StatusPill } from '@/components/StatusPill';
import { getGovEnv } from '@/config/govEnv';
import { buildPreflight } from '@/domain/preflight';
import { useGovernance } from '@/hooks/GovernanceContext';
import { useT } from '@/i18n';
import { MODULE_IDS, getModule, moduleNotebooks } from '@/modules';
import {
  GRAPH_MINIMAL_SCOPES,
  GRAPH_READ_SCOPES,
  getGraphToken,
  signInToPbi,
} from '@/services/fabricAuth';
import { runNotebook } from '@/services/udfClient';

/**
 * Setup — the first screen a new tenant sees (PLAN.md §8.4).
 *
 * Doubles as the honest-onboarding artifact for a customer security review: it
 * enumerates every permission this deployment wants and what breaks without it.
 */
export function SetupPage() {
  const t = useT();
  const { config, availability, tier, probing, backendReachable, refresh } = useGovernance();
  const env = useMemo(() => getGovEnv(), []);
  const [bootstrapMsg, setBootstrapMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [connectMsg, setConnectMsg] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  /**
   * The data-plane tokens are a **separate** sign-in from the Rayfin app shell:
   * the app session gates the UI, MSAL authorises the Power BI and Graph hops.
   * Both must be acquired from a user gesture, because a silent acquisition
   * fails until the scopes have been consented once and popups are blocked
   * outside a click. Without this button the Setup page reported
   * "Power BI sign-in required" with no way to act on it, which left every
   * live-checked module permanently unavailable (D42).
   */
  async function connectDataPlane() {
    setConnecting(true);
    setConnectMsg(null);
    const notes: string[] = [];
    try {
      await signInToPbi();
    } catch (error) {
      notes.push(`Power BI: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await getGraphToken(GRAPH_READ_SCOPES, { interactive: true });
    } catch {
      // `Directory.Read.All` and `Group.Read.All` need *admin* consent. When
      // that is refused the whole request fails, which would also throw away
      // the `User.Read` every user already has — and M-ENTRA would drop to
      // nothing instead of T0. So fall back to the minimal scope and say so.
      try {
        await getGraphToken(GRAPH_MINIMAL_SCOPES, { interactive: true });
        notes.push(t('setup.connect.graphMinimal'));
      } catch (error) {
        notes.push(`Graph: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    setConnectMsg(notes.length ? notes.join(' · ') : null);
    setConnecting(false);
    await refresh();
  }

  const checks = useMemo(
    () => buildPreflight({ env, config, availability, backendReachable }),
    [env, config, availability, backendReachable]
  );

  const notebooks = useMemo(
    () => moduleNotebooks(config.modulesEnabled, env),
    [config.modulesEnabled, env]
  );

  const bootstrapNotebook = env.VITE_GOV_BOOTSTRAP_NOTEBOOK_ID;
  const bootstrapWorkspace = env.VITE_GOV_WORKSPACE_ID ?? env.VITE_FABRIC_WORKSPACE_ID;

  async function runBootstrap(dryRun: boolean) {
    if (!bootstrapNotebook || !bootstrapWorkspace) return;
    setBusy(true);
    setBootstrapMsg(null);
    try {
      const result = await runNotebook(bootstrapWorkspace, bootstrapNotebook, {
        dry_run: { value: dryRun, type: 'bool' },
      });
      setBootstrapMsg(result.exitValue ?? result.status ?? 'submitted');
      await refresh();
    } catch (error) {
      setBootstrapMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-xl font-semibold text-gray-900">{t('setup.title')}</h2>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">{t('setup.intro')}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-lg bg-white px-3 py-1.5 shadow-sm ring-1 ring-gray-200">
            {t('setup.tier.current')}: <strong>{t(`module.tier.${tier}`)}</strong>
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={probing}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {probing ? t('common.checking') : t('common.recheck')}
          </button>
          <button
            type="button"
            onClick={() => void connectDataPlane()}
            disabled={connecting}
            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-blue-800 hover:bg-blue-100 disabled:opacity-50"
          >
            {connecting ? t('common.checking') : t('setup.connect')}
          </button>
        </div>
        {connectMsg ? (
          <p className="mt-2 max-w-3xl text-xs text-amber-700">{connectMsg}</p>
        ) : null}
        <p className="mt-2 max-w-3xl text-xs text-gray-500">{t('setup.connect.explain')}</p>
        <p className="mt-2 max-w-3xl text-xs text-gray-500">{t('setup.tier.explain')}</p>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold tracking-wide text-gray-500 uppercase">
          {t('setup.modules')}
        </h3>
        <ul className="grid gap-3 sm:grid-cols-2">
          {MODULE_IDS.map((id) => {
            const mod = getModule(id);
            const state = availability[id];
            if (!mod) return null;
            return (
              <li
                key={id}
                className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-900">{t(mod.nameKey)}</span>
                  <StatusPill status={state?.status ?? 'checking'} />
                </div>
                <p className="mt-1 text-xs text-gray-600">{t(mod.descriptionKey)}</p>
                {state?.reasonKey && (
                  <p className="mt-2 text-xs text-gray-700">
                    {t(state.reasonKey, state.reasonParams)}
                  </p>
                )}
                {state && (
                  <p className="mt-2 text-xs text-gray-400">
                    {t(`module.tier.${state.tier}`)} ·{' '}
                    {t(
                      state.probeKind === 'live'
                        ? 'module.probe.live'
                        : 'module.probe.declared'
                    )}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold tracking-wide text-gray-500 uppercase">
          {t('setup.prerequisites')}
        </h3>
        <ul className="rounded-xl bg-white px-4 shadow-sm ring-1 ring-gray-200">
          {checks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </ul>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-semibold tracking-wide text-gray-500 uppercase">
          {t('setup.collectors')}
        </h3>
        <p className="mb-3 max-w-3xl text-sm text-gray-600">{t('setup.collectors.help')}</p>
        {notebooks.length === 0 ? (
          <p className="rounded-xl bg-white p-4 text-sm text-gray-500 shadow-sm ring-1 ring-gray-200">
            {t('setup.collectors.none')}
          </p>
        ) : (
          <ul className="space-y-2">
            {notebooks.map((nb) => {
              const mod = getModule(nb.module);
              return (
                <li
                  key={`${nb.module}:${nb.role}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-gray-900">
                      {mod ? t(mod.nameKey) : nb.module}
                    </span>
                    <p className="mt-0.5 text-xs text-gray-600">{nb.description}</p>
                    <code className="mt-1 block font-mono text-xs text-gray-400">
                      {nb.envVar}
                    </code>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${
                      nb.configured
                        ? 'bg-emerald-50 text-emerald-800 ring-emerald-600/20'
                        : 'bg-gray-100 text-gray-600 ring-gray-500/20'
                    }`}
                  >
                    {t(
                      nb.configured
                        ? 'setup.collectors.configured'
                        : 'setup.collectors.missing'
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
        {!bootstrapNotebook || !bootstrapWorkspace ? (
          <p className="text-sm text-gray-600">{t('setup.bootstrapNotConfigured')}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void runBootstrap(true)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {t('setup.runBootstrapDryRun')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runBootstrap(false)}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {t('setup.runBootstrap')}
            </button>
            {busy && <span className="text-sm text-gray-500">{t('common.loading')}</span>}
          </div>
        )}
        {bootstrapMsg && (
          <pre className="mt-3 max-h-48 overflow-auto rounded bg-gray-900 p-3 font-mono text-xs text-gray-100">
            {bootstrapMsg}
          </pre>
        )}
      </section>
    </div>
  );
}

export default SetupPage;
