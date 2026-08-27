/**
 * Licence impact of a binding (PLAN.md §8.5, decision D19).
 *
 * The product claim is precise: **the Governance Hub needs no premium licence
 * to run, and its Power Platform controls work without Managed Environments.**
 * That claim is only worth making if it is checkable, so every binding kind
 * declares what it costs and a test asserts the writable set stays free.
 *
 * The distinction that matters is *consumption*, not entitlement. Managed
 * Environments licensing is tied to **active usage** — "every user running an
 * app", and the compliance report "excludes users who didn't launch an app".
 * Adding somebody to a group therefore consumes nothing by itself.
 */
export type LicenceCost =
  /** Costs nothing, ever. */
  | 'free'
  /** Free to configure, but it makes premium licences a requirement for
   *  active usage in that environment. Never armed by default. */
  | 'enables-premium-requirement'
  /** Not a write — a manual task or a detective-only control. */
  | 'not-a-write';

export interface LicenceNote {
  cost: LicenceCost;
  /** Non-localised, specific, quotable in a licence conversation. */
  detail: string;
}

export const LICENCE_BY_BINDING_KIND: Record<string, LicenceNote> = {
  // ── Entra ────────────────────────────────────────────────────────────────
  entra_group_member: {
    cost: 'free',
    detail: 'Group membership alone consumes nothing; licensing follows active usage.',
  },
  entra_license_group: {
    cost: 'free',
    detail:
      'Group-based licensing assigns licences the customer already owns. The binding itself costs nothing.',
  },

  // ── Fabric ───────────────────────────────────────────────────────────────
  fabric_workspace_role: {
    cost: 'free',
    detail: 'A workspace role is not a licence. Capacity is billed regardless of role assignments.',
  },
  fabric_tenant_setting: {
    cost: 'free',
    detail: 'Tenant settings are administrative configuration with no licence prerequisite.',
  },
  fabric_capacity_override: {
    cost: 'free',
    detail: 'A capacity-level override changes scope, not billing.',
  },
  fabric_item_permission: {
    cost: 'not-a-write',
    detail:
      'No write API exists for item-level permissions, so this is reported and never applied.',
  },
  orgapp_audience_member: {
    cost: 'not-a-write',
    detail: 'Org-app audience membership is portal-only — a guided task, then verified.',
  },

  // ── Power Platform — the licence-free set (PLAN.md §8.5) ─────────────────
  pp_env_security_group: {
    cost: 'free',
    detail:
      'Environment membership is the main preventive control in Power Platform and needs no premium licence.',
  },
  pp_dataverse_role: {
    cost: 'free',
    detail:
      'Dataverse security roles are free to assign; the app user driving them is unlicensed by design.',
  },
  pp_data_policy: {
    cost: 'free',
    detail:
      'Data policies have no licence prerequisite — they are absent from the licensing FAQ’s security and governance list.',
  },
  pp_tenant_isolation: {
    cost: 'free',
    detail: 'Tenant isolation is tenant-level administrative configuration.',
  },
  pp_tenant_setting: {
    cost: 'free',
    detail:
      'Environment-creation restrictions and disableShareWithEveryone need no licence and no Managed Environments.',
  },
  pp_managed_env: {
    cost: 'enables-premium-requirement',
    detail:
      'Enabling Managed Environments makes a premium licence a requirement for ACTIVE USAGE of that environment. Never enabled as a side effect of granting access.',
  },
  pp_routing_rule: {
    cost: 'not-a-write',
    detail: 'PPAC only, and it requires Managed Environments — raised as a task.',
  },

  // ── Agents / M365 ────────────────────────────────────────────────────────
  entra_agent_blueprint: {
    cost: 'free',
    detail:
      'Blueprints are Entra objects. Agent 365 licensing is a separate, prior decision — this binding does not change it.',
  },
  entra_access_package: {
    cost: 'free',
    detail: 'Entra entitlement management is licensed at the tenant level, not per binding.',
  },
  agent_blueprint_membership: {
    cost: 'free',
    detail: 'Attaching an agent identity to a blueprint consumes nothing.',
  },
  agent_sponsor: {
    cost: 'free',
    detail: 'Setting a human sponsor is metadata, not entitlement.',
  },
  a365_registry_action: {
    cost: 'not-a-write',
    detail: 'Block / Delete / Reassign are UI-only in the Agent 365 registry — raised as tasks.',
  },
  m365_agent_access: {
    cost: 'not-a-write',
    detail: 'Admin-center only — raised as a task.',
  },

  // ── App-internal ─────────────────────────────────────────────────────────
  app_role: { cost: 'free', detail: 'Internal to this app. Writes nothing to a control plane.' },
};

export function licenceCostOf(bindingKind: string): LicenceNote {
  return (
    LICENCE_BY_BINDING_KIND[bindingKind] ?? {
      cost: 'free',
      // An unknown kind is reported, not assumed expensive — but the invariant
      // test below makes sure "unknown" never actually happens.
      detail: 'No licence impact recorded for this binding kind.',
    }
  );
}

export interface LicenceImpact {
  /** True when nothing in the set consumes or triggers a premium licence. */
  free: boolean;
  /** Kinds that would make premium licences a requirement for active usage. */
  premiumTriggers: string[];
  notes: { bindingKind: string; note: LicenceNote }[];
}

/**
 * What would applying these bindings cost?
 *
 * Used to make the Phase-10 exit criterion visible in the product rather than
 * only in a test: *"agent author in environment X, granted via a group team,
 * with zero premium licences consumed."*
 */
export function licenceImpact(bindingKinds: string[]): LicenceImpact {
  const notes = [...new Set(bindingKinds)].map((bindingKind) => ({
    bindingKind,
    note: licenceCostOf(bindingKind),
  }));
  const premiumTriggers = notes
    .filter((n) => n.note.cost === 'enables-premium-requirement')
    .map((n) => n.bindingKind);
  return { free: premiumTriggers.length === 0, premiumTriggers, notes };
}

/**
 * What a customer gives up by not enabling Managed Environments (PLAN.md §8.5).
 *
 * Stated as capability loss rather than as a reason to buy: the tool's job is
 * to make the trade-off legible, not to upsell.
 */
export const WITHOUT_MANAGED_ENVIRONMENTS = [
  'Default-environment routing — so the Default leak can only be contained, never closed',
  'Environment groups and rules',
  'Proactive sharing limits — over-sharing is detected after the fact instead',
  'Solution-checker enforcement on import',
  'Weekly usage insights, maker welcome content, IP firewall, CMK, Customer Lockbox, vNet',
  'Pipelines in Power Platform — note that target environments get Managed Environments auto-enabled',
] as const;
