import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_SNAPSHOT, type GovernanceSnapshot } from '@/domain/effective';
import { SEED_PERSONAS } from '@/domain/personas';
import type { AccessRequest } from '@/domain/requests';

const createAssignment = vi.fn();
const updateRequest = vi.fn();
const submitWrite = vi.fn();
const raiseTask = vi.fn();

vi.mock('@/services/assignments', () => ({
  createAssignment: (...args: unknown[]) => createAssignment(...args),
}));
vi.mock('@/services/requests', () => ({
  updateRequest: (...args: unknown[]) => updateRequest(...args),
}));
vi.mock('@/services/writes', () => ({
  submitWrite: (...args: unknown[]) => submitWrite(...args),
}));
vi.mock('@/services/tasks', () => ({
  raiseTask: (...args: unknown[]) => raiseTask(...args),
}));

const { approveRequest, denyRequest, verifyAndClose } = await import('@/services/approvals');

const MODULES = ['fabric', 'pp', 'entra', 'agent'];

const request = (over: Partial<AccessRequest> = {}): AccessRequest => ({
  id: 'r1',
  requesterId: 'marcel@example.com',
  requesterName: 'Marcel',
  personaId: 'report-author',
  scopeType: 'Workspace',
  scopeId: 'ws-finance',
  scopeName: 'Finance',
  justification: 'Quarterly close.',
  status: 'Pending',
  createdAt: '2026-08-01T09:00:00Z',
  ...over,
});

const actor = {
  actorId: 'alkorn@example.com',
  actorName: 'Alexander',
  isApprover: true,
};

function approve(over: Partial<AccessRequest> = {}, modules = MODULES) {
  return approveRequest({
    request: request(over),
    personas: SEED_PERSONAS,
    enabledModules: modules,
    actor,
    principalId: 'marcel@example.com',
    principalName: 'Marcel',
    principalType: 'User',
  });
}

beforeEach(() => {
  createAssignment.mockReset().mockResolvedValue('assignment-1');
  updateRequest.mockReset().mockResolvedValue(true);
  submitWrite.mockReset().mockResolvedValue({
    state: 'result',
    result: { ok: true, dry_run: false },
  });
  raiseTask.mockReset().mockResolvedValue('task-1');
});

/**
 * Phase 9 exit criterion (PLAN.md §17 Track D):
 * request → approve → membership written → verified → drift closes.
 */
describe('approveRequest', () => {
  it('writes the entitlement BEFORE touching any plane', async () => {
    const order: string[] = [];
    createAssignment.mockImplementation(async () => {
      order.push('assignment');
      return 'assignment-1';
    });
    submitWrite.mockImplementation(async () => {
      order.push('write');
      return { state: 'result', result: { ok: true, dry_run: false } };
    });

    await approve();

    // If the write fails, drift reports Missing — visible and retryable. The
    // reverse order leaves access nothing justifies, which is the state this
    // product exists to eliminate.
    expect(order[0]).toBe('assignment');
    expect(order).toContain('write');
  });

  it('records the entitlement as coming from a request, linked to it', async () => {
    await approve();
    expect(createAssignment.mock.calls[0][0]).toMatchObject({
      grantedVia: 'Request',
      requestId: 'r1',
      personaId: 'report-author',
      scopeId: 'ws-finance',
    });
  });

  it('applies every compiled binding for the requested scope', async () => {
    const result = await approve();
    expect(result.ok).toBe(true);
    expect(result.status).toBe('Approved');
    expect(submitWrite).toHaveBeenCalled();
    for (const [call] of submitWrite.mock.calls) {
      expect(call.dryRun).toBe(false);
      expect(call.binding.targetId).toBe('ws-finance');
      expect(call.requestId).toBe('r1');
    }
  });

  it('lands as Failed when a gate refuses a binding, and says which', async () => {
    submitWrite.mockResolvedValue({
      state: 'result',
      result: { ok: false, dry_run: false, error: 'gate:dryRun' },
    });

    const result = await approve();

    expect(result.ok).toBe(false);
    expect(result.status).toBe('Failed');
    expect(result.outcomes.every((o) => o.error === 'gate:dryRun')).toBe(true);
    expect(updateRequest).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'Failed' }));
  });

  it('reports a missing actuator as a failure rather than a silent success', async () => {
    submitWrite.mockResolvedValue({ state: 'not-configured' });
    const result = await approve();
    expect(result.status).toBe('Failed');
    expect(result.outcomes[0].error).toBe('actuator:not-configured');
  });

  it('does not claim success when every binding belongs to a disabled module', async () => {
    const result = await approve({}, ['entra']);
    expect(submitWrite).not.toHaveBeenCalled();
    expect(result.status).toBe('Failed');
    expect(updateRequest).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ decisionNote: expect.stringContaining('switched-off') })
    );
  });

  it('never writes to a plane when the entitlement could not be stored', async () => {
    createAssignment.mockResolvedValue(null);
    const result = await approve();
    expect(submitWrite).not.toHaveBeenCalled();
    expect(result.status).toBe('Failed');
  });

  it('refuses self-approval before doing anything at all', async () => {
    const result = await approveRequest({
      request: request({ requesterId: actor.actorId }),
      personas: SEED_PERSONAS,
      enabledModules: MODULES,
      actor,
      principalId: actor.actorId,
      principalName: 'Alexander',
      principalType: 'User',
    });

    expect(result.ok).toBe(false);
    expect(result.refusedReason).toContain('own request');
    expect(createAssignment).not.toHaveBeenCalled();
    expect(submitWrite).not.toHaveBeenCalled();
    expect(updateRequest).not.toHaveBeenCalled();
  });
});

/**
 * Phase 11: bindings with no write API become tasks instead of reaching the
 * actuator, where they would be refused with `executor:not-implemented` — which
 * reads like a defect rather than a documented platform gap.
 */
describe('manual bindings become tasks', () => {
  const orgApp = () =>
    approveRequest({
      request: request({
        personaId: 'org-app-publisher',
        scopeType: 'Audience',
        scopeId: 'aud1',
        scopeName: 'Finance app',
      }),
      personas: SEED_PERSONAS,
      enabledModules: MODULES,
      actor,
      principalId: 'marcel@example.com',
      principalName: 'Marcel',
      principalType: 'User',
    });

  it('raises a task instead of calling the actuator', async () => {
    const result = await orgApp();

    expect(raiseTask).toHaveBeenCalled();
    expect(result.tasksRaised).toBeGreaterThan(0);
    // Whatever else was written, no manual kind reached the actuator.
    for (const [call] of submitWrite.mock.calls) {
      expect(call.binding.kind).not.toBe('orgapp_audience_member');
    }
  });

  it('links the task back to the request and names the person', async () => {
    await orgApp();
    const [draft] = raiseTask.mock.calls[0];
    expect(draft.requestId).toBe('r1');
    expect(draft.principalName).toBe('Marcel');
    expect(draft.source).toBe('Request');
  });

  it('counts a handed-over request as Approved, never Verified', async () => {
    // The work genuinely moved to a human with instructions, so it is not a
    // failure — but nothing has been confirmed, so it is certainly not verified.
    const result = await orgApp();
    expect(result.status).toBe('Approved');
    expect(updateRequest).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ status: 'Approved' })
    );
  });

  it('says in the decision note that a human now owns it', async () => {
    await orgApp();
    const [, patch] = updateRequest.mock.calls[0];
    expect(patch.decisionNote).toContain('manual tasks');
  });
});

describe('denyRequest', () => {
  it('records the decision and the note', async () => {
    await denyRequest(request(), actor, 'use the shared workspace instead');
    expect(updateRequest).toHaveBeenCalledWith('r1', {
      status: 'Denied',
      decidedBy: actor.actorId,
      decisionNote: 'use the shared workspace instead',
    });
  });

  it('refuses when the actor may not decide', async () => {
    const ok = await denyRequest(request(), { actorId: 'x@example.com', isApprover: false }, '');
    expect(ok).toBe(false);
    expect(updateRequest).not.toHaveBeenCalled();
  });
});

/**
 * Verification is the difference between "the API returned 200" and "the person
 * can actually do the thing". It runs through the same effective-permissions
 * engine as the Can-Do Explorer.
 */
describe('verifyAndClose', () => {
  const granted: GovernanceSnapshot = {
    ...EMPTY_SNAPSHOT,
    workspaces: [{ workspace_id: 'ws-finance', workspace_name: 'Finance' }],
    workspaceRoles: [
      {
        workspace_id: 'ws-finance',
        workspace_name: 'Finance',
        principal_id: 'marcel@example.com',
        principal_name: 'Marcel',
        principal_type: 'User',
        role: 'Contributor',
      },
    ],
    tenantSettings: [{ setting_name: 'CreateFabricItems', scope: 'Everyone' }],
  };

  it('verifies once the plane really grants what was promised', async () => {
    const outcome = await verifyAndClose({
      request: request({ status: 'Approved' }),
      personas: SEED_PERSONAS,
      enabledModules: MODULES,
      snapshot: granted,
      principalId: 'marcel@example.com',
    });

    expect(outcome.verified).toBe(true);
    expect(outcome.status).toBe('Verified');
    expect(updateRequest).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'Verified' }));
  });

  it('stays Failed and names what is missing when the write has not taken effect', async () => {
    const outcome = await verifyAndClose({
      request: request({ status: 'Approved' }),
      personas: SEED_PERSONAS,
      enabledModules: MODULES,
      snapshot: EMPTY_SNAPSHOT,
      principalId: 'marcel@example.com',
    });

    expect(outcome.verified).toBe(false);
    expect(outcome.status).toBe('Failed');
    expect(outcome.missing.length).toBeGreaterThan(0);
    expect(updateRequest).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ decisionNote: expect.stringContaining('not yet effective') })
    );
  });
});

/**
 * The last link in the chain: once the entitlement exists AND the plane grants
 * it, the drift row that the entitlement opened must close.
 */
describe('the loop actually closes', () => {
  it('turns a Missing drift row into no drift at all', async () => {
    const { computeDrift } = await import('@/domain/drift');
    const { computeEffectiveGrants } = await import('@/domain/effective');

    const assignment = {
      id: 'assignment-1',
      principalId: 'marcel@example.com',
      principalName: 'Marcel',
      principalType: 'User',
      personaId: 'report-author',
      scopeType: 'Workspace',
      scopeId: 'ws-finance',
      scopeName: 'Finance',
      isActive: true,
    };

    // Approved, entitlement recorded, nothing written yet.
    const before = computeDrift({
      assignments: [assignment],
      personas: SEED_PERSONAS,
      grants: computeEffectiveGrants(EMPTY_SNAPSHOT, { enabledModules: MODULES }),
    });
    expect(before.some((d) => d.driftType === 'Missing')).toBe(true);

    // The membership landed and the collector re-read the plane.
    const after = computeDrift({
      assignments: [assignment],
      personas: SEED_PERSONAS,
      grants: computeEffectiveGrants(
        {
          ...EMPTY_SNAPSHOT,
          workspaces: [{ workspace_id: 'ws-finance', workspace_name: 'Finance' }],
          workspaceRoles: [
            {
              workspace_id: 'ws-finance',
              workspace_name: 'Finance',
              principal_id: 'marcel@example.com',
              principal_name: 'Marcel',
              principal_type: 'User',
              role: 'Contributor',
            },
          ],
          tenantSettings: [{ setting_name: 'CreateFabricItems', scope: 'Everyone' }],
        },
        { enabledModules: MODULES }
      ),
    });

    expect(after.filter((d) => d.driftType === 'Missing')).toHaveLength(0);

    // What is left over is not a bug — it is the product's central finding.
    // Fabric has no per-item-type role, so the only way to let someone author
    // reports is `Contributor`, which also lets them create lakehouses,
    // notebooks and data agents. The entitlement asked for report authoring and
    // the platform can only deliver more than that.
    const extras = after.filter((d) => d.driftType === 'Extra');
    expect(extras.map((d) => d.capabilityId).sort()).toEqual([
      'create:FabricDataAgent',
      'create:FabricItem',
    ]);
    // And none of it may ever be auto-revoked.
    expect(extras.some((d) => d.autoRemediable)).toBe(false);
  });
});
