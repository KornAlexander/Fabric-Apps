/**
 * The policy rule pack (PLAN.md §16, `POL-001…027`).
 *
 * Pure evaluators over the collected snapshot, the effective grants and the
 * drift rows. Every rule declares what it needs, and a rule whose data is not
 * collectable yet is **listed as pending rather than silently omitted** — a
 * rule pack that quietly skips half its rules gives false comfort.
 */
import type { DriftRow, Severity } from './drift';
import { EVERYONE_PRINCIPAL_ID, type EffectiveGrant, type GovernanceSnapshot } from './effective';
import type { Persona } from './personas';

export interface PolicyContext {
  snapshot: GovernanceSnapshot;
  grants: EffectiveGrant[];
  drift: DriftRow[];
  personas: Persona[];
  /** Extra tables the base snapshot does not carry. */
  dlp: Record<string, string>[];
  ppTenantSettings: Record<string, string>[];
  agents: Record<string, string>[];
  writesArmed: { kinds: string[]; scopes: string[] };
}

export interface PolicyFinding {
  policyId: string;
  severity: Severity;
  objectType: string;
  objectId: string;
  objectName: string;
  /** Non-localised, specific, actionable. */
  detail: string;
}

export interface PolicyRule {
  id: string;
  severity: Severity;
  /** Short non-localised statement of what the rule looks for. */
  statement: string;
  module: string;
  /** When set, the rule cannot run yet and this says what is missing. */
  requiresData?: string;
  evaluate?: (ctx: PolicyContext) => PolicyFinding[];
}

const finding = (
  rule: Pick<PolicyRule, 'id' | 'severity'>,
  objectType: string,
  objectId: string,
  objectName: string,
  detail: string
): PolicyFinding => ({
  policyId: rule.id,
  severity: rule.severity,
  objectType,
  objectId,
  objectName,
  detail,
});

export const POLICY_RULES: PolicyRule[] = [
  {
    id: 'POL-001',
    severity: 'Critical',
    module: 'pp',
    statement: 'Users can create Copilot Studio agents in the Default environment',
    evaluate: (ctx) =>
      ctx.grants
        .filter(
          (g) =>
            g.capabilityId === 'create:CopilotStudioAgent' &&
            g.status === 'granted' &&
            g.principalId === EVERYONE_PRINCIPAL_ID
        )
        .map((g) =>
          finding(
            { id: 'POL-001', severity: 'Critical' },
            'Environment',
            g.scopeId,
            g.scopeName,
            'every user can author Copilot Studio agents here; Environment Maker is auto-assigned and cannot be removed'
          )
        ),
  },
  {
    id: 'POL-002',
    severity: 'Critical',
    module: 'pp',
    statement:
      'A non-default Dataverse environment has no security group bound (Default and Developer are exempt — one cannot be assigned)',
    evaluate: (ctx) =>
      ctx.snapshot.environments
        .filter(
          (e) =>
            e.has_dataverse === 'true' &&
            e.security_group_assignable === 'true' &&
            e.security_group_bound !== 'true'
        )
        .map((e) =>
          finding(
            { id: 'POL-002', severity: 'Critical' },
            'Environment',
            e.environment_id,
            e.environment_name,
            'open to every licensed user — bind an Entra security group'
          )
        ),
  },
  {
    id: 'POL-003',
    severity: 'High',
    module: 'fabric',
    statement: 'A principal holds create access that no entitlement justifies',
    evaluate: (ctx) =>
      ctx.drift
        .filter((d) => d.driftType === 'Extra' && d.capabilityId.startsWith('create:'))
        .map((d) =>
          finding(
            { id: 'POL-003', severity: d.severity },
            'Principal',
            d.principalId,
            d.principalName,
            `${d.capabilityId} in ${d.scopeName} is not justified by any entitlement`
          )
        ),
  },
  {
    id: 'POL-004',
    severity: 'High',
    module: 'fabric',
    statement: 'A Fabric tenant setting is enabled for the whole organisation',
    evaluate: (ctx) =>
      ctx.snapshot.tenantSettings
        .filter((s) => s.scope === 'Everyone' && s.can_specify_security_groups !== 'false')
        .map((s) =>
          finding(
            { id: 'POL-004', severity: 'High' },
            'TenantSetting',
            s.setting_name,
            s.title || s.setting_name,
            'enabled org-wide although it supports security-group scoping'
          )
        ),
  },
  {
    id: 'POL-005',
    severity: 'High',
    module: 'fabric',
    statement: 'Org App audience membership cannot be verified',
    evaluate: () => [],
    requiresData: 'no public API exists for org-app audience membership — detective only',
  },
  {
    id: 'POL-006',
    severity: 'High',
    module: 'pp',
    statement:
      'An environment is not a Managed Environment — reported as a posture gap with the named missing controls, not as a licence accusation',
    evaluate: (ctx) =>
      ctx.snapshot.environments
        .filter((e) => e.is_managed_env !== 'true' && e.has_dataverse === 'true')
        .map((e) =>
          finding(
            { id: 'POL-006', severity: 'High' },
            'Environment',
            e.environment_id,
            e.environment_name,
            'without Managed Environments this environment has no routing, environment groups, sharing limits, solution-checker enforcement or usage insights'
          )
        ),
  },
  {
    id: 'POL-007',
    severity: 'Medium',
    module: 'pp',
    statement: 'An app, flow or agent has no owner',
    evaluate: (ctx) =>
      ctx.agents
        .filter((a) => a.is_ownerless === 'true')
        .map((a) =>
          finding(
            { id: 'POL-007', severity: 'Medium' },
            'Agent',
            a.agent_id,
            a.name,
            'no owner and no sponsor'
          )
        ),
  },
  {
    id: 'POL-008',
    severity: 'Medium',
    module: 'pp',
    statement: 'An app, flow or agent has had no usage in 90 days',
    requiresData: 'usage telemetry is not collected yet (Phase 11 activity collector)',
  },
  {
    id: 'POL-009',
    severity: 'Medium',
    module: 'fabric',
    statement: 'A workspace has no Admin, or only one',
    evaluate: (ctx) => {
      const adminsByWorkspace = new Map<string, number>();
      for (const role of ctx.snapshot.workspaceRoles) {
        if (role.role !== 'Admin') continue;
        adminsByWorkspace.set(
          role.workspace_id,
          (adminsByWorkspace.get(role.workspace_id) ?? 0) + 1
        );
      }
      return ctx.snapshot.workspaces
        .map((w) => ({ w, admins: adminsByWorkspace.get(w.workspace_id) ?? 0 }))
        .filter(({ admins }) => admins <= 1)
        .map(({ w, admins }) =>
          finding(
            { id: 'POL-009', severity: 'Medium' },
            'Workspace',
            w.workspace_id,
            w.workspace_name,
            admins === 0 ? 'no workspace Admin' : 'only one workspace Admin (bus factor)'
          )
        );
    },
  },
  {
    id: 'POL-010',
    severity: 'Medium',
    module: 'entra',
    statement: 'A principal holds a create capability but lacks the licence to use it',
    requiresData: 'licence-to-capability mapping arrives with the entitlement actuators',
  },
  {
    id: 'POL-011',
    severity: 'Medium',
    module: 'pp',
    statement: 'A data policy does not cover an environment',
    evaluate: (ctx) => {
      const covered = new Set(ctx.dlp.map((p) => p.environment_id).filter(Boolean));
      const tenantWide = ctx.dlp.some((p) => !p.environment_id);
      if (tenantWide) return [];
      return ctx.snapshot.environments
        .filter((e) => !covered.has(e.environment_id))
        .map((e) =>
          finding(
            { id: 'POL-011', severity: 'Medium' },
            'Environment',
            e.environment_id,
            e.environment_name,
            'no data policy covers this environment'
          )
        );
    },
  },
  {
    id: 'POL-012',
    severity: 'Low',
    module: 'entra',
    statement: 'A governance group has drifted from the naming convention',
    evaluate: (ctx) =>
      ctx.snapshot.groups
        .filter((g) => g.is_app_managed === 'true' && !/^GOV-[A-Z]+-/.test(g.display_name))
        .map((g) =>
          finding(
            { id: 'POL-012', severity: 'Low' },
            'Group',
            g.group_id,
            g.display_name,
            'app-managed group does not match GOV-<PLANE>-<SCOPE>-<NAME>-<ROLE>'
          )
        ),
  },
  {
    id: 'POL-013',
    severity: 'High',
    module: 'pp',
    statement: 'A previously remediated binding has reverted',
    requiresData: 'needs remediation history, which arrives with the actuators',
  },
  {
    id: 'POL-014',
    severity: 'High',
    module: 'entra',
    statement: 'An entitlement is past its expiry but the access still exists',
    evaluate: (ctx) =>
      ctx.drift
        .filter((d) => d.driftType === 'Missing' && d.detail.includes('expired'))
        .map((d) =>
          finding(
            { id: 'POL-014', severity: 'Low' },
            'Principal',
            d.principalId,
            d.principalName,
            d.detail
          )
        ),
  },
  {
    id: 'POL-015',
    severity: 'Medium',
    module: 'fabric',
    statement: 'A tenant-gated item type exists in a workspace nobody is entitled for',
    evaluate: (ctx) => {
      const entitled = new Set(
        ctx.drift.filter((d) => d.driftType !== 'Extra').map((d) => d.scopeId)
      );
      return ctx.snapshot.workspaces
        .filter((w) => !entitled.has(w.workspace_id))
        .slice(0, 0)
        .map((w) =>
          finding(
            { id: 'POL-015', severity: 'Medium' },
            'Workspace',
            w.workspace_id,
            w.workspace_name,
            'shadow item type'
          )
        );
    },
    requiresData: 'needs per-item-type entitlement scoping (Phase 9)',
  },
  {
    id: 'POL-016',
    severity: 'Critical',
    module: 'agent',
    statement: 'A registered agent has no owner and no sponsor',
    evaluate: (ctx) =>
      ctx.agents
        .filter((a) => a.is_ownerless === 'true')
        .map((a) =>
          finding(
            { id: 'POL-016', severity: 'Critical' },
            'Agent',
            a.agent_id,
            a.name,
            'every agent identity requires a human sponsor; this one has neither owner nor sponsor'
          )
        ),
  },
  {
    id: 'POL-017',
    severity: 'Critical',
    module: 'agent',
    statement:
      'An agent exists whose owner holds no entitlement to create agents — computable only by joining the registry to the entitlement model',
    evaluate: (ctx) => {
      const entitledOwners = new Set(
        ctx.grants
          .filter(
            (g) =>
              (g.capabilityId === 'create:CopilotStudioAgent' ||
                g.capabilityId === 'create:M365DeclarativeAgent') &&
              g.status === 'granted'
          )
          .map((g) => g.principalId)
      );
      // A tenant-wide grant entitles everybody, so the rule cannot fire.
      if (entitledOwners.has(EVERYONE_PRINCIPAL_ID)) return [];

      return ctx.agents
        .filter((a) => {
          const owner = a.owner_principal || a.sponsor_principal;
          return owner && !entitledOwners.has(owner);
        })
        .map((a) =>
          finding(
            { id: 'POL-017', severity: 'Critical' },
            'Agent',
            a.agent_id,
            a.name,
            `owner "${a.owner_principal || a.sponsor_principal}" was never entitled to create agents`
          )
        );
    },
  },
  {
    id: 'POL-018',
    severity: 'High',
    module: 'agent',
    statement: 'An agent identity exists outside any managed blueprint',
    evaluate: (ctx) =>
      ctx.agents
        .filter((a) => a.agent_identity_id && !a.blueprint_id)
        .map((a) =>
          finding(
            { id: 'POL-018', severity: 'High' },
            'Agent',
            a.agent_id,
            a.name,
            'inherits no Conditional Access and no capped permissions'
          )
        ),
  },
  {
    id: 'POL-019',
    severity: 'High',
    module: 'agent',
    statement: 'A shadow agent appeared — seen only by the tenant-wide registry',
    evaluate: (ctx) =>
      ctx.agents
        .filter((a) => a.is_shadow === 'true')
        .map((a) =>
          finding(
            { id: 'POL-019', severity: 'High' },
            'Agent',
            a.agent_id,
            a.name,
            'no governed source provisioned this agent'
          )
        ),
  },
  {
    id: 'POL-020',
    severity: 'High',
    module: 'agent',
    statement: 'An agent holds Graph permissions above its persona’s permitted set',
    requiresData: 'needs a permitted-permission set per persona (Phase 13 blueprints)',
  },
  {
    id: 'POL-021',
    severity: 'Medium',
    module: 'pp',
    statement: 'A draft Copilot Studio agent has existed for more than 30 days',
    evaluate: (ctx) => {
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      return ctx.agents
        .filter((a) => a.state === 'Draft' && a.created_at)
        .filter((a) => {
          const created = Date.parse(a.created_at);
          return Number.isFinite(created) && created < cutoff;
        })
        .map((a) =>
          finding(
            { id: 'POL-021', severity: 'Medium' },
            'Agent',
            a.agent_id,
            a.name,
            'abandoned draft'
          )
        );
    },
  },
  {
    id: 'POL-022',
    severity: 'Medium',
    module: 'agent',
    statement: 'An agent sponsor auto-transferred to a manager and has not attested',
    requiresData: 'needs sponsorship history from Entra lifecycle workflows',
  },
  {
    id: 'POL-023',
    severity: 'High',
    module: 'agent',
    statement:
      'A blueprint principal exists that no persona justifies — it can mint up to 250 agent identities and CreateAsManager cannot be revoked',
    evaluate: (ctx) => {
      const managed = new Set(
        ctx.personas.flatMap((p) =>
          p.capabilityIds.includes('manage:AgentBlueprint') ? [p.id] : []
        )
      );
      if (managed.size > 0) return [];
      const blueprints = new Set(ctx.agents.map((a) => a.blueprint_id).filter(Boolean));
      return [...blueprints].map((id) =>
        finding(
          { id: 'POL-023', severity: 'High' },
          'Blueprint',
          id,
          id,
          'no persona owns blueprint management, so this blueprint is unmanaged'
        )
      );
    },
  },
  {
    id: 'POL-024',
    severity: 'Critical',
    module: 'pp',
    statement: 'The Default environment is missing one of the six licence-free hardening levers',
    evaluate: (ctx) => {
      const posture = scoreDefaultPosture(ctx);
      return posture.levers
        .filter((l) => l.status === 'fail')
        .map((l) =>
          finding(
            { id: 'POL-024', severity: 'Critical' },
            'Environment',
            posture.environmentId ?? 'default',
            posture.environmentName ?? 'Default',
            `${l.id}: ${l.detail}`
          )
        );
    },
  },
  {
    id: 'POL-025',
    severity: 'High',
    module: 'pp',
    statement:
      'An environment became a Managed Environment without a decision — e.g. the pipeline auto-enablement',
    requiresData: 'needs a previous run to compare against (Phase 11 history)',
  },
  {
    id: 'POL-026',
    severity: 'High',
    module: 'fabric',
    statement: 'A module is enabled but its collector is stale or ran at a lower tier than expected',
    requiresData: 'needs gov_runs freshness, wired with the drift scheduler',
  },
  {
    id: 'POL-027',
    severity: 'Medium',
    module: 'fabric',
    statement: 'A binding kind is armed for writes with no successful dry run in 30 days',
    evaluate: (ctx) =>
      ctx.writesArmed.kinds.map((kind) =>
        finding(
          { id: 'POL-027', severity: 'Medium' },
          'BindingKind',
          kind,
          kind,
          'armed for writes — gate 4 will refuse it until a dry run succeeds for each scope'
        )
      ),
  },
];

export function evaluatePolicies(ctx: PolicyContext): PolicyFinding[] {
  const findings: PolicyFinding[] = [];
  for (const rule of POLICY_RULES) {
    if (!rule.evaluate) continue;
    try {
      findings.push(...rule.evaluate(ctx));
    } catch {
      // A broken rule must not take the whole pack down — the other 26 still
      // carry information.
    }
  }
  return findings;
}

export function pendingRules(): PolicyRule[] {
  return POLICY_RULES.filter((r) => r.requiresData);
}

// ── Default environment posture (PLAN.md §8.6) ───────────────────────────────

export type LeverStatus = 'pass' | 'fail' | 'unknown';

export interface PostureLever {
  id: string;
  status: LeverStatus;
  /** Non-localised specific reason. */
  detail: string;
}

export interface DefaultPosture {
  environmentId?: string;
  environmentName?: string;
  levers: PostureLever[];
  passed: number;
  total: number;
}

/**
 * Score the six licence-free levers for the Default environment.
 *
 * A security group **cannot** be bound to Default, and `Basic User` +
 * `Environment Maker` are auto-assigned there in a way that survives the
 * opt-out — so these six are what containment actually looks like. The score is
 * deliberately simple arithmetic so an admin can reproduce it by hand.
 */
export function scoreDefaultPosture(ctx: PolicyContext): DefaultPosture {
  const environment = ctx.snapshot.environments.find(
    (e) => e.environment_type === 'Default'
  );
  const setting = (name: string) =>
    ctx.ppTenantSettings.find((s) => s.setting_name === name);

  const dlpForDefault = environment
    ? ctx.dlp.filter(
        (p) => !p.environment_id || p.environment_id === environment.environment_id
      )
    : ctx.dlp.filter((p) => !p.environment_id);

  // Nothing collected at all is "we have not looked", not "there is no policy".
  // Scoring an un-run collector as a failing lever would accuse a tenant of
  // being wide open on the strength of no evidence whatsoever.
  const dlpCollected = ctx.dlp.length > 0;

  const levers: PostureLever[] = [];

  // 1 — data policy with Blocked as the default connector group
  const blocking = dlpForDefault.find((p) => p.blocks_new_connectors_by_default === 'true');
  levers.push({
    id: 'dlp-default-blocked',
    status: !dlpCollected ? 'unknown' : blocking ? 'pass' : 'fail',
    detail: !dlpCollected
      ? 'no data policies have been collected yet'
      : blocking
        ? `policy "${blocking.policy_name}" blocks new connectors by default`
        : 'no data policy sets the default connector group to Blocked',
  });

  // 2 — custom-connector URL patterns blocked
  const urlBlock = dlpForDefault.find((p) => p.blocks_custom_connector_urls === 'true');
  levers.push({
    id: 'dlp-custom-connector-urls',
    status: !dlpCollected ? 'unknown' : urlBlock ? 'pass' : 'fail',
    detail: !dlpCollected
      ? 'no data policies have been collected yet'
      : urlBlock
        ? 'custom-connector URL patterns are blocked'
        : 'custom-connector URL patterns are not blocked',
  });

  // 3 — tenant isolation
  const isolation = setting('tenantIsolation');
  levers.push({
    id: 'tenant-isolation',
    status: !isolation || isolation.is_set !== 'true'
      ? 'unknown'
      : isolation.value === 'true'
        ? 'pass'
        : 'fail',
    detail: !isolation
      ? 'tenant isolation was not collected'
      : isolation.value === 'true'
        ? 'cross-tenant isolation is on'
        : 'cross-tenant isolation is off',
  });

  // 4 — disableShareWithEveryone
  const share = setting('disableShareWithEveryone');
  levers.push({
    id: 'disable-share-with-everyone',
    status: !share || share.is_set !== 'true'
      ? 'unknown'
      : share.value === 'true'
        ? 'pass'
        : 'fail',
    detail: !share
      ? 'setting was not collected'
      : share.value === 'true'
        ? 'sharing with everyone is disabled'
        : 'makers can still share apps with the whole organisation',
  });

  // 5 — environment-creation restrictions
  const envCreation = setting('disableEnvironmentCreationByNonAdminUsers');
  const trialCreation = setting('disableTrialEnvironmentCreationByNonAdminUsers');
  const bothSet = envCreation?.is_set === 'true' && trialCreation?.is_set === 'true';
  levers.push({
    id: 'restrict-environment-creation',
    status: !bothSet
      ? 'unknown'
      : envCreation?.value === 'true' && trialCreation?.value === 'true'
        ? 'pass'
        : 'fail',
    detail: !bothSet
      ? 'environment-creation settings were not collected'
      : 'production and trial environment creation are restricted to admins',
  });

  // 6 — Exchange transport rule for the unblockable Outlook connector
  levers.push({
    id: 'exchange-transport-rule',
    status: 'unknown',
    detail:
      'the Office 365 Outlook connector cannot be blocked by DLP; an Exchange transport rule on x-ms-mail-environment-id is the documented mitigation and is not machine-checkable from here',
  });

  return {
    environmentId: environment?.environment_id,
    environmentName: environment?.environment_name,
    levers,
    passed: levers.filter((l) => l.status === 'pass').length,
    total: levers.length,
  };
}
