import { useCallback, useEffect, useMemo, useState } from 'react';

import { getGovEnv } from '@/config/govEnv';
import { CAPABILITIES } from '@/domain/capabilities';
import {
  EMPTY_SNAPSHOT,
  EVERYONE_PRINCIPAL_ID,
  capabilityReach,
  computeEffectiveGrants,
  expandGrant,
  grantReach,
  listPrincipals,
  whatCan,
  whoCan,
  type EffectiveGrant,
  type GovernanceSnapshot,
} from '@/domain/effective';
import { useGovernance } from '@/hooks/GovernanceContext';
import { useT } from '@/i18n';
import { getModelTarget } from '@/services/govModel';
import { loadSnapshot } from '@/services/effectiveData';

type Direction = 'who' | 'what';

/** Members listed before the list is truncated. Nobody reads 300,000 names. */
const MEMBER_PAGE = 25;

const STATUS_STYLE: Record<EffectiveGrant['status'], string> = {
  granted: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  blocked: 'bg-gray-100 text-gray-600 ring-gray-500/20',
  unknown: 'bg-amber-50 text-amber-900 ring-amber-600/20',
};

/**
 * Can-Do Explorer (PLAN.md §11.4) — the headline feature.
 *
 * Answers the question that started the project: *who can create a Copilot Studio
 * agent / a Power App / a Fabric data agent / a Power BI report, right now, and
 * why?*
 *
 * Every row carries a **derivation path**, because an answer an admin cannot
 * argue with is an answer they will not act on. And `Everyone` is a real result,
 * not an empty one — several controls genuinely grant to the whole tenant.
 */
export function CanDoPage() {
  const t = useT();
  const { config } = useGovernance();

  const [direction, setDirection] = useState<Direction>('who');
  const [capabilityId, setCapabilityId] = useState('create:CopilotStudioAgent');
  const [principalId, setPrincipalId] = useState('');
  const [principalSearch, setPrincipalSearch] = useState('');
  const [includeBlocked, setIncludeBlocked] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [membersShown, setMembersShown] = useState<string | null>(null);

  const [snapshot, setSnapshot] = useState<GovernanceSnapshot>(EMPTY_SNAPSHOT);
  const [failures, setFailures] = useState<{ table: string; message: string }[]>([]);
  const [emptyTables, setEmptyTables] = useState<string[]>([]);
  const [state, setState] = useState<'loading' | 'no-model' | 'ready'>('loading');

  const target = useMemo(() => getModelTarget(getGovEnv()), []);

  const load = useCallback(async () => {
    if (!target) {
      setState('no-model');
      return;
    }
    setState('loading');
    const result = await loadSnapshot(target, config.modulesEnabled);
    setSnapshot(result.snapshot);
    setFailures(result.failures);
    setEmptyTables(result.emptyTables);
    setState('ready');
  }, [target, config.modulesEnabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const grants = useMemo(
    () => computeEffectiveGrants(snapshot, { enabledModules: config.modulesEnabled }),
    [snapshot, config.modulesEnabled]
  );

  const principals = useMemo(() => listPrincipals(grants, snapshot), [grants, snapshot]);
  const reach = useMemo(() => capabilityReach(grants, snapshot), [grants, snapshot]);

  const filteredPrincipals = useMemo(() => {
    const needle = principalSearch.trim().toLowerCase();
    if (!needle) return principals.slice(0, 50);
    return principals
      .filter((p) => p.name.toLowerCase().includes(needle) || p.id.includes(needle))
      .slice(0, 50);
  }, [principals, principalSearch]);

  const results = useMemo(() => {
    if (direction === 'who') return whoCan(grants, capabilityId, { includeBlocked });
    if (!principalId) return [];
    return whatCan(grants, principalId, snapshot, { includeBlocked });
  }, [direction, grants, snapshot, capabilityId, principalId, includeBlocked]);

  const everyoneHere = results.some(
    (g) => g.principalId === EVERYONE_PRINCIPAL_ID && g.status === 'granted'
  );

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{t('cando.title')}</h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">{t('cando.intro')}</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={state === 'loading'}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {state === 'loading' ? t('common.loading') : t('inventory.refresh')}
        </button>
      </section>

      {state === 'no-model' && (
        <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-600/20 ring-inset">
          {t('model.notProvisioned')}
        </p>
      )}

      {failures.length > 0 && (
        <div className="rounded-xl bg-rose-50 p-4 ring-1 ring-rose-600/20 ring-inset">
          <p className="text-sm font-medium text-rose-900">{t('cando.incomplete')}</p>
          <ul className="mt-1 space-y-0.5">
            {failures.map((failure) => (
              <li key={failure.table} className="font-mono text-xs text-rose-800/80">
                {failure.table}: {failure.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {failures.length === 0 && emptyTables.length > 0 && state === 'ready' && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-600/20 ring-inset">
          {t('cando.emptySources', { tables: emptyTables.join(', ') })}
        </p>
      )}

      <section className="flex flex-wrap items-end gap-3">
        <div className="flex overflow-hidden rounded-lg ring-1 ring-gray-200">
          <button
            type="button"
            onClick={() => setDirection('who')}
            className={`px-3 py-1.5 text-sm ${
              direction === 'who' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'
            }`}
          >
            {t('cando.direction.who')}
          </button>
          <button
            type="button"
            onClick={() => setDirection('what')}
            className={`px-3 py-1.5 text-sm ${
              direction === 'what' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'
            }`}
          >
            {t('cando.direction.what')}
          </button>
        </div>

        {direction === 'who' ? (
          <label className="text-sm">
            <span className="mb-1 block text-xs text-gray-500">{t('cando.capability')}</span>
            <select
              value={capabilityId}
              onChange={(e) => setCapabilityId(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-gray-800"
            >
              {CAPABILITIES.map((capability) => (
                <option key={capability.id} value={capability.id}>
                  {capability.id}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-xs text-gray-500">{t('cando.principal')}</span>
            <input
              type="search"
              value={principalSearch}
              placeholder={t('cando.principalPlaceholder')}
              onChange={(e) => setPrincipalSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-gray-800"
            />
          </label>
        )}

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={includeBlocked}
            onChange={(e) => setIncludeBlocked(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          {t('cando.includeBlocked')}
        </label>
      </section>

      {direction === 'what' && (
        <section className="flex flex-wrap gap-2">
          {filteredPrincipals.map((principal) => (
            <button
              key={principal.id}
              type="button"
              onClick={() => setPrincipalId(principal.id)}
              className={`rounded-full px-3 py-1 text-xs ring-1 ring-inset ${
                principalId === principal.id
                  ? 'bg-blue-600 text-white ring-blue-700'
                  : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'
              }`}
            >
              {principal.name}
              <span className="ml-1 opacity-60">{principal.capabilityCount}</span>
            </button>
          ))}
          {filteredPrincipals.length === 0 && (
            <p className="text-sm text-gray-500">{t('cando.noPrincipals')}</p>
          )}
        </section>
      )}

      {direction === 'who' && everyoneHere && (
        <section className="rounded-xl bg-rose-50 p-4 ring-1 ring-rose-600/20 ring-inset">
          <h3 className="text-sm font-semibold text-rose-900">{t('cando.everyone.title')}</h3>
          <p className="mt-1 text-sm text-rose-900/80">{t('cando.everyone.body')}</p>
        </section>
      )}

      <section>
        {state === 'loading' ? (
          <p className="text-sm text-gray-500">{t('common.loading')}</p>
        ) : results.length === 0 ? (
          <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm ring-1 ring-gray-200">
            {t(direction === 'who' ? 'cando.noneCan' : 'cando.pickPrincipal')}
          </p>
        ) : (
          <ul className="space-y-2">
            {results.map((grant, index) => {
              const key = `${grant.principalId}|${grant.capabilityId}|${grant.scopeId}|${index}`;
              const isOpen = expanded === key;
              const membersOpen = membersShown === key;
              // A group-held grant covers people. Showing the group without
              // saying how many it reaches would understate the exposure.
              const reach =
                direction === 'who' && grant.principalType === 'Group'
                  ? grantReach(grant, snapshot)
                  : 0;
              return (
                <li
                  key={key}
                  className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-gray-900">
                          {direction === 'who' ? grant.principalName : grant.capabilityId}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${STATUS_STYLE[grant.status]}`}
                        >
                          {t(`cando.status.${grant.status}`)}
                        </span>
                        {reach > 0 && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                            {t('cando.reach.count', { count: String(reach) })}
                          </span>
                        )}
                        {grant.viaGroupName && (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-800 ring-1 ring-blue-600/20 ring-inset">
                            {t('cando.viaGroup', { group: grant.viaGroupName })}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-gray-600">
                        {direction === 'who' ? grant.capabilityId : grant.principalName} ·{' '}
                        {grant.scopeType} {grant.scopeName}
                      </p>
                      {grant.statusDetail && (
                        <p className="mt-0.5 text-xs text-amber-700">{grant.statusDetail}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {reach > 0 && (
                        <button
                          type="button"
                          onClick={() => setMembersShown(membersOpen ? null : key)}
                          className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
                        >
                          {t(membersOpen ? 'cando.hideMembers' : 'cando.showMembers')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : key)}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
                      >
                        {t(isOpen ? 'cando.hidePath' : 'cando.showPath')}
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <ol className="mt-3 space-y-1 border-t border-gray-100 pt-3">
                      {grant.path.map((step, stepIndex) => (
                        <li
                          key={stepIndex}
                          className="font-mono text-xs text-gray-700"
                        >
                          {stepIndex + 1}. {step.label}
                        </li>
                      ))}
                    </ol>
                  )}

                  {membersOpen && (
                    // Expanded on demand, one group at a time — the whole point
                    // of holder-level grants (PLAN.md D38).
                    <ul className="mt-3 space-y-1 border-t border-gray-100 pt-3">
                      {expandGrant(grant, snapshot)
                        .slice(0, MEMBER_PAGE)
                        .map((member) => (
                          <li key={member.principalId} className="text-xs text-gray-700">
                            {member.principalName}{' '}
                            <span className="text-gray-500">
                              ({t(`cando.status.${member.status}`)})
                            </span>
                          </li>
                        ))}
                      {reach > MEMBER_PAGE && (
                        <li className="text-xs text-gray-500">
                          {t('cando.moreMembers', { count: String(reach - MEMBER_PAGE) })}
                        </li>
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {state === 'ready' && reach.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold tracking-wide text-gray-500 uppercase">
            {t('cando.reach')}
          </h3>
          <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
            <table className="min-w-full text-sm">
              <tbody>
                {reach.map((row) => (
                  <tr
                    key={row.capabilityId}
                    className="border-b border-gray-50 last:border-0"
                  >
                    <td className="px-4 py-2 font-mono text-xs text-gray-900">
                      {row.capabilityId}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {row.everyone ? (
                        <span className="font-semibold text-rose-700">
                          {t('cando.reach.everyone')}
                        </span>
                      ) : (
                        <span className="text-gray-700">
                          {t('cando.reach.count', { count: row.principals })}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-amber-700">
                      {row.unknown ? t('cando.reach.partlyUnknown') : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

export default CanDoPage;
