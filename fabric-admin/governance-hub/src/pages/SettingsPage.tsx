import { useState } from 'react';

import { LanguageToggle } from '@/components/LanguageToggle';
import { StatusPill } from '@/components/StatusPill';
import { useAuth } from '@/hooks/AuthContext';
import { useGovernance } from '@/hooks/GovernanceContext';
import { useT } from '@/i18n';
import { MODULE_IDS, allBindingKinds, getModule } from '@/modules';

/**
 * Settings — the operator's module toggles and the write-gate view
 * (PLAN.md §8.2, §8.7).
 *
 * The module toggle is also the demo lever: flipping a plane on here must make
 * the rest of the app visibly gain that plane, live, with no redeploy.
 *
 * Write arming is intentionally **read-only in Phase 1**. The gates exist and
 * are enforced, but nothing in this build can perform a privileged write, so
 * offering an "arm" switch would be theatre.
 */
export function SettingsPage() {
  const t = useT();
  const { user } = useAuth();
  const { config, availability, backendReachable, setModuleEnabled } = useGovernance();
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const kinds = allBindingKinds();

  async function toggle(id: (typeof MODULE_IDS)[number], enabled: boolean) {
    setSaving(id);
    setSaved(null);
    const ok = await setModuleEnabled(id, enabled, user?.email ?? 'unknown');
    setSaving(null);
    if (ok) {
      setSaved(id);
      setTimeout(() => setSaved(null), 2000);
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-xl font-semibold text-gray-900">{t('settings.title')}</h2>
        {!backendReachable && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-600/20 ring-inset">
            {t('settings.readOnlyNotice')}
          </p>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold tracking-wide text-gray-500 uppercase">
          {t('settings.modules.title')}
        </h3>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">{t('settings.modules.help')}</p>
        <ul className="mt-3 space-y-2">
          {MODULE_IDS.map((id) => {
            const mod = getModule(id);
            if (!mod) return null;
            const enabled = config.modulesEnabled.includes(id);
            return (
              <li
                key={id}
                className="flex items-start justify-between gap-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{t(mod.nameKey)}</span>
                    <StatusPill status={availability[id]?.status ?? 'checking'} />
                    {saved === id && (
                      <span className="text-xs text-emerald-700">{t('settings.saved')}</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-600">{t(mod.descriptionKey)}</p>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={enabled}
                    disabled={saving === id}
                    onChange={(e) => void toggle(id, e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="sr-only">{t(mod.nameKey)}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h3 className="text-sm font-semibold tracking-wide text-gray-500 uppercase">
          {t('settings.writes.title')}
        </h3>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">{t('settings.writes.help')}</p>
        <div className="mt-3 overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
          <table className="min-w-full text-sm">
            <tbody>
              {kinds.map((kind) => (
                <tr key={kind.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-2 font-mono text-xs text-gray-900">{kind.id}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{kind.module}</td>
                  <td className="px-4 py-2 text-xs">
                    <span
                      className={
                        kind.controlMode === 'preventive-auto'
                          ? 'text-emerald-700'
                          : kind.controlMode === 'preventive-manual'
                            ? 'text-amber-700'
                            : 'text-rose-700'
                      }
                    >
                      {kind.controlMode}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {config.writeKinds.includes(kind.id) ? 'armed' : 'disarmed'}
                  </td>
                  <td className="max-w-md px-4 py-2 text-xs text-gray-600">
                    {kind.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold tracking-wide text-gray-500 uppercase">
          {t('settings.language.title')}
        </h3>
        <div className="mt-2">
          <LanguageToggle />
        </div>
      </section>
    </div>
  );
}

export default SettingsPage;
