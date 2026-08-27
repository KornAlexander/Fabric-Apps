/**
 * The request lifecycle (PLAN.md §13 pages 6–7, §17 Phase 9).
 *
 * A request is the *front door*: "I want to be able to create X in scope Y".
 * Approving it does three things, in this order, and the order is the whole
 * design:
 *
 *   1. record the **entitlement** — the desired state, which is what drift is
 *      measured against;
 *   2. compile it into **bindings** and ask the actuator to apply them;
 *   3. **verify** by re-reading the plane.
 *
 * Doing (1) before (2) is deliberate. If the write fails, the customer is left
 * with an approved entitlement that drift immediately reports as `Missing` —
 * visible, explainable, retryable. The opposite order leaves access that
 * nothing justifies, which is the failure mode this product exists to prevent.
 *
 * Pure module: no IO, no React. Every state transition is decided here.
 */
import { compilePersona, type Persona } from './personas';

export type RequestStatus =
  /** Submitted, waiting for an approver. */
  | 'Pending'
  /** Approved; bindings compiled and handed to the actuator. */
  | 'Approved'
  /** Approver said no. Terminal. */
  | 'Denied'
  /** Approved, but at least one binding did not reach its plane. */
  | 'Failed'
  /** Approved, applied, and confirmed by re-reading the plane. */
  | 'Verified'
  /** Withdrawn by the requester before a decision. Terminal. */
  | 'Withdrawn';

export const TERMINAL_STATUSES: RequestStatus[] = ['Denied', 'Withdrawn', 'Verified'];

export interface AccessRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  personaId: string;
  scopeType: string;
  scopeId: string;
  scopeName: string;
  justification: string;
  status: RequestStatus;
  createdAt: string;
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
  validUntil?: string;
  /** Set once an entitlement row has been created for this request. */
  assignmentId?: string;
}

export type RequestAction = 'approve' | 'deny' | 'withdraw' | 'retry';

export interface ActorContext {
  /** Signed-in principal id, or their email when no id is known. */
  actorId: string;
  isApprover: boolean;
}

export interface ActionDecision {
  allowed: boolean;
  /** Non-localised reason, used for the audit row. */
  reason?: string;
  reasonCode?:
    | 'terminal'
    | 'not-approver'
    | 'self-approval'
    | 'not-requester'
    | 'not-failed'
    | 'not-pending';
}

const deny = (
  reasonCode: ActionDecision['reasonCode'],
  reason: string
): ActionDecision => ({ allowed: false, reasonCode, reason });

/**
 * Can this actor take this action on this request?
 *
 * The rule worth naming: **nobody approves their own request**, not even a
 * tenant admin. An approval chain of one is not an approval chain, and this is
 * the first thing an auditor tests.
 */
export function canAct(
  request: AccessRequest,
  action: RequestAction,
  actor: ActorContext
): ActionDecision {
  if (TERMINAL_STATUSES.includes(request.status) && action !== 'retry') {
    return deny('terminal', `request is ${request.status}`);
  }

  switch (action) {
    case 'approve':
    case 'deny': {
      if (request.status !== 'Pending') {
        return deny('not-pending', `request is ${request.status}, not Pending`);
      }
      if (!actor.isApprover) return deny('not-approver', 'actor is not an approver');
      if (request.requesterId === actor.actorId) {
        return deny('self-approval', 'an approver cannot decide their own request');
      }
      return { allowed: true };
    }
    case 'withdraw': {
      if (request.status !== 'Pending') {
        return deny('not-pending', `request is ${request.status}, not Pending`);
      }
      if (request.requesterId !== actor.actorId) {
        return deny('not-requester', 'only the requester can withdraw');
      }
      return { allowed: true };
    }
    case 'retry': {
      // Retrying is how a failed write gets a second chance once the operator
      // has fixed the cause (armed the kind, ran the dry run, granted the SP
      // workspace admin). It never re-opens the approval decision.
      if (request.status !== 'Failed') {
        return deny('not-failed', `only a Failed request can be retried`);
      }
      if (!actor.isApprover) return deny('not-approver', 'actor is not an approver');
      return { allowed: true };
    }
  }
}

export interface PlannedBinding {
  bindingKind: string;
  module: string;
  scopeType: string;
  scopeId: string;
  scopeName: string;
  capabilityId: string;
  roleValue?: string;
  isPerUser: boolean;
  /** False when the owning module is off — the binding is dark, not broken. */
  moduleEnabled: boolean;
  note: string;
}

export interface CompiledRequest {
  bindings: PlannedBinding[];
  /** Compile problems: the persona promises something we cannot deliver. */
  issues: string[];
  /** Bindings that will do nothing because their module is switched off. */
  darkCount: number;
}

/**
 * Compile an approved request into the bindings the actuator must apply.
 *
 * Only bindings for the *requested* scope type are produced. A request for a
 * workspace must not quietly also arm a tenant setting — that is exactly the
 * kind of scope creep a governance tool must never perform on its own.
 */
export function compileRequest(
  request: AccessRequest,
  personas: Persona[],
  enabledModules: string[]
): CompiledRequest {
  const persona = personas.find((p) => p.id === request.personaId);
  if (!persona) {
    return {
      bindings: [],
      issues: [`persona "${request.personaId}" no longer exists`],
      darkCount: 0,
    };
  }

  const result = compilePersona(persona, {
    enabledModules: enabledModules as never,
    scopeType: request.scopeType as never,
  });

  const bindings: PlannedBinding[] = result.bindings.map((binding) => ({
    bindingKind: binding.bindingKind,
    module: binding.requiresModule,
    scopeType: binding.scopeType,
    scopeId: request.scopeId,
    scopeName: request.scopeName,
    capabilityId: binding.capabilityId,
    roleValue: binding.roleValue,
    isPerUser: binding.isPerUser,
    moduleEnabled: binding.moduleEnabled,
    note: binding.note,
  }));

  return {
    bindings,
    issues: result.issues.map((i) => i.detail),
    darkCount: bindings.filter((b) => !b.moduleEnabled).length,
  };
}

export interface ApplyOutcome {
  bindingKind: string;
  scopeId: string;
  ok: boolean;
  /** `gate:dryRun`, `executor:not-implemented`, an HTTP error… */
  error?: string;
}

export interface ApplyOptions {
  hasWritableBindings: boolean;
  /** Bindings with no write API, handed to a human as tasks instead. */
  tasksRaised?: number;
}

/**
 * Where a request lands after the actuator has been asked to apply it.
 *
 * A request with nothing to apply is **not** a success. Marking it Verified
 * would tell the requester they can now do something they cannot — the single
 * most damaging lie this product could tell.
 *
 * A request whose bindings were all *manual* is a different case: the work has
 * genuinely been handed to a human, with instructions, and the task queue now
 * owns it. That is `Approved` — but never `Verified`, because nothing has been
 * confirmed yet.
 */
export function statusAfterApply(
  outcomes: ApplyOutcome[],
  options: ApplyOptions = { hasWritableBindings: true }
): RequestStatus {
  const tasks = options.tasksRaised ?? 0;
  if (!options.hasWritableBindings && tasks === 0) return 'Failed';
  if (outcomes.length === 0) return tasks > 0 ? 'Approved' : 'Failed';
  return outcomes.every((o) => o.ok) ? 'Approved' : 'Failed';
}

export interface VerificationInput {
  /** Capabilities the effective-permissions engine now derives for the principal. */
  grantedCapabilityIds: string[];
  /** Capabilities the request's persona promised, at the requested scope. */
  expectedCapabilityIds: string[];
}

export interface VerificationResult {
  verified: boolean;
  missing: string[];
}

/**
 * Verification closes the loop: the plane is re-read and the request is only
 * `Verified` when the effective-permissions engine *actually derives* what was
 * promised.
 *
 * "The API returned 200" is not verification. Tenant settings in particular
 * take minutes to take effect, so a synchronous success proves nothing.
 */
export function verifyRequest(input: VerificationInput): VerificationResult {
  const granted = new Set(input.grantedCapabilityIds);
  const missing = input.expectedCapabilityIds.filter((c) => !granted.has(c));
  return { verified: missing.length === 0 && input.expectedCapabilityIds.length > 0, missing };
}

export interface RequestSummary {
  total: number;
  byStatus: Record<RequestStatus, number>;
  pending: number;
  /** Approved but not yet confirmed in the plane — the queue worth watching. */
  awaitingVerification: number;
}

export function summariseRequests(requests: AccessRequest[]): RequestSummary {
  const byStatus: Record<RequestStatus, number> = {
    Pending: 0,
    Approved: 0,
    Denied: 0,
    Failed: 0,
    Verified: 0,
    Withdrawn: 0,
  };
  for (const request of requests) byStatus[request.status] += 1;
  return {
    total: requests.length,
    byStatus,
    pending: byStatus.Pending,
    awaitingVerification: byStatus.Approved,
  };
}

/** Approver queue order: oldest first — a queue sorted newest-first starves. */
export function approvalQueue(requests: AccessRequest[]): AccessRequest[] {
  return requests
    .filter((r) => r.status === 'Pending')
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export function isApprover(
  actorId: string | undefined,
  approverEmails: string[]
): boolean {
  if (!actorId) return false;
  const needle = actorId.trim().toLowerCase();
  return approverEmails.some((email) => email.trim().toLowerCase() === needle);
}
