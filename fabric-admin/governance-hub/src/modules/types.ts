/**
 * The module contract (PLAN.md §8.1, §8.2, Phase 1).
 *
 * A *module* is one control plane: Fabric, Power Platform, Agents, Entra.
 * Everything that belongs to a plane — its collectors, its `gov_actual_*`
 * tables, its binding kinds, its policy rules, its actuators and its pages —
 * is owned by exactly one module and reached only through this contract.
 *
 * Two rules make the modularity real rather than cosmetic:
 *  1. **No module may import from another module.** Cross-module behaviour goes
 *     through the registry. Enforced by `src/__tests__/moduleBoundaries.test.ts`.
 *  2. **A module must be deletable as a folder.** Adding a fifth plane later
 *     (or removing one) must be a folder operation, not a refactor.
 */
import type { TranslationKey } from '@/i18n';

export const MODULE_IDS = ['fabric', 'pp', 'agent', 'entra'] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

/**
 * Reach tiers (PLAN.md §8.8). The default first-run experience is **T0** —
 * a user token, no admin consent, an honest partial view.
 */
export const REACH_TIERS = ['T0', 'T1', 'T2'] as const;
export type ReachTier = (typeof REACH_TIERS)[number];

export type ModuleStatus =
  /** Fully reachable at the tier reported. */
  | 'available'
  /** Reachable, but with less than the module's full reach — say why. */
  | 'degraded'
  /** A prerequisite is missing. The module contributes nothing. */
  | 'unavailable'
  /** Switched off by the operator, or compiled out. */
  | 'disabled'
  /** The probe has not finished yet. */
  | 'checking';

/**
 * How a status was determined. `live` means an API was actually called;
 * `declared` means it was inferred from configuration. The UI shows this,
 * because "we think it works" and "we checked" are different claims.
 */
export type ProbeKind = 'live' | 'declared';

export interface ModuleAvailability {
  status: ModuleStatus;
  /** Highest tier this module can currently operate at. */
  tier: ReachTier;
  probeKind: ProbeKind;
  /** Translation key explaining the status — always set for non-`available`. */
  reasonKey?: TranslationKey;
  /** Substitution params for `reasonKey`. */
  reasonParams?: Record<string, string | number>;
  /** Raw technical detail for the Setup page / support. Never localised. */
  detail?: string;
  checkedAt: string;
}

/** Everything a probe is allowed to depend on. Keeps probes unit-testable. */
export interface ProbeContext {
  /** Non-secret build-time configuration (`src/config/govEnv.ts`). */
  env: Readonly<Record<string, string | undefined>>;
  /** Fabric / Power BI REST via the server-side `fabric_proxy` UDF. */
  fabricProxy: <T>(
    api: 'fabric' | 'pbi',
    path: string,
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    body?: unknown
  ) => Promise<T>;
  /** Microsoft Graph GET for the signed-in user. */
  graphGet: <T>(path: string) => Promise<T>;
  /** Abort signal so a slow probe never blocks the Setup page. */
  signal?: AbortSignal;
}

/**
 * A binding kind is one concrete instruction the compiler can emit into a
 * control plane (PLAN.md §11.1). Declared here in Phase 1 so the write gates
 * and the Setup page have something real to reason about; the compiler that
 * produces them arrives in Phase 6.
 */
export interface BindingKindDef {
  id: string;
  module: ModuleId;
  /** 🟢 preventive-automated · 🟡 preventive-manual · 🔴 detective-only. */
  controlMode: 'preventive-auto' | 'preventive-manual' | 'detective';
  /** Whether this kind can ever be written by an actuator. */
  writable: boolean;
  /** True for kinds that are cheap and safe to reverse (armed first). */
  reversible: boolean;
  /** Short, non-localised technical description for admins. */
  description: string;
}

/** A notebook this module owns. Ids come from build-time config. */
export interface NotebookRef {
  /** Stable logical name, e.g. `collector`. */
  role: 'collector' | 'actuator' | 'verify';
  /** Env var holding the deployed notebook item id. */
  envVar: string;
  description: string;
}

export interface ModuleRoute {
  path: string;
  labelKey: TranslationKey;
  /** Lazily loaded so a disabled module costs nothing at runtime. */
  element: () => Promise<{ default: React.ComponentType }>;
}

export interface GovernanceModule {
  id: ModuleId;
  nameKey: TranslationKey;
  descriptionKey: TranslationKey;
  /** Modules this one degrades without. Entra is everyone's substrate. */
  dependsOn: ModuleId[];
  bindingKinds: BindingKindDef[];
  notebooks: NotebookRef[];
  routes: ModuleRoute[];
  probe: (ctx: ProbeContext) => Promise<ModuleAvailability>;
  /**
   * Browser-side inventory collection (PLAN.md §8.8, Phase 2).
   *
   * This is the **T0 path**: what the signed-in user can see with their own
   * token and no admin consent. It is not the nightly collector — that runs
   * server-side in a notebook and writes Delta (Track B). Both exist because a
   * customer's first five minutes must show something real *before* any consent
   * conversation, and that experience cannot be retrofitted later.
   *
   * A module without a browser-reachable API returns an empty, explicitly
   * partial result rather than pretending.
   */
  collect?: (ctx: CollectContext) => Promise<InventoryResult>;
}

/** Artifact kinds the inventory can hold. Extended as modules grow. */
export const INVENTORY_KINDS = [
  'workspace',
  'fabricItem',
  'orgApp',
  'group',
  'environment',
  'agent',
] as const;
export type InventoryKind = (typeof INVENTORY_KINDS)[number];

export interface InventoryItem {
  /** Stable id within its plane. */
  id: string;
  module: ModuleId;
  kind: InventoryKind;
  name: string;
  /** Container this lives in (workspace / environment), when it has one. */
  scopeId?: string;
  scopeName?: string;
  /** Plane-native type, e.g. `Notebook`, `SemanticModel`, `Security`. */
  itemType?: string;
  /** Free-form extras rendered as a detail column. Never localised. */
  detail?: string;
}

export interface InventoryResult {
  items: InventoryItem[];
  /** Tier the data was actually collected at. */
  tier: ReachTier;
  /**
   * True when this is knowingly less than the whole truth — a user-scoped
   * read, a capped page size, or a plane that could not be reached at all.
   * The UI must surface this; silently partial data is worse than none.
   */
  partial: boolean;
  partialReasonKey?: TranslationKey;
  /** Substitution params for `partialReasonKey`, supplied by the module so no
   *  consumer has to know a module's internals. */
  partialReasonParams?: Record<string, string | number>;
  /** Non-fatal per-object failures. Never localised. */
  errors: string[];
}

/** Collectors need exactly what probes need. */
export type CollectContext = ProbeContext;

export function emptyInventory(
  tier: ReachTier,
  partialReasonKey?: TranslationKey
): InventoryResult {
  return {
    items: [],
    tier,
    partial: true,
    partialReasonKey,
    errors: [],
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Small helper so every probe reports the same shape. */
export function availability(
  status: ModuleStatus,
  tier: ReachTier,
  probeKind: ProbeKind,
  extra: Partial<Omit<ModuleAvailability, 'status' | 'tier' | 'probeKind' | 'checkedAt'>> = {}
): ModuleAvailability {
  return { status, tier, probeKind, checkedAt: nowIso(), ...extra };
}
