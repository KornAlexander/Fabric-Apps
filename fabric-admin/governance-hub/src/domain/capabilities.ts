/**
 * The capability catalogue and binding recipes (PLAN.md §11.1).
 *
 * **Why this is code and not customer data.** Capabilities and recipes encode
 * *Microsoft's documented behaviour* — which control actually gates creating a
 * Copilot Studio agent, and what that compiles down to in Dataverse. That
 * changes when the platform changes, not when a customer reorganises. Personas
 * are the opposite: they encode the customer's org, so they live in the store
 * and are fully editable (`domain/personas.ts`).
 *
 * Getting this split wrong in either direction is expensive: customer-editable
 * recipes would let someone "fix" a documented impossibility, and hard-coded
 * personas would make the tool useless outside my own tenant.
 */
import type { TranslationKey } from '@/i18n';
import { allBindingKinds } from '@/modules';
import type { ModuleId } from '@/modules/types';

/** Where an entitlement can be scoped. */
export const SCOPE_TYPES = [
  'Tenant',
  'Capacity',
  'Workspace',
  'Environment',
  'Audience',
] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

/** Capabilities that are internal to this app rather than to a control plane. */
export const CORE_MODULE = 'core' as const;
export type CapabilityModule = ModuleId | typeof CORE_MODULE;

/** Binding emitted for app-internal capabilities. Writes nothing to a plane. */
export const APP_ROLE_BINDING = 'app_role';

export type ControlMode = 'preventive-auto' | 'preventive-manual' | 'detective';

export interface CapabilityDef {
  id: string;
  module: CapabilityModule;
  /** The artifact this is the right to create/manage. */
  artifactType: string;
  controlMode: ControlMode;
  /** Scopes this capability can meaningfully be granted at. */
  scopeTypes: ScopeType[];
  descriptionKey: TranslationKey;
}

export interface BindingRecipe {
  capabilityId: string;
  scopeType: ScopeType;
  bindingKind: string;
  /** Module that owns the binding kind — if it is off, this recipe is dark. */
  requiresModule: CapabilityModule;
  /** True when the binding is written per person; false when it is per scope. */
  isPerUser: boolean;
  roleValue?: string;
  /** Non-localised engineering note, shown to platform admins. */
  note: string;
}

// ── Capabilities ─────────────────────────────────────────────────────────────

export const CAPABILITIES: CapabilityDef[] = [
  // M-FABRIC
  {
    id: 'read:Report',
    module: 'fabric',
    artifactType: 'PowerBIReport',
    controlMode: 'preventive-auto',
    scopeTypes: ['Workspace', 'Audience'],
    descriptionKey: 'cap.read:Report',
  },
  {
    id: 'create:PowerBIReport',
    module: 'fabric',
    artifactType: 'PowerBIReport',
    controlMode: 'preventive-auto',
    scopeTypes: ['Workspace'],
    descriptionKey: 'cap.create:PowerBIReport',
  },
  {
    id: 'create:SemanticModel',
    module: 'fabric',
    artifactType: 'SemanticModel',
    controlMode: 'preventive-auto',
    scopeTypes: ['Workspace'],
    descriptionKey: 'cap.create:SemanticModel',
  },
  {
    id: 'create:FabricItem',
    module: 'fabric',
    artifactType: 'FabricItem',
    controlMode: 'preventive-auto',
    scopeTypes: ['Workspace', 'Tenant', 'Capacity'],
    descriptionKey: 'cap.create:FabricItem',
  },
  {
    id: 'create:FabricDataAgent',
    module: 'fabric',
    artifactType: 'FabricDataAgent',
    controlMode: 'preventive-auto',
    scopeTypes: ['Workspace', 'Capacity'],
    descriptionKey: 'cap.create:FabricDataAgent',
  },
  {
    id: 'create:FabricApp',
    module: 'fabric',
    artifactType: 'FabricApp',
    controlMode: 'preventive-auto',
    scopeTypes: ['Workspace', 'Tenant'],
    descriptionKey: 'cap.create:FabricApp',
  },
  {
    id: 'create:Workspace',
    module: 'fabric',
    artifactType: 'Workspace',
    controlMode: 'preventive-auto',
    scopeTypes: ['Tenant'],
    descriptionKey: 'cap.create:Workspace',
  },
  {
    id: 'create:OrgApp',
    module: 'fabric',
    artifactType: 'OrgApp',
    controlMode: 'preventive-auto',
    scopeTypes: ['Workspace', 'Tenant'],
    descriptionKey: 'cap.create:OrgApp',
  },
  {
    id: 'manage:OrgAppAudience',
    module: 'fabric',
    artifactType: 'OrgAppAudience',
    // No public API for audience membership — guided task, then verify.
    controlMode: 'preventive-manual',
    scopeTypes: ['Audience'],
    descriptionKey: 'cap.manage:OrgAppAudience',
  },

  // M-PP
  {
    id: 'create:CanvasApp',
    module: 'pp',
    artifactType: 'PowerApp',
    controlMode: 'preventive-auto',
    scopeTypes: ['Environment'],
    descriptionKey: 'cap.create:CanvasApp',
  },
  {
    id: 'create:ModelDrivenApp',
    module: 'pp',
    artifactType: 'PowerApp',
    controlMode: 'preventive-auto',
    scopeTypes: ['Environment'],
    descriptionKey: 'cap.create:ModelDrivenApp',
  },
  {
    id: 'create:Flow',
    module: 'pp',
    artifactType: 'Flow',
    controlMode: 'preventive-auto',
    scopeTypes: ['Environment'],
    descriptionKey: 'cap.create:Flow',
  },
  {
    id: 'create:CopilotStudioAgent',
    module: 'pp',
    artifactType: 'CopilotStudioAgent',
    // Per environment this is genuinely preventive via `bot` privileges.
    // Tenant-wide it is not: agent creation cannot be disabled.
    controlMode: 'preventive-auto',
    scopeTypes: ['Environment'],
    descriptionKey: 'cap.create:CopilotStudioAgent',
  },

  // M-AGENT
  {
    id: 'create:M365DeclarativeAgent',
    module: 'agent',
    artifactType: 'M365DeclarativeAgent',
    // Admin-center only, no documented API.
    controlMode: 'preventive-manual',
    scopeTypes: ['Tenant'],
    descriptionKey: 'cap.create:M365DeclarativeAgent',
  },
  {
    id: 'manage:AgentBlueprint',
    module: 'agent',
    artifactType: 'AgentBlueprint',
    controlMode: 'preventive-auto',
    scopeTypes: ['Tenant'],
    descriptionKey: 'cap.manage:AgentBlueprint',
  },

  // Core — app-internal roles, no plane binding.
  {
    id: 'app:Approve',
    module: CORE_MODULE,
    artifactType: 'Request',
    controlMode: 'preventive-auto',
    scopeTypes: ['Tenant', 'Workspace', 'Environment'],
    descriptionKey: 'cap.app:Approve',
  },
  {
    id: 'app:Administer',
    module: CORE_MODULE,
    artifactType: 'Platform',
    controlMode: 'preventive-auto',
    scopeTypes: ['Tenant'],
    descriptionKey: 'cap.app:Administer',
  },
  {
    id: 'app:Audit',
    module: CORE_MODULE,
    artifactType: 'Platform',
    controlMode: 'preventive-auto',
    scopeTypes: ['Tenant'],
    descriptionKey: 'cap.app:Audit',
  },
];

export const CAPABILITY_BY_ID = new Map(CAPABILITIES.map((c) => [c.id, c]));

export function getCapability(id: string): CapabilityDef | undefined {
  return CAPABILITY_BY_ID.get(id);
}

// ── Binding recipes ──────────────────────────────────────────────────────────

/**
 * How each capability compiles into a control plane.
 *
 * **Group-first.** Almost every recipe resolves to `entra_group_member` plus a
 * per-scope wiring binding. That keeps the per-user write path to a single Graph
 * call, makes revocation instant, and means the system degrades gracefully when
 * a plane's API is unavailable.
 */
function fabricWorkspace(capabilityId: string, role: string): BindingRecipe[] {
  return [
    {
      capabilityId,
      scopeType: 'Workspace',
      bindingKind: 'entra_group_member',
      requiresModule: 'entra',
      isPerUser: true,
      note: 'Add the principal to the governance group backing this workspace role.',
    },
    {
      capabilityId,
      scopeType: 'Workspace',
      bindingKind: 'fabric_workspace_role',
      requiresModule: 'fabric',
      isPerUser: false,
      roleValue: role,
      note: `Assign the governance group ${role} on the workspace. Set once per scope.`,
    },
  ];
}

function tenantSetting(capabilityId: string, note: string): BindingRecipe[] {
  return [
    {
      capabilityId,
      scopeType: 'Tenant',
      bindingKind: 'entra_group_member',
      requiresModule: 'entra',
      isPerUser: true,
      note: 'Add the principal to the security group named on the tenant setting.',
    },
    {
      capabilityId,
      scopeType: 'Tenant',
      bindingKind: 'fabric_tenant_setting',
      requiresModule: 'fabric',
      isPerUser: false,
      note,
    },
  ];
}

function dataverseRole(capabilityId: string, note: string): BindingRecipe[] {
  return [
    {
      capabilityId,
      scopeType: 'Environment',
      bindingKind: 'entra_group_member',
      requiresModule: 'entra',
      isPerUser: true,
      note: 'Add the principal to the governance group backing the Dataverse group team.',
    },
    {
      capabilityId,
      scopeType: 'Environment',
      bindingKind: 'pp_env_security_group',
      requiresModule: 'pp',
      isPerUser: false,
      note: 'Bind the environment to the governance group. NOT possible for Default or Developer environments.',
    },
    {
      capabilityId,
      scopeType: 'Environment',
      bindingKind: 'pp_dataverse_role',
      requiresModule: 'pp',
      isPerUser: false,
      note,
    },
  ];
}

function appRole(capabilityId: string, scopeTypes: ScopeType[]): BindingRecipe[] {
  return scopeTypes.map((scopeType) => ({
    capabilityId,
    scopeType,
    bindingKind: APP_ROLE_BINDING,
    requiresModule: CORE_MODULE,
    isPerUser: true,
    note: 'Internal to the Governance Hub. Writes nothing to a control plane.',
  }));
}

export const BINDING_RECIPES: BindingRecipe[] = [
  // ── read ──
  ...fabricWorkspace('read:Report', 'Viewer'),
  {
    capabilityId: 'read:Report',
    scopeType: 'Audience',
    bindingKind: 'orgapp_audience_member',
    requiresModule: 'fabric',
    isPerUser: true,
    note: 'Org App audience membership has no public API — raised as a guided task, then verified.',
  },

  // ── Fabric creation ──
  // Fabric has no per-item-type workspace role, so reports, models and generic
  // items all compile to the same Contributor binding. That is not a modelling
  // shortcut: it is the documented gap, and the UI must not imply otherwise.
  ...fabricWorkspace('create:PowerBIReport', 'Contributor'),
  ...fabricWorkspace('create:SemanticModel', 'Contributor'),
  ...fabricWorkspace('create:FabricItem', 'Contributor'),
  ...tenantSetting(
    'create:FabricItem',
    'Scope "Users can create Fabric items" to the governance group.'
  ),
  {
    capabilityId: 'create:FabricItem',
    scopeType: 'Capacity',
    bindingKind: 'fabric_capacity_override',
    requiresModule: 'fabric',
    isPerUser: false,
    note: 'Capacity-level override of the Fabric-items tenant setting.',
  },

  ...fabricWorkspace('create:FabricDataAgent', 'Contributor'),
  {
    capabilityId: 'create:FabricDataAgent',
    scopeType: 'Capacity',
    bindingKind: 'fabric_capacity_override',
    requiresModule: 'fabric',
    isPerUser: false,
    note: 'No dedicated create switch exists; gated via the Copilot/Azure OpenAI capacity setting.',
  },

  ...fabricWorkspace('create:FabricApp', 'Contributor'),
  ...tenantSetting(
    'create:FabricApp',
    'Scope "Enable Fabric App Items (preview)" to the governance group.'
  ),

  ...tenantSetting(
    'create:Workspace',
    'Scope "Create workspaces" to the governance group.'
  ),

  ...fabricWorkspace('create:OrgApp', 'Member'),
  ...tenantSetting(
    'create:OrgApp',
    'Scope "Users can discover and create org apps (preview)" to the governance group.'
  ),

  {
    capabilityId: 'manage:OrgAppAudience',
    scopeType: 'Audience',
    bindingKind: 'orgapp_audience_member',
    requiresModule: 'fabric',
    isPerUser: true,
    note: 'Portal-only. The app raises a deep-linked task and verifies afterwards.',
  },

  // ── Power Platform ──
  ...dataverseRole(
    'create:CanvasApp',
    'Environment Maker via a group team. Custom roles are NOT supported for canvas-app maker scenarios, so this is the only supported lever.'
  ),
  ...dataverseRole(
    'create:ModelDrivenApp',
    'System Customizer or Environment Maker via a group team.'
  ),
  ...dataverseRole('create:Flow', 'Environment Maker via a group team.'),
  ...dataverseRole(
    'create:CopilotStudioAgent',
    'Custom role with Create/Write on bot and botcomponent, assigned to a group team. This IS supported, unlike the canvas-app case.'
  ),

  // ── Agents ──
  {
    capabilityId: 'create:M365DeclarativeAgent',
    scopeType: 'Tenant',
    bindingKind: 'm365_agent_access',
    requiresModule: 'agent',
    isPerUser: true,
    note: 'Agents → Settings → User access = Specific users or groups. Admin-center only.',
  },
  {
    capabilityId: 'manage:AgentBlueprint',
    scopeType: 'Tenant',
    bindingKind: 'entra_group_member',
    requiresModule: 'entra',
    isPerUser: true,
    note: 'Add the principal to the governance group that holds the Agent ID Developer/Administrator role. Without this the persona grants nothing to a person.',
  },
  {
    capabilityId: 'manage:AgentBlueprint',
    scopeType: 'Tenant',
    bindingKind: 'agent_blueprint_membership',
    requiresModule: 'agent',
    isPerUser: false,
    note: 'Class-level control: Conditional Access and capped permissions inherited by every instance.',
  },

  // ── Core ──
  ...appRole('app:Approve', ['Tenant', 'Workspace', 'Environment']),
  ...appRole('app:Administer', ['Tenant']),
  ...appRole('app:Audit', ['Tenant']),
];

export function recipesFor(capabilityId: string, scopeType?: ScopeType): BindingRecipe[] {
  return BINDING_RECIPES.filter(
    (r) => r.capabilityId === capabilityId && (!scopeType || r.scopeType === scopeType)
  );
}

/** Binding kinds the modules actually implement, plus the app-internal one. */
export function knownBindingKinds(
  env?: Readonly<Record<string, string | undefined>>
): Set<string> {
  const kinds = new Set(allBindingKinds(env).map((k) => k.id));
  kinds.add(APP_ROLE_BINDING);
  return kinds;
}
