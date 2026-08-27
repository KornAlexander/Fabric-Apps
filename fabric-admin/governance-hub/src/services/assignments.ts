/**
 * Entitlement persistence (PLAN.md §12.1).
 *
 * The desired side of drift. Degrades to an empty list when the backend is
 * unreachable, in which case every grant reads as `Extra` — which the Drift
 * page says out loud rather than presenting as a finding.
 */
import type { Assignment } from '@/domain/drift';

import { getRayfinClient } from './rayfinClient';

interface GovAssignmentRow {
  id: string;
  principal_id: string;
  principal_name: string;
  principal_type: string;
  persona_id: string;
  scope_type: string;
  scope_id: string;
  scope_name: string;
  granted_via: string;
  granted_by: string;
  granted_at: Date;
  valid_until?: Date;
  is_active: boolean;
  request_id?: string;
}

type Db = ReturnType<typeof getRayfinClient>['data'];
function rows(): Db['GovAssignment'] {
  return getRayfinClient().data.GovAssignment;
}

export interface LoadAssignmentsResult {
  assignments: Assignment[];
  backendReachable: boolean;
}

export async function loadAssignments(): Promise<LoadAssignmentsResult> {
  try {
    const stored = (await rows().findMany({})) as GovAssignmentRow[];
    return {
      assignments: stored.map((row) => ({
        id: row.id,
        principalId: row.principal_id,
        principalName: row.principal_name,
        principalType: row.principal_type,
        personaId: row.persona_id,
        scopeType: row.scope_type,
        scopeId: row.scope_id,
        scopeName: row.scope_name,
        validUntil: row.valid_until ? new Date(row.valid_until).toISOString() : undefined,
        isActive: row.is_active,
      })),
      backendReachable: true,
    };
  } catch {
    return { assignments: [], backendReachable: false };
  }
}

export interface CreateAssignmentInput {
  principalId: string;
  principalName: string;
  principalType: string;
  personaId: string;
  scopeType: string;
  scopeId: string;
  scopeName: string;
  validUntil?: Date;
  /** Request | Policy | Bulk | Inherited (PLAN.md §12.1). */
  grantedVia?: string;
  requestId?: string;
}

/** Returns the new assignment id, or `null` when it could not be stored. */
export async function createAssignment(
  input: CreateAssignmentInput,
  actor: string
): Promise<string | null> {
  try {
    const created = (await rows().create({
      principal_id: input.principalId,
      principal_name: input.principalName,
      principal_type: input.principalType,
      persona_id: input.personaId,
      scope_type: input.scopeType,
      scope_id: input.scopeId,
      scope_name: input.scopeName,
      granted_via: input.grantedVia ?? 'Bulk',
      granted_by: actor,
      granted_at: new Date(),
      valid_until: input.validUntil,
      is_active: true,
      request_id: input.requestId,
    })) as { id?: string } | undefined;
    // The id matters: it is what links an entitlement back to the decision that
    // produced it. A grant nobody can trace to an approval is a finding.
    return created?.id ?? 'created';
  } catch {
    return null;
  }
}

/**
 * Deactivate rather than delete.
 *
 * The audit question "who was entitled to this last month" has to stay
 * answerable, and a hard delete makes the later `Extra` drift row unexplainable.
 */
export async function deactivateAssignment(id: string): Promise<boolean> {
  try {
    await rows().update({ id }, { is_active: false });
    return true;
  } catch {
    return false;
  }
}
