/**
 * Access requests + approval workflow (PLAN.md §7 / Phase 8).
 *
 * The request store is the Rayfin `AccessRequest` data entity (mssql). Reads of
 * current access + the actual workspace-role grant go through the shared
 * fabric_proxy UDF with the signed-in user's Power BI token.
 *
 * Fulfilment note (Decision D6): granting a workspace role needs
 * `Workspace.ReadWrite.All`, which the SPA token does not hold. So auto-grant
 * is attempted best-effort and, when it is refused, the request is left
 * Approved with a "manual fulfilment required" detail. Provisioning the
 * service principal turns that into an automatic grant.
 */
import { getRayfinClient } from './rayfinClient';
import { executeDax, fabricProxy, runNotebook } from './udfClient';

const MODEL_ID = import.meta.env.VITE_CATALOG_MODEL_ID as string | undefined;
const CATALOG_WS = (import.meta.env.VITE_CATALOG_WORKSPACE_ID ||
  import.meta.env.VITE_FABRIC_WORKSPACE_ID) as string | undefined;
/** The Catalog Grant notebook (fulfils grants under the grant service
 *  principal). When unset, approvals fall back to manual fulfilment. */
const GRANT_NOTEBOOK_ID = import.meta.env.VITE_GRANT_NOTEBOOK_ID as string | undefined;

export const WORKSPACE_ROLES = ['Viewer', 'Contributor', 'Member', 'Admin'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export type RequestStatus =
  | 'Submitted'
  | 'Approved'
  | 'Denied'
  | 'Fulfilled'
  | 'Failed';

export interface Workspace {
  id: string;
  name: string;
}

export interface WorkspaceMember {
  principalId: string;
  principalType: string;
  principalName: string;
  role: string;
}

export interface AccessRequest {
  id: string;
  request_type: string;
  target_id: string;
  target_name: string;
  requested_role?: string;
  requester: string;
  justification?: string;
  status: string;
  approver?: string;
  decision?: string;
  fulfilment_status?: string;
  fulfilment_detail?: string;
  error?: string;
  requested_at: Date;
  decided_at?: Date;
  user_id: string;
}

function daxVal(row: Record<string, unknown>, alias: string): string {
  for (const k of Object.keys(row)) {
    if (k === alias || k.endsWith(`[${alias}]`)) {
      const v = row[k];
      return v == null ? '' : String(v);
    }
  }
  return '';
}

/** Workspaces the catalog knows about (from cat_workspaces). */
export async function listWorkspaces(): Promise<Workspace[]> {
  if (!MODEL_ID || !CATALOG_WS) return [];
  const rows = await executeDax(
    CATALOG_WS,
    MODEL_ID,
    `EVALUATE SELECTCOLUMNS('cat_workspaces', "id", 'cat_workspaces'[workspace_id], "name", 'cat_workspaces'[workspace_name]) ORDER BY [name]`
  );
  return rows
    .map((r) => ({ id: daxVal(r, 'id'), name: daxVal(r, 'name') }))
    .filter((w) => w.id);
}

/** Current role assignments of a workspace (read; works with Workspace.Read.All). */
export async function getWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const res = await fabricProxy<{ value?: Record<string, unknown>[] }>(
    'fabric',
    `/workspaces/${workspaceId}/roleAssignments`
  );
  return (res.value ?? []).map((r) => {
    const p = (r.principal ?? {}) as Record<string, unknown>;
    return {
      principalId: String(p.id ?? ''),
      principalType: String(p.type ?? ''),
      principalName: String(p.displayName ?? ''),
      role: String(r.role ?? ''),
    };
  });
}

/** Body for a workspace role-assignment grant. */
export function grantBody(principalId: string, role: string, type = 'User') {
  return { principal: { id: principalId, type }, role };
}

/** Attempt the workspace-role grant. Throws on any failure (incl. the expected
 *  403 when the token lacks Workspace.ReadWrite.All). */
export async function grantWorkspaceAccess(
  workspaceId: string,
  principalId: string,
  role: string
): Promise<void> {
  await fabricProxy('fabric', `/workspaces/${workspaceId}/roleAssignments`, 'POST',
    grantBody(principalId, role));
}

type Db = ReturnType<typeof getRayfinClient>['data'];
function reqs(): Db['AccessRequest'] {
  return getRayfinClient().data.AccessRequest;
}

export async function createWorkspaceRequest(input: {
  workspace: Workspace;
  role: WorkspaceRole;
  justification: string;
  requesterEmail: string;
  requesterId: string;
}): Promise<AccessRequest> {
  return reqs().create({
    request_type: 'Workspace',
    target_id: input.workspace.id,
    target_name: input.workspace.name,
    requested_role: input.role,
    requester: input.requesterEmail,
    justification: input.justification,
    status: 'Submitted',
    requested_at: new Date(),
    user_id: input.requesterId,
  }) as Promise<AccessRequest>;
}

export async function listMyRequests(userId: string): Promise<AccessRequest[]> {
  return reqs().findMany({ user_id: { eq: userId } }) as Promise<AccessRequest[]>;
}

export async function listPendingRequests(): Promise<AccessRequest[]> {
  return reqs().findMany({ status: { eq: 'Submitted' } }) as Promise<AccessRequest[]>;
}

export async function denyRequest(id: string, approver: string): Promise<void> {
  await reqs().update(
    { id },
    { status: 'Denied', approver, decision: 'Denied', decided_at: new Date() }
  );
}

/**
 * Approve a request and fulfil it. Never auto-grants Admin. When the Catalog
 * Grant notebook is configured, the grant runs under the grant service
 * principal (Andreas Rederer's msfabricpysdkcore `add_workspace_role_assignment`)
 * → Fulfilled on success. Otherwise (or on failure) the request is left
 * Approved with a manual-fulfilment detail.
 */
export async function approveRequest(req: AccessRequest, approver: string): Promise<AccessRequest> {
  await reqs().update(
    { id: req.id },
    { status: 'Approved', approver, decision: 'Approved', decided_at: new Date() }
  );

  const role = req.requested_role ?? 'Viewer';
  const manualDetail = (extra: string) =>
    `Grant not completed automatically. Add ${req.requester} as ${role} to ` +
    `"${req.target_name}" in the Fabric portal. (${extra})`;

  // Preferred path: service-principal grant via the Catalog Grant notebook.
  if (GRANT_NOTEBOOK_ID && CATALOG_WS) {
    try {
      const result = await runNotebook(CATALOG_WS, GRANT_NOTEBOOK_ID, {
        workspace_id: { value: req.target_id, type: 'string' },
        principal_id: { value: req.user_id, type: 'string' },
        principal_type: { value: 'User', type: 'string' },
        role: { value: role, type: 'string' },
      });
      const parsed = result.exitValue ? JSON.parse(result.exitValue) : { ok: false };
      if (parsed.ok) {
        return (await reqs().update(
          { id: req.id },
          { status: 'Fulfilled', fulfilment_status: 'Succeeded', fulfilment_detail: parsed.detail }
        )) as AccessRequest;
      }
      return (await reqs().update(
        { id: req.id },
        { fulfilment_status: 'Manual', fulfilment_detail: manualDetail(String(parsed.detail ?? 'grant failed')).slice(0, 900) }
      )) as AccessRequest;
    } catch (e) {
      return (await reqs().update(
        { id: req.id },
        { fulfilment_status: 'Manual', fulfilment_detail: manualDetail(e instanceof Error ? e.message : String(e)).slice(0, 900) }
      )) as AccessRequest;
    }
  }

  // Fallback: try the user-token grant (works only if the caller has
  // Workspace.ReadWrite.All), else leave it for manual fulfilment.
  try {
    await grantWorkspaceAccess(req.target_id, req.user_id, role);
    return (await reqs().update(
      { id: req.id },
      { status: 'Fulfilled', fulfilment_status: 'Succeeded' }
    )) as AccessRequest;
  } catch (e) {
    return (await reqs().update(
      { id: req.id },
      { fulfilment_status: 'Manual', fulfilment_detail: manualDetail(e instanceof Error ? e.message : String(e)).slice(0, 900) }
    )) as AccessRequest;
  }
}
