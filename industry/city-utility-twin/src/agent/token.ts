/**
 * Entra access tokens for coordination-note writes.
 *
 * ⚠️ WHY THIS REPLACES THE RAYFIN SESSION FOR AUTHORSHIP. Measured on 2026-09-21: served on its
 * own host the app resolved NO identity at all, even with a live Fabric portal session in the
 * same browser (no cookie, no storage, no session), and the Rayfin sign-in led to the corporate
 * tenant rather than the demo tenant the app actually lives in. On top of that a Rayfin session
 * carries no audience this backend could check. A dedicated registration in the demo tenant is
 * the smallest thing that produces a token the backend can actually verify.
 *
 * ⚠️ THESE IDS ARE NOT SECRETS. A public client id and a tenant id are published in every SPA
 * bundle by design; the security boundary is the redirect URI allow-list and the token audience,
 * both enforced by Entra. They are listed in tools/map-assets.mjs so the asset gate knows they
 * are deliberate rather than a leak.
 *
 * ⚠️ NOTHING HERE MAY THROW INTO THE APP. Every failure resolves to null. The map, the layers,
 * reading notes and the assistant must all keep working with no identity whatsoever.
 */

import type { IPublicClientApplication, AccountInfo } from '@azure/msal-browser';

const env = (name: string, fallback: string): string => {
  const value = (import.meta.env as Record<string, string | undefined>)[name];
  return (value && value.trim()) || fallback;
};

export const CLIENT_ID = env('VITE_ENTRA_CLIENT_ID', '');
export const TENANT_ID = env('VITE_ENTRA_TENANT_ID', '');
const SCOPE = `api://${CLIENT_ID}/Notizen.Write`;

let appPromise: Promise<IPublicClientApplication | null> | null = null;

async function instance(): Promise<IPublicClientApplication | null> {
  if (!appPromise) {
    appPromise = (async () => {
      const msal = await import('@azure/msal-browser');
      const app = new msal.PublicClientApplication({
        auth: {
          clientId: CLIENT_ID,
          authority: `https://login.microsoftonline.com/${TENANT_ID}`,
          // ⚠️ THE BRIDGE PAGE, NOT THE APP ROOT. MSAL 5 completes a popup by having the redirect
          // page broadcast the response over a same-origin BroadcastChannel. Pointing this at
          // `/` made the popup boot the entire map, the opener timed out after 60 s and the
          // sign-in silently produced nothing. See auth.html and src/auth-callback.ts.
          redirectUri: `${window.location.origin}/auth.html`,
        },
        // ⚠️ localStorage, NOT sessionStorage. sessionStorage is per TAB: closing the tab, or
        // opening the app in a second one, silently discards the sign-in and the author falls
        // back to unverified. Measured on 2026-09-22 by closing the tab that held the session.
        // In a live demo a reload must not cost the identity.
        cache: { cacheLocation: 'localStorage' },
      });
      await app.initialize();
      return app as IPublicClientApplication;
    })().catch(() => null);
  }
  return appPromise;
}

function pick(app: IPublicClientApplication): AccountInfo | null {
  // ⚠️ THE ACTIVE ACCOUNT FIRST. Taking all[0] meant that with more than one cached account the
  // panel could name the person who just signed in while writes fetched a token for a different,
  // older account.
  const active = app.getActiveAccount();
  if (active) return active;
  const all = app.getAllAccounts();
  return all.length > 0 ? all[0] : null;
}

/** The signed-in account name, or null. Never prompts. */
export async function account(): Promise<string | null> {
  const app = await instance();
  if (!app) return null;
  const acc = pick(app);
  return acc?.username || acc?.name || null;
}

/**
 * A token for the notes API, or null.
 *
 * Silent only: acquiring a token must never open a popup on its own, because writes happen
 * while the user is mid-demo and a surprise window would land on top of the map.
 */
export async function token(): Promise<string | null> {
  const app = await instance();
  if (!app) return null;
  const acc = pick(app);
  if (!acc) return null;
  try {
    const result = await app.acquireTokenSilent({ scopes: [SCOPE], account: acc });
    return result.accessToken || null;
  } catch {
    return null;
  }
}

/** Interactive sign-in. Only ever called from a real click, because popups need a gesture. */
export async function signIn(): Promise<string | null> {
  const app = await instance();
  if (!app) return null;
  try {
    const result = await app.loginPopup({ scopes: [SCOPE] });
    if (result.account) app.setActiveAccount(result.account);
    return result.account?.username || result.account?.name || null;
  } catch {
    return null;
  }
}
