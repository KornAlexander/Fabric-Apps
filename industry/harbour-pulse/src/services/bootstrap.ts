import type { IAuthService } from './IAuthService';
import { GuestAuthService } from './GuestAuthService';
import { RayfinAuthService } from './RayfinAuthService';
import { initRayfinClient, setSessionRecovery } from './rayfinClient';

/** True when the frontend itself is being served from localhost (dev server). */
function isLocalFrontend(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1';
}

/**
 * Read VITE_* env vars, initialize the Rayfin client, and return the right
 * auth service.
 *
 * - Local dev (frontend on localhost) → {@link GuestAuthService} (no Fabric
 *   popup; the app's data comes from the local KQL API + Azure Maps).
 * - Deployed (Fabric static hosting)  → {@link RayfinAuthService} (Fabric SSO).
 */
export function bootstrapAuth(): IAuthService {
  const apiUrl = import.meta.env.VITE_RAYFIN_API_URL || 'http://localhost:5168';
  const localDev = isLocalFrontend();
  const publishableKey = import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY;

  if (!publishableKey && !localDev) {
    throw new Error('VITE_RAYFIN_PUBLISHABLE_KEY environment variable is required');
  }

  const client = initRayfinClient({
    baseUrl: apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`,
    publishableKey: publishableKey ?? 'local-dev-key',
    localDev,
  });

  if (localDev) {
    return new GuestAuthService();
  }

  const workspaceId = import.meta.env.VITE_FABRIC_WORKSPACE_ID;
  const projectId = import.meta.env.VITE_FABRIC_ITEM_ID;
  const fabricPortalUrl = import.meta.env.VITE_FABRIC_PORTAL_URL;

  if (!workspaceId || !projectId || !fabricPortalUrl) {
    throw new Error(
      'Missing required Fabric config. Set VITE_FABRIC_WORKSPACE_ID, VITE_FABRIC_ITEM_ID, and VITE_FABRIC_PORTAL_URL.',
    );
  }

  const authService = new RayfinAuthService(client, {
    workspaceId,
    projectId,
    fabricPortalUrl,
    returnOrigin: window.location.origin,
  });

  setSessionRecovery(async () => {
    // initEmbeddedAuth resumes any cached session first, and a session holding
    // an expired token still reads as authenticated — so drop it to force a
    // genuine postMessage handoff.
    try {
      await authService.signOut();
    } catch {
      /* already invalid server-side; the local clear is what matters */
    }
    return (await authService.initEmbeddedAuth()) !== null;
  });

  return authService;
}
