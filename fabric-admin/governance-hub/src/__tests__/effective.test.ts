import { describe, expect, it } from 'vitest';

import {
  EMPTY_SNAPSHOT,
  EVERYONE_PRINCIPAL_ID,
  WORKSPACE_ROLE_CAPABILITIES,
  capabilityReach,
  computeEffectiveGrants,
  evaluateTenantGate,
  expandGrant,
  expandPrincipal,
  grantReach,
  grantsForPrincipal,
  listPrincipals,
  whatCan,
  whoCan,
  type GovernanceSnapshot,
} from '@/domain/effective';
import { CAPABILITY_BY_ID } from '@/domain/capabilities';

function snapshot(partial: Partial<GovernanceSnapshot>): GovernanceSnapshot {
  return { ...EMPTY_SNAPSHOT, ...partial };
}

describe('group expansion', () => {
  const base = snapshot({
    groupMembers: [
      {
        group_id: 'g1',
        principal_id: 'u1',
        principal_type: 'User',
        principal_name: 'Alice',
        is_transitive: 'false',
        depth: '0',
      },
      {
        group_id: 'g1',
        principal_id: 'u2',
        principal_type: 'User',
        principal_name: 'Bob',
        is_transitive: 'true',
        depth: '2',
      },
      {
        group_id: 'g1',
        principal_id: 'g2',
        principal_type: 'Group',
        principal_name: 'Nested',
        is_transitive: 'false',
        depth: '0',
      },
    ],
  });

  it('returns a user unchanged', () => {
    const result = expandPrincipal('u1', 'Alice', 'User', base);
    expect(result).toEqual([{ id: 'u1', name: 'Alice', type: 'User', steps: [] }]);
  });

  it('keeps the group itself and adds its effective members', () => {
    const result = expandPrincipal('g1', 'Finance', 'Group', base);
    expect(result.map((r) => r.id)).toEqual(['g1', 'u1', 'u2']);
  });

  it('does not double-count nested groups as principals', () => {
    // Their members are already present as transitive rows.
    const result = expandPrincipal('g1', 'Finance', 'Group', base);
    expect(result.map((r) => r.id)).not.toContain('g2');
  });

  it('records how a transitive member was reached', () => {
    const result = expandPrincipal('g1', 'Finance', 'Group', base);
    const bob = result.find((r) => r.id === 'u2')!;
    expect(bob.viaGroupName).toBe('Finance');
    expect(bob.steps[0].label).toContain('nested, depth 2');
  });
});

describe('tenant gate evaluation', () => {
  it('is unknown when the setting was never collected — never granted', () => {
    // Assuming "on" over-reports access; assuming "off" under-reports it.
    const result = evaluateTenantGate('create:Workspace', EMPTY_SNAPSHOT);
    expect(result.status).toBe('unknown');
  });

  it('blocks when the setting is disabled', () => {
    const result = evaluateTenantGate(
      'create:Workspace',
      snapshot({ tenantSettings: [{ setting_name: 'CreateWorkspaces', scope: 'Disabled' }] })
    );
    expect(result.status).toBe('blocked');
  });

  it('grants tenant-wide when enabled for everyone', () => {
    const result = evaluateTenantGate(
      'create:Workspace',
      snapshot({ tenantSettings: [{ setting_name: 'CreateWorkspaces', scope: 'Everyone' }] })
    );
    expect(result.status).toBe('granted');
    expect(result.allowedGroupIds).toEqual([]);
  });

  it('extracts the security groups a setting is limited to', () => {
    const result = evaluateTenantGate(
      'create:Workspace',
      snapshot({
        tenantSettings: [
          {
            setting_name: 'CreateWorkspaces',
            scope: 'SecurityGroups',
            enabled_groups_json: '[{"graphId":"g1","name":"Makers"}]',
          },
        ],
      })
    );
    expect(result.allowedGroupIds).toEqual(['g1']);
  });

  it('passes through capabilities that have no tenant gate', () => {
    expect(evaluateTenantGate('create:PowerBIReport', EMPTY_SNAPSHOT).status).toBe('granted');
  });
});

describe('Fabric workspace roles', () => {
  const base = snapshot({
    workspaces: [{ workspace_id: 'ws1', workspace_name: 'Finance' }],
    workspaceRoles: [
      {
        workspace_id: 'ws1',
        principal_id: 'u1',
        principal_type: 'User',
        principal_name: 'Alice',
        role: 'Contributor',
      },
    ],
  });

  it('grants report creation to a Contributor', () => {
    const grants = computeEffectiveGrants(base, { enabledModules: ['fabric'] });
    const report = grants.find(
      (g) => g.capabilityId === 'create:PowerBIReport' && g.principalId === 'u1'
    );
    expect(report?.status).toBe('granted');
    expect(report?.scopeName).toBe('Finance');
    expect(report?.path.map((p) => p.label)).toContain('workspace "Finance" role Contributor');
  });

  it('grants semantic models with the same role — Fabric cannot separate them', () => {
    // This is the documented gap, and flattening it would hide the product's
    // central finding.
    const grants = computeEffectiveGrants(base, { enabledModules: ['fabric'] });
    expect(
      grants.some((g) => g.capabilityId === 'create:SemanticModel' && g.principalId === 'u1')
    ).toBe(true);
    expect(WORKSPACE_ROLE_CAPABILITIES.Contributor).toContain('create:SemanticModel');
  });

  it('gives a Viewer read only', () => {
    const viewer = computeEffectiveGrants(
      snapshot({
        ...base,
        workspaceRoles: [
          {
            workspace_id: 'ws1',
            principal_id: 'u2',
            principal_type: 'User',
            principal_name: 'Bob',
            role: 'Viewer',
          },
        ],
      }),
      { enabledModules: ['fabric'] }
    ).filter((g) => g.principalId === 'u2');
    expect(viewer.map((g) => g.capabilityId)).toEqual(['read:Report']);
  });

  it('flows a group-held role to its effective members', () => {
    const tenant = snapshot({
      workspaces: [{ workspace_id: 'ws1', workspace_name: 'Finance' }],
      workspaceRoles: [
        {
          workspace_id: 'ws1',
          principal_id: 'g1',
          principal_type: 'Group',
          principal_name: 'Analysts',
          role: 'Contributor',
        },
      ],
      groupMembers: [
        {
          group_id: 'g1',
          principal_id: 'u9',
          principal_type: 'User',
          principal_name: 'Carol',
          is_transitive: 'false',
          depth: '0',
        },
      ],
    });
    const grants = computeEffectiveGrants(tenant, { enabledModules: ['fabric'] });

    // The grant is held by the group — that is the fact the collector found.
    const held = grants.find(
      (g) => g.principalId === 'g1' && g.capabilityId === 'create:PowerBIReport'
    );
    expect(held).toBeDefined();

    // Carol gets it through her membership, resolved per query (D38). The
    // answer is identical to the old materialised one; only the timing moved.
    const carol = grantsForPrincipal(grants, 'u9', tenant).find(
      (g) => g.capabilityId === 'create:PowerBIReport'
    );
    expect(carol?.viaGroupName).toBe('Analysts');
    expect(carol?.path[0].label).toContain('member of "Analysts"');

    // And the drill-down from the group reaches her too.
    expect(expandGrant(held!, tenant).map((g) => g.principalId)).toEqual(['u9']);
    expect(grantReach(held!, tenant)).toBe(1);
  });

  it('blocks a tenant-gated capability when the setting is off', () => {
    const grants = computeEffectiveGrants(
      snapshot({
        ...base,
        tenantSettings: [{ setting_name: 'EnableFabricAppItems', scope: 'Disabled' }],
      }),
      { enabledModules: ['fabric'] }
    );
    const fabricApp = grants.find(
      (g) => g.capabilityId === 'create:FabricApp' && g.principalId === 'u1'
    );
    expect(fabricApp?.status).toBe('blocked');
    expect(fabricApp?.statusDetail).toContain('is disabled');
  });

  it('blocks a workspace role holder outside the setting security group', () => {
    const grants = computeEffectiveGrants(
      snapshot({
        ...base,
        tenantSettings: [
          {
            setting_name: 'EnableFabricAppItems',
            scope: 'SecurityGroups',
            enabled_groups_json: '[{"graphId":"gX"}]',
          },
        ],
      }),
      { enabledModules: ['fabric'] }
    );
    const fabricApp = grants.find(
      (g) => g.capabilityId === 'create:FabricApp' && g.principalId === 'u1'
    );
    expect(fabricApp?.status).toBe('blocked');
    expect(fabricApp?.statusDetail).toContain('security groups');
  });

  it('grants workspace creation to everyone when the tenant setting is open', () => {
    const grants = computeEffectiveGrants(
      snapshot({ tenantSettings: [{ setting_name: 'CreateWorkspaces', scope: 'Everyone' }] }),
      { enabledModules: ['fabric'] }
    );
    const grant = grants.find((g) => g.capabilityId === 'create:Workspace');
    expect(grant?.principalId).toBe(EVERYONE_PRINCIPAL_ID);
    expect(grant?.status).toBe('granted');
  });
});

describe('Power Platform', () => {
  /**
   * The exit criterion for Phase 6, as a fixture:
   * *"who can create Copilot Studio agents?"*
   */
  const tenant = snapshot({
    environments: [
      { environment_id: 'e-default', environment_name: 'Default', environment_type: 'Default' },
      { environment_id: 'e-coe', environment_name: 'CoE', environment_type: 'Production' },
    ],
    ppRoles: [
      { environment_id: 'e-default', role_id: 'r-maker-d', role_name: 'Environment Maker' },
      { environment_id: 'e-coe', role_id: 'r-agent', role_name: 'Agent Author' },
      { environment_id: 'e-coe', role_id: 'r-basic', role_name: 'Basic User' },
    ],
    ppPrivileges: [
      {
        environment_id: 'e-default',
        role_id: 'r-maker-d',
        table_logical_name: 'bot',
        privilege: 'Create',
        depth: 'User',
        gates_agent_authoring: 'true',
      },
      {
        environment_id: 'e-coe',
        role_id: 'r-agent',
        table_logical_name: 'bot',
        privilege: 'Create',
        depth: 'Organization',
        gates_agent_authoring: 'true',
      },
      {
        environment_id: 'e-coe',
        role_id: 'r-basic',
        table_logical_name: 'account',
        privilege: 'Read',
        depth: 'User',
        gates_agent_authoring: 'false',
      },
    ],
    ppAssignments: [
      {
        environment_id: 'e-coe',
        principal_id: 't1',
        principal_type: 'Team',
        principal_name: 'GOV-PP-ENV-CoE-AgentAuthor',
        azure_group_id: 'g-agent',
        role_id: 'r-agent',
      },
      {
        environment_id: 'e-coe',
        principal_id: 'u-basic',
        principal_type: 'User',
        principal_name: 'Dave',
        role_id: 'r-basic',
      },
    ],
    groupMembers: [
      {
        group_id: 'g-agent',
        principal_id: 'u-marcel',
        principal_type: 'User',
        principal_name: 'Marcel',
        is_transitive: 'false',
        depth: '0',
      },
    ],
  });

  const grants = computeEffectiveGrants(tenant, { enabledModules: ['pp'] });
  const agentAuthors = whoCan(grants, 'create:CopilotStudioAgent');

  it('finds everyone in the Default environment', () => {
    // Environment Maker is auto-assigned there and cannot be removed. Listing
    // individual assignees instead would badly understate the exposure.
    const everyone = agentAuthors.find((g) => g.principalId === EVERYONE_PRINCIPAL_ID);
    expect(everyone).toBeDefined();
    expect(everyone!.scopeName).toBe('Default');
    expect(everyone!.path[0].label).toContain('cannot be removed');
  });

  it('finds the group team holding a Create-on-bot role', () => {
    expect(agentAuthors.map((g) => g.principalId)).toContain('g-agent');
  });

  it('resolves the group team through to its members', () => {
    // The group team holds the role; Marcel gets it by being in the group.
    // Resolved per query since D38 — same answer, computed on demand.
    const marcel = grantsForPrincipal(grants, 'u-marcel', tenant).find(
      (g) => g.capabilityId === 'create:CopilotStudioAgent' && g.scopeName === 'CoE'
    );
    expect(marcel).toBeDefined();
    expect(marcel!.scopeName).toBe('CoE');
    expect(marcel!.viaGroupName).toBe('GOV-PP-ENV-CoE-AgentAuthor');
  });

  it('excludes a role without Create on bot', () => {
    expect(agentAuthors.map((g) => g.principalId)).not.toContain('u-basic');
    expect(
      grantsForPrincipal(grants, 'u-basic', tenant).filter(
        (g) => g.capabilityId === 'create:CopilotStudioAgent' && g.scopeName === 'CoE'
      )
    ).toHaveLength(0);
  });

  it('explains every answer with a derivation path', () => {
    // An answer an admin cannot argue with is an answer they will not act on.
    for (const grant of agentAuthors) {
      expect(grant.path.length, grant.principalName).toBeGreaterThan(0);
    }
    const marcel = grantsForPrincipal(grants, 'u-marcel', tenant).find(
      (g) => g.capabilityId === 'create:CopilotStudioAgent' && g.scopeName === 'CoE'
    )!;
    const labels = marcel.path.map((p) => p.label);
    expect(labels[0]).toContain('member of');
    expect(labels.join(' ')).toContain('environment "CoE"');
    expect(labels.join(' ')).toContain('role "Agent Author"');
    expect(labels.join(' ')).toContain('Create on bot');
  });

  it('grants canvas apps to the predefined maker roles only', () => {
    const canvas = whoCan(grants, 'create:CanvasApp');
    // Custom security roles are not supported for canvas-app maker scenarios.
    expect(canvas.map((g) => g.principalId)).not.toContain('u-marcel');
    expect(canvas.some((g) => g.principalId === EVERYONE_PRINCIPAL_ID)).toBe(true);
  });

  it('reports unknown rather than empty when privileges were not collected', () => {
    const withoutPrivileges = computeEffectiveGrants(
      snapshot({
        environments: [
          { environment_id: 'e1', environment_name: 'Prod', environment_type: 'Production' },
        ],
        ppRoles: [{ environment_id: 'e1', role_id: 'r1', role_name: 'Custom Agent Role' }],
      }),
      { enabledModules: ['pp'] }
    );
    const unknown = withoutPrivileges.find(
      (g) => g.capabilityId === 'create:CopilotStudioAgent' && g.status === 'unknown'
    );
    expect(unknown).toBeDefined();
    expect(unknown!.statusDetail).toContain('not collected');
  });
});

describe('agents', () => {
  it('reports M365 declarative agents as unknown, not as nobody', () => {
    // Admin-center only, no API. "Nobody can" would be the opposite of true.
    const grants = computeEffectiveGrants(EMPTY_SNAPSHOT, { enabledModules: ['agent'] });
    const grant = grants.find((g) => g.capabilityId === 'create:M365DeclarativeAgent');
    expect(grant?.status).toBe('unknown');
    expect(grant?.statusDetail).toContain('admin-center only');
  });
});

describe('module filtering', () => {
  it('computes nothing for a disabled module', () => {
    const grants = computeEffectiveGrants(
      snapshot({
        workspaces: [{ workspace_id: 'ws1', workspace_name: 'W' }],
        workspaceRoles: [
          {
            workspace_id: 'ws1',
            principal_id: 'u1',
            principal_type: 'User',
            principal_name: 'A',
            role: 'Contributor',
          },
        ],
      }),
      { enabledModules: ['pp'] }
    );
    expect(grants.filter((g) => g.capabilityId.startsWith('create:PowerBI'))).toEqual([]);
  });
});

describe('query helpers', () => {
  const querySnapshot = snapshot({
    workspaces: [{ workspace_id: 'ws1', workspace_name: 'Finance' }],
    workspaceRoles: [
      {
        workspace_id: 'ws1',
        principal_id: 'u1',
        principal_type: 'User',
        principal_name: 'Alice',
        role: 'Contributor',
      },
    ],
    tenantSettings: [{ setting_name: 'EnableFabricAppItems', scope: 'Disabled' }],
  });
  const grants = computeEffectiveGrants(querySnapshot, { enabledModules: ['fabric'] });

  it('hides blocked grants by default and shows them on request', () => {
    expect(whoCan(grants, 'create:FabricApp')).toHaveLength(0);
    expect(whoCan(grants, 'create:FabricApp', { includeBlocked: true }).length).toBeGreaterThan(0);
  });

  it('includes tenant-wide grants when asking what a person can do', () => {
    const everyoneSnapshot = snapshot({
      tenantSettings: [{ setting_name: 'CreateWorkspaces', scope: 'Everyone' }],
    });
    const everyoneGrants = computeEffectiveGrants(everyoneSnapshot, {
      enabledModules: ['fabric'],
    });
    expect(
      whatCan(everyoneGrants, 'u-anyone', everyoneSnapshot).map((g) => g.capabilityId)
    ).toContain('create:Workspace');
  });

  it('lists principals with a capability count', () => {
    const principals = listPrincipals(grants, querySnapshot);
    expect(principals.find((p) => p.id === 'u1')?.capabilityCount).toBeGreaterThan(0);
  });

  it('summarises reach and flags tenant-wide exposure', () => {
    const everyoneSnapshot = snapshot({
      tenantSettings: [{ setting_name: 'CreateWorkspaces', scope: 'Everyone' }],
    });
    const everyoneGrants = computeEffectiveGrants(everyoneSnapshot, {
      enabledModules: ['fabric'],
    });
    const reach = capabilityReach(everyoneGrants, everyoneSnapshot).find(
      (r) => r.capabilityId === 'create:Workspace'
    );
    expect(reach?.everyone).toBe(true);
  });

  it('deduplicates a principal reachable by two routes', () => {
    const twoRoutes = snapshot({
      workspaces: [{ workspace_id: 'ws1', workspace_name: 'Finance' }],
      workspaceRoles: [
        {
          workspace_id: 'ws1',
          principal_id: 'g1',
          principal_type: 'Group',
          principal_name: 'A',
          role: 'Contributor',
        },
        {
          workspace_id: 'ws1',
          principal_id: 'g2',
          principal_type: 'Group',
          principal_name: 'B',
          role: 'Contributor',
        },
      ],
      groupMembers: [
        {
          group_id: 'g1',
          principal_id: 'u1',
          principal_type: 'User',
          principal_name: 'Alice',
          is_transitive: 'false',
          depth: '0',
        },
        {
          group_id: 'g2',
          principal_id: 'u1',
          principal_type: 'User',
          principal_name: 'Alice',
          is_transitive: 'false',
          depth: '0',
        },
      ],
    });
    const duplicated = computeEffectiveGrants(twoRoutes, { enabledModules: ['fabric'] });
    const alice = grantsForPrincipal(duplicated, 'u1', twoRoutes).filter(
      (g) => g.capabilityId === 'create:PowerBIReport'
    );
    expect(alice).toHaveLength(1);
  });
});

describe('capability coverage', () => {
  it('every capability the engine can emit is in the catalogue', () => {
    for (const capabilities of Object.values(WORKSPACE_ROLE_CAPABILITIES)) {
      for (const capabilityId of capabilities) {
        expect(CAPABILITY_BY_ID.get(capabilityId), capabilityId).toBeDefined();
      }
    }
  });
});
