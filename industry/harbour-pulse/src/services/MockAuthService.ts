import { AuthError, type RayfinClient } from '@microsoft/rayfin-client';

import type { AppSchema } from '../../rayfin/data/schema';

import { type AuthUser, type IAuthService, toAuthUser } from './IAuthService';

// Fixture credentials for the bundled local backend, which ships without
// Fabric/Entra. Not a secret: it authenticates nothing beyond localhost, and
// both sides of the local flow have to agree on the same literal.
const MOCK_EMAIL = 'dev@contoso.com';
const MOCK_PASSWORD = 'LocalDev!Pass123'; // gitleaks:allow pragma: allowlist secret

/**
 * Local-development auth service. Used when the API URL targets localhost.
 *
 * Signs into the bundled local backend with a fixed email/password — no
 * Fabric/Entra wiring required. If the dev account does not exist yet on
 * the local backend, it is created on first sign-in.
 */
export class MockAuthService implements IAuthService {
  readonly fabricAuthEnabled = false;

  constructor(private readonly client: RayfinClient<AppSchema>) {}

  async signIn(): Promise<AuthUser> {
    const auth = this.client.auth;

    // Try sign-in. If the credentials are rejected (also how the backend
    // reports "user does not exist") create the account and retry. Other
    // errors (network, server, …) propagate unchanged.
    try {
      await auth.signIn({ email: MOCK_EMAIL, password: MOCK_PASSWORD });
    } catch (err) {
      if (!(err instanceof AuthError) || err.code !== 'INVALID_GRANT') {
        throw err;
      }
      await auth.signUp({ email: MOCK_EMAIL, password: MOCK_PASSWORD });
      await auth.signIn({ email: MOCK_EMAIL, password: MOCK_PASSWORD });
    }

    const session = auth.getSession();
    if (!session.isAuthenticated || !session.user) {
      throw new Error('Local mock sign-in failed to establish a session.');
    }
    return toAuthUser(session.user);
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    const session = this.client.auth.getSession();
    if (!session.isAuthenticated || !session.user) return null;
    return toAuthUser(session.user);
  }

  async initEmbeddedAuth(): Promise<AuthUser | null> {
    // Embedded Fabric flow is not used in local-dev mode.
    return null;
  }
}
