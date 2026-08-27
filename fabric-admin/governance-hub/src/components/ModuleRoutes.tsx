import { lazy, Suspense, useMemo } from 'react';
import { Route } from 'react-router-dom';

import { useGovernance } from '@/hooks/GovernanceContext';
import { useT } from '@/i18n';
import { moduleRoutes } from '@/modules';

function RouteFallback() {
  const t = useT();
  return <div className="py-12 text-center text-sm text-gray-500">{t('common.loading')}</div>;
}

/**
 * Routes contributed by enabled modules (PLAN.md §8.2).
 *
 * Returned as a fragment of `<Route>` elements so `App.tsx` stays declarative
 * and no page has to know whether its module is on.
 */
export function useModuleRouteElements() {
  const { config } = useGovernance();

  return useMemo(
    () =>
      moduleRoutes(config.modulesEnabled).map((route) => {
        const Page = lazy(route.element);
        return (
          <Route
            key={route.path}
            path={route.path}
            element={
              <Suspense fallback={<RouteFallback />}>
                <Page />
              </Suspense>
            }
          />
        );
      }),
    [config.modulesEnabled]
  );
}
