/**
 * The four write gates (PLAN.md §8.7).
 *
 * A governance tool with a single global write switch is a tenant-wide
 * incident waiting to happen. Every privileged write must pass **all** of:
 *
 *   1. master kill switch          — `writes.enabled`, ships `false`
 *   2. per binding kind            — `writes.kinds`, ships `[]`
 *   3. per scope allow-list        — `writes.scopeAllowlist`, ships `[]`
 *   4. prior successful dry run    — for this kind × scope, within 30 days
 *
 * plus unconditional invariants that no configuration can override:
 *   - elevated roles are never granted
 *   - the owning module must be enabled
 *   - the binding kind must actually be writable
 *
 * This module is **pure**. The real enforcement point is the actuator notebook,
 * which re-evaluates the same rules server-side — the SPA's opinion is never
 * trusted (PLAN.md §14, §19). Keeping the logic pure is what lets both sides
 * share one specification and one test suite.
 */
import type { TranslationKey } from '@/i18n';

export const DRY_RUN_VALIDITY_DAYS = 30;

/**
 * Roles this tool must never grant, in any plane, under any configuration.
 * Compared case-insensitively.
 */
export const DENIED_ROLES = [
  'admin',
  'administrator',
  'owner',
  'system administrator',
  'global administrator',
  'power platform administrator',
] as const;

export interface WriteConfig {
  /** Gate 1. */
  writesEnabled: boolean;
  /** Gate 2 — armed binding kind ids. */
  armedKinds: string[];
  /** Gate 3 — scope ids, or `['*']` for every scope. */
  scopeAllowlist: string[];
  /** Enabled module ids. */
  enabledModules: string[];
}

export interface DryRunRecord {
  bindingKind: string;
  scopeId: string;
  succeededAt: Date;
}

export interface WriteRequest {
  bindingKind: string;
  /** Module that owns the binding kind. */
  module: string;
  scopeId: string;
  /** Role/level being granted, if the binding carries one. */
  role?: string;
  /** True for a preview run — dry runs skip gates 3 and 4 by design. */
  dryRun: boolean;
  /** Whether the binding kind is writable at all (from its definition). */
  writable: boolean;
}

export type WriteGateId =
  | 'master'
  | 'kind'
  | 'scope'
  | 'dryRun'
  | 'deniedRole'
  | 'moduleOff'
  | 'notWritable';

export interface WriteGateDecision {
  allowed: boolean;
  /** First gate that refused, if any. */
  failedGate?: WriteGateId;
  /** Localisable explanation for the UI. */
  reasonKey?: TranslationKey;
  /** Non-localised detail for `gov_audit`. */
  detail?: string;
}

const GATE_REASON: Record<WriteGateId, TranslationKey> = {
  master: 'writes.gate.master',
  kind: 'writes.gate.kind',
  scope: 'writes.gate.scope',
  dryRun: 'writes.gate.dryRun',
  deniedRole: 'writes.gate.deniedRole',
  moduleOff: 'writes.gate.moduleOff',
  // A non-writable kind is a manual/detective control — the same message the
  // operator needs to see: this kind is not something we arm.
  notWritable: 'writes.gate.kind',
};

function refuse(gate: WriteGateId, detail?: string): WriteGateDecision {
  return { allowed: false, failedGate: gate, reasonKey: GATE_REASON[gate], detail };
}

export function isDeniedRole(role: string | undefined): boolean {
  if (!role) return false;
  return DENIED_ROLES.includes(role.trim().toLowerCase() as (typeof DENIED_ROLES)[number]);
}

function hasRecentDryRun(
  request: WriteRequest,
  dryRuns: DryRunRecord[],
  now: Date
): boolean {
  const cutoff = now.getTime() - DRY_RUN_VALIDITY_DAYS * 24 * 60 * 60 * 1000;
  return dryRuns.some(
    (r) =>
      r.bindingKind === request.bindingKind &&
      r.scopeId === request.scopeId &&
      r.succeededAt.getTime() >= cutoff &&
      r.succeededAt.getTime() <= now.getTime()
  );
}

/**
 * Evaluate all gates. Order matters: the *first* refusal is reported, and the
 * cheapest / most fundamental checks come first so audit rows are meaningful.
 */
export function evaluateWriteGates(
  request: WriteRequest,
  config: WriteConfig,
  dryRuns: DryRunRecord[] = [],
  now: Date = new Date()
): WriteGateDecision {
  // Unconditional invariants — not overridable by configuration.
  if (isDeniedRole(request.role)) {
    return refuse('deniedRole', `role=${request.role}`);
  }
  if (!config.enabledModules.includes(request.module)) {
    return refuse('moduleOff', `module=${request.module}`);
  }
  if (!request.writable) {
    return refuse('notWritable', `kind=${request.bindingKind}`);
  }

  // A dry run changes nothing, so it only needs the master switch and an armed
  // kind. Requiring the scope allow-list here would make gate 4 unreachable.
  if (!config.writesEnabled) {
    return refuse('master');
  }
  if (!config.armedKinds.includes(request.bindingKind)) {
    return refuse('kind', `kind=${request.bindingKind}`);
  }
  if (request.dryRun) {
    return { allowed: true };
  }

  const scopeAllowed =
    config.scopeAllowlist.includes('*') || config.scopeAllowlist.includes(request.scopeId);
  if (!scopeAllowed) {
    return refuse('scope', `scope=${request.scopeId}`);
  }
  if (!hasRecentDryRun(request, dryRuns, now)) {
    return refuse(
      'dryRun',
      `kind=${request.bindingKind} scope=${request.scopeId} window=${DRY_RUN_VALIDITY_DAYS}d`
    );
  }

  return { allowed: true };
}

/** Header chip state (PLAN.md §8.7). */
export function writeChipState(config: WriteConfig): {
  armed: boolean;
  kinds: number;
  scopes: number;
} {
  const armed = config.writesEnabled && config.armedKinds.length > 0;
  return {
    armed,
    kinds: config.armedKinds.length,
    scopes: config.scopeAllowlist.includes('*') ? Infinity : config.scopeAllowlist.length,
  };
}
