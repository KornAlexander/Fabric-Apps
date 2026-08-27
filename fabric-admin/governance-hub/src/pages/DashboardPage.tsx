import { StatusPill } from '@/components/StatusPill';
import { useGovernance } from '@/hooks/GovernanceContext';
import { useT } from '@/i18n';
import { getModule } from '@/modules';

/**
 * Dashboard — a placeholder in Phase 1, but an honest one.
 *
 * It shows what actually exists today (modules, reach tier, unmet
 * dependencies) and states plainly what has not been built yet, rather than
 * rendering empty charts that imply missing data.
 */
export function DashboardPage() {
  const t = useT();
  const { config, availability, tier, unmet } = useGovernance();

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-xl font-semibold text-gray-900">{t('dashboard.title')}</h2>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">{t('dashboard.phaseNotice')}</p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs tracking-wide text-gray-500 uppercase">
            {t('dashboard.reachTier')}
          </p>
          <p className="mt-1 text-lg font-semibold text-gray-900">
            {t(`module.tier.${tier}`)}
          </p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs tracking-wide text-gray-500 uppercase">
            {t('dashboard.enabledModules')}
          </p>
          <p className="mt-1 text-lg font-semibold text-gray-900">
            {config.modulesEnabled.length}
          </p>
        </div>
      </section>

      <section>
        <ul className="grid gap-3 sm:grid-cols-2">
          {config.modulesEnabled.map((id) => {
            const mod = getModule(id);
            if (!mod) return null;
            const missing = unmet.find((u) => u.module === id)?.missing ?? [];
            return (
              <li
                key={id}
                className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-900">{t(mod.nameKey)}</span>
                  <StatusPill status={availability[id]?.status ?? 'checking'} />
                </div>
                {missing.length > 0 && (
                  <p className="mt-2 font-mono text-xs text-amber-700">
                    depends on: {missing.join(', ')}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

export default DashboardPage;
