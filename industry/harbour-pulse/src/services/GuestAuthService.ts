import { type AuthUser, type IAuthService } from './IAuthService';

/**
 * Local-development auth bypass. When the app runs on localhost we don't want
 * the Fabric brokered sign-in popup (it needs the app to be opened from within
 * Fabric and often hangs in a plain browser tab). The local experience doesn't
 * need a Rayfin session anyway — ferry data comes from the local KQL dev API
 * and the map from the Azure Maps key — so we auto-authenticate a guest.
 *
 * Deployed builds (non-localhost) still use real Fabric SSO via
 * {@link RayfinAuthService}; see bootstrap.ts.
 */
const GUEST: AuthUser = { id: 'local-guest', email: 'guest@localhost', name: 'Local Dev' };

export class GuestAuthService implements IAuthService {
  readonly fabricAuthEnabled = false;

  async signIn(): Promise<AuthUser> {
    return GUEST;
  }

  async signOut(): Promise<void> {
    /* no-op in local dev */
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    return GUEST;
  }

  async initEmbeddedAuth(): Promise<AuthUser | null> {
    // Returning the guest here means the app loads straight to the map,
    // skipping the sign-in screen entirely during local development.
    return GUEST;
  }
}
