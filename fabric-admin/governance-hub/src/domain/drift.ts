/**
 * The drift engine (PLAN.md §11.3).
 *
 * Compares **desired** entitlements against **actual** effective grants, at the
 * capability level — which is the level a human argues about ("Marcel should be
 * able to author agents in CoE"), rather than at binding level.
 *
 * The one rule that matters more than any other:
 *
 * > **`Extra` drift is never auto-removed.**
 *
 * Auto-revoking unjustified access is how a governance tool takes production
 * down at 03:00. Removal is always an explicit human decision with an audit
 * row. The engine therefore *reports* extra access and refuses to mark it
 * auto-remediable, no matter how confident it is.
 */
import { CAPABILITY_BY_ID } from './capabilities';
import type { EffectiveGrant } from './effective';
import { EVERYONE_PRINCIPAL_ID } from './effective';
import { compilePersona, type Persona } from './personas';

export type DriftType =
  /** Desired but not held — someone cannot do what they were entitled to. */
  | 'Missing'
  /** Held but not justified by any entitlement. NEVER auto-removed. */
  | 'Extra'
  /** Entitled *and* nominally granted, but a tenant setting blocks it. */
  | 'Blocked'
  /** Held, but the platform cannot tell us whether it is effective. */
  | 'Unknown';

export type Severity = 'Critical' | 'High' | 'Medium' | 'Low';

export const SEVERITY_ORDER: Severity[] = ['Critical', 'High', 'Medium', 'Low'];

export interface Assignment {
  id: string;
  principalId: string;
  principalName: string;
  principalType: string;
  personaId: string;
  scopeType: string;
  scopeId: string;
  scopeName: string;
  validUntil?: string;
  isActive: boolean;
}

export interface DriftRow {
  id: string;
  driftType: DriftType;
  severity: Severity;
  principalId: string;
  principalName: string;
  capabilityId: string;
  scopeType: string;
  scopeId: string;
  scopeName: string;
  /** Non-localised explanation. */
  detail: string;
  /** Whether the app is *allowed* to fix this automatically. */
  autoRemediable: boolean;
  /** Derivation path from the actual side, when there is one. */
  path?: EffectiveGrant['path'];
}

/** Capabilities where unjustified access is a serious finding, not a nit. */
const HIGH_RISK_CAPABILITIES = new Set([
  'create:CopilotStudioAgent',
  'create:M365DeclarativeAgent',
  'manage:AgentBlueprint',
  'create:Workspace',
  'create:OrgApp',
  'manage:OrgAppAudience',
  'create:FabricDataAgent',
]);

function key(principalId: string, capabilityId: string, scopeId: string): string {
  return `${principalId}|${capabilityId}|${scopeId}`;
}

export interface DesiredEntry {
  principalId: string;
  principalName: string;
  capabilityId: string;
  scopeType: string;
  scopeId: string;
  scopeName: string;
  personaId: string;
  expired: boolean;
}

/**
 * Expand assignments into the capabilities they promise.
 *
 * An expired assignment still expands — it has to, or expiry would look like
 * the entitlement never existed and the resulting `Extra` row would lose the
 * reason it appeared.
 */
export function expandAssignments(
  assignments: Assignment[],
  personas: Persona[],
  now: Date = new Date()
): DesiredEntry[] {
  const byId = new Map(personas.map((p) => [p.id, p]));
  const entries: DesiredEntry[] = [];

  for (const assignment of assignments) {
    if (!assignment.isActive) continue;
    const persona = byId.get(assignment.personaId);
    if (!persona) continue;

    const expired = Boolean(
      assignment.validUntil && new Date(assignment.validUntil).getTime() < now.getTime()
    );

    for (const capabilityId of persona.capabilityIds) {
      const capability = CAPABILITY_BY_ID.get(capabilityId);
      if (!capability) continue;
      // Only the scopes this capability can meaningfully be granted at.
      if (!capability.scopeTypes.includes(assignment.scopeType as never)) continue;

      entries.push({
        principalId: assignment.principalId,
        principalName: assignment.principalName,
        capabilityId,
        scopeType: assignment.scopeType,
        scopeId: assignment.scopeId,
        scopeName: assignment.scopeName,
        personaId: assignment.personaId,
        expired,
      });
    }
  }

  return entries;
}

function extraSeverity(grant: EffectiveGrant): Severity {
  // Unjustified access held by *everyone* is categorically worse than one
  // person having too much: it is the whole tenant, and usually structural.
  if (grant.principalId === EVERYONE_PRINCIPAL_ID) return 'Critical';
  if (HIGH_RISK_CAPABILITIES.has(grant.capabilityId)) return 'High';
  if (grant.capabilityId.startsWith('read:')) return 'Low';
  return 'Medium';
}

export interface ComputeDriftInput {
  assignments: Assignment[];
  personas: Persona[];
  grants: EffectiveGrant[];
  now?: Date;
}

/**
 * Diff desired against actual.
 *
 * Note the asymmetry: `Missing` is a *promise the platform is not keeping*, and
 * `Extra` is *access nobody asked for*. They are both drift, but only one of
 * them is ever safe to fix automatically — and it is not `Extra`.
 */
export function computeDrift(input: ComputeDriftInput): DriftRow[] {
  const now = input.now ?? new Date();
  const desired = expandAssignments(input.assignments, input.personas, now);
  const rows: DriftRow[] = [];

  const actualByKey = new Map<string, EffectiveGrant>();
  for (const grant of input.grants) {
    // `Everyone` grants satisfy any principal's desire for that capability, so
    // index them under a wildcard the lookup can fall back to.
    actualByKey.set(key(grant.principalId, grant.capabilityId, grant.scopeId), grant);
  }

  const everyoneHas = new Set(
    input.grants
      .filter((g) => g.principalId === EVERYONE_PRINCIPAL_ID && g.status === 'granted')
      .map((g) => `${g.capabilityId}|${g.scopeId}`)
  );

  const justified = new Set<string>();

  // ── desired → Missing / Blocked / Unknown ────────────────────────────────
  for (const entry of desired) {
    const lookupKey = key(entry.principalId, entry.capabilityId, entry.scopeId);
    const grant = actualByKey.get(lookupKey);
    const coveredByEveryone = everyoneHas.has(`${entry.capabilityId}|${entry.scopeId}`);

    justified.add(lookupKey);

    if (!grant && !coveredByEveryone) {
      rows.push({
        id: `missing:${lookupKey}`,
        driftType: 'Missing',
        severity: entry.expired ? 'Low' : 'Medium',
        principalId: entry.principalId,
        principalName: entry.principalName,
        capabilityId: entry.capabilityId,
        scopeType: entry.scopeType,
        scopeId: entry.scopeId,
        scopeName: entry.scopeName,
        detail: entry.expired
          ? `entitlement from persona "${entry.personaId}" has expired and is correctly not in effect`
          : `entitled via persona "${entry.personaId}" but the capability is not held`,
        // Safe to fix: granting what was already approved.
        autoRemediable: !entry.expired,
      });
      continue;
    }

    if (grant?.status === 'blocked') {
      rows.push({
        id: `blocked:${lookupKey}`,
        driftType: 'Blocked',
        severity: 'High',
        principalId: entry.principalId,
        principalName: entry.principalName,
        capabilityId: entry.capabilityId,
        scopeType: entry.scopeType,
        scopeId: entry.scopeId,
        scopeName: entry.scopeName,
        // The entitlement model is promising something the platform refuses.
        detail: grant.statusDetail ?? 'granted at one layer but blocked at another',
        autoRemediable: false,
        path: grant.path,
      });
      continue;
    }

    if (grant?.status === 'unknown') {
      rows.push({
        id: `unknown:${lookupKey}`,
        driftType: 'Unknown',
        severity: 'Medium',
        principalId: entry.principalId,
        principalName: entry.principalName,
        capabilityId: entry.capabilityId,
        scopeType: entry.scopeType,
        scopeId: entry.scopeId,
        scopeName: entry.scopeName,
        detail: grant.statusDetail ?? 'cannot determine whether this is in effect',
        autoRemediable: false,
        path: grant.path,
      });
    }
  }

  // ── actual → Extra ───────────────────────────────────────────────────────
  for (const grant of input.grants) {
    if (grant.status !== 'granted') continue;
    const lookupKey = key(grant.principalId, grant.capabilityId, grant.scopeId);
    if (justified.has(lookupKey)) continue;

    rows.push({
      id: `extra:${lookupKey}`,
      driftType: 'Extra',
      severity: extraSeverity(grant),
      principalId: grant.principalId,
      principalName: grant.principalName,
      capabilityId: grant.capabilityId,
      scopeType: grant.scopeType,
      scopeId: grant.scopeId,
      scopeName: grant.scopeName,
      detail: 'held, but no active entitlement justifies it',
      // Never. Auto-revoking access is how a governance tool causes an outage.
      autoRemediable: false,
      path: grant.path,
    });
  }

  return rows.sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      a.capabilityId.localeCompare(b.capabilityId)
  );
}

export interface DriftSummary {
  total: number;
  bySeverity: Record<Severity, number>;
  byType: Record<DriftType, number>;
  autoRemediable: number;
}

export function summariseDrift(rows: DriftRow[]): DriftSummary {
  const bySeverity: Record<Severity, number> = {
    Critical: 0,
    High: 0,
    Medium: 0,
    Low: 0,
  };
  const byType: Record<DriftType, number> = {
    Missing: 0,
    Extra: 0,
    Blocked: 0,
    Unknown: 0,
  };
  for (const row of rows) {
    bySeverity[row.severity] += 1;
    byType[row.driftType] += 1;
  }
  return {
    total: rows.length,
    bySeverity,
    byType,
    autoRemediable: rows.filter((r) => r.autoRemediable).length,
  };
}

/**
 * Personas that do not compile are drift too — the model promises rights the
 * product cannot deliver, which is the overclaiming this tool exists to avoid.
 */
export function personaCompileDrift(personas: Persona[], enabledModules: string[]): DriftRow[] {
  const rows: DriftRow[] = [];
  for (const persona of personas) {
    const result = compilePersona(persona, { enabledModules: enabledModules as never });
    for (const issue of result.issues) {
      rows.push({
        id: `persona:${persona.id}:${issue.capabilityId}:${issue.code}`,
        driftType: 'Unknown',
        severity: 'High',
        principalId: persona.id,
        principalName: persona.name,
        capabilityId: issue.capabilityId,
        scopeType: issue.scopeType ?? 'Tenant',
        scopeId: 'model',
        scopeName: 'Entitlement model',
        detail: issue.detail,
        autoRemediable: false,
      });
    }
  }
  return rows;
}
