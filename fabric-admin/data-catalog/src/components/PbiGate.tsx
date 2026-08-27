import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/hooks/AuthContext';
import { getFabricToken, PbiSignInRequiredError, signInToPbi } from '@/services/fabricAuth';
import { isLiveCatalog } from '@/services/catalogClient';

/**
 * Ensures a Power BI token is available before the catalog views render.
 *
 * The Rayfin brokered sign-in gates the app shell; the catalog data hop needs a
 * separate Power BI token (MSAL, app reg a57da069). We try to acquire it
 * silently on mount; if an interactive prompt is required, we show a
 * "Connect to Power BI" button (popups need a user gesture). In mock mode
 * (no live catalog config) the gate is a no-op.
 */
export function PbiGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<'checking' | 'ready' | 'needsSignin'>(
    isLiveCatalog ? 'checking' : 'ready'
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLiveCatalog) return;
    let cancelled = false;
    getFabricToken()
      .then(() => !cancelled && setState('ready'))
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof PbiSignInRequiredError) setState('needsSignin');
        else {
          setError(e instanceof Error ? e.message : String(e));
          setState('needsSignin');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setState('checking');
    try {
      await signInToPbi(user?.email);
      setState('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('needsSignin');
    }
  }, [user]);

  if (state === 'ready') return <>{children}</>;

  if (state === 'checking') {
    return <div className="p-8 text-center text-sm text-gray-500">Connecting to Power BI…</div>;
  }

  return (
    <div className="mx-auto mt-8 max-w-md rounded-xl border border-gray-100 bg-white p-8 text-center shadow-sm">
      <h2 className="text-base font-semibold text-gray-900">Connect to Power BI</h2>
      <p className="mt-2 text-sm text-gray-500">
        The catalog reads live metadata via Power BI. Connect your account to continue.
      </p>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <button
        type="button"
        onClick={() => void connect()}
        className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Connect to Power BI
      </button>
    </div>
  );
}
