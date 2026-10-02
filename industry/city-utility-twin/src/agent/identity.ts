/**
 * Who is signed in, for attributing a coordination note.
 *
 * ⚠️ REPORTED, NOT PROVEN, AND EVERY LAYER REPEATS THAT DELIBERATELY. This reads the Rayfin
 * session that the Fabric-hosted app already holds. The backend cannot verify it: Rayfin's auth
 * provider yields a Rayfin session, not an access token for the backend's own audience, so there
 * is no signature this service could check. It is a real improvement on a free-text name box,
 * and it is not an audit trail. The database column is `autorGemeldet` and the panel says
 * "gemeldet" for exactly this reason.
 *
 * ⚠️ EVERY FAILURE PATH RETURNS null RATHER THAN THROWING. Identity is a nice-to-have for a note;
 * the map, the agent and the notes themselves must keep working on a laptop, under Playwright and
 * in any build where these variables are missing. A sign-in problem must never be able to take
 * the application down with it.
 */

const env = (...names: string[]): string => {
  for (const name of names) {
    const value = (import.meta.env as Record<string, string | undefined>)[name];
    if (value) return value;
  }
  return '';
};

/**
 * ⚠️ THE FABRIC IDENTIFIERS USE A DIFFERENT PREFIX FROM THE REST. `rayfin env` writes
 * `VITE_FABRIC_WORKSPACE_ID` and friends, not the `VITE_RAYFIN_*` form used for the API URL and
 * the publishable key. Guessing by analogy yields empty strings, a client that never initialises
 * and an identity that is silently always null — and the workspace id IS in the shipped bundle
 * either way, so searching the artefact for the value proves nothing about the key it was read
 * under.
 */
const API_URL = env('VITE_RAYFIN_API_URL', 'VITE_API_URL');
const PUBLISHABLE_KEY = env('VITE_RAYFIN_PUBLISHABLE_KEY', 'VITE_PUBLISHABLE_KEY');
const WORKSPACE_ID = env('VITE_FABRIC_WORKSPACE_ID');
const ITEM_ID = env('VITE_FABRIC_ITEM_ID');
const TENANT_ID = env('VITE_FABRIC_TENANT_ID');
const PORTAL_URL = env('VITE_FABRIC_PORTAL_URL');

export function identityConfigured(): boolean {
  return Boolean(API_URL && PUBLISHABLE_KEY);
}

/** Built once. Creating a second client would start a second session listener. */
let clientPromise: Promise<unknown> | null = null;

async function getClient(): Promise<unknown> {
  if (!identityConfigured()) return null;
  if (!clientPromise) {
    clientPromise = (async () => {
      const { RayfinClient } = await import('@microsoft/rayfin-client');
      return new RayfinClient({ baseUrl: API_URL, publishableKey: PUBLISHABLE_KEY } as never);
    })().catch(() => null);
  }
  return clientPromise;
}

function nameFrom(client: unknown): string | null {
  const session = (client as {
    auth?: { getSession?: () => { isAuthenticated?: boolean; user?: unknown } | null };
  } | null)?.auth?.getSession?.();
  if (!session?.isAuthenticated || !session.user) return null;
  const user = session.user as { email?: string; name?: string; id?: string };
  return user.email ?? user.name ?? user.id ?? null;
}

/**
 * Read the signed-in user without opening anything.
 *
 * Returns null when there is no session yet. It never prompts: a popup needs a user gesture, and
 * the app must not open one while the map is loading.
 */
export async function reportedUser(): Promise<string | null> {
  try {
    return nameFrom(await getClient());
  } catch {
    return null;
  }
}

/**
 * Ask Fabric who is signed in, opening the broker if necessary.
 *
 * ⚠️ MUST BE CALLED STRAIGHT FROM A CLICK. The last step of Rayfin's waterfall calls
 * `window.open`, and a browser only permits that inside a user gesture — after an `await` the
 * gesture is spent and the popup is silently blocked. That is why this is wired to its own
 * button rather than folded into saving a note, which awaits the backend first.
 *
 * ⚠️ TWO ARGUMENTS, AND THE OPTION NAMES ARE NOT THE OBVIOUS ONES. The installed signature is
 * `ensureSignedInWithFabric(auth, options)` where options are `workspaceId`, **`projectId`**
 * (the Fabric ITEM id, despite the name), `fabricPortalUrl` and `returnOrigin`. An earlier
 * version passed a single object with `itemId`, `portalUrl` and `tenantId`, which type-checked
 * only because it was cast — and then failed at runtime into a `catch` that returns null, so
 * sign-in simply never worked and said nothing. The cast is gone for that reason.
 */
export async function signIn(): Promise<string | null> {
  if (!identityConfigured() || !WORKSPACE_ID || !ITEM_ID) return null;
  try {
    const client = await getClient();
    if (!client) return null;
    const existing = nameFrom(client);
    if (existing) return existing;

    const auth = (client as { auth?: unknown }).auth;
    if (!auth) return null;

    const { ensureSignedInWithFabric } = await import('@microsoft/rayfin-auth-provider-fabric');
    await ensureSignedInWithFabric(auth as Parameters<typeof ensureSignedInWithFabric>[0], {
      workspaceId: WORKSPACE_ID,
      // The SDK calls the Fabric item id `projectId`.
      projectId: ITEM_ID,
      fabricPortalUrl: PORTAL_URL || 'https://app.fabric.microsoft.com',
      returnOrigin: window.location.origin,
    });
    return nameFrom(client);
  } catch {
    return null;
  }
}
