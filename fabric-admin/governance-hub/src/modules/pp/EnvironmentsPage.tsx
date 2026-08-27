import { FlagPill, GovTableView, type ColumnDef } from '@/components/GovTableView';
import { useT } from '@/i18n';

const COLUMNS: ColumnDef[] = [
  { key: 'environment_name', labelKey: 'pp.col.environment' },
  { key: 'environment_type', labelKey: 'inventory.column.type', mono: true },
  {
    key: 'security_group_assignable',
    labelKey: 'pp.col.securityGroup',
    render: (value, row) =>
      value === 'false' ? (
        <FlagPill
          value="false"
          good="true"
          labelTrue="pp.flag.sgBound"
          labelFalse="pp.flag.sgImpossible"
        />
      ) : (
        <FlagPill
          value={row.security_group_bound ?? 'false'}
          good="true"
          labelTrue="pp.flag.sgBound"
          labelFalse="pp.flag.sgMissing"
        />
      ),
  },
  {
    key: 'is_managed_env',
    labelKey: 'pp.col.managed',
    render: (value) => (
      <FlagPill
        value={value}
        good="true"
        labelTrue="pp.flag.managedOn"
        labelFalse="pp.flag.managedOff"
      />
    ),
  },
  { key: 'region', labelKey: 'pp.col.region', mono: true },
];

/**
 * M-PP — environments, and the Default-environment hole (PLAN.md §8.6, page 13).
 *
 * Two documented constraints drive this page:
 *  * a security group **cannot** be bound to a Default or Developer environment
 *  * `Basic User` + `Environment Maker` are auto-assigned in Default and that
 *    **survives the opt-out** — there is no supported way to remove it
 *
 * So an unbound Default environment is not a misconfiguration to fix, it is a
 * structural fact to contain. The page distinguishes "not bound" from "cannot
 * be bound" for exactly that reason.
 */
export function EnvironmentsPage() {
  const t = useT();
  return (
    <GovTableView
      table="gov_actual_pp_environments"
      columns={COLUMNS}
      options={{
        columns: [
          'environment_id',
          'environment_name',
          'environment_type',
          'region',
          'security_group_assignable',
          'security_group_bound',
          'is_managed_env',
          'has_dataverse',
        ],
        orderBy: 'environment_name',
      }}
      titleKey="pp.environments.title"
      introKey="pp.environments.intro"
    >
      {(rows) => {
        const unbound = rows.filter(
          (r) => r.security_group_assignable === 'true' && r.security_group_bound !== 'true'
        );
        const structural = rows.filter((r) => r.security_group_assignable === 'false');
        const unmanaged = rows.filter((r) => r.is_managed_env !== 'true');

        return (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
                <p className="text-xs tracking-wide text-gray-500 uppercase">
                  {t('pp.stat.environments')}
                </p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">{rows.length}</p>
              </div>
              <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
                <p className="text-xs tracking-wide text-gray-500 uppercase">
                  {t('pp.stat.unbound')}
                </p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">{unbound.length}</p>
              </div>
              <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
                <p className="text-xs tracking-wide text-gray-500 uppercase">
                  {t('pp.stat.unmanaged')}
                </p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">{unmanaged.length}</p>
              </div>
            </div>

            {structural.length > 0 && (
              <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-600/20 ring-inset">
                <h3 className="text-sm font-semibold text-amber-900">
                  {t('pp.defaultHole.title')}
                </h3>
                <p className="mt-1 text-sm text-amber-900/80">{t('pp.defaultHole.body')}</p>
                <p className="mt-2 font-mono text-xs text-amber-900/70">
                  {structural.map((r) => r.environment_name || r.environment_id).join(' · ')}
                </p>
              </div>
            )}
          </div>
        );
      }}
    </GovTableView>
  );
}

export default EnvironmentsPage;
