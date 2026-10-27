import { HashRouter, NavLink, Navigate, Outlet, Route, Routes } from 'react-router-dom';

import { GuidelinesPage } from '@/components/GuidelinesPage';
import { GuidelinesSetupPage } from '@/components/GuidelinesSetup';
import { LOCALES, LOCALE_LABELS, useI18n, type Locale } from '@/i18n';
import { PATHS } from '@/paths';

const tab = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'}`;

/** Header with the two pages and the language switch. */
export function Layout() {
  const { t, locale, setLocale } = useI18n();
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <span className="text-base font-semibold text-slate-900">{t('app.name')}</span>
          <nav aria-label={t('app.nav')} className="flex gap-1">
            <NavLink to={PATHS.guide} end className={tab}>
              {t('app.nav.guide')}
            </NavLink>
            <NavLink to={PATHS.conventions} className={tab}>
              {t('app.nav.conventions')}
            </NavLink>
          </nav>
          <a
            href={`./power-bi-guidelines.${locale}.html`}
            target="_blank"
            rel="noopener"
            title={t('app.html.title')}
            className="ml-auto rounded-lg px-3 py-1.5 text-sm font-medium text-blue-700 underline-offset-2 hover:underline"
          >
            {t('app.html')}
          </a>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <span>{t('app.language')}</span>
            <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)} className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm text-gray-800">
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_LABELS[l]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-slate-500">{t('app.privacy')}</footer>
    </div>
  );
}

/** The routes, without a router, so tests can start on any page. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path={PATHS.guide} element={<GuidelinesPage />} />
        <Route path={PATHS.conventions} element={<GuidelinesSetupPage />} />
        <Route path="*" element={<Navigate to={PATHS.guide} replace />} />
      </Route>
    </Routes>
  );
}

/** Hash routes: a reload works on any static host, inside Fabric or not. */
export default function App() {
  return (
    <HashRouter>
      <AppRoutes />
    </HashRouter>
  );
}
