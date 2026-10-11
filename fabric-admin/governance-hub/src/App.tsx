import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AuthPage } from '@/components/AuthPage';
import { useAuth } from '@/hooks/AuthContext';
import { useT } from '@/i18n';
import { UmLayout } from '@/um/components/UmLayout';
import { getUmEnv } from '@/um/config/umEnv';
import { UM_PATHS, resolveProfile, type UiProfile } from '@/um/domain/profile';
import { UmProvider } from '@/um/hooks/UmContext';
import { PROFILE_WAIT_MS, loadStoredProfile, within } from '@/um/services/profileStore';
import { umRouteElements } from '@/um/UmRoutes';

/**
 * Build level of the profile switch (docs/FABRIC-USER-MANAGER-PLAN.md
 * section 5). A build made with `VITE_UM_ADVANCED_AREAS=false` does not
 * contain the Governance Hub areas at all: the import below is dead code
 * there and is dropped by the bundler, so no setting can reveal them.
 */
const ADVANCED_IN_BUILD = import.meta.env.VITE_UM_ADVANCED_AREAS !== 'false';
const HubShell = ADVANCED_IN_BUILD ? lazy(() => import('@/HubShell')) : null;

const RELOAD_FLAG = 'governance-hub.chunk-reload';

/**
 * A browser that still holds the page from before a deployment asks for a
 * Hub chunk that no longer exists. Reload once to pick up the new page;
 * if that does not help, say so instead of showing a blank screen.
 */
class ChunkBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    try {
      if (window.sessionStorage.getItem(RELOAD_FLAG) !== '1') {
        window.sessionStorage.setItem(RELOAD_FLAG, '1');
        window.location.reload();
      }
    } catch {
      /* storage can be blocked; the fallback below still shows */
    }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function LoadFailed() {
  const t = useT();
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <p className="max-w-md text-center text-sm text-gray-700">{t('um.shell.loadFailed')}</p>
    </div>
  );
}

function Loading() {
  const t = useT();
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-gray-500">{t('common.loading')}</div>
    </div>
  );
}

function AuthGuard({
  children,
  requireAuth,
}: {
  children: React.ReactNode;
  requireAuth: boolean;
}) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return <Loading />;
  if (requireAuth && !isAuthenticated) return <Navigate to="/auth" replace />;
  if (!requireAuth && isAuthenticated) return <Navigate to="/" replace />;

  return <>{children}</>;
}

/** The simple profile: three tabs, and none of the Hub's providers or probes. */
function SimpleShell() {
  return (
    <UmProvider>
      <Routes>
        <Route element={<UmLayout />}>{umRouteElements()}</Route>
        <Route path="*" element={<Navigate to={UM_PATHS.workspaces} replace />} />
      </Routes>
    </UmProvider>
  );
}

/**
 * Run level of the profile switch. Three tabs unless the build contains the
 * Hub areas and the stored setting asks for them. The setting keeps things
 * tidy; it is not a control, because any signed-in user could change it.
 */
function ProfileGate() {
  const env = getUmEnv();
  const canBeFull = ADVANCED_IN_BUILD && !env.mock;
  const defaultProfile = env.defaultProfile;
  const [profile, setProfile] = useState<UiProfile | null>(canBeFull ? null : 'simple');

  useEffect(() => {
    if (!canBeFull) return;
    let cancelled = false;
    const apply = (storedProfile: unknown) => {
      if (!cancelled) setProfile(resolveProfile({ advancedInBuild: true, storedProfile, defaultProfile }));
    };
    const stored = loadStoredProfile();
    // A slow first answer of the database must not keep the app on "loading":
    // after a short wait it starts with the default, and the stored setting
    // still applies when it arrives.
    void within(stored, PROFILE_WAIT_MS).then((early) => {
      apply(early);
      if (early === undefined) void stored.then((late) => late !== undefined && apply(late)).catch(() => undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [canBeFull, defaultProfile]);

  if (!profile) return <Loading />;
  if (profile === 'full' && HubShell) {
    return (
      <ChunkBoundary fallback={<LoadFailed />}>
        <Suspense fallback={<Loading />}>
          <HubShell />
        </Suspense>
      </ChunkBoundary>
    );
  }
  return <SimpleShell />;
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
              <ProfileGate />
            </AuthGuard>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
