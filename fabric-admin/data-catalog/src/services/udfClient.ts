/**
 * Thin client for the shared Fabric `fabric_proxy` User Data Function.
 *
 * The Power BI token authenticates the invocation (Authorization header) and is
 * also passed in the body as `fabricToken` so the function can call Power BI /
 * Fabric REST on the user's behalf. Response envelope:
 *   { functionName, invocationId, status, output, errors }
 * and `fabric_proxy` wraps REST responses as `{ status, body }`.
 */
import { getUdfConfig } from '@/config/udfConfig';

import { getFabricToken, PbiSignInRequiredError } from './fabricAuth';

interface UdfEnvelope<T> {
  functionName: string;
  invocationId: string;
  status: string;
  output: T;
  errors?: { name: string; message: string }[];
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
    throw new Error(`Function call failed (${res.status}): ${await res.text()}`);
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

/** Trigger an on-demand RunNotebook job (the in-app Rescan / grant path) and
 *  return its terminal result, including the notebook's `exit()` value. */
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
