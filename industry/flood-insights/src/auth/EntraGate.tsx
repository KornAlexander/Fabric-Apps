import { ensureSignedInWithFabric, initEmbeddedAuth } from '@microsoft/rayfin-auth-provider-fabric';
import { RayfinClient } from '@microsoft/rayfin-client';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useI18n } from '@/i18n';

/**
 * Require a Microsoft Entra identity before the application will run.
 *
 * ⚠️ **Read this before trusting it with anything.** This is a gate on the APPLICATION, not on the
 * files it downloads. Rayfin static hosting is public by design — its own documentation says the
 * host "serves them at a public URL" and offers no `private` or `requireAuth` option — so
 * `https://<host>/terrain/ahrtal-2021/buildings_lod2.json` answers 200 to anyone who asks, with or
 * without this component. That was verified with an unauthenticated request, not assumed.
 *
 * So what this DOES buy:
 *   * someone who finds the URL sees a sign-in wall instead of the app;
 *   * the scene, the portfolio figures and the whole narrative stay unrendered until Entra has
 *     issued a session for this tenant;
 *   * nothing heavy is even fetched until then, so the assets are not handed out casually.
 *
 * What it does NOT buy: secrecy for the deployed assets. Anyone who knows a file path still gets
 * that file. If the requirement is that the data not be reachable at all, the only reliable
 * options are to unpublish the static site or to move the assets behind an authenticated
 * endpoint — a client-side gate cannot do it, and pretending otherwise would be worse than the
 * open door, because it looks solved.
 *
 * The assets in question are open government geodata (dl-de/by-2-0, dl-de/zero-2-0, CC BY 4.0) plus
 * synthetic insurance figures; the file carrying real addresses and Copernicus damage grades is
 * deliberately NOT deployed (PLAN §2.2, enforced in build_lod2_mesh.py). That is why this is a
 * proportionate answer and not a false one.
 */

type GateState = 'checking' | 'signed-out' | 'signed-in' | 'unavailable';

/**
 * The Vite dev server runs ungated.
 *
 * This is `import.meta.env.DEV` and NOT a bypass flag on purpose. A flag can be set by accident in
 * a production build and would silently unlock the deployed site; `DEV` is false in every artefact
 * `vite build` produces, so the thing that ships is always gated and cannot be talked out of it.
 * The 14 Playwright specs drive `npx vite`, so they keep running without knowing this exists.
 */
const UNGATED_DEV_SERVER = import.meta.env.DEV;

const API_URL = import.meta.env.VITE_RAYFIN_API_URL as string | undefined;
const PUBLISHABLE_KEY = import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY as string | undefined;
const WORKSPACE_ID = import.meta.env.VITE_FABRIC_WORKSPACE_ID as string | undefined;
const ITEM_ID = import.meta.env.VITE_FABRIC_ITEM_ID as string | undefined;
const PORTAL_URL =
  (import.meta.env.VITE_FABRIC_PORTAL_URL as string | undefined) ??
  'https://app.fabric.microsoft.com';

function configured(): boolean {
  return Boolean(API_URL && PUBLISHABLE_KEY && WORKSPACE_ID && ITEM_ID);
}

export function EntraGate({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [state, setState] = useState<GateState>(configured() ? 'checking' : 'unavailable');
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<RayfinClient | null>(null);
  if (clientRef.current === null && configured()) {
    clientRef.current = new RayfinClient({
      baseUrl: API_URL!,
      publishableKey: PUBLISHABLE_KEY!,
    });
  }

  const options = {
    workspaceId: WORKSPACE_ID ?? '',
    projectId: ITEM_ID ?? '',
    fabricPortalUrl: PORTAL_URL,
    returnOrigin: window.location.origin,
  };

  useEffect(() => {
    const auth = clientRef.current?.auth;
    if (!auth) return;
    let cancelled = false;

    void (async () => {
      try {
        // Inside the Fabric shell the session arrives by postMessage with no click at all.
        const embedded = await initEmbeddedAuth(auth, options);
        if (cancelled) return;
        if (embedded) {
          setState('signed-in');
          return;
        }
        // Standalone: an existing session survives a reload, so check before asking.
        const session = auth.getSession();
        setState(session ? 'signed-in' : 'signed-out');
      } catch {
        if (!cancelled) setState('signed-out');
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = useCallback(async () => {
    const auth = clientRef.current?.auth;
    if (!auth) return;
    setError(null);
    try {
      // Must run from the click itself: the popup flow calls window.open().
      await ensureSignedInWithFabric(auth, options);
      setState('signed-in');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === 'signed-in') return <>{children}</>;
  if (UNGATED_DEV_SERVER) return <>{children}</>;

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-stone-100 p-6"
      data-testid="entra-gate"
      data-gate-state={state}
    >
      <div className="max-w-xl rounded border border-stone-300 bg-white p-8 shadow-sm">
        <p className="text-xs uppercase tracking-widest text-stone-500">Flut-Insights</p>
        <h1 className="mt-2 text-xl text-stone-900">{t('gate.title')}</h1>
        <p className="mt-3 text-sm leading-relaxed text-stone-700">{t('gate.body')}</p>

        {state === 'unavailable' ? (
          <p className="mt-4 rounded bg-amber-50 p-3 text-sm text-amber-900" role="alert">
            {t('gate.unavailable')}
          </p>
        ) : (
          <button
            type="button"
            onClick={signIn}
            disabled={state === 'checking'}
            data-testid="entra-signin"
            className="mt-6 rounded bg-stone-800 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {state === 'checking' ? t('gate.checking') : t('gate.signIn')}
          </button>
        )}

        {error && (
          <p className="mt-4 text-sm text-red-700" role="alert" data-testid="entra-error">
            {error}
          </p>
        )}

        {/* Saying plainly what the gate does not cover. It is a demonstrator, and the honest
            statement costs nothing next to someone assuming the assets are private. */}
        <p className="mt-6 border-t border-stone-200 pt-4 text-xs leading-relaxed text-stone-500">
          {t('gate.scope')}
        </p>
      </div>
    </div>
  );
}
