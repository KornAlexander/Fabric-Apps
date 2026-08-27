/**
 * Reading the write ledgers (PLAN.md §12, §8.7).
 *
 * `gov_audit` is append-only and is the product's real deliverable for an
 * auditor; `gov_dry_runs` is the machine evidence behind gate 4. Both are
 * written **only** by the actuator notebook — the app reads them and never
 * writes them, which is what keeps "the tool cannot forge its own permission"
 * true rather than merely intended.
 */
import { DRY_RUN_VALIDITY_DAYS, type DryRunRecord } from './writeGates';

export type Row = Record<string, string>;

export interface AuditEntry {
  auditId: string;
  ts: Date;
  actor: string;
  actorType: string;
  action: string;
  plane: string;
  targetType: string;
  targetId: string;
  outcome: string;
  error?: string;
  requestId?: string;
  correlationId?: string;
}

/** Outcomes the actuator writes. `Refused` is a first-class result, not an error. */
export const AUDIT_OUTCOMES = ['Success', 'Planned', 'Refused', 'Failed'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

function parseDate(value: string | undefined): Date {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? new Date(parsed) : new Date(0);
}

export function parseAudit(rows: Row[]): AuditEntry[] {
  return rows
    .map((row) => ({
      auditId: row.audit_id,
      ts: parseDate(row.ts),
      actor: row.actor || 'unknown',
      actorType: row.actor_type || 'User',
      action: row.action || '',
      plane: row.plane || '',
      targetType: row.target_type || '',
      targetId: row.target_id || '',
      outcome: row.outcome || '',
      error: row.error || undefined,
      requestId: row.request_id || undefined,
      correlationId: row.correlation_id || undefined,
    }))
    .sort((a, b) => b.ts.getTime() - a.ts.getTime());
}

export function parseDryRuns(rows: Row[]): DryRunRecord[] {
  return rows.map((row) => ({
    bindingKind: row.binding_kind,
    scopeId: row.scope_id,
    succeededAt: parseDate(row.succeeded_at),
  }));
}

export type DryRunStatus = 'fresh' | 'expired' | 'never';

export interface DryRunState {
  status: DryRunStatus;
  /** Whole days left before gate 4 closes again. */
  daysRemaining: number;
  lastSucceededAt?: Date;
}

/**
 * Gate-4 state for one binding kind × scope.
 *
 * Expiry is deliberately visible rather than silent: an operator whose pilot
 * stalled for five weeks should be told the evidence went stale, not discover
 * it as a refusal at the moment they finally press the button.
 */
export function dryRunState(
  bindingKind: string,
  scopeId: string,
  dryRuns: DryRunRecord[],
  now: Date = new Date()
): DryRunState {
  const matching = dryRuns
    .filter(
      (r) =>
        r.bindingKind === bindingKind &&
        r.scopeId === scopeId &&
        r.succeededAt.getTime() <= now.getTime()
    )
    .sort((a, b) => b.succeededAt.getTime() - a.succeededAt.getTime());

  const latest = matching[0];
  if (!latest) return { status: 'never', daysRemaining: 0 };

  const ageMs = now.getTime() - latest.succeededAt.getTime();
  const remaining = DRY_RUN_VALIDITY_DAYS - ageMs / (24 * 60 * 60 * 1000);
  return remaining > 0
    ? {
        status: 'fresh',
        daysRemaining: Math.max(1, Math.ceil(remaining)),
        lastSucceededAt: latest.succeededAt,
      }
    : { status: 'expired', daysRemaining: 0, lastSucceededAt: latest.succeededAt };
}

export interface AuditSummary {
  total: number;
  byOutcome: Record<string, number>;
  refusalsByGate: Record<string, number>;
  lastAt?: Date;
}

/**
 * Refusals are grouped by the gate that fired, because "we were refused 40
 * times by gate 4" and "we were refused 40 times by the denied-role invariant"
 * describe two completely different deployments.
 */
export function summariseAudit(entries: AuditEntry[]): AuditSummary {
  const byOutcome: Record<string, number> = {};
  const refusalsByGate: Record<string, number> = {};

  for (const entry of entries) {
    byOutcome[entry.outcome] = (byOutcome[entry.outcome] ?? 0) + 1;
    const gate = entry.error?.match(/^gate:(\w+)/)?.[1];
    if (gate) refusalsByGate[gate] = (refusalsByGate[gate] ?? 0) + 1;
  }

  return {
    total: entries.length,
    byOutcome,
    refusalsByGate,
    lastAt: entries[0]?.ts,
  };
}

export interface AuditFilter {
  outcome?: string;
  plane?: string;
  search?: string;
}

export function filterAudit(entries: AuditEntry[], filter: AuditFilter): AuditEntry[] {
  const needle = filter.search?.trim().toLowerCase();
  return entries.filter((entry) => {
    if (filter.outcome && entry.outcome !== filter.outcome) return false;
    if (filter.plane && entry.plane !== filter.plane) return false;
    if (!needle) return true;
    return [entry.actor, entry.action, entry.targetId, entry.error ?? '']
      .join(' ')
      .toLowerCase()
      .includes(needle);
  });
}
