/**
 * The effective-permissions engine (PLAN.md §11.4).
 *
 * This answers the question that started the project: **who can create a Copilot
 * Studio agent / a Power App / a Fabric data agent / a Power BI report, right
 * now, and why?**
 *
 * It works from **collected reality**, not from intent. The entitlement model
 * supplies the *interpretation* — which concrete facts add up to a capability —
 * and the collectors supply the facts. Every grant carries a derivation path so
 * the answer is arguable rather than merely asserted.
 *
 * Pure: rows in, grants out. No network, no React. That is what makes the
 * headline feature testable against hand-built fixtures.
 */
import {
  CAPABILITY_BY_ID,
  type CapabilityDef,
  type ControlMode,
  type ScopeType,
} from './capabilities';

export type Row = Record<string, string>;

/** Everything the engine reads. Each field is one `gov_actual_*` table. */
export interface GovernanceSnapshot {
  workspaces: Row[];
  workspaceRoles: Row[];
  tenantSettings: Row[];
  groups: Row[];
  /** Already transitively resolved by the Entra collector. */
  groupMembers: Row[];
  environments: Row[];
  ppRoles: Row[];
  ppPrivileges: Row[];
  ppAssignments: Row[];
}

export const EMPTY_SNAPSHOT: GovernanceSnapshot = {
  workspaces: [],
  workspaceRoles: [],
  tenantSettings: [],
  groups: [],
  groupMembers: [],
  environments: [],
  ppRoles: [],
  ppPrivileges: [],
  ppAssignments: [],
};

/**
 * A synthetic principal for rights that are not scoped to anyone.
 *
 * Several controls genuinely grant to the whole tenant — a tenant setting
 * enabled for everyone, or the Default environment's auto-assigned Environment
 * Maker. Modelling that as "no rows" would be the single most misleading thing
 * this app could do, so it gets a first-class principal instead.
 */
export const EVERYONE_PRINCIPAL_ID = '*';

export type GrantStatus =
  /** The capability is genuinely held. */
  | 'granted'
  /** Held at one layer but switched off at another (usually a tenant setting). */
  | 'blocked'
  /** We cannot tell — the deciding data is not collectable or not collected. */
  | 'unknown';

export interface DerivationStep {
  kind:
    | 'group-member'
    | 'workspace-role'
    | 'tenant-setting'
    | 'dataverse-role'
    | 'dataverse-privilege'
    | 'environment'
    | 'auto-assignment'
    | 'not-collectable';
  /** Non-localised technical fact, e.g. `workspace "Finance" role Contributor`. */
  label: string;
}

export interface EffectiveGrant {
  principalId: string;
  principalName: string;
  principalType: string;
  capabilityId: string;
  controlMode: ControlMode;
  scopeType: ScopeType;
  scopeId: string;
  scopeName: string;
  status: GrantStatus;
  /** Why a grant is blocked or unknown. Non-localised. */
  statusDetail?: string;
  /** Group the right flows through, when it is not held directly. */
  viaGroupId?: string;
  viaGroupName?: string;
  path: DerivationStep[];
  /**
   * A tenant setting that limits this grant to specific security groups.
   *
   * Carried on the grant because the holder and its members can have *different
   * answers*: a group may hold Contributor while only some of its members are
   * inside the setting's security group. Expansion re-evaluates it per person
   * (PLAN.md D38) — dropping it would silently over-report access.
   */
  gate?: { settingName?: string; allowedGroupIds: string[] };
}

// ── Group expansion ──────────────────────────────────────────────────────────

export interface ResolvedPrincipal {
  id: string;
  name: string;
  type: string;
  viaGroupId?: string;
  viaGroupName?: string;
  /** Extra path steps describing how the group membership was reached. */
  steps: DerivationStep[];
}

/**
 * Expand a principal into the people it actually covers.
 *
 * A workspace role held by a *group* grants to every effective member of that
 * group — which is the whole reason the Entra collector resolves nesting. The
 * group itself is kept as well, because "the group has Contributor" is a fact
 * an admin needs to see, not just its consequences.
 */
export function expandPrincipal(
  principalId: string,
  principalName: string,
  principalType: string,
  snapshot: GovernanceSnapshot
): ResolvedPrincipal[] {
  if (principalType !== 'Group') {
    return [{ id: principalId, name: principalName, type: principalType, steps: [] }];
  }

  const members = memberIndex(snapshot).get(principalId) ?? [];
  const group: ResolvedPrincipal = {
    id: principalId,
    name: principalName,
    type: 'Group',
    steps: [],
  };

  const expanded = members
    // Nested groups are edges, not leaves: their members are already present as
    // transitive rows, so counting the group again would double-report.
    .filter((m) => m.principal_type !== 'Group')
    .map<ResolvedPrincipal>((m) => ({
      id: m.principal_id,
      name: m.principal_name || m.principal_id,
      type: m.principal_type || 'User',
      viaGroupId: principalId,
      viaGroupName: principalName,
      steps: [
        {
          kind: 'group-member',
          label:
            m.is_transitive === 'true'
              ? `member of "${principalName}" (nested, depth ${m.depth || '?'})`
              : `member of "${principalName}"`,
        },
      ],
    }));

  return [group, ...expanded];
}

// ── Tenant-setting evaluation ────────────────────────────────────────────────

/** Tenant settings that gate a capability, by capability id. */
export const TENANT_GATES: Record<string, string[]> = {
  'create:Workspace': ['CreateWorkspaces'],
  'create:FabricItem': ['CreateFabricItems', 'FabricSwitch'],
  'create:FabricApp': ['EnableFabricAppItems', 'FabricAppItems'],
  'create:OrgApp': ['OrgAppsPreview', 'CreateOrgApps'],
};

export interface TenantGateResult {
  status: GrantStatus;
  detail?: string;
  /** Group ids the setting is restricted to, when it is. */
  allowedGroupIds: string[];
  settingName?: string;
}

function findSetting(snapshot: GovernanceSnapshot, names: string[]): Row | undefined {
  return snapshot.tenantSettings.find((s) =>
    names.some((n) => (s.setting_name || '').toLowerCase() === n.toLowerCase())
  );
}

function parseGroupIds(json: string | undefined): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((g) =>
        typeof g === 'object' && g !== null
          ? String((g as Record<string, unknown>).graphId ?? (g as Record<string, unknown>).id ?? '')
          : String(g)
      )
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Evaluate the tenant setting that gates a capability.
 *
 * An uncollected setting is `unknown`, never `granted`. Assuming "on" would
 * over-report access; assuming "off" would under-report it. Saying "we do not
 * know" is the only honest option, and the UI shows it as such.
 */
export function evaluateTenantGate(
  capabilityId: string,
  snapshot: GovernanceSnapshot
): TenantGateResult {
  const names = TENANT_GATES[capabilityId];
  if (!names) return { status: 'granted', allowedGroupIds: [] };

  const setting = findSetting(snapshot, names);
  if (!setting) {
    return {
      status: 'unknown',
      detail: `tenant setting ${names[0]} not collected`,
      allowedGroupIds: [],
    };
  }

  const settingName = setting.setting_name;
  switch (setting.scope) {
    case 'Disabled':
      return {
        status: 'blocked',
        detail: `tenant setting "${settingName}" is disabled`,
        allowedGroupIds: [],
        settingName,
      };
    case 'Everyone':
      return { status: 'granted', allowedGroupIds: [], settingName };
    case 'SecurityGroups':
      return {
        status: 'granted',
        allowedGroupIds: parseGroupIds(setting.enabled_groups_json),
        settingName,
      };
    case 'Excluded':
      return { status: 'granted', allowedGroupIds: [], settingName };
    default:
      return {
        status: 'unknown',
        detail: `tenant setting "${settingName}" has an unrecognised scope`,
        allowedGroupIds: [],
        settingName,
      };
  }
}

/**
 * Group → its membership rows, built once per snapshot.
 *
 * Both `expandPrincipal` and `membersOfGroups` used to scan the whole
 * `groupMembers` array on every call. With 2,000 workspace-role assignments
 * over 100,000 membership rows that is 200 million comparisons for one page
 * load — it measured at ~5.7 s against a 3 s budget (PLAN.md D32).
 *
 * The index is memoised on the snapshot object itself, so every call site keeps
 * its original signature and a fresh snapshot simply gets a fresh index. A
 * `WeakMap` means it is collected with the snapshot rather than pinning it.
 */
const MEMBER_INDEX = new WeakMap<GovernanceSnapshot, Map<string, Row[]>>();

function memberIndex(snapshot: GovernanceSnapshot): Map<string, Row[]> {
  const cached = MEMBER_INDEX.get(snapshot);
  if (cached) return cached;

  const index = new Map<string, Row[]>();
  for (const member of snapshot.groupMembers) {
    const bucket = index.get(member.group_id);
    if (bucket) bucket.push(member);
    else index.set(member.group_id, [member]);
  }
  MEMBER_INDEX.set(snapshot, index);
  return index;
}

/** Effective members of a set of groups, as principal ids. */
function membersOfGroups(groupIds: string[], snapshot: GovernanceSnapshot): Set<string> {
  const index = memberIndex(snapshot);
  const ids = new Set<string>();
  for (const groupId of groupIds) {
    ids.add(groupId);
    for (const member of index.get(groupId) ?? []) ids.add(member.principal_id);
  }
  return ids;
}

// ── Fabric rules ─────────────────────────────────────────────────────────────

/**
 * What each Fabric workspace role actually grants.
 *
 * Contributor grants **every** create capability, because Fabric has no
 * per-item-type role. That is not a modelling shortcut — it is the documented
 * gap, and flattening it would hide the product's central finding.
 */
export const WORKSPACE_ROLE_CAPABILITIES: Record<string, string[]> = {
  Viewer: ['read:Report'],
  Contributor: [
    'read:Report',
    'create:PowerBIReport',
    'create:SemanticModel',
    'create:FabricItem',
    'create:FabricDataAgent',
    'create:FabricApp',
  ],
  Member: [
    'read:Report',
    'create:PowerBIReport',
    'create:SemanticModel',
    'create:FabricItem',
    'create:FabricDataAgent',
    'create:FabricApp',
    'create:OrgApp',
  ],
  Admin: [
    'read:Report',
    'create:PowerBIReport',
    'create:SemanticModel',
    'create:FabricItem',
    'create:FabricDataAgent',
    'create:FabricApp',
    'create:OrgApp',
  ],
};

function fabricGrants(snapshot: GovernanceSnapshot): EffectiveGrant[] {
  const grants: EffectiveGrant[] = [];
  const workspaceName = new Map(
    snapshot.workspaces.map((w) => [w.workspace_id, w.workspace_name || w.workspace_id])
  );

  for (const assignment of snapshot.workspaceRoles) {
    const capabilities = WORKSPACE_ROLE_CAPABILITIES[assignment.role] ?? [];
    if (capabilities.length === 0) continue;

    const scopeId = assignment.workspace_id;
    const scopeName = workspaceName.get(scopeId) ?? scopeId;

    // Holder-level: the principal that actually holds the role. Members are
    // resolved per query instead of materialised here (PLAN.md D38).
    const holder = {
      id: assignment.principal_id,
      name: assignment.principal_name || assignment.principal_id,
      type: assignment.principal_type || 'User',
    };

    for (const capabilityId of capabilities) {
      const capability = CAPABILITY_BY_ID.get(capabilityId);
      if (!capability) continue;

      const gate = evaluateTenantGate(capabilityId, snapshot);
      const allowed = gate.allowedGroupIds.length
        ? membersOfGroups(gate.allowedGroupIds, snapshot)
        : null;

      {
        const principal = holder;
        let status = gate.status;
        let statusDetail = gate.detail;

        // A tenant setting scoped to security groups only helps the people in
        // them — everyone else holds the workspace role and still cannot create.
        if (status === 'granted' && allowed && !allowed.has(principal.id)) {
          status = 'blocked';
          statusDetail = `tenant setting "${gate.settingName}" is limited to security groups this principal is not in`;
        }

        const path: DerivationStep[] = [
          {
            kind: 'workspace-role',
            label: `workspace "${scopeName}" role ${assignment.role}`,
          },
        ];
        if (gate.settingName) {
          path.push({
            kind: 'tenant-setting',
            label: `tenant setting "${gate.settingName}" — ${
              snapshot.tenantSettings.find((s) => s.setting_name === gate.settingName)?.scope ??
              'unknown'
            }`,
          });
        }

        grants.push({
          principalId: principal.id,
          principalName: principal.name,
          principalType: principal.type,
          capabilityId,
          controlMode: capability.controlMode,
          scopeType: 'Workspace',
          scopeId,
          scopeName,
          status,
          statusDetail,
          path,
          ...(gate.allowedGroupIds.length
            ? { gate: { settingName: gate.settingName, allowedGroupIds: gate.allowedGroupIds } }
            : {}),
        });
      }
    }
  }

  // Tenant-scoped capabilities that need no workspace at all.
  for (const capabilityId of ['create:Workspace']) {
    const capability = CAPABILITY_BY_ID.get(capabilityId);
    if (!capability) continue;
    const gate = evaluateTenantGate(capabilityId, snapshot);

    if (gate.status === 'unknown') {
      grants.push(unknownGrant(capability, 'Tenant', 'tenant', 'Tenant', gate.detail!));
      continue;
    }
    if (gate.status === 'blocked') continue;

    if (gate.allowedGroupIds.length === 0) {
      grants.push({
        principalId: EVERYONE_PRINCIPAL_ID,
        principalName: 'Everyone',
        principalType: 'Everyone',
        capabilityId,
        controlMode: capability.controlMode,
        scopeType: 'Tenant',
        scopeId: 'tenant',
        scopeName: 'Tenant',
        status: 'granted',
        path: [
          {
            kind: 'tenant-setting',
            label: `tenant setting "${gate.settingName}" is enabled for the whole organisation`,
          },
        ],
      });
      continue;
    }

    for (const groupId of gate.allowedGroupIds) {
      const group = snapshot.groups.find((g) => g.group_id === groupId);
      const groupName = group?.display_name || groupId;
      // Holder-level: the group named on the tenant setting. Its members are
      // resolved per query (PLAN.md D38).
      grants.push({
        principalId: groupId,
        principalName: groupName,
        principalType: 'Group',
        capabilityId,
        controlMode: capability.controlMode,
        scopeType: 'Tenant',
        scopeId: 'tenant',
        scopeName: 'Tenant',
        status: 'granted',
        path: [
          {
            kind: 'tenant-setting',
            label: `tenant setting "${gate.settingName}" is scoped to "${groupName}"`,
          },
        ],
      });
    }
  }

  return grants;
}

// ── Power Platform rules ─────────────────────────────────────────────────────

/** Dataverse privileges that constitute each Power Platform capability. */
const DATAVERSE_CAPABILITY_TABLES: Record<string, string[]> = {
  'create:CopilotStudioAgent': ['bot'],
};

/** Roles that carry maker rights by name, per Microsoft's role matrix. */
const MAKER_ROLES = new Set(['Environment Maker', 'System Customizer', 'System Administrator']);

function roleGrantsCapability(
  capabilityId: string,
  role: Row,
  privileges: Row[]
): { grants: boolean; step?: DerivationStep; unknown?: string } {
  const tables = DATAVERSE_CAPABILITY_TABLES[capabilityId];

  if (tables) {
    const rolePrivileges = privileges.filter((p) => p.role_id === role.role_id);
    if (rolePrivileges.length === 0) {
      return {
        grants: false,
        unknown: `privileges for role "${role.role_name}" were not collected`,
      };
    }
    const match = rolePrivileges.find(
      (p) => tables.includes(p.table_logical_name) && p.privilege === 'Create'
    );
    if (!match) return { grants: false };
    return {
      grants: true,
      step: {
        kind: 'dataverse-privilege',
        label: `role "${role.role_name}" has Create on ${match.table_logical_name} (${match.depth})`,
      },
    };
  }

  // Canvas apps and flows: only the predefined maker roles work. Custom
  // security roles are NOT supported for canvas-app maker scenarios.
  if (MAKER_ROLES.has(role.role_name)) {
    return {
      grants: true,
      step: { kind: 'dataverse-role', label: `role "${role.role_name}"` },
    };
  }
  return { grants: false };
}

function powerPlatformGrants(snapshot: GovernanceSnapshot): EffectiveGrant[] {
  const grants: EffectiveGrant[] = [];
  const capabilityIds = ['create:CanvasApp', 'create:ModelDrivenApp', 'create:Flow', 'create:CopilotStudioAgent'];

  for (const environment of snapshot.environments) {
    const envId = environment.environment_id;
    const envName = environment.environment_name || envId;
    const isDefault = environment.environment_type === 'Default';
    const envRoles = snapshot.ppRoles.filter((r) => r.environment_id === envId);
    const envPrivileges = snapshot.ppPrivileges.filter((p) => p.environment_id === envId);
    const envAssignments = snapshot.ppAssignments.filter((a) => a.environment_id === envId);

    for (const capabilityId of capabilityIds) {
      const capability = CAPABILITY_BY_ID.get(capabilityId);
      if (!capability) continue;

      /**
       * The Default environment is the finding.
       *
       * `Basic User` and `Environment Maker` are auto-assigned to every user
       * added to Dataverse there, and that **survives the licence-assignment
       * opt-out**. There is no supported way to remove Environment Maker in
       * Default — so this is a structural grant to the whole tenant, and the
       * app must say so plainly rather than listing individual assignees.
       */
      if (isDefault) {
        const makerRole = envRoles.find((r) => r.role_name === 'Environment Maker');
        const check = makerRole
          ? roleGrantsCapability(capabilityId, makerRole, envPrivileges)
          : { grants: false, unknown: 'Environment Maker role was not collected' };

        if (check.grants || !DATAVERSE_CAPABILITY_TABLES[capabilityId]) {
          grants.push({
            principalId: EVERYONE_PRINCIPAL_ID,
            principalName: 'Everyone',
            principalType: 'Everyone',
            capabilityId,
            controlMode: capability.controlMode,
            scopeType: 'Environment',
            scopeId: envId,
            scopeName: envName,
            status: 'granted',
            path: [
              {
                kind: 'auto-assignment',
                label: `Default environment "${envName}" — Environment Maker is auto-assigned to every user and cannot be removed`,
              },
              ...(check.step ? [check.step] : []),
            ],
          });
          continue;
        }
        if (check.unknown) {
          grants.push(
            unknownGrant(capability, 'Environment', envId, envName, check.unknown)
          );
          continue;
        }
      }

      for (const role of envRoles) {
        const check = roleGrantsCapability(capabilityId, role, envPrivileges);
        if (check.unknown && !isDefault) {
          grants.push(unknownGrant(capability, 'Environment', envId, envName, check.unknown));
          continue;
        }
        if (!check.grants) continue;

        for (const assignment of envAssignments.filter((a) => a.role_id === role.role_id)) {
          // A group team is the good case: the entitlement compiles onto an
          // Entra group instead of a person. Holder-level either way — members
          // are resolved per query (PLAN.md D38).
          const isTeam = assignment.principal_type === 'Team' && assignment.azure_group_id;
          const principal = isTeam
            ? {
                id: assignment.azure_group_id,
                name: assignment.principal_name || assignment.azure_group_id,
                type: 'Group',
              }
            : {
                id: assignment.principal_id,
                name: assignment.principal_name || assignment.principal_id,
                type: assignment.principal_type || 'User',
              };

          {
            grants.push({
              principalId: principal.id,
              principalName: principal.name,
              principalType: principal.type,
              capabilityId,
              controlMode: capability.controlMode,
              scopeType: 'Environment',
              scopeId: envId,
              scopeName: envName,
              status: 'granted',
              path: [
                { kind: 'environment', label: `environment "${envName}"` },
                { kind: 'dataverse-role', label: `role "${role.role_name}"` },
                ...(check.step ? [check.step] : []),
              ],
            });
          }
        }
      }
    }
  }

  return grants;
}

// ── Agent rules ──────────────────────────────────────────────────────────────

function unknownGrant(
  capability: CapabilityDef,
  scopeType: ScopeType,
  scopeId: string,
  scopeName: string,
  detail: string
): EffectiveGrant {
  return {
    principalId: EVERYONE_PRINCIPAL_ID,
    principalName: 'Unknown',
    principalType: 'Unknown',
    capabilityId: capability.id,
    controlMode: capability.controlMode,
    scopeType,
    scopeId,
    scopeName,
    status: 'unknown',
    statusDetail: detail,
    path: [{ kind: 'not-collectable', label: detail }],
  };
}

function agentGrants(): EffectiveGrant[] {
  const capability = CAPABILITY_BY_ID.get('create:M365DeclarativeAgent');
  if (!capability) return [];
  // Admin-center only, no documented API. Reporting nothing would read as
  // "nobody can", which is the opposite of the truth in most tenants.
  return [
    unknownGrant(
      capability,
      'Tenant',
      'tenant',
      'Tenant',
      'Microsoft 365 Copilot agent access is admin-center only — no API exists to read who is allowed'
    ),
  ];
}

// ── Entry point ──────────────────────────────────────────────────────────────

// ── Query-time expansion (PLAN.md D38) ───────────────────────────────────────

/**
 * Principal → the groups it is an effective member of. The reverse of
 * `memberIndex`, memoised the same way.
 */
const GROUPS_OF_INDEX = new WeakMap<GovernanceSnapshot, Map<string, Row[]>>();

function groupsOfIndex(snapshot: GovernanceSnapshot): Map<string, Row[]> {
  const cached = GROUPS_OF_INDEX.get(snapshot);
  if (cached) return cached;

  const index = new Map<string, Row[]>();
  for (const member of snapshot.groupMembers) {
    if (member.principal_type === 'Group') continue;
    const bucket = index.get(member.principal_id);
    if (bucket) bucket.push(member);
    else index.set(member.principal_id, [member]);
  }
  GROUPS_OF_INDEX.set(snapshot, index);
  return index;
}

function membershipStep(member: Row, groupName: string): DerivationStep {
  return {
    kind: 'group-member',
    label:
      member.is_transitive === 'true'
        ? `member of "${groupName}" (nested, depth ${member.depth || '?'})`
        : `member of "${groupName}"`,
  };
}

/** Re-check a grant's tenant gate for one specific principal. */
function applyGate(
  grant: EffectiveGrant,
  principalId: string,
  snapshot: GovernanceSnapshot
): Pick<EffectiveGrant, 'status' | 'statusDetail'> {
  if (!grant.gate || grant.status !== 'granted') {
    return { status: grant.status, statusDetail: grant.statusDetail };
  }
  const allowed = membersOfGroups(grant.gate.allowedGroupIds, snapshot);
  if (allowed.has(principalId)) return { status: 'granted' };
  return {
    status: 'blocked',
    statusDetail: `tenant setting "${grant.gate.settingName}" is limited to security groups this principal is not in`,
  };
}

/**
 * Every grant that applies to one principal — held directly, inherited through
 * a group, or granted to everyone.
 *
 * This is the replacement for materialising a row per person per capability per
 * scope. At 50k principals that produced 2.1 million objects; this produces
 * only what the question asked for.
 */
export function grantsForPrincipal(
  grants: EffectiveGrant[],
  principalId: string,
  snapshot: GovernanceSnapshot
): EffectiveGrant[] {
  const memberships = groupsOfIndex(snapshot).get(principalId) ?? [];
  const byGroup = new Map(memberships.map((m) => [m.group_id, m]));
  const groupName = new Map(
    snapshot.groups.map((g) => [g.group_id, g.display_name || g.group_id])
  );

  const out: EffectiveGrant[] = [];
  // The same person often reaches one capability by two routes — two groups,
  // two roles. Deduplicate here, exactly as the materialised version did, or
  // the UI lists them twice and the reach counts double.
  const seen = new Set<string>();
  const keep = (grant: EffectiveGrant) => {
    const key = `${grant.capabilityId}|${grant.scopeType}|${grant.scopeId}|${grant.status}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(grant);
  };

  for (const grant of grants) {
    if (grant.principalId === principalId || grant.principalId === EVERYONE_PRINCIPAL_ID) {
      keep(grant);
      continue;
    }
    const membership = byGroup.get(grant.principalId);
    if (!membership) continue;

    const name = grant.principalName || groupName.get(grant.principalId) || grant.principalId;
    keep({
      ...grant,
      principalId,
      principalName: membership.principal_name || principalId,
      principalType: membership.principal_type || 'User',
      viaGroupId: grant.principalId,
      viaGroupName: name,
      path: [membershipStep(membership, name), ...grant.path],
      ...applyGate(grant, principalId, snapshot),
    });
  }
  return out;
}

/**
 * Expand one holder grant into the people it actually covers.
 *
 * Used for the "who exactly?" drill-down, one grant at a time, so the cost is
 * bounded by that group's membership rather than by the tenant.
 */
export function expandGrant(
  grant: EffectiveGrant,
  snapshot: GovernanceSnapshot
): EffectiveGrant[] {
  if (grant.principalType !== 'Group') return [grant];

  const members = memberIndex(snapshot).get(grant.principalId) ?? [];
  return members
    // Nested groups are edges, not leaves: their members are already present as
    // transitive rows, so counting the group again would double-report.
    .filter((m) => m.principal_type !== 'Group')
    .map((m) => ({
      ...grant,
      principalId: m.principal_id,
      principalName: m.principal_name || m.principal_id,
      principalType: m.principal_type || 'User',
      viaGroupId: grant.principalId,
      viaGroupName: grant.principalName,
      path: [membershipStep(m, grant.principalName), ...grant.path],
      ...applyGate(grant, m.principal_id, snapshot),
    }));
}

/** How many individuals a holder grant reaches. A user reaches one: themselves. */
export function grantReach(grant: EffectiveGrant, snapshot: GovernanceSnapshot): number {
  if (grant.principalId === EVERYONE_PRINCIPAL_ID) return Infinity;
  if (grant.principalType !== 'Group') return 1;
  return (memberIndex(snapshot).get(grant.principalId) ?? []).filter(
    (m) => m.principal_type !== 'Group'
  ).length;
}

// ── Compute ──────────────────────────────────────────────────────────────────

export interface ComputeOptions {
  /** Only compute for these modules. Omit for all. */
  enabledModules?: string[];
}

/**
 * Compute every effective grant in the snapshot, **at holder level**.
 *
 * A grant's principal is whoever actually holds the binding — usually a group.
 * Individuals are resolved per query with `grantsForPrincipal` / `expandGrant`
 * (PLAN.md D38). Materialising a row per person per capability per scope
 * produced 2.1 million objects at 50k principals; this produces thousands.
 */

/** Compute every effective grant in the snapshot. */
export function computeEffectiveGrants(
  snapshot: GovernanceSnapshot,
  options: ComputeOptions = {}
): EffectiveGrant[] {
  const enabled = options.enabledModules;
  const include = (module: string) => !enabled || enabled.includes(module);

  const grants = [
    ...(include('fabric') ? fabricGrants(snapshot) : []),
    ...(include('pp') ? powerPlatformGrants(snapshot) : []),
    ...(include('agent') ? agentGrants() : []),
  ];

  // Deduplicate: the same person can reach one capability by several routes
  // (two groups, two roles). Keep the first path but remember there were more.
  const seen = new Map<string, EffectiveGrant>();
  for (const grant of grants) {
    const key = `${grant.principalId}|${grant.capabilityId}|${grant.scopeType}|${grant.scopeId}|${grant.status}`;
    if (!seen.has(key)) seen.set(key, grant);
  }
  return [...seen.values()];
}

// ── Query helpers (the two directions) ───────────────────────────────────────

/** *"Who can create X?"* — capability → principals. */
export function whoCan(
  grants: EffectiveGrant[],
  capabilityId: string,
  options: { includeBlocked?: boolean } = {}
): EffectiveGrant[] {
  return grants
    .filter((g) => g.capabilityId === capabilityId)
    .filter((g) => options.includeBlocked || g.status !== 'blocked')
    .sort((a, b) => a.principalName.localeCompare(b.principalName));
}

/**
 * *"What can this person create?"* — principal → capabilities.
 *
 * Requires the snapshot: grants are held at holder level, so answering for a
 * person means resolving their group memberships. Making the snapshot optional
 * would let a caller silently get an empty answer for somebody who *does* have
 * access — under-reporting, which is the dangerous direction.
 */
export function whatCan(
  grants: EffectiveGrant[],
  principalId: string,
  snapshot: GovernanceSnapshot,
  options: { includeBlocked?: boolean } = {}
): EffectiveGrant[] {
  return grantsForPrincipal(grants, principalId, snapshot)
    .filter((g) => options.includeBlocked || g.status !== 'blocked')
    .sort((a, b) => a.capabilityId.localeCompare(b.capabilityId));
}

export interface PrincipalSummary {
  id: string;
  name: string;
  type: string;
  capabilityCount: number;
}

/**
 * Distinct principals appearing in the grants, for the search box.
 *
 * Holders *and* the people inside them: a picker that only listed groups would
 * make "what can Marcel do?" unanswerable.
 */
export function listPrincipals(
  grants: EffectiveGrant[],
  snapshot: GovernanceSnapshot
): PrincipalSummary[] {
  const byId = new Map<string, PrincipalSummary>();

  const add = (id: string, name: string, type: string) => {
    const existing = byId.get(id);
    if (existing) existing.capabilityCount += 1;
    else byId.set(id, { id, name, type, capabilityCount: 1 });
  };

  const index = memberIndex(snapshot);
  for (const grant of grants) {
    if (grant.status === 'blocked') continue;
    add(grant.principalId, grant.principalName, grant.principalType);
    if (grant.principalType !== 'Group') continue;
    for (const member of index.get(grant.principalId) ?? []) {
      if (member.principal_type === 'Group') continue;
      add(
        member.principal_id,
        member.principal_name || member.principal_id,
        member.principal_type || 'User'
      );
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Count of distinct **people** per capability, for the summary view.
 *
 * Counting holders would report "3 principals can create agents" when those
 * three are groups covering half the organisation.
 */
export function capabilityReach(
  grants: EffectiveGrant[],
  snapshot: GovernanceSnapshot
): { capabilityId: string; principals: number; everyone: boolean; unknown: boolean }[] {
  const byCapability = new Map<
    string,
    { principals: Set<string>; everyone: boolean; unknown: boolean }
  >();

  const index = memberIndex(snapshot);
  for (const grant of grants) {
    if (grant.status === 'blocked') continue;
    const entry =
      byCapability.get(grant.capabilityId) ??
      { principals: new Set<string>(), everyone: false, unknown: false };
    if (grant.status === 'unknown') {
      entry.unknown = true;
    } else if (grant.principalId === EVERYONE_PRINCIPAL_ID) {
      entry.everyone = true;
    } else {
      entry.principals.add(grant.principalId);
      if (grant.principalType === 'Group') {
        for (const member of index.get(grant.principalId) ?? []) {
          if (member.principal_type !== 'Group') entry.principals.add(member.principal_id);
        }
      }
    }
    byCapability.set(grant.capabilityId, entry);
  }

  return [...byCapability.entries()]
    .map(([capabilityId, entry]) => ({
      capabilityId,
      principals: entry.principals.size,
      everyone: entry.everyone,
      unknown: entry.unknown,
    }))
    .sort((a, b) => a.capabilityId.localeCompare(b.capabilityId));
}
