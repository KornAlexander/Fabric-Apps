/**
 * Server-side REST hops used by the app.
 *
 * Two paths, both read-only from the browser's point of view:
 *  - **Fabric / Power BI** via the shared `fabric_proxy` User Data Function.
 *    The Power BI token authenticates the invocation and is passed in the body
 *    so the function can call REST on the user's behalf.
 *  - **Microsoft Graph** directly, with a delegated token.
 *
 * Privileged *writes* never go through here. They run inside notebook actuators
 * under a service principal whose secret lives in Key Vault (PLAN.md §14, §19).
 * `runNotebook` only *triggers* such a notebook; it carries no credential.
 */
import { getUdfConfig } from '@/config/udfConfig';

import {
  GRAPH_MINIMAL_SCOPES,
  GRAPH_READ_SCOPES,
  getFabricToken,
  getGraphToken,
  PbiSignInRequiredError,
} from './fabricAuth';

interface UdfEnvelope<T> {
  functionName: string;
  invocationId: string;
  status: string;
  output: T;
  errors?: { name: string; message: string }[];
}

/**
 * Turn a User Data Function failure body into one actionable sentence.
 *
 * The UDF wraps the upstream error twice: an HTTP 500 envelope around a
 * `RuntimeError` whose text carries the *real* status and error code. The Setup
 * page rendered that whole blob, which buried the only fact an operator can act
 * on — which scope is missing — under 400 characters of JSON (D43).
 */
export function describeUdfFailure(status: number, body: string): string {
  const inner = innerErrorMessage(body) ?? body.trim();

  if (/InsufficientScopes/i.test(inner)) {
    return (
      'The app registration is missing the Power BI `Tenant.Read.All` scope, so ' +
      'tenant-wide admin reads are refused (403 InsufficientScopes). Grant it and ' +
      'consent, or stay at T0 with the workspaces you can already see.'
    );
  }
  if (/PowerBINotAuthorizedException|Unauthorized|\(401\)/i.test(inner)) {
    return `Not authenticated for this read (401). ${truncate(inner, 200)}`;
  }
  if (/\(403\)|Forbidden/i.test(inner)) {
    return `Not permitted for this read (403). ${truncate(inner, 200)}`;
  }
  return `Function call failed (${status}): ${truncate(inner, 240)}`;
}

/** Dig the innermost human message out of the nested UDF error envelope. */
function innerErrorMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      errors?: { message?: string; properties?: { error_message?: string } }[];
    };
    const first = parsed.errors?.[0];
    return first?.properties?.error_message || first?.message || null;
  } catch {
    return null;
  }
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

async function invoke<T>(url: string, params: Record<string, unknown>): Promise<T> {
  const token = await getFabricToken();
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, fabricToken: token }),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new PbiSignInRequiredError();
    throw new Error(describeUdfFailure(res.status, await res.text()));
  }
  const envelope = (await res.json()) as UdfEnvelope<T>;
  if (envelope.status !== 'Succeeded') {
    const detail = envelope.errors?.map((e) => e.message).join('; ') || envelope.status;
    throw new Error(`${envelope.functionName} ${envelope.status}: ${detail}`);
  }
  return envelope.output;
}

/** Generic Fabric / Power BI REST call routed through the server-side proxy. */
export async function fabricProxy<T>(
  api: 'fabric' | 'pbi',
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body?: unknown
): Promise<T> {
  const res = await invoke<{ status: number; body: T }>(getUdfConfig().urls.fabricProxy, {
    api,
    path,
    method,
    body: body === undefined ? '' : JSON.stringify(body),
  });
  return res.body;
}

/**
 * Microsoft Graph GET with a delegated token.
 *
 * Tries the full read scope set first, then falls back to `User.Read` — which
 * every signed-in user already has — so a probe can still establish T0 in a
 * tenant that has not consented to directory read.
 */
export async function graphGet<T>(path: string): Promise<T> {
  let token: string;
  try {
    token = await getGraphToken(GRAPH_READ_SCOPES);
  } catch {
    token = await getGraphToken(GRAPH_MINIMAL_SCOPES);
  }
  const url = path.startsWith('http') ? path : `https://graph.microsoft.com${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Graph GET ${path} failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as T;
}

/** Run a DAX query against a dataset via Power BI `executeQueries`. */
export async function executeDax(
  workspaceId: string,
  datasetId: string,
  dax: string
): Promise<Record<string, unknown>[]> {
  const resp = await fabricProxy<{
    results: { tables: { rows: Record<string, unknown>[] }[] }[];
  }>('pbi', `/groups/${workspaceId}/datasets/${datasetId}/executeQueries`, 'POST', {
    queries: [{ query: dax }],
    serializerSettings: { includeNulls: true },
  });
  return resp.results?.[0]?.tables?.[0]?.rows ?? [];
}

/** Terminal result of a RunNotebook job, with the notebook's exit value. */
export interface NotebookRunResult {
  id?: string;
  status?: string;
  failureReason?: { errorCode?: string; message?: string } | null;
  exitValue?: string | null;
}

/** A Fabric notebook parameter map: `{ name: { value, type } }`. */
export type NotebookParams = Record<string, { value: string | boolean; type: string }>;

/** Trigger an on-demand RunNotebook job and return its terminal result,
 *  including the notebook's `exit()` value. */
export async function runNotebook(
  workspaceId: string,
  notebookId: string,
  parameters?: NotebookParams
): Promise<NotebookRunResult> {
  const body = parameters ? { executionData: { parameters } } : undefined;
  const inst = await fabricProxy<NotebookRunResult>(
    'fabric',
    `/workspaces/${workspaceId}/items/${notebookId}/jobs/instances?jobType=RunNotebook`,
    'POST',
    body
  );
  let exitValue = inst?.exitValue ?? null;
  if (exitValue == null && inst?.id) {
    try {
      const detail = await fabricProxy<{ properties?: { exitValue?: string } }>(
        'fabric',
        `/workspaces/${workspaceId}/notebooks/${notebookId}/jobs/execute/instances/${inst.id}?beta=true`
      );
      exitValue = detail?.properties?.exitValue ?? null;
    } catch {
      /* best effort */
    }
  }
  return { ...inst, exitValue };
}
