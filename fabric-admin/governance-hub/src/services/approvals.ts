/**
 * Approval orchestration (PLAN.md §17 Phase 9).
 *
 * The exit criterion of this phase in one function:
 * **request → approve → membership written → verified → drift closes.**
 *
 * The order below is the design, not an implementation detail:
 *
 *   1. write the **entitlement** first;
 *   2. then ask the actuator to apply the compiled bindings;
 *   3. then **verify** by re-reading the plane.
 *
 * If step 2 fails, the customer is left with an approved entitlement that drift
 * immediately reports as `Missing` — visible, explainable, retryable. The
 * reverse order would leave access in a tenant that no entitlement justifies,
 * which is precisely the state this product exists to eliminate.
 *
 * Nothing here decides *whether* a write is permitted. That is the actuator's
 * job, server-side, on every call.
 */
import {
  canAct,
  compileRequest,
  statusAfterApply,
  verifyRequest,
  type AccessRequest,
  type ActorContext,
  type ApplyOutcome,
  type PlannedBinding,
  type RequestStatus,
} from '@/domain/requests';
import type { Persona } from '@/domain/personas';
import { computeEffectiveGrants, whatCan, type GovernanceSnapshot } from '@/domain/effective';
import { compilePersona } from '@/domain/personas';
import { isManualBinding, taskForBinding } from '@/domain/tasks';

import { createAssignment } from './assignments';
import { updateRequest } from './requests';
import { raiseTask } from './tasks';
import { submitWrite } from './writes';

export interface ApproveOptions {
  request: AccessRequest;
  personas: Persona[];
  enabledModules: string[];
  actor: ActorContext & { actorName: string };
  /** The principal the bindings target. Usually the requester. */
  principalId: string;
  principalName: string;
  principalType: string;
}

export interface ApproveResult {
  ok: boolean;
  status: RequestStatus;
  /** Non-localised reason when the action itself was refused. */
  refusedReason?: string;
  planned: PlannedBinding[];
  outcomes: ApplyOutcome[];
  assignmentId?: string;
  /** Bindings with no write API, raised as manual tasks instead. */
  tasksRaised: number;
}

/**
 * Approve a request and apply it.
 *
 * A binding whose module is switched off is **not** applied and **not**
 * counted as a failure: it is dark by operator choice. But if *every* binding
 * is dark, the request cannot be honoured and lands as `Failed` — telling the
 * requester "approved" while nothing was written would be the worst outcome
 * available.
 */
export async function approveRequest(options: ApproveOptions): Promise<ApproveResult> {
  const { request, personas, enabledModules, actor } = options;

  const permitted = canAct(request, 'approve', actor);
  if (!permitted.allowed) {
    return {
      ok: false,
      status: request.status,
      refusedReason: permitted.reason,
      planned: [],
      outcomes: [],
      tasksRaised: 0,
    };
  }

  const compiled = compileRequest(request, personas, enabledModules);
  const enabled = compiled.bindings.filter((b) => b.moduleEnabled);
  // Bindings with no write API never reach the actuator: it would refuse them
  // with `executor:not-implemented`, which reads like a defect rather than a
  // documented platform gap. They become tasks a human can actually act on.
  const applicable = enabled.filter((b) => !isManualBinding(b.bindingKind));
  const manual = enabled.filter((b) => isManualBinding(b.bindingKind));

  // 1 — the entitlement, first and unconditionally.
  const assignmentId = await createAssignment(
    {
      principalId: options.principalId,
      principalName: options.principalName,
      principalType: options.principalType,
      personaId: request.personaId,
      scopeType: request.scopeType,
      scopeId: request.scopeId,
      scopeName: request.scopeName,
      validUntil: request.validUntil ? new Date(request.validUntil) : undefined,
      grantedVia: 'Request',
      requestId: request.id,
    },
    actor.actorId
  );

  if (!assignmentId) {
    // Without the entitlement there is no desired state, so a successful write
    // would be indistinguishable from unjustified access.
    await updateRequest(request.id, {
      status: 'Failed',
      decidedBy: actor.actorId,
      decisionNote: 'entitlement could not be stored',
    });
    return {
      ok: false,
      status: 'Failed',
      refusedReason: 'entitlement could not be stored',
      planned: compiled.bindings,
      outcomes: [],
      tasksRaised: 0,
    };
  }

  // 2 — apply. Sequential on purpose: a plane that rate-limits under a burst
  // turns a partial success into a confusing one.
  const outcomes: ApplyOutcome[] = [];
  for (const binding of applicable) {
    const outcome = await submitWrite({
      binding: {
        kind: binding.bindingKind,
        module: binding.module,
        targetId: binding.scopeId,
        targetType: binding.scopeType,
        principalId: options.principalId,
        principalName: options.principalName,
        role: binding.roleValue,
        writable: true,
      },
      dryRun: false,
      actor: actor.actorId,
      requestId: request.id,
    });

    if (outcome.state === 'result') {
      outcomes.push({
        bindingKind: binding.bindingKind,
        scopeId: binding.scopeId,
        ok: outcome.result.ok,
        error: outcome.result.error ?? undefined,
      });
    } else {
      outcomes.push({
        bindingKind: binding.bindingKind,
        scopeId: binding.scopeId,
        ok: false,
        error:
          outcome.state === 'transport-error'
            ? outcome.message
            : outcome.state === 'not-configured'
              ? 'actuator:not-configured'
              : 'actuator:no-exit-value',
      });
    }
  }

  // 3 — hand the manual bindings to a human, with instructions.
  let tasksRaised = 0;
  for (const binding of manual) {
    const draft = taskForBinding(binding, {
      source: 'Request',
      principalId: options.principalId,
      principalName: options.principalName,
      requestId: request.id,
    });
    if (!draft) continue;
    if (await raiseTask(draft)) tasksRaised += 1;
  }

  const status = statusAfterApply(outcomes, {
    hasWritableBindings: applicable.length > 0,
    tasksRaised,
  });

  await updateRequest(request.id, {
    status,
    decidedBy: actor.actorId,
    assignmentId,
    decisionNote:
      applicable.length === 0 && tasksRaised === 0
        ? compiled.bindings.length === 0
          ? 'persona compiles to no bindings at this scope'
          : 'every binding belongs to a switched-off module'
        : tasksRaised > 0
          ? `${tasksRaised} binding(s) have no write API and were raised as manual tasks`
          : undefined,
  });

  return {
    ok: status === 'Approved',
    status,
    planned: compiled.bindings,
    outcomes,
    assignmentId,
    tasksRaised,
  };
}

export async function denyRequest(
  request: AccessRequest,
  actor: ActorContext,
  note: string
): Promise<boolean> {
  const permitted = canAct(request, 'deny', actor);
  if (!permitted.allowed) return false;
  return updateRequest(request.id, {
    status: 'Denied',
    decidedBy: actor.actorId,
    decisionNote: note,
  });
}

export async function withdrawRequest(
  request: AccessRequest,
  actor: ActorContext
): Promise<boolean> {
  const permitted = canAct(request, 'withdraw', actor);
  if (!permitted.allowed) return false;
  return updateRequest(request.id, { status: 'Withdrawn' });
}

export interface VerifyOptions {
  request: AccessRequest;
  personas: Persona[];
  enabledModules: string[];
  /** A freshly collected snapshot — stale data proves nothing. */
  snapshot: GovernanceSnapshot;
  principalId: string;
}

export interface VerifyOutcome {
  verified: boolean;
  missing: string[];
  status: RequestStatus;
}

/**
 * Close the loop.
 *
 * Verification asks the effective-permissions engine — the same engine the
 * Can-Do Explorer uses — whether the principal *now actually derives* what the
 * persona promised at that scope. "The API returned 200" is not verification,
 * and for tenant settings it is not even a good predictor.
 */
export async function verifyAndClose(options: VerifyOptions): Promise<VerifyOutcome> {
  const { request, personas, enabledModules, snapshot, principalId } = options;

  const persona = personas.find((p) => p.id === request.personaId);
  const expected = persona
    ? compilePersona(persona, {
        enabledModules: enabledModules as never,
        scopeType: request.scopeType as never,
      })
        .bindings.filter((b) => b.moduleEnabled)
        .map((b) => b.capabilityId)
    : [];

  const grants = computeEffectiveGrants(snapshot, { enabledModules });
  const granted = whatCan(grants, principalId, snapshot)
    .filter((g) => g.scopeId === request.scopeId && g.status === 'granted')
    .map((g) => g.capabilityId);

  const result = verifyRequest({
    grantedCapabilityIds: granted,
    expectedCapabilityIds: [...new Set(expected)],
  });

  const status: RequestStatus = result.verified ? 'Verified' : 'Failed';
  await updateRequest(request.id, {
    status,
    decisionNote: result.verified
      ? undefined
      : `not yet effective: ${result.missing.join(', ') || 'nothing expected'}`,
  });

  return { verified: result.verified, missing: result.missing, status };
}
