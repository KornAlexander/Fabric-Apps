import { GovTableView, type ColumnDef } from '@/components/GovTableView';
import { useT } from '@/i18n';

const COLUMNS: ColumnDef[] = [
  { key: 'workspace_name', labelKey: 'fabric.col.workspace' },
  { key: 'workspace_type', labelKey: 'inventory.column.type', mono: true },
  { key: 'capacity_id', labelKey: 'fabric.col.capacity', mono: true },
  { key: 'state', labelKey: 'fabric.col.state', mono: true },
];

/**
 * M-FABRIC — workspaces (PLAN.md §13, page 12).
 *
 * A workspace is the unit that actually decides who may create a Power BI
 * report or a Fabric item, because **Fabric has no per-item-type role**: a
 * Contributor can create every item type not separately gated by a tenant
 * setting. So "which workspaces exist, on what capacity" is the ground truth
 * the entitlement model is written against.
 */
export function WorkspacesPage() {
  const t = useT();
  return (
    <GovTableView
      table="gov_actual_workspaces"
      columns={COLUMNS}
      options={{
        columns: ['workspace_id', 'workspace_name', 'workspace_type', 'capacity_id', 'state'],
        orderBy: 'workspace_name',
      }}
      titleKey="fabric.workspaces.title"
      introKey="fabric.workspaces.intro"
    >
      {(rows) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
            <p className="text-xs tracking-wide text-gray-500 uppercase">
              {t('fabric.stat.workspaces')}
            </p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{rows.length}</p>
          </div>
          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
            <p className="text-xs tracking-wide text-gray-500 uppercase">
              {t('fabric.stat.onCapacity')}
            </p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">
              {rows.filter((r) => r.capacity_id).length}
            </p>
          </div>
          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
            <p className="text-xs tracking-wide text-gray-500 uppercase">
              {t('fabric.stat.noCapacity')}
            </p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">
              {rows.filter((r) => !r.capacity_id).length}
            </p>
          </div>
        </div>
      )}
    </GovTableView>
  );
}

export default WorkspacesPage;
