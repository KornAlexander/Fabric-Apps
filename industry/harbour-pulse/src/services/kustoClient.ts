/**
 * Browser-side Eventhouse (Kusto) client for the *deployed* app.
 *
 * In production there is no Vite `/api` middleware, so the frontend queries the
 * Fabric Real-Time Intelligence Eventhouse directly. It acquires an access
 * token for the cluster via MSAL using the signed-in user's identity, then
 * POSTs KQL to the cluster's `/v1/rest/query` endpoint. The Eventhouse allows
 * CORS from the app origin, so this works from the browser.
 *
 * Two runtime modes, both driven by the same MSAL instance:
 *   - Standalone browser tab — a one-time interactive sign-in via redirect. The
 *     UI surfaces a "Connect live data" button that calls
 *     connectDataInteractive() from a user gesture.
 *   - Inside the Fabric portal (embedded iframe) — harder. Fabric does not
 *     inject a Nested App Auth bridge for Rayfin-hosted apps, and Rayfin's own
 *     brokered session yields Rayfin tokens, not Entra tokens for the cluster.
 *     A framed document may also have partitioned storage, so the MSAL cache is
 *     NOT shared with a standalone tab on the same origin. connectDataInteractive()
 *     therefore walks a fallback chain: NAA broker -> Storage Access API +
 *     ssoSilent -> a top-level popup that runs the redirect flow and posts the
 *     token back. Any of these can be blocked by the host frame's sandbox, so
 *     each failure is reported rather than swallowed.
 *
 * Configuration (VITE_* env, set at build time):
 *   VITE_KUSTO_CLUSTER   Eventhouse cluster URI
 *   VITE_KUSTO_DATABASE  KQL database name
 *   VITE_ENTRA_CLIENT_ID Entra app (client) ID used for interactive sign-in
 *   VITE_ENTRA_TENANT_ID Entra tenant ID
 *   VITE_KUSTO_SCOPE     (optional) override for the token scope
 */
import {
  createNestablePublicClientApplication,
  InteractionRequiredAuthError,
  type AccountInfo,
  type AuthenticationResult,
  type IPublicClientApplication,
  type PopupRequest,
  type RedirectRequest,
  type SsoSilentRequest,
} from '@azure/msal-browser';

const CLUSTER = import.meta.env.VITE_KUSTO_CLUSTER as string | undefined;
const DATABASE = (import.meta.env.VITE_KUSTO_DATABASE as string | undefined) ?? 'SydneyFerriesKustoDB';
const CLIENT_ID = import.meta.env.VITE_ENTRA_CLIENT_ID as string | undefined;
const TENANT_ID = (import.meta.env.VITE_ENTRA_TENANT_ID as string | undefined) ?? 'organizations';
// The Eventhouse accepts a token whose audience is the cluster URI and whose
// scope is `user_impersonation`. We request that scope (rather than `.default`)
// so Entra grants it via dynamic consent even though the app registration has
// no statically-configured Kusto permission.
const SCOPE = (import.meta.env.VITE_KUSTO_SCOPE as string | undefined) ?? (CLUSTER ? `${CLUSTER}/user_impersonation` : '');

/** True when direct Eventhouse access is configured (deployed build). */
export function isDirectKustoConfigured(): boolean {
  return Boolean(CLUSTER && CLIENT_ID);
}

/**
 * True when the app runs inside an iframe (e.g. embedded in the Fabric portal).
 * MSAL forbids the redirect flow in a frame, so interactive sign-in must use a
 * popup instead.
 */
function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // A cross-origin `window.top` access throws — which itself means we're framed.
    return true;
  }
}

/**
 * True when a Nested App Auth bridge (host token broker) is available — the
 * Fabric portal injects this into embedded apps. Under NAA, MSAL brokers tokens
 * through the host with no popup, redirect, or hidden iframe (all of which are
 * blocked in the portal's sandboxed frame).
 */
function isNaaAvailable(): boolean {
  return (
    typeof (window as { __initializeNestedAppAuth?: unknown }).__initializeNestedAppAuth ===
    'function'
  );
}

/** Marks the auth popup: a query flag on open, `window.name` across redirects. */
const CONNECT_FLAG = 'kustoConnect';
const POPUP_NAME = 'harbourpulse-kusto-auth';
const POPUP_MESSAGE = 'harbourpulse:kusto-token';
const POPUP_STATE_KEY = 'harbourpulse.kustoConnectState';

type StorageAccessDocument = Document & {
  hasStorageAccess?: () => Promise<boolean>;
  requestStorageAccess?: () => Promise<void>;
};

export interface AuthEnvironment {
  embedded: boolean;
  naaBridge: boolean;
  storageAccessSupported: boolean;
  storageAccessGranted: boolean | null;
}

/**
 * Snapshot of the browser capabilities that decide which interactive flow can
 * work. Logged on every embedded connect attempt so the portal case is
 * diagnosable from the console rather than by guesswork.
 */
export async function describeAuthEnvironment(): Promise<AuthEnvironment> {
  const doc = document as StorageAccessDocument;
  let storageAccessGranted: boolean | null = null;
  if (typeof doc.hasStorageAccess === 'function') {
    try {
      storageAccessGranted = await doc.hasStorageAccess();
    } catch {
      storageAccessGranted = null;
    }
  }
  return {
    embedded: isEmbedded(),
    naaBridge: isNaaAvailable(),
    storageAccessSupported: typeof doc.requestStorageAccess === 'function',
    storageAccessGranted,
  };
}

/**
 * Ask the host for unpartitioned storage. When granted, the frame's MSAL cache
 * and Entra session cookies stop being partitioned, which can make ssoSilent
 * succeed. Must be called from a user gesture.
 */
async function requestStorageAccess(): Promise<boolean> {
  const doc = document as StorageAccessDocument;
  if (typeof doc.requestStorageAccess !== 'function') return false;
  try {
    if (typeof doc.hasStorageAccess === 'function' && (await doc.hasStorageAccess())) return true;
    await doc.requestStorageAccess();
    return true;
  } catch {
    return false;
  }
}

export function getClusterUri(): string {
  if (!CLUSTER) throw new Error('VITE_KUSTO_CLUSTER is not configured.');
  return CLUSTER;
}

export function getDatabase(): string {
  return DATABASE;
}

/** Error thrown when a token can only be obtained via user interaction. */
export class KustoInteractionRequiredError extends Error {
  constructor(message = 'Sign-in required to load live ferry data.') {
    super(message);
    this.name = 'KustoInteractionRequiredError';
  }
}

let loginHint: string | undefined;
/** Provide the signed-in user's UPN/email so SSO-silent can target the session. */
export function setKustoLoginHint(hint: string | undefined): void {
  loginHint = hint;
}

let msalReady: Promise<IPublicClientApplication> | null = null;
/** Result of the redirect leg, needed by the popup to post its token back. */
let redirectResult: AuthenticationResult | null = null;

/**
 * Create (once) a "nestable" MSAL instance. When the app is embedded in the
 * Fabric portal it uses Nested App Auth (host broker); standalone it behaves
 * like a normal browser SPA. `createNestablePublicClientApplication` resolves
 * only after the instance is initialized.
 */
async function ensureMsalInitialized(): Promise<IPublicClientApplication> {
  if (!CLIENT_ID) throw new Error('VITE_ENTRA_CLIENT_ID is not configured.');
  const clientId = CLIENT_ID;
  if (!msalReady) {
    msalReady = (async () => {
      const msal = await createNestablePublicClientApplication({
        auth: {
          clientId,
          authority: `https://login.microsoftonline.com/${TENANT_ID}`,
          redirectUri: window.location.origin,
        },
        cache: { cacheLocation: 'localStorage' },
      });
      // Complete any pending redirect sign-in (standalone path) and adopt the
      // returned account. A no-op under NAA.
      const result = await msal.handleRedirectPromise();
      redirectResult = result;
      if (result?.account) msal.setActiveAccount(result.account);
      else if (!msal.getActiveAccount()) {
        const first = msal.getAllAccounts()[0];
        if (first) msal.setActiveAccount(first);
      }
      return msal;
    })();
  }
  return msalReady;
}

// Cache the token and de-duplicate concurrent acquisitions so the 5s poll does
// not hammer MSAL.
let cachedToken: { token: string; expiresOn: number } | null = null;
let inFlight: Promise<string> | null = null;
const connectListeners = new Set<() => void>();

/**
 * Subscribe to the moment Kusto becomes usable. Embedded in Fabric the token
 * only arrives after the user connects, long after startup, so views that load
 * reference data once at mount need a nudge to try again.
 */
export function onKustoConnected(cb: () => void): () => void {
  connectListeners.add(cb);
  return () => {
    connectListeners.delete(cb);
  };
}

function setCachedToken(next: { token: string; expiresOn: number }): void {
  const reconnected = !cachedToken;
  cachedToken = next;
  if (reconnected) connectListeners.forEach((cb) => cb());
}

/** Store an MSAL result's access token so subsequent polls reuse it. */
function cacheResult(res: AuthenticationResult): void {
  setCachedToken({
    token: res.accessToken,
    expiresOn: res.expiresOn ? res.expiresOn.getTime() : Date.now() + 5 * 60_000,
  });
}

/** Cache a bare access token, taking the refresh deadline from its `exp` claim. */
function cacheRawToken(token: string): void {
  let expiresOn = Date.now() + 5 * 60_000;
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    );
    if (payload.exp) expiresOn = payload.exp * 1000;
  } catch {
    // keep default
  }
  setCachedToken({ token, expiresOn });
}

async function acquireToken(): Promise<string> {
  const msal = await ensureMsalInitialized();
  const scopes = [SCOPE];
  const account: AccountInfo | undefined =
    msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? undefined;

  // 1. Silent with a known account — a cached/refresh token in a standalone
  //    browser, or a host-brokered token once NAA has adopted the portal's
  //    active account.
  if (account) {
    try {
      const res = await msal.acquireTokenSilent({ scopes, account });
      if (res.account) msal.setActiveAccount(res.account);
      cacheResult(res);
      return res.accessToken;
    } catch (err) {
      // Standalone, non-interaction failures (e.g. network) are real errors.
      if (
        !isNaaAvailable() &&
        !isEmbedded() &&
        !(err instanceof InteractionRequiredAuthError)
      ) {
        throw err;
      }
      // Otherwise fall through to the brokered / SSO-silent attempt below.
    }
  }

  // 2. No-UI SSO:
  //    - Fabric portal (NAA): the host broker returns a token with no popup,
  //      redirect, or hidden iframe — this is what makes the embedded app work
  //      without any additional user login.
  //    - Standalone top-level window: reuses an existing Entra session if one
  //      is present (still no prompt).
  //    A plain (non-NAA) sandboxed iframe can do neither, so skip to the button.
  if (isNaaAvailable() || !isEmbedded()) {
    try {
      const req: SsoSilentRequest = loginHint ? { scopes, loginHint } : { scopes };
      const res = await msal.ssoSilent(req);
      if (res.account) msal.setActiveAccount(res.account);
      cacheResult(res);
      return res.accessToken;
    } catch {
      // No silent session — fall through to the interactive prompt.
    }
  }

  // 3. Interaction required. The UI shows a "Connect live data" button that
  //    calls connectDataInteractive() from a user gesture (a brokered popup
  //    under NAA, or a redirect to Entra sign-in standalone).
  throw new KustoInteractionRequiredError();
}

/** Acquire an access token for the Eventhouse cluster (silent, cached). */
async function getKustoToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresOn - Date.now() > 60_000) {
    return cachedToken.token;
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const token = await acquireToken();
    cacheRawToken(token);
    return token;
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * Open a top-level popup on our own origin that runs the redirect flow and
 * posts the token back. A popup is a top-level browsing context, so the
 * redirect flow MSAL forbids inside a frame is legal there.
 */
function openConnectPopup(state: string): Window | null {
  const url = new URL(window.location.href);
  url.hash = '';
  url.searchParams.set(CONNECT_FLAG, state);
  return window.open(
    url.toString(),
    POPUP_NAME,
    'width=520,height=700,menubar=no,toolbar=no,location=no,status=no',
  );
}

/** Resolve with the popup's access token, or reject if it closes or stalls. */
function awaitPopupToken(popup: Window, state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => {
      window.removeEventListener('message', onMessage);
      clearInterval(closedTimer);
      clearTimeout(timeout);
      fn();
    };

    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as { type?: string; state?: string; token?: string } | null;
      if (!data || data.type !== POPUP_MESSAGE || data.state !== state) return;
      if (typeof data.token !== 'string' || !data.token) {
        done(() => reject(new KustoInteractionRequiredError('Sign-in did not return a token.')));
        return;
      }
      const token = data.token;
      done(() => resolve(token));
    };

    // The popup cannot report a user closing it, so watch for that here.
    const closedTimer = setInterval(() => {
      if (popup.closed) {
        done(() =>
          reject(new KustoInteractionRequiredError('Sign-in window was closed before completing.')),
        );
      }
    }, 500);

    const timeout = setTimeout(
      () =>
        done(() => {
          popup.close();
          reject(new KustoInteractionRequiredError('Sign-in timed out. Please try again.'));
        }),
      3 * 60_000,
    );

    window.addEventListener('message', onMessage);
  });
}

/**
 * User-initiated interactive sign-in. Call ONLY from a click handler — never
 * automatically.
 *
 * - NAA host broker, if one is present: a brokered popup with no real window.
 * - Standalone top-level window: a redirect to Entra and back.
 * - Embedded without a broker: try the Storage Access API (which can unblock
 *   ssoSilent outright), then fall back to a top-level popup.
 */
export async function connectDataInteractive(): Promise<void> {
  const msal = await ensureMsalInitialized();
  const scopes = [SCOPE];

  if (isNaaAvailable()) {
    const req: PopupRequest = loginHint ? { scopes, loginHint } : { scopes };
    const res = await msal.acquireTokenPopup(req);
    if (res.account) msal.setActiveAccount(res.account);
    cacheResult(res);
    return;
  }

  if (isEmbedded()) {
    console.info('[kusto] embedded auth environment', await describeAuthEnvironment());

    if (await requestStorageAccess()) {
      try {
        const req: SsoSilentRequest = loginHint ? { scopes, loginHint } : { scopes };
        const res = await msal.ssoSilent(req);
        if (res.account) msal.setActiveAccount(res.account);
        cacheResult(res);
        return;
      } catch {
        // Unpartitioned storage alone was not enough — fall through to the popup.
      }
    }

    const state = crypto.randomUUID();
    const popup = openConnectPopup(state);
    if (!popup) {
      throw new KustoInteractionRequiredError(
        'The Fabric portal blocked the sign-in window. Allow pop-ups for this site, or open the app in a new tab to connect.',
      );
    }
    cacheRawToken(await awaitPopupToken(popup, state));
    popup.close();
    return;
  }

  const req: RedirectRequest = loginHint ? { scopes, loginHint } : { scopes };
  await msal.acquireTokenRedirect(req);
}

/**
 * True when this document is the interactive-auth popup.
 *
 * The popup is marked three ways because none survives every leg: the query
 * flag is only on the first load, `window.name` is cleared by the browser on
 * the cross-site trip to Entra, and sessionStorage is per-tab so it comes back
 * with us. Miss this and the popup boots a second copy of the app, whose own
 * "Connect live data" button opens a third — the loop users hit on first
 * sign-in, when there is no cached account to skip the redirect.
 */
export function isKustoConnectPopup(): boolean {
  if (!isDirectKustoConfigured()) return false;
  if (window.name === POPUP_NAME) return true;
  const flag = new URLSearchParams(window.location.search).get(CONNECT_FLAG);
  try {
    if (flag) {
      sessionStorage.setItem(POPUP_STATE_KEY, flag);
      return true;
    }
    return sessionStorage.getItem(POPUP_STATE_KEY) !== null;
  } catch {
    return Boolean(flag);
  }
}

/**
 * Popup entry point: acquire a token top-level, hand it to the opener, close.
 * Called from main.tsx instead of rendering the app.
 */
export async function runKustoConnectPopup(): Promise<void> {
  window.name = POPUP_NAME;
  const flag = new URLSearchParams(window.location.search).get(CONNECT_FLAG);
  if (flag) sessionStorage.setItem(POPUP_STATE_KEY, flag);
  const state = sessionStorage.getItem(POPUP_STATE_KEY) ?? '';

  const fail = (message: string) => {
    // Drop the marker so reloading this window recovers into the app rather
    // than retrying the popup flow forever.
    sessionStorage.removeItem(POPUP_STATE_KEY);
    window.name = '';
    document.body.textContent = message;
  };

  try {
    const msal = await ensureMsalInitialized();
    const scopes = [SCOPE];

    let token = redirectResult?.accessToken;
    if (!token) {
      const account = msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? undefined;
      if (account) {
        try {
          token = (await msal.acquireTokenSilent({ scopes, account })).accessToken;
        } catch {
          // Needs the interactive leg below.
        }
      }
    }

    if (!token) {
      await msal.acquireTokenRedirect(loginHint ? { scopes, loginHint } : { scopes });
      return;
    }

    if (!window.opener) {
      fail('Signed in. Please close this window and select “Connect live data” again.');
      return;
    }
    window.opener.postMessage(
      { type: POPUP_MESSAGE, state, token },
      window.location.origin,
    );
    sessionStorage.removeItem(POPUP_STATE_KEY);
    window.close();
  } catch (err) {
    fail(`Sign-in failed: ${(err as Error).message}`);
  }
}

export interface KustoTable {
  TableName?: string;
  Columns: { ColumnName: string }[];
  Rows: unknown[][];
}

/** Run a KQL query and return the primary result table (v1 REST). */
export async function queryKusto(csl: string, signal?: AbortSignal): Promise<KustoTable> {
  const token = await getKustoToken();
  const res = await fetch(`${getClusterUri()}/v1/rest/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ db: DATABASE, csl }),
    signal,
  });
  if (!res.ok) {
    // A 401 likely means the cached token was revoked; drop it so the next
    // call re-acquires silently.
    if (res.status === 401) cachedToken = null;
    throw new Error(`KQL query failed: ${res.status} ${res.statusText} — ${await res.text()}`);
  }
  const json = (await res.json()) as { Tables: KustoTable[] };
  return json.Tables[0];
}

export function colIndex(table: KustoTable, name: string): number {
  return table.Columns.findIndex((c) => c.ColumnName === name);
}
