import { NavLink, Outlet } from 'react-router-dom';

import { PbiGate } from '@/components/PbiGate';
import { RefreshButton } from '@/components/RefreshButton';
import { useAuth } from '@/hooks/AuthContext';

const tabs = [
  { to: '/', label: 'Reports', end: true },
  { to: '/apps', label: 'Fabric Apps', end: false },
  { to: '/kpis', label: 'KPIs', end: false },
  { to: '/topics', label: 'Topics', end: false },
  { to: '/lineage', label: 'Lineage', end: false },
  { to: '/search', label: 'Search', end: false },
  { to: '/requests', label: 'Requests', end: false },
  { to: '/approvals', label: 'Approvals', end: false },
  { to: '/groups', label: 'Groups', end: false },
];

export function Layout() {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <header className="border-b border-black/5 bg-white/70 backdrop-blur-sm">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Data Catalog</h1>
            <p className="text-xs text-gray-500">
              Power BI reports, semantic models &amp; KPIs across your workspaces
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <RefreshButton />
            <span className="text-gray-600">{user?.name ?? user?.email}</span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-gray-700 hover:bg-gray-50"
            >
              Sign out
            </button>
          </div>
        </div>
        <nav className="flex gap-1 px-4">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `rounded-t-lg px-4 py-2 text-sm font-medium ${
                  isActive
                    ? 'bg-white text-blue-700 shadow-[0_-1px_0_0_rgba(0,0,0,0.04)]'
                    : 'text-gray-500 hover:text-gray-800'
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <PbiGate>
          <Outlet />
        </PbiGate>
      </main>

      <footer className="mx-auto max-w-5xl px-6 py-6 text-xs text-gray-400">
        Access-request &amp; approval workflow adapted from{' '}
        <a
          href="https://github.com/DaSenf1860/fabricplatformgovernance"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-gray-600"
        >
          DaSenf1860/fabricplatformgovernance
        </a>{' '}
        by Andreas J. Rederer · see{' '}
        <a
          href="https://github.com/DaSenf1860"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-gray-600"
        >
          @DaSenf1860
        </a>
        .
      </footer>
    </div>
  );
}

