/**
 * Inventory view logic (PLAN.md §8.8, Phase 2).
 *
 * Pure derivation: gap reporting, filtering and counting. Kept out of the page
 * component so the honesty rules — which gaps get reported, and how — are unit
 * tested rather than eyeballed.
 */
import type { TranslationKey } from '@/i18n';
import type { MergedInventory } from '@/modules';
import type { InventoryItem, InventoryKind, ModuleId } from '@/modules/types';

export interface GapReport {
  module: ModuleId;
  reasonKey?: TranslationKey;
  reasonParams?: Record<string, string | number>;
}

/**
 * One gap entry per module that knowingly returned less than the whole truth.
 *
 * A module that returned complete data produces no entry — the banner must
 * stay quiet when there is nothing to confess, or people learn to ignore it.
 */
export function buildGapReport(inventory: MergedInventory): GapReport[] {
  const gaps: GapReport[] = [];
  for (const [id, result] of Object.entries(inventory.byModule) as [
    ModuleId,
    MergedInventory['byModule'][ModuleId],
  ][]) {
    if (!result?.partial) continue;
    gaps.push({
      module: id,
      reasonKey: result.partialReasonKey,
      reasonParams: result.partialReasonParams,
    });
  }
  return gaps;
}

export interface InventoryFilters {
  search: string;
  module: ModuleId | 'all';
  kind: InventoryKind | 'all';
}

export const EMPTY_FILTERS: InventoryFilters = {
  search: '',
  module: 'all',
  kind: 'all',
};

export function filterInventory(
  items: InventoryItem[],
  filters: InventoryFilters
): InventoryItem[] {
  const needle = filters.search.trim().toLowerCase();
  return items.filter((item) => {
    if (filters.module !== 'all' && item.module !== filters.module) return false;
    if (filters.kind !== 'all' && item.kind !== filters.kind) return false;
    if (!needle) return true;
    return [item.name, item.itemType, item.scopeName, item.detail]
      .filter((v): v is string => typeof v === 'string')
      .some((v) => v.toLowerCase().includes(needle));
  });
}

/** Counts per kind, for the summary cards. Zero-valued kinds are omitted. */
export function countByKind(items: InventoryItem[]): { kind: InventoryKind; count: number }[] {
  const counts = new Map<InventoryKind, number>();
  for (const item of items) {
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count);
}

/** Kinds actually present, for the filter dropdown. */
export function presentKinds(items: InventoryItem[]): InventoryKind[] {
  return [...new Set(items.map((i) => i.kind))].sort();
}
