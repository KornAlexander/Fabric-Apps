import { describe, expect, it } from 'vitest';

import {
  computeEffectiveGrants,
  listPrincipals,
  whatCan,
  whoCan,
  type GovernanceSnapshot,
  type Row,
} from '@/domain/effective';
import { EMPTY_SNAPSHOT } from '@/domain/effective';

/**
 * The performance budget (PLAN.md D32).
 *
 * > The Can-Do Explorer must answer a tenant-wide capability question in
 * > **under 3 s at 50k principals × 500 scopes**, cold.
 *
 * "Fast enough" is unfalsifiable; a number can fail a build. Success for this
 * product is defined as *many* customers running it as their central governance
 * platform, so scale is a feature rather than an optimisation.
 *
 * **The fixture is generated here, in the test — it is never shipped.** Demos
 * run against real tenant data; a synthetic tenant is a measuring instrument,
 * not a product feature (PLAN.md §18).
 *
 * These numbers are machine-dependent. The budget is deliberately generous
 * (3 s for what should be ~100 ms of work) so it fails on an architectural
 * regression, not on a noisy CI agent.
 */

const MODULES = ['fabric', 'pp', 'entra', 'agent'];

export interface TenantShape {
  users: number;
  groups: number;
  workspaces: number;
  environments: number;
  /** Groups a user belongs to, on average. */
  groupsPerUser: number;
  /** Role assignments per workspace. */
  rolesPerWorkspace: number;
}

/** A tenant the size the budget is written against. */
const LARGE: TenantShape = {
  users: 50_000,
  groups: 500,
  workspaces: 500,
  environments: 50,
  groupsPerUser: 2,
  rolesPerWorkspace: 4,
};

const FABRIC_ROLES = ['Viewer', 'Contributor', 'Member', 'Admin'];

/**
 * Build a snapshot with realistic *shape*, not realistic content.
 *
 * The shape is what costs time: group membership is transitive and already
 * expanded by the collector, workspace roles are usually held by groups, and
 * the engine has to fan a group-held role out to every member.
 */
function buildSnapshot(shape: TenantShape): GovernanceSnapshot {
  const groups: Row[] = Array.from({ length: shape.groups }, (_, g) => ({
    group_id: `g${g}`,
    display_name: `GOV-FAB-WS-Group${g}`,
    is_app_managed: 'true',
  }));

  // Each user is a member of `groupsPerUser` groups; the collector has already
  // resolved transitivity, so these are effective-membership rows.
  const groupMembers: Row[] = [];
  for (let u = 0; u < shape.users; u += 1) {
    for (let k = 0; k < shape.groupsPerUser; k += 1) {
      const g = (u + k * 7919) % shape.groups;
      groupMembers.push({
        group_id: `g${g}`,
        principal_id: `u${u}`,
        principal_name: `User ${u}`,
        principal_type: 'User',
        is_transitive: k === 0 ? 'false' : 'true',
        depth: k === 0 ? '0' : '1',
      });
    }
  }

  const workspaces: Row[] = Array.from({ length: shape.workspaces }, (_, w) => ({
    workspace_id: `ws${w}`,
    workspace_name: `Workspace ${w}`,
    capacity_id: `cap${w % 8}`,
    state: 'Active',
  }));

  const workspaceRoles: Row[] = [];
  for (let w = 0; w < shape.workspaces; w += 1) {
    for (let r = 0; r < shape.rolesPerWorkspace; r += 1) {
      workspaceRoles.push({
        workspace_id: `ws${w}`,
        workspace_name: `Workspace ${w}`,
        principal_id: `g${(w * shape.rolesPerWorkspace + r) % shape.groups}`,
        principal_name: `GOV-FAB-WS-Group${(w * shape.rolesPerWorkspace + r) % shape.groups}`,
        principal_type: 'Group',
        role: FABRIC_ROLES[r % FABRIC_ROLES.length],
      });
    }
  }

  const environments: Row[] = Array.from({ length: shape.environments }, (_, e) => ({
    environment_id: `e${e}`,
    environment_name: `Environment ${e}`,
    environment_type: e === 0 ? 'Default' : 'Production',
    has_dataverse: 'true',
    security_group_assignable: e === 0 ? 'false' : 'true',
    security_group_bound: e === 0 ? 'false' : 'true',
  }));

  const ppRoles: Row[] = environments.map((env) => ({
    environment_id: env.environment_id,
    role_id: `r-${env.environment_id}`,
    role_name: env.environment_type === 'Default' ? 'Environment Maker' : 'Agent Author',
    is_customizable: env.environment_type === 'Default' ? 'false' : 'true',
  }));

  const ppPrivileges: Row[] = ppRoles.map((role) => ({
    environment_id: role.environment_id,
    role_id: role.role_id,
    table_logical_name: 'bot',
    privilege: 'Create',
    depth: 'Organization',
    gates_agent_authoring: 'true',
  }));

  const ppAssignments: Row[] = ppRoles.map((role, index) => ({
    environment_id: role.environment_id,
    role_id: role.role_id,
    principal_id: `t${index}`,
    principal_type: 'Team',
    principal_name: `GOV-PP-Team${index}`,
    azure_group_id: `g${index % shape.groups}`,
  }));

  const tenantSettings: Row[] = [
    { setting_name: 'CreateWorkspaces', scope: 'SecurityGroups', security_group_ids: 'g1,g2' },
    { setting_name: 'CreateFabricItems', scope: 'Everyone' },
  ];

  return {
    ...EMPTY_SNAPSHOT,
    groups,
    groupMembers,
    workspaces,
    workspaceRoles,
    environments,
    ppRoles,
    ppPrivileges,
    ppAssignments,
    tenantSettings,
  };
}

function ms(fn: () => unknown): { elapsed: number; value: unknown } {
  const started = performance.now();
  const value = fn();
  return { elapsed: performance.now() - started, value };
}

describe('performance budget (D32)', () => {
  it(
    'answers a tenant-wide capability question within budget at 50k principals',
    { timeout: 300_000 },
    () => {
      const built = ms(() => buildSnapshot(LARGE));
      const snapshot = built.value as GovernanceSnapshot;

      const compute = ms(() => computeEffectiveGrants(snapshot, { enabledModules: MODULES }));
      const grants = compute.value as ReturnType<typeof computeEffectiveGrants>;

      const query = ms(() => whoCan(grants, 'create:PowerBIReport'));
      const principals = ms(() => listPrincipals(grants, snapshot));
      const single = ms(() => whatCan(grants, 'u42', snapshot));

      // Reported unconditionally: a number nobody reads is a budget nobody keeps.
      const report = [
        `  fixture      ${built.elapsed.toFixed(0)} ms  (${snapshot.groupMembers.length} membership rows)`,
        `  compute      ${compute.elapsed.toFixed(0)} ms  → ${grants.length} grants`,
        `  whoCan       ${query.elapsed.toFixed(0)} ms  → ${(query.value as unknown[]).length} rows`,
        `  listPrincipals ${principals.elapsed.toFixed(0)} ms → ${(principals.value as unknown[]).length}`,
        `  whatCan      ${single.elapsed.toFixed(0)} ms`,
        `  TOTAL cold   ${(compute.elapsed + query.elapsed).toFixed(0)} ms (budget 3000 ms)`,
      ].join('\n');
      console.log(`\nD32 performance budget — 50k principals × 500 scopes\n${report}\n`);

      // The budget covers what a user waits for: compute + the query itself.
      // Building the fixture is the collector's job in reality, so it is
      // measured but not charged.
      expect(compute.elapsed + query.elapsed).toBeLessThan(3000);

      // Holder-level means the grant count tracks *bindings*, not people
      // (PLAN.md D38). If this ever climbs back into six figures, the per-user
      // fan-out has returned and the budget will follow it.
      expect(grants.length).toBeLessThan(50_000);

      // …and the fixture must still exercise group resolution, or the numbers
      // above measure nothing. A user who holds access only through a group
      // must still get a complete answer.
      const viaGroup = single.value as unknown[];
      expect(viaGroup.length).toBeGreaterThan(0);
    }
  );
});
