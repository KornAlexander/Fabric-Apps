import { describe, expect, it } from 'vitest';

import {
  computeDrift,
  expandAssignments,
  personaCompileDrift,
  summariseDrift,
  type Assignment,
} from '@/domain/drift';
import type { EffectiveGrant } from '@/domain/effective';
import { SEED_PERSONAS, type Persona } from '@/domain/personas';

const persona = (over: Partial<Persona> = {}): Persona => ({
  id: 'p-report-author',
  name: 'Report Author',
  description: '',
  capabilityIds: ['create:PowerBIReport'],
  riskTier: 'Medium',
  isActive: true,
  isSeed: true,
  ...over,
});

const assignment = (over: Partial<Assignment> = {}): Assignment => ({
  id: 'a1',
  principalId: 'u1',
  principalName: 'Alice',
  principalType: 'User',
  personaId: 'p-report-author',
  scopeType: 'Workspace',
  scopeId: 'ws1',
  scopeName: 'Finance',
  isActive: true,
  ...over,
});

const grant = (over: Partial<EffectiveGrant> = {}): EffectiveGrant => ({
  principalId: 'u1',
  principalName: 'Alice',
  principalType: 'User',
  capabilityId: 'create:PowerBIReport',
  controlMode: 'preventive-auto',
  scopeType: 'Workspace',
  scopeId: 'ws1',
  scopeName: 'Finance',
  status: 'granted',
  path: [{ kind: 'workspace-role', label: 'Contributor on Finance' }],
  ...over,
});

describe('expandAssignments', () => {
  it('expands a persona into the capabilities it promises', () => {
    const entries = expandAssignments([assignment()], [persona()]);
    expect(entries.map((e) => e.capabilityId)).toContain('create:PowerBIReport');
  });

  it('ignores withdrawn assignments', () => {
    expect(expandAssignments([assignment({ isActive: false })], [persona()])).toHaveLength(0);
  });

  it('still expands an expired assignment, but marks it expired', () => {
    // If expiry made the entitlement vanish, the access left behind would show
    // up as unexplained Extra rather than "this expired".
    const entries = expandAssignments(
      [assignment({ validUntil: '2020-01-01T00:00:00Z' })],
      [persona()]
    );
    expect(entries.every((e) => e.expired)).toBe(true);
  });

  it('ignores an assignment whose persona no longer exists', () => {
    expect(expandAssignments([assignment({ personaId: 'gone' })], [persona()])).toHaveLength(0);
  });
});

describe('computeDrift — the exit criterion', () => {
  it('reports a deliberately broken binding as Missing', () => {
    // Entitled to author reports in Finance, but no grant exists.
    const rows = computeDrift({ assignments: [assignment()], personas: [persona()], grants: [] });
    const row = rows.find((r) => r.capabilityId === 'create:PowerBIReport')!;
    expect(row.driftType).toBe('Missing');
    expect(row.severity).toBe('Medium');
    // Granting what was already approved is safe to automate.
    expect(row.autoRemediable).toBe(true);
  });

  it('downgrades a Missing caused by expiry to Low and refuses to re-grant it', () => {
    const rows = computeDrift({
      assignments: [assignment({ validUntil: '2020-01-01T00:00:00Z' })],
      personas: [persona()],
      grants: [],
    });
    const row = rows.find((r) => r.capabilityId === 'create:PowerBIReport')!;
    expect(row.severity).toBe('Low');
    expect(row.autoRemediable).toBe(false);
  });

  it('raises Blocked at High when the platform contradicts the entitlement', () => {
    const rows = computeDrift({
      assignments: [assignment()],
      personas: [persona()],
      grants: [grant({ status: 'blocked', statusDetail: 'tenant setting is off' })],
    });
    const row = rows.find((r) => r.driftType === 'Blocked')!;
    expect(row.severity).toBe('High');
    expect(row.detail).toContain('tenant setting is off');
    expect(row.autoRemediable).toBe(false);
  });

  it('surfaces Unknown rather than silently treating it as granted', () => {
    const rows = computeDrift({
      assignments: [assignment()],
      personas: [persona()],
      grants: [grant({ status: 'unknown', statusDetail: 'setting not collected' })],
    });
    expect(rows.find((r) => r.driftType === 'Unknown')).toBeDefined();
  });

  it('produces no drift when desire and reality agree', () => {
    const rows = computeDrift({
      assignments: [assignment()],
      personas: [persona()],
      grants: [grant()],
    });
    expect(rows).toHaveLength(0);
  });
});

describe('Extra drift is never auto-remediable', () => {
  it('reports unjustified access', () => {
    const rows = computeDrift({ assignments: [], personas: [persona()], grants: [grant()] });
    expect(rows[0].driftType).toBe('Extra');
  });

  it('never marks any Extra row auto-remediable — for any capability', () => {
    // The invariant the whole product rests on: a governance tool that revokes
    // on its own is a governance tool that causes outages.
    const grants = [
      grant(),
      grant({ capabilityId: 'create:CopilotStudioAgent' }),
      grant({ capabilityId: 'create:Workspace', scopeType: 'Tenant', scopeId: 'tenant' }),
      grant({ capabilityId: 'read:Report' }),
    ];
    const rows = computeDrift({ assignments: [], personas: [persona()], grants });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.driftType === 'Extra')).toBe(true);
    expect(rows.some((r) => r.autoRemediable)).toBe(false);
  });

  it('rates unjustified agent authoring above unjustified reading', () => {
    const rows = computeDrift({
      assignments: [],
      personas: [persona()],
      grants: [grant({ capabilityId: 'create:CopilotStudioAgent' }), grant({ capabilityId: 'read:Report' })],
    });
    const bySeverity = new Map(rows.map((r) => [r.capabilityId, r.severity]));
    expect(bySeverity.get('create:CopilotStudioAgent')).toBe('High');
    expect(bySeverity.get('read:Report')).toBe('Low');
  });

  it('does not report blocked or unknown grants as Extra', () => {
    const rows = computeDrift({
      assignments: [],
      personas: [persona()],
      grants: [grant({ status: 'blocked' }), grant({ status: 'unknown' })],
    });
    expect(rows).toHaveLength(0);
  });
});

describe('everyone-grants', () => {
  it('satisfies an individual entitlement', () => {
    // Not drift: the person can do it. It is a policy finding instead.
    const rows = computeDrift({
      assignments: [assignment()],
      personas: [persona()],
      grants: [grant({ principalId: '*', principalName: 'Everyone', principalType: 'Everyone' })],
    });
    expect(rows.filter((r) => r.driftType === 'Missing')).toHaveLength(0);
  });
});

describe('summariseDrift', () => {
  it('counts by severity and type without losing rows', () => {
    const rows = computeDrift({
      assignments: [assignment()],
      personas: [persona()],
      grants: [grant({ principalId: 'u2', principalName: 'Bob' })],
    });
    const summary = summariseDrift(rows);
    expect(summary.total).toBe(rows.length);
    const bySeverity = Object.values(summary.bySeverity).reduce((a, b) => a + b, 0);
    const byType = Object.values(summary.byType).reduce((a, b) => a + b, 0);
    expect(bySeverity).toBe(summary.total);
    expect(byType).toBe(summary.total);
  });
});

describe('personaCompileDrift', () => {
  it('flags a persona referencing a capability that does not exist', () => {
    const rows = personaCompileDrift([persona({ capabilityIds: ['create:Nonsense'] })], [
      'fabric',
      'pp',
      'entra',
      'agent',
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe('High');
  });

  it('treats a switched-off module as dark, not as drift', () => {
    // A disabled module means "this grants nothing right now", which the UI
    // already strikes through. Reporting it as drift would bury the real
    // findings under noise the operator caused on purpose.
    expect(personaCompileDrift([persona()], ['entra'])).toHaveLength(0);
  });

  it('is silent for the shipped personas with everything enabled', () => {
    const rows = personaCompileDrift(SEED_PERSONAS, ['fabric', 'pp', 'entra', 'agent', 'core']);
    expect(rows).toHaveLength(0);
  });
});
