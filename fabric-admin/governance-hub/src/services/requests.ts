/**
 * Request persistence (PLAN.md §13, page 6).
 *
 * Requests are the decision record. They degrade to an empty list when the
 * backend is unreachable, so the page renders an honest "nothing here yet"
 * rather than an error boundary — but submitting reports a real failure, since
 * a request the requester believes was filed and that nobody can see is worse
 * than an error message.
 */
import type { AccessRequest, RequestStatus } from '@/domain/requests';

import { getRayfinClient } from './rayfinClient';

interface GovRequestRow {
  id: string;
  requester_id: string;
  requester_name: string;
  persona_id: string;
  scope_type: string;
  scope_id: string;
  scope_name: string;
  justification: string;
  status: string;
  created_at: Date;
  decided_by?: string;
  decided_at?: Date;
  decision_note?: string;
  valid_until?: Date;
  assignment_id?: string;
}

type Db = ReturnType<typeof getRayfinClient>['data'];
function rows(): Db['GovRequest'] {
  return getRayfinClient().data.GovRequest;
}

function toRequest(row: GovRequestRow): AccessRequest {
  return {
    id: row.id,
    requesterId: row.requester_id,
    requesterName: row.requester_name,
    personaId: row.persona_id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    scopeName: row.scope_name,
    justification: row.justification,
    status: row.status as RequestStatus,
    createdAt: new Date(row.created_at).toISOString(),
    decidedBy: row.decided_by,
    decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : undefined,
    decisionNote: row.decision_note,
    validUntil: row.valid_until ? new Date(row.valid_until).toISOString() : undefined,
    assignmentId: row.assignment_id,
  };
}

export interface LoadRequestsResult {
  requests: AccessRequest[];
  backendReachable: boolean;
}

export async function loadRequests(): Promise<LoadRequestsResult> {
  try {
    const stored = (await rows().findMany({})) as GovRequestRow[];
    return { requests: stored.map(toRequest), backendReachable: true };
  } catch {
    return { requests: [], backendReachable: false };
  }
}

export interface SubmitRequestInput {
  requesterId: string;
  requesterName: string;
  personaId: string;
  scopeType: string;
  scopeId: string;
  scopeName: string;
  justification: string;
  validUntil?: Date;
}

export async function submitRequest(input: SubmitRequestInput): Promise<boolean> {
  try {
    await rows().create({
      requester_id: input.requesterId,
      requester_name: input.requesterName,
      persona_id: input.personaId,
      scope_type: input.scopeType,
      scope_id: input.scopeId,
      scope_name: input.scopeName,
      justification: input.justification,
      status: 'Pending' satisfies RequestStatus,
      created_at: new Date(),
      valid_until: input.validUntil,
    });
    return true;
  } catch {
    return false;
  }
}

export interface DecisionPatch {
  status: RequestStatus;
  decidedBy?: string;
  decisionNote?: string;
  assignmentId?: string;
}

export async function updateRequest(id: string, patch: DecisionPatch): Promise<boolean> {
  try {
    await rows().update(
      { id },
      {
        status: patch.status,
        ...(patch.decidedBy ? { decided_by: patch.decidedBy, decided_at: new Date() } : {}),
        ...(patch.decisionNote !== undefined ? { decision_note: patch.decisionNote } : {}),
        ...(patch.assignmentId ? { assignment_id: patch.assignmentId } : {}),
      }
    );
    return true;
  } catch {
    return false;
  }
}
