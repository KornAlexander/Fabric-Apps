/**
 * Personas — the customer's role model (PLAN.md §11.1, decision D28).
 *
 * Unlike capabilities and recipes, personas are **customer data**: "Report
 * Author" means something different in every organisation, and a tool that
 * hard-codes them is only useful in the tenant it was written for.
 *
 * So the 14 personas below are a **seed**, not a fixture. They are merged with
 * stored overrides at read time: a customer can rename them, change their
 * capability set, deactivate them, or add their own — and can always reset a
 * seeded persona back to what shipped.
 *
 * Names and descriptions are deliberately **not translated**. They are data the
 * customer edits, and a half-translated persona list is worse than an English
 * one everybody agrees to rename.
 */
import type { ModuleId } from '@/modules/types';

import {
  CAPABILITY_BY_ID,
  CORE_MODULE,
  knownBindingKinds,
  recipesFor,
  type BindingRecipe,
  type CapabilityModule,
  type ScopeType,
} from './capabilities';

/** Drives approval requirements later (two-person rule for Critical). */
export const RISK_TIERS = ['Low', 'Medium', 'High', 'Critical'] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

export interface Persona {
  id: string;
  name: string;
  description: string;
  riskTier: RiskTier;
  capabilityIds: string[];
  isActive: boolean;
  /** True for personas that shipped with the product and can be reset. */
  isSeed: boolean;
}

export const SEED_PERSONAS: Persona[] = [
  {
    id: 'consumer',
    name: 'Consumer',
    description: 'Reads reports and org apps. Creates nothing.',
    riskTier: 'Low',
    capabilityIds: ['read:Report'],
    isActive: true,
    isSeed: true,
  },
  {
    id: 'report-author',
    name: 'Report Author',
    description:
      'Builds Power BI reports and semantic models in assigned workspaces. Note: Fabric cannot separate these two rights.',
    riskTier: 'Medium',
    capabilityIds: ['read:Report', 'create:PowerBIReport', 'create:SemanticModel'],
    isActive: true,
    isSeed: true,
  },
  {
    id: 'fabric-engineer',
    name: 'Fabric Engineer',
    description: 'Builds lakehouses, notebooks and pipelines in assigned workspaces.',
    riskTier: 'Medium',
    capabilityIds: ['read:Report', 'create:FabricItem', 'create:SemanticModel'],
    isActive: true,
    isSeed: true,
  },
  {
    id: 'data-agent-author',
    name: 'Data Agent Author',
    description: 'Creates Fabric data agents. Requires a Copilot-enabled capacity.',
    riskTier: 'High',
    capabilityIds: ['read:Report', 'create:FabricDataAgent'],
    isActive: true,
    isSeed: true,
  },
  {
    id: 'fabric-app-author',
    name: 'Fabric App Author',
    description: 'Creates Fabric App items in assigned workspaces.',
    riskTier: 'Medium',
    capabilityIds: ['create:FabricApp', 'create:FabricItem'],
    isActive: true,
    isSeed: true,
  },
  {
    id: 'workspace-creator',
    name: 'Workspace Creator',
    description: 'May create Fabric workspaces. Tenant-scoped.',
    riskTier: 'High',
    capabilityIds: ['create:Workspace'],
    isActive: true,
    isSeed: true,
  },
  {
    id: 'org-app-publisher',
    name: 'Org App Publisher',
    description:
      'Creates org apps and manages their audiences. Audience membership is portal-only.',
    riskTier: 'High',
    capabilityIds: ['create:OrgApp', 'manage:OrgAppAudience', 'read:Report'],
    isActive: true,
    isSeed: true,
  },
  {
    id: 'pp-maker-personal',
    name: 'Maker (personal)',
    description: 'Builds apps and flows in their own developer environment only.',
    riskTier: 'Low',
    capabilityIds: ['create:CanvasApp', 'create:Flow'],
    isActive: true,
    isSeed: true,
  },
  {
    id: 'pp-maker-team',
    name: 'Maker (team)',
    description: 'Builds solution-aware apps and flows in a shared team environment.',
    riskTier: 'Medium',
    capabilityIds: ['create:CanvasApp', 'create:ModelDrivenApp', 'create:Flow'],
    isActive: true,
    isSeed: true,
  },
  {
    id: 'cs-agent-author',
    name: 'Copilot Studio Agent Author',
    description:
      'Authors Copilot Studio agents in a named environment via bot table privileges.',
    riskTier: 'High',
    capabilityIds: ['create:CopilotStudioAgent', 'create:Flow'],
    isActive: true,
    isSeed: true,
  },
  {
    id: 'm365-agent-author',
    name: 'M365 Agent Author',
    description:
      'Builds declarative agents in Microsoft 365 Copilot. Admin-center controlled.',
    riskTier: 'High',
    capabilityIds: ['create:M365DeclarativeAgent'],
    isActive: true,
    isSeed: true,
  },
  {
    id: 'agent-platform-owner',
    name: 'Agent Platform Owner',
    description:
      'Owns agent identity blueprints — the one preventive, class-level agent control.',
    riskTier: 'Critical',
    capabilityIds: ['manage:AgentBlueprint'],
    isActive: true,
    isSeed: true,
  },
  {
    id: 'approver',
    name: 'Approver',
    description: 'Approves access requests for the scopes they own.',
    riskTier: 'High',
    capabilityIds: ['app:Approve'],
    isActive: true,
    isSeed: true,
  },
  {
    id: 'platform-admin',
    name: 'Platform Admin',
    description: 'Manages personas, recipes, modules and write gates.',
    riskTier: 'Critical',
    capabilityIds: ['app:Administer', 'app:Approve', 'app:Audit'],
    isActive: true,
    isSeed: true,
  },
  {
    id: 'auditor',
    name: 'Auditor',
    description: 'Read-only across everything, including the audit trail.',
    riskTier: 'Low',
    capabilityIds: ['app:Audit', 'read:Report'],
    isActive: true,
    isSeed: true,
  },
];

/** A stored override of a seeded persona, or an entirely custom one. */
export interface PersonaOverride {
  id: string;
  name?: string;
  description?: string;
  riskTier?: RiskTier;
  capabilityIds?: string[];
  isActive?: boolean;
  /** True when the row defines a persona that is not in the seed. */
  isCustom?: boolean;
}

/**
 * Seed ∪ stored overrides.
 *
 * A stored row wins field by field, so a customer who only renamed a persona
 * still picks up capability corrections when the product updates.
 */
export function mergePersonas(overrides: PersonaOverride[]): Persona[] {
  const byId = new Map(SEED_PERSONAS.map((p) => [p.id, { ...p }]));

  for (const override of overrides) {
    const existing = byId.get(override.id);
    if (existing) {
      byId.set(override.id, {
        ...existing,
        name: override.name ?? existing.name,
        description: override.description ?? existing.description,
        riskTier: override.riskTier ?? existing.riskTier,
        capabilityIds: override.capabilityIds ?? existing.capabilityIds,
        isActive: override.isActive ?? existing.isActive,
      });
    } else {
      byId.set(override.id, {
        id: override.id,
        name: override.name ?? override.id,
        description: override.description ?? '',
        riskTier: override.riskTier ?? 'Medium',
        capabilityIds: override.capabilityIds ?? [],
        isActive: override.isActive ?? true,
        isSeed: false,
      });
    }
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ── Compilation ──────────────────────────────────────────────────────────────

export interface CompiledBinding {
  capabilityId: string;
  scopeType: ScopeType;
  bindingKind: string;
  requiresModule: CapabilityModule;
  isPerUser: boolean;
  roleValue?: string;
  note: string;
  /** False when the owning module is off — the binding is dark, not broken. */
  moduleEnabled: boolean;
}

export type CompileIssueCode =
  | 'unknown-capability'
  | 'no-recipe'
  | 'unknown-binding-kind'
  | 'scope-not-supported';

export interface CompileIssue {
  code: CompileIssueCode;
  capabilityId: string;
  scopeType?: ScopeType;
  detail: string;
}

export interface CompileResult {
  bindings: CompiledBinding[];
  issues: CompileIssue[];
  /** Capabilities that are dark because their module is switched off. */
  darkCapabilityIds: string[];
  ok: boolean;
}

export interface CompileOptions {
  /** Modules currently enabled. Omit to treat every module as enabled. */
  enabledModules?: (ModuleId | typeof CORE_MODULE)[];
  /** Restrict to one scope type; otherwise every scope the capability supports. */
  scopeType?: ScopeType;
  env?: Readonly<Record<string, string | undefined>>;
}

function isModuleEnabled(
  module: CapabilityModule,
  enabled: CompileOptions['enabledModules']
): boolean {
  // Core capabilities are internal to the app and are never switched off.
  if (module === CORE_MODULE) return true;
  if (!enabled) return true;
  return enabled.includes(module);
}

/**
 * Compile a persona into the bindings it would emit.
 *
 * A **missing recipe is an error** — it means the model promises a right the
 * product cannot deliver, which is exactly the overclaiming this tool exists to
 * avoid. A **disabled module is not**: the binding is reported as dark so the UI
 * can strike it through and say why.
 */
export function compilePersona(
  persona: Persona,
  options: CompileOptions = {}
): CompileResult {
  const bindings: CompiledBinding[] = [];
  const issues: CompileIssue[] = [];
  const dark = new Set<string>();
  const validKinds = knownBindingKinds(options.env);

  for (const capabilityId of persona.capabilityIds) {
    const capability = CAPABILITY_BY_ID.get(capabilityId);
    if (!capability) {
      issues.push({
        code: 'unknown-capability',
        capabilityId,
        detail: `no capability definition for ${capabilityId}`,
      });
      continue;
    }

    const scopes = options.scopeType
      ? capability.scopeTypes.filter((s) => s === options.scopeType)
      : capability.scopeTypes;

    if (options.scopeType && scopes.length === 0) {
      issues.push({
        code: 'scope-not-supported',
        capabilityId,
        scopeType: options.scopeType,
        detail: `${capabilityId} cannot be scoped to ${options.scopeType}`,
      });
      continue;
    }

    const moduleEnabled = isModuleEnabled(capability.module, options.enabledModules);
    if (!moduleEnabled) dark.add(capabilityId);

    for (const scopeType of scopes) {
      const recipes: BindingRecipe[] = recipesFor(capabilityId, scopeType);
      if (recipes.length === 0) {
        issues.push({
          code: 'no-recipe',
          capabilityId,
          scopeType,
          detail: `no binding recipe for ${capabilityId} at ${scopeType}`,
        });
        continue;
      }

      for (const recipe of recipes) {
        if (!validKinds.has(recipe.bindingKind)) {
          issues.push({
            code: 'unknown-binding-kind',
            capabilityId,
            scopeType,
            detail: `binding kind ${recipe.bindingKind} is not implemented by any module`,
          });
          continue;
        }
        bindings.push({
          capabilityId,
          scopeType,
          bindingKind: recipe.bindingKind,
          requiresModule: recipe.requiresModule,
          isPerUser: recipe.isPerUser,
          roleValue: recipe.roleValue,
          note: recipe.note,
          moduleEnabled:
            moduleEnabled && isModuleEnabled(recipe.requiresModule, options.enabledModules),
        });
      }
    }
  }

  return {
    bindings,
    issues,
    darkCapabilityIds: [...dark],
    ok: issues.length === 0,
  };
}

/** Compile every persona — the Phase 5 exit criterion, as a function. */
export function compileAll(
  personas: Persona[],
  options: CompileOptions = {}
): { persona: Persona; result: CompileResult }[] {
  return personas.map((persona) => ({ persona, result: compilePersona(persona, options) }));
}
