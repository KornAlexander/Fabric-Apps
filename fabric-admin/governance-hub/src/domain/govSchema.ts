/**
 * The `gov_*` table catalogue (PLAN.md §12).
 *
 * This is the **allow-list** every DAX query is validated against. Nothing
 * reaches a query unless it appears here, which is what makes the read path
 * injection-proof by construction rather than by escaping (OWASP A03).
 *
 * It must stay in step with `bootstrap/gov_bootstrap.py`; a structural test
 * (`src/__tests__/govSchema.test.ts`) parses the notebook source and fails the
 * build if the two drift apart.
 */
import type { ModuleId } from '@/modules/types';

/** Columns every `gov_actual_*` row carries. */
export const PROVENANCE_COLUMNS = ['run_id', 'scanned_at'] as const;

export interface GovTableDef {
  /** Owning module, or `core` for tables no plane owns. */
  module: ModuleId | 'core';
  columns: readonly string[];
}

export const GOV_TABLES = {
  // ── core ──────────────────────────────────────────────────────────────────
  gov_runs: {
    module: 'core',
    columns: [
      'run_id',
      'collector',
      'module',
      'tier',
      'started_at',
      'finished_at',
      'n_objects',
      'n_errors',
      'error_json',
      'duration_s',
    ],
  },  /** Append-only. The product's real deliverable for an auditor (PLAN.md §12). */
  gov_audit: {
    module: 'core',
    columns: [
      'audit_id',
      'ts',
      'actor',
      'actor_type',
      'action',
      'plane',
      'target_type',
      'target_id',
      'before_json',
      'after_json',
      'request_id',
      'correlation_id',
      'outcome',
      'error',
    ],
  },
  /** Gate-4 evidence: a successful dry run per binding kind × scope. */
  gov_dry_runs: {
    module: 'core',
    columns: ['binding_kind', 'scope_id', 'succeeded_at', 'actor', 'correlation_id'],
  },
  // ── M-FABRIC ──────────────────────────────────────────────────────────────
  gov_actual_tenant_settings: {
    module: 'fabric',
    columns: [
      'setting_name',
      'title',
      'setting_group',
      'enabled',
      'scope',
      'can_specify_security_groups',
      'delegate_to_capacity',
      'delegate_to_domain',
      'delegate_to_workspace',
      'enabled_groups_json',
      'excluded_groups_json',
      'properties_json',
    ],
  },
  gov_actual_capacity_overrides: {
    module: 'fabric',
    columns: ['capacity_id', 'setting_name', 'enabled', 'enabled_groups_json'],
  },
  gov_actual_workspaces: {
    module: 'fabric',
    columns: [
      'workspace_id',
      'workspace_name',
      'workspace_type',
      'capacity_id',
      'state',
      'description',
    ],
  },
  gov_actual_workspace_roles: {
    module: 'fabric',
    columns: ['workspace_id', 'principal_id', 'principal_type', 'principal_name', 'role'],
  },
  gov_actual_items: {
    module: 'fabric',
    columns: [
      'item_id',
      'item_type',
      'item_name',
      'workspace_id',
      'workspace_name',
      'description',
      'is_tenant_gated',
    ],
  },
  gov_actual_orgapps: {
    module: 'fabric',
    columns: ['app_id', 'app_name', 'kind', 'workspace_id', 'workspace_name'],
  },
  gov_actual_orgapp_audiences: {
    module: 'fabric',
    columns: [
      'audience_id',
      'audience_name',
      'app_id',
      'workspace_id',
      'membership_source',
      'membership_known',
    ],
  },

  // ── M-ENTRA ───────────────────────────────────────────────────────────────
  gov_actual_entra_groups: {
    module: 'entra',
    columns: [
      'group_id',
      'display_name',
      'mail',
      'group_type',
      'security_enabled',
      'is_app_managed',
      'description',
    ],
  },
  gov_actual_entra_group_members: {
    module: 'entra',
    columns: [
      'group_id',
      'principal_id',
      'principal_type',
      'principal_name',
      'is_transitive',
      'depth',
    ],
  },
  gov_actual_licenses: {
    module: 'entra',
    columns: [
      'principal_id',
      'principal_name',
      'sku_id',
      'sku_name',
      'assigned_via',
      'group_id',
      'disabled_plans_json',
    ],
  },

  // ── M-PP ──────────────────────────────────────────────────────────────────
  gov_actual_pp_environments: {
    module: 'pp',
    columns: [
      'environment_id',
      'environment_name',
      'environment_type',
      'region',
      'has_dataverse',
      'security_group_id',
      'security_group_assignable',
      'security_group_bound',
      'is_managed_env',
      'protection_level',
      'environment_group_id',
      'created_by',
      'created_at',
    ],
  },
  gov_actual_pp_roles: {
    module: 'pp',
    columns: [
      'environment_id',
      'role_id',
      'role_name',
      'is_predefined',
      'is_customizable',
      'business_unit_id',
    ],
  },
  gov_actual_pp_role_privileges: {
    module: 'pp',
    columns: [
      'environment_id',
      'role_id',
      'privilege_name',
      'table_logical_name',
      'privilege',
      'depth',
      'gates_agent_authoring',
    ],
  },
  gov_actual_pp_role_assignments: {
    module: 'pp',
    columns: [
      'environment_id',
      'principal_id',
      'principal_type',
      'principal_name',
      'team_type',
      'azure_group_id',
      'role_id',
      'role_name',
    ],
  },
  gov_actual_pp_resources: {
    module: 'pp',
    columns: [
      'environment_id',
      'resource_type',
      'resource_id',
      'resource_name',
      'owner_name',
      'created_at',
      'state',
      'is_orphaned',
    ],
  },
  gov_actual_pp_dlp: {
    module: 'pp',
    columns: [
      'policy_id',
      'policy_name',
      'environment_id',
      'scope',
      'default_connector_group',
      'blocks_new_connectors_by_default',
      'blocks_custom_connector_urls',
      'connector_groups_json',
    ],
  },
  gov_actual_pp_tenant_settings: {
    module: 'pp',
    columns: ['setting_name', 'value', 'is_set', 'source', 'detail_json'],
  },

  // ── M-AGENT ───────────────────────────────────────────────────────────────
  gov_actual_agents: {
    module: 'agent',
    columns: [
      'agent_id',
      'name',
      'platform',
      'source',
      'state',
      'owner_principal',
      'sponsor_principal',
      'blueprint_id',
      'agent_identity_id',
      'environment_id',
      'risk_flags_json',
      'created_at',
      'sources_json',
      'is_shadow',
      'is_ownerless',
    ],
  },
  gov_actual_agent_blueprints: {
    module: 'agent',
    columns: [
      'blueprint_id',
      'display_name',
      'is_multitenant',
      'sponsor_principal',
      'granted_permissions_json',
      'is_app_managed',
    ],
  },
} as const satisfies Record<string, GovTableDef>;

export type GovTableName = keyof typeof GOV_TABLES;

export function isGovTable(name: string): name is GovTableName {
  return Object.prototype.hasOwnProperty.call(GOV_TABLES, name);
}

/** Every column a table exposes, including the provenance pair.
 *
 * Core ledgers carry their own timestamps and are not the product of a collector
 * run, so appending `run_id` / `scanned_at` to them would invent columns the
 * bootstrap never created — and the query would fail at runtime, not here.
 */
export function columnsOf(table: GovTableName): readonly string[] {
  const base = GOV_TABLES[table].columns as readonly string[];
  return GOV_TABLES[table].module === 'core' ? base : [...base, ...PROVENANCE_COLUMNS];
}

export function hasColumn(table: GovTableName, column: string): boolean {
  return columnsOf(table).includes(column);
}

export function tablesForModule(module: ModuleId | 'core'): GovTableName[] {
  return (Object.keys(GOV_TABLES) as GovTableName[]).filter(
    (name) => GOV_TABLES[name].module === module
  );
}
