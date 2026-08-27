import { FlagPill, GovTableView, type ColumnDef } from '@/components/GovTableView';
import { useT } from '@/i18n';

const COLUMNS: ColumnDef[] = [
  { key: 'display_name', labelKey: 'entra.col.group' },
  { key: 'group_type', labelKey: 'inventory.column.type', mono: true },
  {
    key: 'is_app_managed',
    labelKey: 'entra.col.managed',
    render: (value) => (
      <FlagPill
        value={value}
        good="true"
        labelTrue="entra.flag.appManaged"
        labelFalse="entra.flag.preExisting"
      />
    ),
  },
  { key: 'mail', labelKey: 'entra.col.mail', mono: true },
];

/**
 * M-ENTRA — governance groups (PLAN.md §13, page 16).
 *
 * Entra is the compiler's target instruction set: security groups are the one
 * currency all four planes accept, so almost every per-user write reduces to a
 * single Graph call against one of these.
 *
 * `is_app_managed` is the safety line. Groups this app created (the `GOV-`
 * convention) are ours to change; everything else is read-only to us, because a
 * governance tool that edits groups it did not create is a liability.
 */
export function GroupsPage() {
  const t = useT();
  return (
    <GovTableView
      table="gov_actual_entra_groups"
      columns={COLUMNS}
      options={{
        columns: ['group_id', 'display_name', 'group_type', 'is_app_managed', 'mail'],
        orderBy: 'display_name',
      }}
      titleKey="entra.groups.title"
      introKey="entra.groups.intro"
    >
      {(rows) => {
        const managed = rows.filter((r) => r.is_app_managed === 'true');
        return (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
              <p className="text-xs tracking-wide text-gray-500 uppercase">
                {t('entra.stat.groups')}
              </p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{rows.length}</p>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
              <p className="text-xs tracking-wide text-gray-500 uppercase">
                {t('entra.stat.appManaged')}
              </p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{managed.length}</p>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
              <p className="text-xs tracking-wide text-gray-500 uppercase">
                {t('entra.stat.readOnly')}
              </p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">
                {rows.length - managed.length}
              </p>
            </div>
          </div>
        );
      }}
    </GovTableView>
  );
}

export default GroupsPage;
