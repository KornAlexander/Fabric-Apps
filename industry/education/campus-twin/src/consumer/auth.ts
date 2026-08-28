/**
 * Where the consumer app's bearer token comes from, and an honest account of what is missing.
 *
 * ⚠️ THE FABRIC/ENTRA PATH IS NOT FINISHED, AND THIS FILE SAYS SO RATHER THAN PRETENDING.
 * `/api/me/*` requires `Authorization: Bearer <token>` for an Entra token whose audience is the
 * scheduler API (`ENTRA_API_AUDIENCE`). This repository has never acquired one in a browser:
 *
 *   - `@microsoft/rayfin-auth-provider-fabric` yields a **Rayfin session**, which is what
 *     `planStore.ts` needs to read and write Fabric items. It is not an access token for a custom
 *     API audience, and treating it as one would fail at `validate_bearer` with a confusing
 *     audience error rather than a clear "not signed in".
 *   - The intake surface sidesteps this entirely: it is reached by a Copilot agent that already
 *     holds a delegated token, not by a web page.
 *
 * So the modes below are ordered by how honest they are about what they prove. `fabric` is a
 * declared TODO that throws a specific error instead of a silent failure, because a token provider
 * that returns `''` produces a 401 that looks like an expired session, and somebody will spend an
 * afternoon on it.
 */

export type TokenMode = 'none' | 'session' | 'fabric';

const env = (...names: string[]): string => {
  for (const name of names) {
    const value = import.meta.env[name] as string | undefined;
    if (value) return value;
  }
  return '';
};

/**
 * Where the consumer API lives. Same two-name dance as the scheduler client.
 *
 * ⚠️ THE LOCALHOST FALLBACK IS DEVELOPMENT-ONLY, AND IT SHIPPED ONCE. The default used to be a
 * bare `'http://127.0.0.1:8082'` with no environment guard, so a production build with no
 * `VITE_CONSUMER_API` set baked a **developer's loopback address into a public bundle**. Deployed,
 * the page loaded, called `127.0.0.1:8082` from the visitor's own machine and reported
 * `ERR_CONNECTION_REFUSED` — which surfaced as "die Verbindung ist fehlgeschlagen", a message that
 * blames the network for a build-configuration mistake and sends the reader hunting for an outage
 * that does not exist.
 *
 * The main app is checked for exactly this (`tools/verify_deploy.mjs`: "the shipped bundle does not
 * point at localhost"). The consumer bundle is a second entry point and was never covered by it.
 *
 * So: configured value wins; in a dev build the loopback default stands; in a production build
 * with nothing configured there is no base at all, and `API_CONFIGURED` is false so the surface can
 * say what is actually wrong instead of firing a request that cannot succeed.
 */
const CONFIGURED = env('VITE_CONSUMER_API', 'VITE_RAYFIN_CONSUMER_API');

/** The local `server/consumer_app.py`, which is where this runs during development. */
const DEV_FALLBACK = 'http://127.0.0.1:8082';

/**
 * Whether this build knows where its API is at all.
 *
 * False only in a production bundle built without `VITE_CONSUMER_API`, which is a deployment that
 * cannot work — and should therefore say so rather than look broken.
 */
export const API_CONFIGURED = Boolean(CONFIGURED) || import.meta.env.DEV;

export const API_BASE = (
  CONFIGURED || (import.meta.env.DEV ? DEV_FALLBACK : '')
).replace(/\/$/, '');

/**
 * ⚠️ `none` IS ONLY VALID AGAINST A SERVER THAT HAS ALSO DISABLED AUTH.
 *
 * `server/auth.py` refuses to honour `ENTRA_AUTH_DISABLED` when it detects Container Apps
 * (`AUTH_BYPASS_REFUSED`), so this cannot silently become the deployed configuration: the server
 * would start demanding a token and every call would 401. That asymmetry is deliberate: the
 * client may be wrong about being in development, the server may not.
 */
export const TOKEN_MODE: TokenMode =
  (env('VITE_CONSUMER_TOKEN_MODE') as TokenMode) || 'none';

const SESSION_KEY = 'campus.consumer.token';

/** Put a token in for this tab only. Used by the dev console and by the e2e harness. */
export function setSessionToken(token: string): void {
  sessionStorage.setItem(SESSION_KEY, token.trim());
}

export function clearSessionToken(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export class NotSignedIn extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotSignedIn';
  }
}

/**
 * The one function the API layer calls. Returns `null` when no header should be sent at all,
 * which is different from returning an empty string: an `Authorization: ` header with no value is
 * a malformed request, and some proxies reject it before the server sees it.
 */
export async function getToken(): Promise<string | null> {
  if (TOKEN_MODE === 'none') return null;

  if (TOKEN_MODE === 'session') {
    const token = sessionStorage.getItem(SESSION_KEY);
    if (!token) {
      throw new NotSignedIn(
        'Kein Token hinterlegt. Im Entwicklungsmodus mit setSessionToken("…") setzen.'
      );
    }
    return token;
  }

  // ⚠️ DELIBERATELY UNIMPLEMENTED. See the file header. Throwing a NAMED error here means the UI
  // can say "die Anmeldung für diese Ansicht ist noch nicht eingerichtet" instead of showing a
  // generic 401, which is the difference between a known gap and a bug hunt.
  throw new NotSignedIn(
    'Die Fabric-Anmeldung für die Nutzeransicht ist noch nicht eingerichtet. ' +
      'Es fehlt ein Entra-Zugriffstoken für die Zielgruppe der Scheduler-API.'
  );
}
