import { describe, expect, it } from 'vitest';

import {
  AUDIT_OUTCOMES,
  dryRunState,
  filterAudit,
  parseAudit,
  parseDryRuns,
  summariseAudit,
} from '@/domain/audit';
import { DRY_RUN_VALIDITY_DAYS } from '@/domain/writeGates';

const NOW = new Date('2026-08-04T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const auditRows = [
  {
    audit_id: 'a1',
    ts: daysAgo(2),
    actor: 'alkorn@example.com',
    actor_type: 'User',
    action: 'write:entra_group_member',
    plane: 'entra',
    target_type: 'Workspace',
    target_id: 'ws-pilot',
    outcome: 'Refused',
    error: 'gate:dryRun kind=entra_group_member scope=ws-pilot window=30d',
  },
  {
    audit_id: 'a2',
    ts: daysAgo(1),
    actor: 'sp-fabric',
    actor_type: 'ServicePrincipal',
    action: 'dryrun:fabric_workspace_role',
    plane: 'fabric',
    target_type: 'Workspace',
    target_id: 'ws-lab',
    outcome: 'Planned',
    error: '',
  },
  {
    audit_id: 'a3',
    ts: daysAgo(5),
    actor: 'alkorn@example.com',
    actor_type: 'User',
    action: 'write:fabric_workspace_role',
    plane: 'fabric',
    target_type: 'Workspace',
    target_id: 'ws-lab',
    outcome: 'Refused',
    error: 'gate:master',
  },
];

describe('parseAudit', () => {
  it('puts the most recent attempt first', () => {
    expect(parseAudit(auditRows).map((e) => e.auditId)).toEqual(['a2', 'a1', 'a3']);
  });

  it('does not invent an actor for a row that lost one', () => {
    const [entry] = parseAudit([{ audit_id: 'x', ts: daysAgo(0), actor: '' }]);
    expect(entry.actor).toBe('unknown');
  });

  it('treats an unparseable timestamp as the epoch rather than dropping the row', () => {
    // Losing an audit row because its timestamp is malformed is the one failure
    // mode an append-only trail must not have.
    const entries = parseAudit([{ audit_id: 'x', ts: 'not-a-date', actor: 'a' }]);
    expect(entries).toHaveLength(1);
    expect(entries[0].ts.getTime()).toBe(0);
  });
});

describe('summariseAudit', () => {
  it('counts outcomes', () => {
    const summary = summariseAudit(parseAudit(auditRows));
    expect(summary.total).toBe(3);
    expect(summary.byOutcome.Refused).toBe(2);
    expect(summary.byOutcome.Planned).toBe(1);
  });

  it('separates refusals by the gate that fired', () => {
    // "Refused 40 times by gate 4" and "refused 40 times by the denied-role
    // invariant" describe two completely different deployments.
    const summary = summariseAudit(parseAudit(auditRows));
    expect(summary.refusalsByGate).toEqual({ dryRun: 1, master: 1 });
  });

  it('reports the latest attempt', () => {
    expect(summariseAudit(parseAudit(auditRows)).lastAt?.toISOString()).toBe(daysAgo(1));
  });

  it('knows every outcome the actuator can write', () => {
    expect([...AUDIT_OUTCOMES]).toEqual(['Success', 'Planned', 'Refused', 'Failed']);
  });
});

describe('filterAudit', () => {
  const entries = parseAudit(auditRows);

  it('filters by outcome', () => {
    expect(filterAudit(entries, { outcome: 'Planned' })).toHaveLength(1);
  });

  it('filters by plane', () => {
    expect(filterAudit(entries, { plane: 'fabric' })).toHaveLength(2);
  });

  it('searches actor, action, target and error together', () => {
    expect(filterAudit(entries, { search: 'ws-pilot' })).toHaveLength(1);
    expect(filterAudit(entries, { search: 'gate:master' })).toHaveLength(1);
    expect(filterAudit(entries, { search: 'sp-fabric' })).toHaveLength(1);
  });

  it('returns everything for an empty filter', () => {
    expect(filterAudit(entries, {})).toHaveLength(3);
  });
});

describe('dryRunState — gate 4 seen from the console', () => {
  const dryRuns = parseDryRuns([
    { binding_kind: 'entra_group_member', scope_id: 'ws-pilot', succeeded_at: daysAgo(3) },
    { binding_kind: 'entra_group_member', scope_id: 'ws-old', succeeded_at: daysAgo(40) },
  ]);

  it('reports a fresh dry run with the days left', () => {
    const state = dryRunState('entra_group_member', 'ws-pilot', dryRuns, NOW);
    expect(state.status).toBe('fresh');
    expect(state.daysRemaining).toBe(DRY_RUN_VALIDITY_DAYS - 3);
  });

  it('distinguishes "expired" from "never" — they need different actions', () => {
    expect(dryRunState('entra_group_member', 'ws-old', dryRuns, NOW).status).toBe('expired');
    expect(dryRunState('entra_group_member', 'ws-new', dryRuns, NOW).status).toBe('never');
  });

  it('does not credit a dry run from a different kind or scope', () => {
    expect(dryRunState('fabric_workspace_role', 'ws-pilot', dryRuns, NOW).status).toBe('never');
  });

  it('uses the most recent dry run when several exist', () => {
    const many = parseDryRuns([
      { binding_kind: 'k', scope_id: 's', succeeded_at: daysAgo(29) },
      { binding_kind: 'k', scope_id: 's', succeeded_at: daysAgo(1) },
    ]);
    expect(dryRunState('k', 's', many, NOW).daysRemaining).toBe(DRY_RUN_VALIDITY_DAYS - 1);
  });

  it('ignores a future dry run — that is a clock problem, not approval', () => {
    const future = parseDryRuns([
      { binding_kind: 'k', scope_id: 's', succeeded_at: daysAgo(-5) },
    ]);
    expect(dryRunState('k', 's', future, NOW).status).toBe('never');
  });

  it('is expired at exactly the window boundary', () => {
    const boundary = parseDryRuns([
      { binding_kind: 'k', scope_id: 's', succeeded_at: daysAgo(DRY_RUN_VALIDITY_DAYS) },
    ]);
    expect(dryRunState('k', 's', boundary, NOW).status).toBe('expired');
  });
});
