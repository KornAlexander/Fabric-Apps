import { describe, expect, it } from 'vitest';

import {
  DENIED_ROLES,
  DRY_RUN_VALIDITY_DAYS,
  evaluateWriteGates,
  isDeniedRole,
  writeChipState,
  type DryRunRecord,
  type WriteConfig,
  type WriteRequest,
} from '@/domain/writeGates';

const armedConfig: WriteConfig = {
  writesEnabled: true,
  armedKinds: ['entra_group_member'],
  scopeAllowlist: ['ws-1'],
  enabledModules: ['entra', 'fabric'],
};

const request: WriteRequest = {
  bindingKind: 'entra_group_member',
  module: 'entra',
  scopeId: 'ws-1',
  role: 'Contributor',
  dryRun: false,
  writable: true,
};

const now = new Date('2026-08-04T12:00:00Z');
const freshDryRun: DryRunRecord[] = [
  {
    bindingKind: 'entra_group_member',
    scopeId: 'ws-1',
    succeededAt: new Date('2026-08-01T12:00:00Z'),
  },
];

describe('write gates', () => {
  it('allows a write only when every gate passes', () => {
    expect(evaluateWriteGates(request, armedConfig, freshDryRun, now)).toEqual({
      allowed: true,
    });
  });

  it('ships disarmed — the master switch refuses first', () => {
    const decision = evaluateWriteGates(
      request,
      { ...armedConfig, writesEnabled: false },
      freshDryRun,
      now
    );
    expect(decision.allowed).toBe(false);
    expect(decision.failedGate).toBe('master');
  });

  it('refuses a binding kind that is not armed', () => {
    const decision = evaluateWriteGates(
      request,
      { ...armedConfig, armedKinds: [] },
      freshDryRun,
      now
    );
    expect(decision.failedGate).toBe('kind');
  });

  it('refuses a scope outside the allow-list', () => {
    const decision = evaluateWriteGates(
      { ...request, scopeId: 'ws-999' },
      armedConfig,
      freshDryRun,
      now
    );
    expect(decision.failedGate).toBe('scope');
  });

  it('honours a wildcard scope allow-list', () => {
    const decision = evaluateWriteGates(
      { ...request, scopeId: 'ws-999' },
      { ...armedConfig, scopeAllowlist: ['*'] },
      [{ bindingKind: 'entra_group_member', scopeId: 'ws-999', succeededAt: now }],
      now
    );
    expect(decision.allowed).toBe(true);
  });

  it('requires a dry run before a real write', () => {
    const decision = evaluateWriteGates(request, armedConfig, [], now);
    expect(decision.failedGate).toBe('dryRun');
  });

  it('expires a dry run after the validity window', () => {
    const stale: DryRunRecord[] = [
      {
        bindingKind: 'entra_group_member',
        scopeId: 'ws-1',
        succeededAt: new Date(
          now.getTime() - (DRY_RUN_VALIDITY_DAYS + 1) * 24 * 60 * 60 * 1000
        ),
      },
    ];
    expect(evaluateWriteGates(request, armedConfig, stale, now).failedGate).toBe('dryRun');
  });

  it('does not accept a dry run recorded in the future', () => {
    const future: DryRunRecord[] = [
      {
        bindingKind: 'entra_group_member',
        scopeId: 'ws-1',
        succeededAt: new Date(now.getTime() + 60_000),
      },
    ];
    expect(evaluateWriteGates(request, armedConfig, future, now).failedGate).toBe('dryRun');
  });

  it('lets a dry run through without a prior dry run or scope entry', () => {
    const decision = evaluateWriteGates(
      { ...request, dryRun: true, scopeId: 'ws-999' },
      armedConfig,
      [],
      now
    );
    expect(decision.allowed).toBe(true);
  });

  describe('unconditional invariants', () => {
    it.each(DENIED_ROLES)('never grants %s, even fully armed', (role) => {
      const decision = evaluateWriteGates(
        { ...request, role },
        { ...armedConfig, scopeAllowlist: ['*'] },
        freshDryRun,
        now
      );
      expect(decision.failedGate).toBe('deniedRole');
    });

    it('matches denied roles case-insensitively and ignores padding', () => {
      expect(isDeniedRole('  ADMIN ')).toBe(true);
      expect(isDeniedRole('System Administrator')).toBe(true);
      expect(isDeniedRole('Contributor')).toBe(false);
      expect(isDeniedRole(undefined)).toBe(false);
    });

    it('refuses when the owning module is switched off', () => {
      const decision = evaluateWriteGates(
        request,
        { ...armedConfig, enabledModules: ['fabric'] },
        freshDryRun,
        now
      );
      expect(decision.failedGate).toBe('moduleOff');
    });

    it('refuses a binding kind that is not writable at all', () => {
      const decision = evaluateWriteGates(
        { ...request, writable: false },
        armedConfig,
        freshDryRun,
        now
      );
      expect(decision.failedGate).toBe('notWritable');
    });

    it('applies invariants before configuration gates', () => {
      // Even with writes globally off, a denied role must be reported as such:
      // the audit row has to record *why* it was refused, not just "off".
      const decision = evaluateWriteGates(
        { ...request, role: 'Admin' },
        { ...armedConfig, writesEnabled: false },
        [],
        now
      );
      expect(decision.failedGate).toBe('deniedRole');
    });
  });

  it('reports chip state for the header', () => {
    expect(writeChipState({ ...armedConfig, writesEnabled: false }).armed).toBe(false);
    expect(writeChipState({ ...armedConfig, armedKinds: [] }).armed).toBe(false);
    expect(writeChipState(armedConfig)).toEqual({ armed: true, kinds: 1, scopes: 1 });
    expect(writeChipState({ ...armedConfig, scopeAllowlist: ['*'] }).scopes).toBe(Infinity);
  });
});
