import { GovTableView, type ColumnDef } from '@/components/GovTableView';
import { useT } from '@/i18n';

const COLUMNS: ColumnDef[] = [
  { key: 'name', labelKey: 'agent.col.name' },
  { key: 'platform', labelKey: 'agent.col.platform', mono: true },
  { key: 'state', labelKey: 'agent.col.state', mono: true },
  { key: 'owner_principal', labelKey: 'agent.col.owner', mono: true },
  { key: 'sponsor_principal', labelKey: 'agent.col.sponsor', mono: true },
  {
    key: 'is_shadow',
    labelKey: 'agent.col.risk',
    render: (value, row) => {
      const flags: string[] = [];
      if (value === 'true') flags.push('shadow');
      if (row.is_ownerless === 'true') flags.push('ownerless');
      if (flags.length === 0) return '—';
      return (
        <span className="inline-flex rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-800 ring-1 ring-rose-600/20 ring-inset">
          {flags.join(' · ')}
        </span>
      );
    },
  },
];

/**
 * M-AGENT — the agent inventory (PLAN.md §7, page 15).
 *
 * The load-bearing fact this page exists to make visible: **Agent 365 governs
 * agents after they exist; it does not gate creation.** Copilot Studio agents
 * auto-register on create, and Microsoft's own documented answer is that agent
 * creation cannot be disabled.
 *
 * So the two risk flags here are the product, and neither is discoverable from
 * a single source — they come out of merging the registry, Entra Agent ID and
 * the Dataverse `bot` table:
 *   * **shadow**    — only the tenant-wide registry saw it; nobody here provisioned it
 *   * **ownerless** — no owner and no sponsor, despite sponsorship being mandatory
 */
export function AgentsPage() {
  const t = useT();
  return (
    <GovTableView
      table="gov_actual_agents"
      columns={COLUMNS}
      options={{
        columns: [
          'agent_id',
          'name',
          'platform',
          'state',
          'owner_principal',
          'sponsor_principal',
          'is_shadow',
          'is_ownerless',
          'sources_json',
        ],
        orderBy: 'name',
      }}
      titleKey="agent.agents.title"
      introKey="agent.agents.intro"
    >
      {(rows) => {
        const shadow = rows.filter((r) => r.is_shadow === 'true');
        const ownerless = rows.filter((r) => r.is_ownerless === 'true');
        const drafts = rows.filter((r) => r.state === 'Draft');

        return (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
                <p className="text-xs tracking-wide text-gray-500 uppercase">
                  {t('agent.stat.total')}
                </p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">{rows.length}</p>
              </div>
              <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
                <p className="text-xs tracking-wide text-gray-500 uppercase">
                  {t('agent.stat.shadow')}
                </p>
                <p className="mt-1 text-2xl font-semibold text-rose-700">{shadow.length}</p>
              </div>
              <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
                <p className="text-xs tracking-wide text-gray-500 uppercase">
                  {t('agent.stat.ownerless')}
                </p>
                <p className="mt-1 text-2xl font-semibold text-rose-700">{ownerless.length}</p>
              </div>
              <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
                <p className="text-xs tracking-wide text-gray-500 uppercase">
                  {t('agent.stat.drafts')}
                </p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">{drafts.length}</p>
              </div>
            </div>

            <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700 ring-1 ring-slate-500/10 ring-inset">
              {t('agent.notPreventable')}
            </p>
          </div>
        );
      }}
    </GovTableView>
  );
}

export default AgentsPage;
