/**
 * Read path against the Governance Model (PLAN.md §12.4, §10).
 *
 * The model is a Direct Lake semantic model over `governance_lh`, queried
 * through the same `fabric_proxy` UDF the rest of the app uses — a SPA cannot
 * call Power BI `executeQueries` directly (CORS + audience), and we are not
 * putting a credential in the browser to work around that.
 *
 * Every query is built by `domain/dax.ts`, which validates identifiers against
 * the schema catalogue, so nothing here concatenates user input into DAX.
 */
import { buildCount, buildSelect, mapRows, type DaxFilter } from '@/domain/dax';
import { columnsOf, type GovTableName } from '@/domain/govSchema';

import { executeDax } from './udfClient';

export interface ModelTarget {
  workspaceId: string;
  modelId: string;
}

/** Resolve the model from build-time config, or `null` when not provisioned. */
export function getModelTarget(
  env: Readonly<Record<string, string | undefined>>
): ModelTarget | null {
  const modelId = env.VITE_GOV_MODEL_ID;
  const workspaceId = env.VITE_GOV_WORKSPACE_ID ?? env.VITE_FABRIC_WORKSPACE_ID;
  if (!modelId || !workspaceId) return null;
  return { workspaceId, modelId };
}

export interface QueryOptions {
  columns?: string[];
  filters?: DaxFilter[];
  orderBy?: string;
  orderDesc?: boolean;
  topN?: number;
}

/** Read one governance table. Returns plain string maps, keyed by column. */
export async function queryTable(
  target: ModelTarget,
  table: GovTableName,
  options: QueryOptions = {}
): Promise<Record<string, string>[]> {
  const columns = options.columns ?? [...columnsOf(table)];
  const dax = buildSelect({
    table,
    columns,
    filters: options.filters,
    orderBy: options.orderBy,
    orderDesc: options.orderDesc,
    topN: options.topN ?? 5000,
  });
  const rows = await executeDax(target.workspaceId, target.modelId, dax);
  return mapRows(rows, columns);
}

export async function countRows(
  target: ModelTarget,
  table: GovTableName
): Promise<number> {
  const rows = await executeDax(target.workspaceId, target.modelId, buildCount(table));
  const first = rows[0] ?? {};
  const raw = Object.values(first)[0];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Cheap liveness probe for the model.
 *
 * `gov_runs` exists from the very first bootstrap, so this answers "is the
 * model reachable" without depending on any collector having run.
 */
export async function probeModel(target: ModelTarget): Promise<boolean> {
  try {
    await countRows(target, 'gov_runs');
    return true;
  } catch {
    return false;
  }
}

export interface CollectorRun {
  runId: string;
  collector: string;
  module: string;
  tier: string;
  finishedAt: string;
  objects: number;
  errors: number;
}

/**
 * The most recent run per module — what the UI uses to say how fresh a plane is
 * and whether it was collected at T0 or T1.
 */
export async function latestRuns(target: ModelTarget): Promise<CollectorRun[]> {
  const rows = await queryTable(target, 'gov_runs', {
    columns: ['run_id', 'collector', 'module', 'tier', 'finished_at', 'n_objects', 'n_errors'],
    orderBy: 'finished_at',
    orderDesc: true,
    topN: 200,
  });

  const seen = new Set<string>();
  const latest: CollectorRun[] = [];
  for (const row of rows) {
    if (seen.has(row.module)) continue;
    seen.add(row.module);
    latest.push({
      runId: row.run_id,
      collector: row.collector,
      module: row.module,
      tier: row.tier || 'T1',
      finishedAt: row.finished_at,
      objects: Number(row.n_objects) || 0,
      errors: Number(row.n_errors) || 0,
    });
  }
  return latest;
}
