import { describe, expect, it } from 'vitest';

import {
  approvalQueue,
  canAct,
  compileRequest,
  isApprover,
  statusAfterApply,
  summariseRequests,
  verifyRequest,
  type AccessRequest,
} from '@/domain/requests';
import { SEED_PERSONAS, type Persona } from '@/domain/personas';

const request = (over: Partial<AccessRequest> = {}): AccessRequest => ({
  id: 'r1',
  requesterId: 'marcel@example.com',
  requesterName: 'Marcel',
  personaId: 'report-author',
  scopeType: 'Workspace',
  scopeId: 'ws-finance',
  scopeName: 'Finance',
  justification: 'Building the quarterly close report.',
  status: 'Pending',
  createdAt: '2026-08-01T09:00:00Z',
  ...over,
});

const approver = { actorId: 'alkorn@example.com', isApprover: true };
const bystander = { actorId: 'someone@example.com', isApprover: false };

describe('canAct — who may do what', () => {
  it('lets an approver approve a pending request', () => {
    expect(canAct(request(), 'approve', approver).allowed).toBe(true);
  });

  it('never lets anyone approve their own request', () => {
    // An approval chain of one is not an approval chain, and this is the first
    // thing an auditor tests.
    const own = request({ requesterId: approver.actorId });
    const decision = canAct(own, 'approve', approver);
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe('self-approval');
  });

  it('refuses a non-approver', () => {
    expect(canAct(request(), 'approve', bystander).reasonCode).toBe('not-approver');
  });

  it('refuses to decide a request that is no longer pending', () => {
    expect(canAct(request({ status: 'Verified' }), 'approve', approver).reasonCode).toBe(
      'terminal'
    );
    expect(canAct(request({ status: 'Approved' }), 'approve', approver).reasonCode).toBe(
      'not-pending'
    );
  });

  it('lets only the requester withdraw, and only while pending', () => {
    const own = { actorId: 'marcel@example.com', isApprover: false };
    expect(canAct(request(), 'withdraw', own).allowed).toBe(true);
    expect(canAct(request(), 'withdraw', approver).reasonCode).toBe('not-requester');
    expect(canAct(request({ status: 'Approved' }), 'withdraw', own).reasonCode).toBe(
      'not-pending'
    );
  });

  it('allows a retry only for a failed request, and never re-opens the decision', () => {
    expect(canAct(request({ status: 'Failed' }), 'retry', approver).allowed).toBe(true);
    expect(canAct(request({ status: 'Pending' }), 'retry', approver).reasonCode).toBe(
      'not-failed'
    );
    expect(canAct(request({ status: 'Failed' }), 'retry', bystander).reasonCode).toBe(
      'not-approver'
    );
  });
});

describe('compileRequest', () => {
  it('compiles only for the requested scope type', () => {
    // A workspace request must not quietly also arm a tenant setting.
    const compiled = compileRequest(request(), SEED_PERSONAS, [
      'fabric',
      'pp',
      'entra',
      'agent',
    ]);
    expect(compiled.bindings.length).toBeGreaterThan(0);
    expect(compiled.bindings.every((b) => b.scopeType === 'Workspace')).toBe(true);
    expect(compiled.bindings.every((b) => b.scopeId === 'ws-finance')).toBe(true);
  });

  it('marks bindings of a switched-off module as dark rather than dropping them', () => {
    const compiled = compileRequest(request(), SEED_PERSONAS, ['entra']);
    expect(compiled.darkCount).toBeGreaterThan(0);
    expect(compiled.bindings.some((b) => !b.moduleEnabled)).toBe(true);
  });

  it('reports a persona that no longer exists instead of compiling nothing quietly', () => {
    const compiled = compileRequest(request({ personaId: 'gone' }), SEED_PERSONAS, ['entra']);
    expect(compiled.issues[0]).toContain('gone');
  });

  it('produces no bindings for a scope the persona does not support', () => {
    // `workspace-creator` is gated by a tenant setting, so asking for it in a
    // Power Platform environment is meaningless — and the requester is told so
    // before an approver has to work it out.
    const compiled = compileRequest(
      request({
        personaId: 'workspace-creator',
        scopeType: 'Environment',
        scopeId: 'e-coe',
        scopeName: 'CoE',
      }),
      SEED_PERSONAS,
      ['fabric', 'pp', 'entra', 'agent']
    );
    expect(compiled.bindings).toHaveLength(0);
  });
});

describe('statusAfterApply', () => {
  const ok = { bindingKind: 'entra_group_member', scopeId: 'ws1', ok: true };
  const bad = {
    bindingKind: 'fabric_workspace_role',
    scopeId: 'ws1',
    ok: false,
    error: 'gate:dryRun',
  };

  it('is Approved only when every binding landed', () => {
    expect(statusAfterApply([ok, ok])).toBe('Approved');
  });

  it('is Failed when any binding did not', () => {
    expect(statusAfterApply([ok, bad])).toBe('Failed');
  });

  it('is Failed — never Approved — when there was nothing to apply', () => {
    // Telling a requester "approved" while nothing was written is the single
    // most damaging thing this product could do.
    expect(statusAfterApply([])).toBe('Failed');
    expect(statusAfterApply([ok], { hasWritableBindings: false })).toBe('Failed');
  });
});

describe('verifyRequest — closing the loop', () => {
  it('verifies only when the plane actually grants what was promised', () => {
    expect(
      verifyRequest({
        grantedCapabilityIds: ['create:PowerBIReport', 'create:SemanticModel'],
        expectedCapabilityIds: ['create:PowerBIReport'],
      }).verified
    ).toBe(true);
  });

  it('names what is still missing rather than just failing', () => {
    const result = verifyRequest({
      grantedCapabilityIds: ['create:PowerBIReport'],
      expectedCapabilityIds: ['create:PowerBIReport', 'create:FabricItem'],
    });
    expect(result.verified).toBe(false);
    expect(result.missing).toEqual(['create:FabricItem']);
  });

  it('does not count "expected nothing" as verified', () => {
    // Vacuous success would mark an empty approval as proven.
    expect(
      verifyRequest({ grantedCapabilityIds: ['x'], expectedCapabilityIds: [] }).verified
    ).toBe(false);
  });
});

describe('the approver queue', () => {
  it('shows only pending requests, oldest first', () => {
    // A queue sorted newest-first starves the oldest request.
    const queue = approvalQueue([
      request({ id: 'new', createdAt: '2026-08-03T09:00:00Z' }),
      request({ id: 'old', createdAt: '2026-07-01T09:00:00Z' }),
      request({ id: 'done', status: 'Verified' }),
    ]);
    expect(queue.map((r) => r.id)).toEqual(['old', 'new']);
  });

  it('counts what is applied but not yet proven', () => {
    const summary = summariseRequests([
      request({ status: 'Pending' }),
      request({ status: 'Approved' }),
      request({ status: 'Verified' }),
    ]);
    expect(summary.pending).toBe(1);
    expect(summary.awaitingVerification).toBe(1);
    expect(summary.total).toBe(3);
  });
});

describe('isApprover', () => {
  it('matches case-insensitively and ignores whitespace', () => {
    expect(isApprover('Alkorn@Example.com', [' alkorn@example.com '])).toBe(true);
  });

  it('is false for an unknown or missing actor', () => {
    expect(isApprover('other@example.com', ['alkorn@example.com'])).toBe(false);
    expect(isApprover(undefined, ['alkorn@example.com'])).toBe(false);
    expect(isApprover('alkorn@example.com', [])).toBe(false);
  });
});

describe('seed personas are requestable', () => {
  it('every active persona compiles to something at some scope', () => {
    // A persona nobody can usefully request is a trap in the picker.
    const modules = ['fabric', 'pp', 'entra', 'agent'];
    const scopes = ['Tenant', 'Workspace', 'Environment', 'Capacity', 'Audience'];
    for (const persona of SEED_PERSONAS.filter((p: Persona) => p.isActive)) {
      const anywhere = scopes.some(
        (scopeType) =>
          compileRequest(
            request({ personaId: persona.id, scopeType, scopeId: 's', scopeName: 'S' }),
            SEED_PERSONAS,
            modules
          ).bindings.length > 0
      );
      expect(anywhere, `${persona.id} compiles nowhere`).toBe(true);
    }
  });
});
