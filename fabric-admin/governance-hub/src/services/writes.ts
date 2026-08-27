/**
 * The client side of the write path (PLAN.md §14).
 *
 * This service submits a request to the **Gov Actuator** notebook and reads the
 * ledgers back. It deliberately holds no ability to write anything itself:
 *
 * - the four gates are re-evaluated inside the notebook, from `gov_config` read
 *   server-side, so a tampered client cannot grant itself permission;
 * - `gov_audit` and `gov_dry_runs` are append-only and written only by the
 *   notebook, so the app cannot forge its own gate-4 evidence.
 *
 * The optimistic gate evaluation in the UI is a courtesy — it explains a refusal
 * before the click. When the two disagree, the notebook wins, and its refusal is
 * what gets audited.
 */
import { getGovEnv } from '@/config/govEnv';
import {
  parseAudit,
  parseDryRuns,
  type AuditEntry,
} from '@/domain/audit';
import type { DryRunRecord } from '@/domain/writeGates';

import { getModelTarget, queryTable } from './govModel';
import { runNotebook, type NotebookRunResult } from './udfClient';

export interface WriteBinding {
  kind: string;
  module: string;
  targetId: string;
  targetType: string;
  principalId?: string;
  principalName?: string;
  role?: string;
  writable: boolean;
}

export interface SubmitWriteInput {
  binding: WriteBinding;
  dryRun: boolean;
  actor: string;
  requestId?: string;
}

/** The actuator's `exitValue` contract. */
export interface ActuatorResult {
  ok: boolean;
  dry_run: boolean;
  before?: unknown;
  after?: unknown;
  verified?: boolean;
  verify_after_s?: number;
  detail?: string;
  error?: string | null;
}

export type SubmitOutcome =
  | { state: 'not-configured' }
  | { state: 'transport-error'; message: string }
  | { state: 'no-exit-value'; run: NotebookRunResult }
  | { state: 'result'; result: ActuatorResult };

function correlationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `c-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Run the actuator once.
 *
 * A missing exit value is reported as its own state rather than being folded
 * into failure: "the notebook did not answer" and "the notebook refused" are
 * different problems, and conflating them sends the operator to the wrong place.
 */
export async function submitWrite(input: SubmitWriteInput): Promise<SubmitOutcome> {
  const env = getGovEnv();
  const notebookId = env.VITE_GOV_ACTUATOR_NOTEBOOK_ID;
  const workspaceId = env.VITE_GOV_WORKSPACE_ID ?? env.VITE_FABRIC_WORKSPACE_ID;
  if (!notebookId || !workspaceId) return { state: 'not-configured' };

  const request = {
    correlation_id: correlationId(),
    request_id: input.requestId ?? '',
    actor: input.actor,
    actor_type: 'User',
    dry_run: input.dryRun,
    binding: {
      kind: input.binding.kind,
      module: input.binding.module,
      target_id: input.binding.targetId,
      target_type: input.binding.targetType,
      principal_id: input.binding.principalId ?? '',
      role: input.binding.role ?? null,
      writable: input.binding.writable,
    },
  };

  let run: NotebookRunResult;
  try {
    run = await runNotebook(workspaceId, notebookId, {
      request_json: { value: JSON.stringify(request), type: 'string' },
    });
  } catch (error) {
    return {
      state: 'transport-error',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (!run.exitValue) return { state: 'no-exit-value', run };

  try {
    return { state: 'result', result: JSON.parse(run.exitValue) as ActuatorResult };
  } catch {
    return { state: 'no-exit-value', run };
  }
}

export interface LedgerData {
  audit: AuditEntry[];
  dryRuns: DryRunRecord[];
  /** True when the Governance Model is not provisioned yet. */
  noModel: boolean;
  /** Tables that could not be read — the view under-reports without them. */
  failures: string[];
}

export async function loadLedgers(): Promise<LedgerData> {
  const target = getModelTarget(getGovEnv());
  if (!target) return { audit: [], dryRuns: [], noModel: true, failures: [] };

  const [auditResult, dryRunResult] = await Promise.allSettled([
    queryTable(target, 'gov_audit', { topN: 500, orderBy: 'ts', orderDesc: true }),
    queryTable(target, 'gov_dry_runs', { topN: 500 }),
  ]);

  const failures: string[] = [];
  if (auditResult.status === 'rejected') failures.push('gov_audit');
  if (dryRunResult.status === 'rejected') failures.push('gov_dry_runs');

  return {
    audit: auditResult.status === 'fulfilled' ? parseAudit(auditResult.value) : [],
    dryRuns: dryRunResult.status === 'fulfilled' ? parseDryRuns(dryRunResult.value) : [],
    noModel: false,
    failures,
  };
}
