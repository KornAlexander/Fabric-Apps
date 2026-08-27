import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AuthPage } from '@/components/AuthPage';
import { Layout } from '@/components/Layout';
import { useAuth } from '@/hooks/AuthContext';
import { ApprovalsPage } from '@/pages/ApprovalsPage';
import { FabricAppsPage } from '@/pages/FabricAppsPage';
import { GroupsPage } from '@/pages/GroupsPage';
import { KpiIndexPage } from '@/pages/KpiIndexPage';
import { LineagePage } from '@/pages/LineagePage';
import { ReportDetailPage } from '@/pages/ReportDetailPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { RequestsPage } from '@/pages/RequestsPage';
import { SearchPage } from '@/pages/SearchPage';
import { TopicPage } from '@/pages/TopicPage';

function AuthGuard({
  children,
  requireAuth,
}: {
  children: React.ReactNode;
  requireAuth: boolean;
}) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (requireAuth && !isAuthenticated) return <Navigate to="/auth" replace />;
  if (!requireAuth && isAuthenticated) return <Navigate to="/" replace />;

  return <>{children}</>;
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
          element={
            <AuthGuard requireAuth={true}>
              <Layout />
            </AuthGuard>
          }
        >
          <Route path="/" element={<ReportsPage />} />
          <Route path="/apps" element={<FabricAppsPage />} />
          <Route path="/kpis" element={<KpiIndexPage />} />
          <Route path="/topics" element={<TopicPage />} />
          <Route path="/lineage" element={<LineagePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/requests" element={<RequestsPage />} />
          <Route path="/approvals" element={<ApprovalsPage />} />
          <Route path="/groups" element={<GroupsPage />} />
          <Route path="/reports/:reportId" element={<ReportDetailPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
