/**
 * Loads the snapshot the effective-permissions engine needs (PLAN.md §11.4).
 *
 * One query per source table, run in parallel. A table that fails to load comes
 * back empty *and* is reported, because a silently-empty table would make the
 * engine under-report access — the most dangerous direction for a governance
 * answer to be wrong in.
 */
import { EMPTY_SNAPSHOT, type GovernanceSnapshot } from '@/domain/effective';
import type { GovTableName } from '@/domain/govSchema';

import { queryTable, type ModelTarget } from './govModel';

/** Table → the snapshot field it fills, and the columns the engine reads. */
const SOURCES: {
  table: GovTableName;
  field: keyof GovernanceSnapshot;
  columns: string[];
  module: string;
}[] = [
  {
    table: 'gov_actual_workspaces',
    field: 'workspaces',
    columns: ['workspace_id', 'workspace_name', 'workspace_type'],
    module: 'fabric',
  },
  {
    table: 'gov_actual_workspace_roles',
    field: 'workspaceRoles',
    columns: ['workspace_id', 'principal_id', 'principal_type', 'principal_name', 'role'],
    module: 'fabric',
  },
  {
    table: 'gov_actual_tenant_settings',
    field: 'tenantSettings',
    columns: ['setting_name', 'title', 'scope', 'enabled', 'enabled_groups_json'],
    module: 'fabric',
  },
  {
    table: 'gov_actual_entra_groups',
    field: 'groups',
    columns: ['group_id', 'display_name', 'is_app_managed'],
    module: 'entra',
  },
  {
    table: 'gov_actual_entra_group_members',
    field: 'groupMembers',
    columns: [
      'group_id',
      'principal_id',
      'principal_type',
      'principal_name',
      'is_transitive',
      'depth',
    ],
    module: 'entra',
  },
  {
    table: 'gov_actual_pp_environments',
    field: 'environments',
    columns: ['environment_id', 'environment_name', 'environment_type', 'has_dataverse'],
    module: 'pp',
  },
  {
    table: 'gov_actual_pp_roles',
    field: 'ppRoles',
    columns: ['environment_id', 'role_id', 'role_name', 'is_customizable'],
    module: 'pp',
  },
  {
    table: 'gov_actual_pp_role_privileges',
    field: 'ppPrivileges',
    columns: [
      'environment_id',
      'role_id',
      'table_logical_name',
      'privilege',
      'depth',
      'gates_agent_authoring',
    ],
    module: 'pp',
  },
  {
    table: 'gov_actual_pp_role_assignments',
    field: 'ppAssignments',
    columns: [
      'environment_id',
      'principal_id',
      'principal_type',
      'principal_name',
      'azure_group_id',
      'role_id',
      'role_name',
    ],
    module: 'pp',
  },
];

export interface SnapshotLoad {
  snapshot: GovernanceSnapshot;
  /** Tables that could not be read. Their absence changes the answer. */
  failures: { table: string; message: string }[];
  /** Tables that loaded but were empty — usually a collector that has not run. */
  emptyTables: string[];
}

export async function loadSnapshot(
  target: ModelTarget,
  enabledModules?: string[]
): Promise<SnapshotLoad> {
  const snapshot: GovernanceSnapshot = { ...EMPTY_SNAPSHOT };
  const failures: SnapshotLoad['failures'] = [];
  const emptyTables: string[] = [];

  const sources = SOURCES.filter(
    (s) => !enabledModules || enabledModules.includes(s.module)
  );

  const results = await Promise.allSettled(
    sources.map((source) =>
      queryTable(target, source.table, { columns: source.columns, topN: 10000 })
    )
  );

  results.forEach((result, index) => {
    const source = sources[index];
    if (result.status === 'fulfilled') {
      snapshot[source.field] = result.value;
      if (result.value.length === 0) emptyTables.push(source.table);
    } else {
      failures.push({
        table: source.table,
        message:
          result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });

  return { snapshot, failures, emptyTables };
}
