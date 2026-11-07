import { isCleanText, suggestGroupName } from './groupCreate';
import { isGuid, type GraphIdentity, type WorkspaceRole } from './types';

export const PROVISIONED_ROLES = ['Admin', 'Member', 'Contributor', 'Viewer'] as const satisfies readonly WorkspaceRole[];
export const WORKSPACE_NAME_MAX = 100;

export interface WorkspaceRequestInput {
  displayName: string;
  description: string;
  reason: string;
}

export interface WorkspaceRequest extends WorkspaceRequestInput {
  id: string;
  requester: GraphIdentity;
  createdAt: string;
}

export interface Capacity {
  id: string;
  displayName: string;
  state: string;
}

export interface ProvisionedGroup {
  role: WorkspaceRole;
  name: string;
  id: string;
}

export interface WorkspaceDecision {
  id: string;
  actor: GraphIdentity;
  status: 'Provisioning' | 'Approved' | 'Denied' | 'Failed';
  at: string;
  note: string;
  capacityId?: string;
  workspaceId?: string;
  groups: ProvisionedGroup[];
  step: string;
  error?: string;
  attempt?: number;
}

export function validWorkspaceInput(input: WorkspaceRequestInput): boolean {
  const name = input.displayName.trim();
  return name.length >= 3 && name.length <= WORKSPACE_NAME_MAX &&
    name.toLowerCase() !== 'admin monitoring' && isCleanText(name) &&
    !/[\r\n\t]/.test(name) &&
    input.description.length <= 1000 && isCleanText(input.description) &&
    input.reason.trim().length >= 10 && input.reason.length <= 1000 && isCleanText(input.reason);
}

export function validWorkspaceRequest(request: WorkspaceRequest): boolean {
  return isGuid(request.id) && isGuid(request.requester.objectId) &&
    !!request.requester.userPrincipalName && !!request.requester.displayName && validWorkspaceInput(request);
}

export function workspaceGroupName(request: WorkspaceRequest, role: WorkspaceRole): string {
  // Keep the role and request suffix even when the workspace name is long.
  return `${suggestGroupName(request.displayName.slice(0, 70), role)}-${request.id.slice(0, 8)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function validWorkspaceDecision(value: unknown): value is WorkspaceDecision {
  if (!isRecord(value) || !isRecord(value.actor) || !isGuid(value.id) || !isGuid(value.actor.objectId) ||
    typeof value.actor.displayName !== 'string' || typeof value.actor.userPrincipalName !== 'string' ||
    typeof value.status !== 'string' || !['Provisioning', 'Approved', 'Denied', 'Failed'].includes(value.status) ||
    typeof value.at !== 'string' || !Number.isFinite(Date.parse(value.at)) ||
    typeof value.note !== 'string' || value.note.length > 500 || typeof value.step !== 'string' ||
    !Array.isArray(value.groups) || value.groups.length > 4) return false;
  if (value.capacityId !== undefined && !isGuid(value.capacityId)) return false;
  if (value.workspaceId !== undefined && !isGuid(value.workspaceId)) return false;
  if (value.error !== undefined && (typeof value.error !== 'string' || value.error.length > 1000)) return false;
  if (value.attempt !== undefined && (typeof value.attempt !== 'number' || !Number.isSafeInteger(value.attempt) || value.attempt < 0)) return false;
  return value.groups.every((group: unknown) => isRecord(group) && isGuid(group.id) && typeof group.name === 'string' &&
    typeof group.role === 'string' && (PROVISIONED_ROLES as readonly string[]).includes(group.role)) &&
    value.groups.every((group, index) => group.role === PROVISIONED_ROLES[index]) &&
    new Set(value.groups.map((group) => group.id.toLowerCase())).size === value.groups.length;
}

export function canContinueWorkspace(decision: WorkspaceDecision): boolean {
  if (decision.status !== 'Failed' || !decision.workspaceId || !decision.capacityId) return false;
  if (decision.step === 'verify-workspace' || decision.step === 'verify-resources') return true;
  if (['add-requester', 'verify-access', 'activate-groups', 'complete'].includes(decision.step)) return decision.groups.length === 4;
  const role = PROVISIONED_ROLES.findIndex((value) => decision.step === `verify-owner-${value}` || decision.step === `assign-role-${value}`);
  return role >= 0 && decision.groups.length >= role + 1;
}
