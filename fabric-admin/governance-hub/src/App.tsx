import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AuthPage } from '@/components/AuthPage';
import { Layout } from '@/components/Layout';
import { useModuleRouteElements } from '@/components/ModuleRoutes';
import { useAuth } from '@/hooks/AuthContext';
import { GovernanceProvider } from '@/hooks/GovernanceContext';
import { useT } from '@/i18n';
import { CanDoPage } from '@/pages/CanDoPage';
import { ApprovalsPage } from '@/pages/ApprovalsPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { DriftPage } from '@/pages/DriftPage';
import { EntitlementsPage } from '@/pages/EntitlementsPage';
import { InventoryPage } from '@/pages/InventoryPage';
import { PersonasPage } from '@/pages/PersonasPage';
import { PoliciesPage } from '@/pages/PoliciesPage';
import { RequestsPage } from '@/pages/RequestsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SetupPage } from '@/pages/SetupPage';
import { TasksPage } from '@/pages/TasksPage';
import { WriteGatesPage } from '@/pages/WriteGatesPage';

function AuthGuard({
  children,
  requireAuth,
}: {
  children: React.ReactNode;
  requireAuth: boolean;
}) {
  const { isAuthenticated, loading } = useAuth();
  const t = useT();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-gray-500">{t('common.loading')}</div>
      </div>
    );
  }

  if (requireAuth && !isAuthenticated) return <Navigate to="/auth" replace />;
  if (!requireAuth && isAuthenticated) return <Navigate to="/" replace />;

  return <>{children}</>;
}

/**
 * The signed-in shell. Split out of `App` so module routes can be resolved
 * inside the governance provider — which is what makes "toggle a module off and
 * its pages disappear" work without a reload.
 */
function AppShell() {
  const moduleRouteElements = useModuleRouteElements();

  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Setup is the landing page: a new tenant must see its own state
            first, not an empty dashboard (PLAN.md §8.4). */}
        <Route path="/" element={<SetupPage />} />
        <Route path="/can-do" element={<CanDoPage />} />
        <Route path="/drift" element={<DriftPage />} />
        <Route path="/policies" element={<PoliciesPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/personas" element={<PersonasPage />} />
        <Route path="/entitlements" element={<EntitlementsPage />} />
        <Route path="/requests" element={<RequestsPage />} />
        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/write-gates" element={<WriteGatesPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        {moduleRouteElements}
      </Route>
      {/* A route belonging to a module that is now off falls back to Setup
          rather than 404-ing at someone. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/auth"
          element={
            <AuthGuard requireAuth={false}>
              <AuthPage />
            </AuthGuard>
          }
        />
        <Route
          path="*"
          element={
            <AuthGuard requireAuth={true}>
              <GovernanceProvider>
                <AppShell />
              </GovernanceProvider>
            </AuthGuard>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
