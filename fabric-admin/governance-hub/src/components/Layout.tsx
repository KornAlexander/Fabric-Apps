import { NavLink, Outlet } from 'react-router-dom';

import { LanguageToggle } from '@/components/LanguageToggle';
import { TierBadge } from '@/components/TierBadge';
import { WriteChip } from '@/components/WriteChip';
import { useAuth } from '@/hooks/AuthContext';
import { useGovernance } from '@/hooks/GovernanceContext';
import { useT, type TranslationKey } from '@/i18n';
import { moduleRoutes } from '@/modules';

/**
 * Core navigation. Module-owned routes are added by the registry in later
 * phases; a disabled module's pages are removed from the nav entirely rather
 * than greyed out (PLAN.md §13).
 */
const CORE_TABS: { to: string; labelKey: TranslationKey; end: boolean }[] = [
  { to: '/', labelKey: 'nav.setup', end: true },
  { to: '/can-do', labelKey: 'nav.cando', end: false },
  { to: '/drift', labelKey: 'nav.drift', end: false },
  { to: '/policies', labelKey: 'nav.policies', end: false },
  { to: '/inventory', labelKey: 'nav.inventory', end: false },
  { to: '/personas', labelKey: 'nav.personas', end: false },
  { to: '/entitlements', labelKey: 'nav.entitlements', end: false },
  { to: '/requests', labelKey: 'nav.requests', end: false },
  { to: '/approvals', labelKey: 'nav.approvals', end: false },
  { to: '/tasks', labelKey: 'nav.tasks', end: false },
  { to: '/write-gates', labelKey: 'nav.writeGates', end: false },
  { to: '/dashboard', labelKey: 'nav.dashboard', end: false },
  { to: '/settings', labelKey: 'nav.settings', end: false },
];

export function Layout() {
  const t = useT();
  const { user, signOut } = useAuth();
  const { tier, config } = useGovernance();
  const extraTabs = moduleRoutes(config.modulesEnabled).map((route) => ({
    to: route.path,
    labelKey: route.labelKey,
    end: false,
  }));
  const tabs = [...CORE_TABS, ...extraTabs];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      <header className="border-b border-black/5 bg-white/70 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{t('app.name')}</h1>
            <p className="text-xs text-gray-500">{t('app.tagline')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <TierBadge tier={tier} />
            <WriteChip />
            <LanguageToggle />
            <span className="text-gray-600">{user?.name ?? user?.email}</span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-gray-700 hover:bg-gray-50"
            >
              {t('common.signOut')}
            </button>
          </div>
        </div>
        <nav className="flex flex-wrap gap-1 px-4">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `rounded-t-lg px-4 py-2 text-sm font-medium ${
                  isActive
                    ? 'bg-white text-blue-700 shadow-[0_-1px_0_0_rgba(0,0,0,0.04)]'
                    : 'text-gray-500 hover:text-gray-800'
                }`
              }
            >
              {t(tab.labelKey)}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
