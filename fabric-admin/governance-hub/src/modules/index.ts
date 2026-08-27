/**
 * Module registry (PLAN.md §8.2).
 *
 * Three switching layers, in precedence order:
 *   1. **Build-time kill switch** — `VITE_MODULE_<PLANE>=false` removes the
 *      module entirely, for customers who must prove a plane is absent rather
 *      than merely disabled.
 *   2. **Operator toggle** — `modules.enabled` in `gov_config`, flippable live
 *      from Settings. This is also the demo lever.
 *   3. **Auto-detect probe** — what the tenant actually allows, right now.
 *
 * Nothing outside this file may import a module folder directly.
 */
import { getGovEnv, isTruthyEnv } from '@/config/govEnv';

import agentModule from './agent';
import entraModule from './entra';
import fabricModule from './fabric';
import ppModule from './pp';
import {
  MODULE_IDS,
  availability,
  type GovernanceModule,
  type InventoryItem,
  type InventoryResult,
  type ModuleAvailability,
  type ModuleId,
  type ModuleRoute,
  type ProbeContext,
  type ReachTier,
} from './types';

const ALL_MODULES: GovernanceModule[] = [fabricModule, ppModule, agentModule, entraModule];

const BUILD_FLAG_BY_ID: Record<ModuleId, keyof ReturnType<typeof getGovEnv>> = {
  fabric: 'VITE_MODULE_FABRIC',
  pp: 'VITE_MODULE_PP',
  agent: 'VITE_MODULE_AGENT',
  entra: 'VITE_MODULE_ENTRA',
};

/** Modules that survived the build-time kill switch. */
export function compiledModules(
  env: Readonly<Record<string, string | undefined>> = getGovEnv()
): GovernanceModule[] {
  return ALL_MODULES.filter((m) => isTruthyEnv(env[BUILD_FLAG_BY_ID[m.id]]));
}

export function getModule(id: ModuleId): GovernanceModule | undefined {
  return ALL_MODULES.find((m) => m.id === id);
}

/** Every binding kind across the compiled modules — the write-gate vocabulary. */
export function allBindingKinds(
  env?: Readonly<Record<string, string | undefined>>
): GovernanceModule['bindingKinds'] {
  return compiledModules(env).flatMap((m) => m.bindingKinds);
}

/**
 * Run every compiled module's probe.
 *
 * Probes are independent, so they run in parallel and a slow or throwing probe
 * degrades only its own module — never the Setup page.
 */
export async function probeModules(
  ctx: ProbeContext,
  enabledIds: ModuleId[]
): Promise<Record<ModuleId, ModuleAvailability>> {
  const results = {} as Record<ModuleId, ModuleAvailability>;
  const compiled = compiledModules(ctx.env);
  const compiledIds = new Set(compiled.map((m) => m.id));

  for (const id of MODULE_IDS) {
    if (!compiledIds.has(id)) {
      results[id] = availability('disabled', 'T0', 'declared', {
        reasonKey: 'reason.disabledAtBuild',
      });
    } else if (!enabledIds.includes(id)) {
      results[id] = availability('disabled', 'T0', 'declared', {
        reasonKey: 'reason.disabledByOperator',
      });
    }
  }

  const toProbe = compiled.filter((m) => enabledIds.includes(m.id));
  const settled = await Promise.allSettled(toProbe.map((m) => m.probe(ctx)));

  settled.forEach((outcome, index) => {
    const id = toProbe[index].id;
    results[id] =
      outcome.status === 'fulfilled'
        ? outcome.value
        : availability('unavailable', 'T0', 'live', {
            reasonKey: 'reason.probeFailed',
            reasonParams: {
              detail:
                outcome.reason instanceof Error
                  ? outcome.reason.message
                  : String(outcome.reason),
            },
          });
  });

  return results;
}

const TIER_ORDER: ReachTier[] = ['T0', 'T1', 'T2'];

/**
 * The deployment's overall reach tier: the *lowest* tier among modules that
 * are actually contributing. A single degraded module holds the whole app
 * honest, which is the intended behaviour — the UI must never imply more reach
 * than the weakest contributing plane provides.
 */
export function effectiveTier(
  results: Partial<Record<ModuleId, ModuleAvailability>>
): ReachTier {
  const contributing = Object.values(results).filter(
    (r): r is ModuleAvailability =>
      !!r && (r.status === 'available' || r.status === 'degraded')
  );
  if (contributing.length === 0) return 'T0';
  return contributing.reduce<ReachTier>((lowest, r) => {
    return TIER_ORDER.indexOf(r.tier) < TIER_ORDER.indexOf(lowest) ? r.tier : lowest;
  }, 'T2');
}

/** Modules whose declared dependencies are not contributing. */
export function unmetDependencies(
  results: Partial<Record<ModuleId, ModuleAvailability>>,
  env?: Readonly<Record<string, string | undefined>>
): { module: ModuleId; missing: ModuleId[] }[] {
  const contributing = new Set(
    (Object.entries(results) as [ModuleId, ModuleAvailability][])
      .filter(([, r]) => r.status === 'available' || r.status === 'degraded')
      .map(([id]) => id)
  );

  return compiledModules(env)
    .filter((m) => contributing.has(m.id))
    .map((m) => ({ module: m.id, missing: m.dependsOn.filter((d) => !contributing.has(d)) }))
    .filter((entry) => entry.missing.length > 0);
}

export interface ResolvedRoute extends ModuleRoute {
  module: ModuleId;
}

/**
 * Routes contributed by enabled modules (PLAN.md §8.2, §13).
 *
 * A disabled module's pages are **removed from the navigation entirely**, not
 * greyed out — the app should look like a tool that does not cover that plane,
 * because that is exactly what it is at that moment.
 */
export function moduleRoutes(
  enabledIds: ModuleId[],
  env: Readonly<Record<string, string | undefined>> = getGovEnv()
): ResolvedRoute[] {
  return compiledModules(env)
    .filter((m) => enabledIds.includes(m.id))
    .flatMap((m) => m.routes.map((route) => ({ ...route, module: m.id })));
}

export interface NotebookStatus {  module: ModuleId;
  role: string;
  envVar: string;
  description: string;
  configured: boolean;
  notebookId?: string;
}

/**
 * Which server-side notebooks each enabled module owns, and whether this
 * deployment has been told where they live (PLAN.md §15, Phase 3).
 *
 * A module whose collector notebook id is unset is not broken — it is simply
 * not deployed yet, and the Setup page says exactly that instead of leaving
 * someone to guess why a plane never refreshes.
 */
export function moduleNotebooks(
  enabledIds: ModuleId[],
  env: Readonly<Record<string, string | undefined>> = getGovEnv()
): NotebookStatus[] {
  return compiledModules(env)
    .filter((m) => enabledIds.includes(m.id))
    .flatMap((m) =>
      m.notebooks.map((nb) => {
        const notebookId = env[nb.envVar];
        return {
          module: m.id,
          role: nb.role,
          envVar: nb.envVar,
          description: nb.description,
          configured: Boolean(notebookId),
          notebookId,
        };
      })
    );
}

export interface MergedInventory {  items: InventoryItem[];
  /** Per-module outcome, so the UI can explain each gap individually. */
  byModule: Partial<Record<ModuleId, InventoryResult>>;
  /** True when any contributing module knowingly returned less than the truth. */
  partial: boolean;
  /** Lowest tier any contributing module collected at. */
  tier: ReachTier;
  errors: string[];
}

/**
 * Collect the browser-side inventory across enabled modules (PLAN.md §8.8).
 *
 * Modules run in parallel and are independent: a throwing collector produces a
 * partial result for its own plane and nothing more. The merged result is
 * partial if *any* contributing module is — a single silently-truncated plane
 * would otherwise make the whole view a lie.
 */
export async function collectInventory(
  ctx: ProbeContext,
  enabledIds: ModuleId[]
): Promise<MergedInventory> {
  const collectors = compiledModules(ctx.env).filter(
    (m) => enabledIds.includes(m.id) && m.collect
  );

  const settled = await Promise.allSettled(collectors.map((m) => m.collect!(ctx)));

  const byModule: Partial<Record<ModuleId, InventoryResult>> = {};
  const items: InventoryItem[] = [];
  const errors: string[] = [];

  settled.forEach((outcome, index) => {
    const id = collectors[index].id;
    if (outcome.status === 'fulfilled') {
      byModule[id] = outcome.value;
      items.push(...outcome.value.items);
      errors.push(...outcome.value.errors.map((e) => `${id}: ${e}`));
    } else {
      const message =
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      byModule[id] = {
        items: [],
        tier: 'T0',
        partial: true,
        partialReasonKey: 'reason.probeFailed',
        errors: [message],
      };
      errors.push(`${id}: ${message}`);
    }
  });

  const results = Object.values(byModule);
  const partial =
    results.some((r) => r.partial) ||
    // A module that is enabled but has no collector at all is also a gap.
    collectors.length < compiledModules(ctx.env).filter((m) => enabledIds.includes(m.id)).length;

  const tier = results.reduce<ReachTier>(
    (lowest, r) =>
      TIER_ORDER.indexOf(r.tier) < TIER_ORDER.indexOf(lowest) ? r.tier : lowest,
    'T2'
  );

  return { items, byModule, partial, tier: results.length ? tier : 'T0', errors };
}

export { MODULE_IDS };
export type {
  GovernanceModule,
  InventoryItem,
  InventoryResult,
  ModuleAvailability,
  ModuleId,
  ModuleRoute,
  ProbeContext,
  ReachTier,
};
