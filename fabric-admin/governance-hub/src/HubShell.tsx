import { Navigate, Route, Routes } from 'react-router-dom';

import { Layout } from '@/components/Layout';
import { useModuleRouteElements } from '@/components/ModuleRoutes';
import { GovernanceProvider } from '@/hooks/GovernanceContext';
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
import { UmEmbedded } from '@/um/components/UmLayout';
import { UmProvider } from '@/um/hooks/UmContext';
import { umRouteElements } from '@/um/UmRoutes';

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
        {/* The Fabric User Manager's tabs, inside the Hub's own layout. */}
        <Route
          element={
            <UmProvider>
              <UmEmbedded />
            </UmProvider>
          }
        >
          {umRouteElements()}
        </Route>
      </Route>
      {/* A route belonging to a module that is now off falls back to Setup
          rather than 404-ing at someone. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/**
 * The full Governance Hub: every area, with its governance provider, module
 * probes and collectors. Loaded only in the full profile, and compiled out of
 * builds made without the advanced areas (docs/FABRIC-USER-MANAGER-PLAN.md
 * section 5).
 */
export default function HubShell() {
  return (
    <GovernanceProvider>
      <AppShell />
    </GovernanceProvider>
  );
}
