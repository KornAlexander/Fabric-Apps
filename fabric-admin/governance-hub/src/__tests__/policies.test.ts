import { describe, expect, it } from 'vitest';

import type { DriftRow } from '@/domain/drift';
import { EMPTY_SNAPSHOT, EVERYONE_PRINCIPAL_ID, type EffectiveGrant } from '@/domain/effective';
import { SEED_PERSONAS } from '@/domain/personas';
import {
  POLICY_RULES,
  evaluatePolicies,
  pendingRules,
  scoreDefaultPosture,
  type PolicyContext,
} from '@/domain/policies';

function ctx(partial: Partial<PolicyContext> = {}): PolicyContext {
  return {
    snapshot: EMPTY_SNAPSHOT,
    grants: [],
    drift: [],
    personas: SEED_PERSONAS,
    dlp: [],
    ppTenantSettings: [],
    agents: [],
    writesArmed: { kinds: [], scopes: [] },
    ...partial,
  };
}

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
  path: [],
  ...over,
});

describe('rule pack integrity', () => {
  it('ships POL-001 through POL-027 with no gaps and no duplicates', () => {
    const ids = POLICY_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      Array.from({ length: 27 }, (_, i) => `POL-${String(i + 1).padStart(3, '0')}`)
    );
  });

  it('declares every rule it cannot run yet instead of dropping it silently', () => {
    // A pack that quietly skips rules produces a clean report and false comfort.
    for (const rule of POLICY_RULES) {
      expect(Boolean(rule.evaluate) || Boolean(rule.requiresData)).toBe(true);
    }
    expect(pendingRules().every((r) => r.requiresData!.length > 10)).toBe(true);
  });

  it('finds nothing in an empty tenant rather than throwing', () => {
    // Nothing collected must produce no findings at all: an un-run collector is
    // not evidence of a wide-open tenant.
    expect(evaluatePolicies(ctx())).toEqual([]);
  });

  it('survives a rule that throws', () => {
    // One broken rule must not take the other 26 down with it.
    const findings = evaluatePolicies(
      ctx({ agents: [null as unknown as Record<string, string>] })
    );
    expect(Array.isArray(findings)).toBe(true);
  });
});

describe('individual rules', () => {
  it('POL-001 fires when everyone can author agents', () => {
    const findings = evaluatePolicies(
      ctx({
        grants: [
          grant({
            principalId: EVERYONE_PRINCIPAL_ID,
            principalName: 'Everyone',
            capabilityId: 'create:CopilotStudioAgent',
            scopeType: 'Environment',
            scopeId: 'e-default',
            scopeName: 'Contoso (default)',
          }),
        ],
      })
    );
    const hit = findings.find((f) => f.policyId === 'POL-001')!;
    expect(hit.severity).toBe('Critical');
    expect(hit.objectName).toBe('Contoso (default)');
  });

  it('POL-002 exempts environments where a security group cannot be bound', () => {
    const findings = evaluatePolicies(
      ctx({
        snapshot: {
          ...EMPTY_SNAPSHOT,
          environments: [
            {
              environment_id: 'e1',
              environment_name: 'Default',
              has_dataverse: 'true',
              security_group_assignable: 'false',
              security_group_bound: 'false',
            },
            {
              environment_id: 'e2',
              environment_name: 'Prod',
              has_dataverse: 'true',
              security_group_assignable: 'true',
              security_group_bound: 'false',
            },
          ],
        },
      })
    );
    const hits = findings.filter((f) => f.policyId === 'POL-002');
    expect(hits.map((h) => h.objectId)).toEqual(['e2']);
  });

  it('POL-003 carries the drift row’s own severity rather than a flat one', () => {
    const drift: DriftRow[] = [
      {
        id: 'x',
        driftType: 'Extra',
        severity: 'Critical',
        principalId: '*',
        principalName: 'Everyone',
        capabilityId: 'create:Workspace',
        scopeType: 'Tenant',
        scopeId: 'tenant',
        scopeName: 'Tenant',
        detail: '',
        autoRemediable: false,
      },
    ];
    const hit = evaluatePolicies(ctx({ drift })).find((f) => f.policyId === 'POL-003')!;
    expect(hit.severity).toBe('Critical');
  });

  it('POL-017 cannot fire when the capability is granted tenant-wide', () => {
    // Everyone is entitled, so "owner was never entitled" is meaningless.
    const findings = evaluatePolicies(
      ctx({
        grants: [
          grant({
            principalId: EVERYONE_PRINCIPAL_ID,
            capabilityId: 'create:CopilotStudioAgent',
          }),
        ],
        agents: [{ agent_id: 'a1', name: 'Bot', owner_principal: 'u9' }],
      })
    );
    expect(findings.filter((f) => f.policyId === 'POL-017')).toHaveLength(0);
  });

  it('POL-027 names every armed binding kind', () => {
    const findings = evaluatePolicies(
      ctx({ writesArmed: { kinds: ['entra_group_member'], scopes: [] } })
    );
    expect(findings.filter((f) => f.policyId === 'POL-027')).toHaveLength(1);
  });
});

describe('Default environment posture — reproducible by hand', () => {
  const defaultEnv = {
    environment_id: 'e-default',
    environment_name: 'Contoso (default)',
    environment_type: 'Default',
  };

  it('scores six levers and nothing else', () => {
    const posture = scoreDefaultPosture(ctx());
    expect(posture.total).toBe(6);
    expect(posture.levers).toHaveLength(6);
  });

  it('never counts an unknown lever as passing', () => {
    // Nothing collected at all: every lever is unknown, so the score is 0 of 6
    // and — crucially — none of them is reported as failing.
    const posture = scoreDefaultPosture(ctx());
    expect(posture.passed).toBe(0);
    expect(posture.levers.every((l) => l.status === 'unknown')).toBe(true);
  });

  it('leaves the Exchange transport rule permanently unknown', () => {
    // The Office 365 Outlook connector cannot be blocked by DLP, and the
    // documented mitigation is not machine-checkable from here. Claiming to
    // know would be the lie.
    const lever = scoreDefaultPosture(ctx({ ppTenantSettings: [] })).levers.find(
      (l) => l.id === 'exchange-transport-rule'
    )!;
    expect(lever.status).toBe('unknown');
  });

  it('adds up to exactly the number of passing levers', () => {
    const posture = scoreDefaultPosture(
      ctx({
        snapshot: { ...EMPTY_SNAPSHOT, environments: [defaultEnv] },
        dlp: [
          {
            policy_id: 'p1',
            policy_name: 'Default hardening',
            environment_id: 'e-default',
            blocks_new_connectors_by_default: 'true',
            blocks_custom_connector_urls: 'true',
          },
        ],
        ppTenantSettings: [
          { setting_name: 'tenantIsolation', value: 'true', is_set: 'true' },
          { setting_name: 'disableShareWithEveryone', value: 'true', is_set: 'true' },
          {
            setting_name: 'disableEnvironmentCreationByNonAdminUsers',
            value: 'true',
            is_set: 'true',
          },
          {
            setting_name: 'disableTrialEnvironmentCreationByNonAdminUsers',
            value: 'true',
            is_set: 'true',
          },
        ],
      })
    );
    // Five of six by hand: DLP default-blocked, DLP URL patterns, isolation,
    // share-with-everyone, environment creation. The sixth is not checkable.
    expect(posture.passed).toBe(5);
    expect(posture.environmentName).toBe('Contoso (default)');
    expect(posture.passed).toBe(posture.levers.filter((l) => l.status === 'pass').length);
  });

  it('distinguishes "off" from "never collected"', () => {
    const collectedOff = scoreDefaultPosture(
      ctx({
        ppTenantSettings: [
          { setting_name: 'disableShareWithEveryone', value: 'false', is_set: 'true' },
        ],
      })
    ).levers.find((l) => l.id === 'disable-share-with-everyone')!;
    expect(collectedOff.status).toBe('fail');

    const notCollected = scoreDefaultPosture(ctx()).levers.find(
      (l) => l.id === 'disable-share-with-everyone'
    )!;
    expect(notCollected.status).toBe('unknown');
  });

  it('POL-024 raises one finding per failing lever, and none for unknowns', () => {
    const context = ctx({
      snapshot: { ...EMPTY_SNAPSHOT, environments: [defaultEnv] },
      dlp: [
        {
          policy_id: 'p1',
          policy_name: 'Permissive',
          environment_id: 'e-default',
          blocks_new_connectors_by_default: 'false',
          blocks_custom_connector_urls: 'false',
        },
      ],
    });
    const failing = scoreDefaultPosture(context).levers.filter((l) => l.status === 'fail').length;
    const findings = evaluatePolicies(context).filter((f) => f.policyId === 'POL-024');
    expect(findings).toHaveLength(failing);
    expect(failing).toBeGreaterThan(0);
  });
});
