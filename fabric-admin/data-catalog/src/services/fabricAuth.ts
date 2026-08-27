/**
 * MSAL helper that acquires a Power BI service token for the signed-in user.
 *
 * The catalog is read via the shared Fabric `fabric_proxy` User Data Function
 * (item d17666d2). Invoking it needs the `UserDataFunction.Execute.All`
 * delegated permission, and the function calls Power BI `executeQueries` on the
 * user's behalf using the same token passed in the body. A single Power BI
 * service token (`analysis.windows.net/powerbi/api/.default`) covers both hops.
 *
 * This is separate from the Rayfin brokered app sign-in: the Rayfin session
 * gates the app shell; this MSAL token authorises the Power BI data hop.
 */
import { PublicClientApplication, type AccountInfo } from '@azure/msal-browser';

import { getUdfConfig } from '@/config/udfConfig';

const PBI_SCOPE = 'https://analysis.windows.net/powerbi/api/.default';

/** Thrown when a Power BI token can't be obtained silently. Callers should
 *  surface a "Connect to Power BI" button that calls {@link signInToPbi} from a
 *  click handler (interactive popups are blocked outside a user gesture). */
export class PbiSignInRequiredError extends Error {
  constructor() {
    super('Power BI sign-in required');
    this.name = 'PbiSignInRequiredError';
  }
}

let pcaPromise: Promise<PublicClientApplication> | null = null;
let account: AccountInfo | null = null;

async function getPca(): Promise<PublicClientApplication> {
  if (!pcaPromise) {
    const { tenantId, clientId } = getUdfConfig();
    const pca = new PublicClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        redirectUri: window.location.origin,
      },
      cache: { cacheLocation: 'localStorage' },
    });
    pcaPromise = pca.initialize().then(() => {
      const accounts = pca.getAllAccounts();
      if (accounts.length > 0) account = accounts[0];
      return pca;
    });
  }
  return pcaPromise;
}

/** Acquire a Power BI service access token. Silent by default; pass
 *  `{ interactive: true }` ONLY from a user-gesture handler. */
export async function getFabricToken(
  opts: { interactive?: boolean; loginHint?: string } = {}
): Promise<string> {
  const pca = await getPca();
  const request = { scopes: [PBI_SCOPE], account: account ?? undefined };
  try {
    const result = await pca.acquireTokenSilent(request);
    account = result.account;
    return result.accessToken;
  } catch {
    if (!opts.interactive) throw new PbiSignInRequiredError();
    const result = await pca.acquireTokenPopup({
      scopes: [PBI_SCOPE],
      loginHint: opts.loginHint,
      prompt: 'select_account',
    });
    account = result.account;
    return result.accessToken;
  }
}

/** Start an interactive Power BI sign-in. MUST be called from a user gesture. */
export async function signInToPbi(loginHint?: string): Promise<void> {
  await getFabricToken({ interactive: true, loginHint });
}

const GRAPH_MAIL_SCOPE = 'https://graph.microsoft.com/Mail.Send';

/** Thrown when a Graph token needs interactive consent. */
export class GraphSignInRequiredError extends Error {
  constructor() {
    super('Graph sign-in required');
    this.name = 'GraphSignInRequiredError';
  }
}

/** Acquire a Microsoft Graph token for the given scopes. Silent by default;
 *  pass `{ interactive: true }` from a user gesture to consent the first time. */
export async function getGraphToken(
  scopes: string[],
  opts: { interactive?: boolean } = {}
): Promise<string> {
  const pca = await getPca();
  const request = { scopes, account: account ?? undefined };
  try {
    const result = await pca.acquireTokenSilent(request);
    account = result.account;
    return result.accessToken;
  } catch {
    if (!opts.interactive) throw new GraphSignInRequiredError();
    const result = await pca.acquireTokenPopup({ scopes, prompt: 'select_account' });
    account = result.account;
    return result.accessToken;
  }
}

/** Graph `Mail.Send` scope for notification emails. */
export const GRAPH_MAIL_SCOPES = [GRAPH_MAIL_SCOPE];
