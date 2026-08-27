import { useEffect, useMemo, useState } from 'react';

import { PartialViewBanner } from '@/components/PartialViewBanner';
import { TierBadge } from '@/components/TierBadge';
import {
  EMPTY_FILTERS,
  buildGapReport,
  countByKind,
  filterInventory,
  presentKinds,
  type InventoryFilters,
} from '@/domain/inventoryView';
import { useGovernance } from '@/hooks/GovernanceContext';
import { useT } from '@/i18n';
import { MODULE_IDS, getModule } from '@/modules';
import type { InventoryKind, ModuleId } from '@/modules/types';

/** Rows rendered at once. The full result stays in memory for the counts. */
const PAGE_SIZE = 200;

/**
 * Inventory — the Phase 2 payoff (PLAN.md §17 Track A).
 *
 * Renders whatever the signed-in user can reach with their own token, with no
 * admin consent, and states plainly what is missing. A customer's first five
 * minutes has to show something real before any consent conversation.
 */
export function InventoryPage() {
  const t = useT();
  const { inventory, inventoryLoading, refreshInventory } = useGovernance();
  const [filters, setFilters] = useState<InventoryFilters>(EMPTY_FILTERS);

  // Collected on first visit, not at app start: the Setup page must render
  // immediately, and a user-scoped crawl is a burst of sequential requests.
  const collected = inventory.items.length > 0 || inventory.errors.length > 0;
  useEffect(() => {
    if (!collected && !inventoryLoading) void refreshInventory();
  }, [collected, inventoryLoading, refreshInventory]);

  const gaps = useMemo(() => buildGapReport(inventory), [inventory]);
  const counts = useMemo(() => countByKind(inventory.items), [inventory.items]);
  const kinds = useMemo(() => presentKinds(inventory.items), [inventory.items]);
  const filtered = useMemo(
    () => filterInventory(inventory.items, filters),
    [inventory.items, filters]
  );

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{t('inventory.title')}</h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">{t('inventory.intro')}</p>
        </div>
        <div className="flex items-center gap-2">
          <TierBadge tier={inventory.tier} />
          <button
            type="button"
            onClick={() => void refreshInventory()}
            disabled={inventoryLoading}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {inventoryLoading ? t('common.loading') : t('inventory.refresh')}
          </button>
        </div>
      </section>

      <PartialViewBanner gaps={gaps} />

      {counts.length > 0 && (
        <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {counts.map(({ kind, count }) => (
            <div
              key={kind}
              className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200"
            >
              <p className="text-xs tracking-wide text-gray-500 uppercase">
                {t(`kind.${kind}`)}
              </p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{count}</p>
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-wrap items-end gap-3">
        <label className="flex-1 text-sm">
          <span className="mb-1 block text-xs text-gray-500">{t('inventory.search')}</span>
          <input
            type="search"
            value={filters.search}
            placeholder={t('inventory.searchPlaceholder')}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-gray-800"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-500">
            {t('inventory.filter.module')}
          </span>
          <select
            value={filters.module}
            onChange={(e) =>
              setFilters((f) => ({ ...f, module: e.target.value as ModuleId | 'all' }))
            }
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-gray-800"
          >
            <option value="all">{t('inventory.filter.all')}</option>
            {MODULE_IDS.map((id) => {
              const mod = getModule(id);
              return (
                <option key={id} value={id}>
                  {mod ? t(mod.nameKey) : id}
                </option>
              );
            })}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-500">
            {t('inventory.filter.kind')}
          </span>
          <select
            value={filters.kind}
            onChange={(e) =>
              setFilters((f) => ({ ...f, kind: e.target.value as InventoryKind | 'all' }))
            }
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-gray-800"
          >
            <option value="all">{t('inventory.filter.all')}</option>
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {t(`kind.${kind}`)}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section>
        <p className="mb-2 text-xs text-gray-500">
          {t('inventory.showing', {
            shown: Math.min(filtered.length, PAGE_SIZE),
            total: inventory.items.length,
          })}
          {inventory.errors.length > 0 && (
            <span className="ml-2 text-amber-700">
              {t('inventory.errors', { count: inventory.errors.length })}
            </span>
          )}
        </p>

        {inventory.items.length === 0 ? (
          <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm ring-1 ring-gray-200">
            {t('inventory.empty')}
          </p>
        ) : filtered.length === 0 ? (
          <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm ring-1 ring-gray-200">
            {t('inventory.emptyFiltered')}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase">
                  <th className="px-4 py-2 font-medium">{t('inventory.column.name')}</th>
                  <th className="px-4 py-2 font-medium">{t('inventory.column.kind')}</th>
                  <th className="px-4 py-2 font-medium">{t('inventory.column.type')}</th>
                  <th className="px-4 py-2 font-medium">{t('inventory.column.scope')}</th>
                  <th className="px-4 py-2 font-medium">{t('inventory.column.module')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, PAGE_SIZE).map((item) => {
                  const mod = getModule(item.module);
                  return (
                    <tr
                      key={`${item.module}:${item.kind}:${item.id}`}
                      className="border-b border-gray-50 last:border-0"
                    >
                      <td className="px-4 py-2 text-gray-900">{item.name}</td>
                      <td className="px-4 py-2 text-xs text-gray-600">
                        {t(`kind.${item.kind}`)}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-500">
                        {item.itemType ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-600">
                        {item.scopeName ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500">
                        {mod ? t(mod.nameKey) : item.module}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default InventoryPage;
