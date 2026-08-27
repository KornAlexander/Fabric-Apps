import type { ReactNode } from 'react';

import { useGovTable } from '@/hooks/useGovTable';
import { useT, type TranslationKey } from '@/i18n';
import type { GovTableName } from '@/domain/govSchema';
import type { QueryOptions } from '@/services/govModel';

export interface ColumnDef {
  key: string;
  labelKey: TranslationKey;
  /** Optional renderer for flags, badges, links. */
  render?: (value: string, row: Record<string, string>) => ReactNode;
  mono?: boolean;
}

interface GovTableViewProps {
  table: GovTableName;
  columns: ColumnDef[];
  options?: QueryOptions;
  titleKey: TranslationKey;
  introKey: TranslationKey;
  /** Extra content rendered above the table (posture summaries, counters). */
  children?: (rows: Record<string, string>[]) => ReactNode;
}

/**
 * One table over the Governance Model, with all three honest empty states
 * (PLAN.md §13). Module pages use this so none of them can invent its own —
 * and so "the collector hasn't run" can never be silently rendered as "clean".
 */
export function GovTableView({
  table,
  columns,
  options,
  titleKey,
  introKey,
  children,
}: GovTableViewProps) {
  const t = useT();
  const { state, rows, error, reload } = useGovTable(table, options ?? {});

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{t(titleKey)}</h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">{t(introKey)}</p>
        </div>
        <button
          type="button"
          onClick={reload}
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

      {state === 'error' && (
        <p className="rounded-xl bg-rose-50 p-4 text-sm text-rose-900 ring-1 ring-rose-600/20 ring-inset">
          {t('model.queryFailed')}
          {error && <span className="mt-1 block font-mono text-xs opacity-70">{error}</span>}
        </p>
      )}

      {state === 'empty' && (
        <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm ring-1 ring-gray-200">
          {t('model.collectorNotRun')}
        </p>
      )}

      {state === 'ready' && (
        <>
          {children?.(rows)}
          <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase">
                  {columns.map((column) => (
                    <th key={column.key} className="px-4 py-2 font-medium">
                      {t(column.labelKey)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr
                    key={`${index}:${Object.values(row)[0] ?? index}`}
                    className="border-b border-gray-50 last:border-0"
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={`px-4 py-2 ${
                          column.mono
                            ? 'font-mono text-xs text-gray-500'
                            : 'text-gray-800'
                        }`}
                      >
                        {column.render
                          ? column.render(row[column.key] ?? '', row)
                          : row[column.key] || '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500">
            {t('inventory.showing', { shown: rows.length, total: rows.length })}
          </p>
        </>
      )}
    </div>
  );
}

/** Small yes/no pill for the boolean-ish string columns the collectors emit. */
export function FlagPill({
  value,
  good,
  labelTrue,
  labelFalse,
}: {
  value: string;
  /** Which value is the desirable one, for colour. */
  good: 'true' | 'false';
  labelTrue: TranslationKey;
  labelFalse: TranslationKey;
}) {
  const t = useT();
  const isTrue = value === 'true';
  const isGood = value === good;
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${
        isGood
          ? 'bg-emerald-50 text-emerald-800 ring-emerald-600/20'
          : 'bg-amber-50 text-amber-900 ring-amber-600/20'
      }`}
    >
      {t(isTrue ? labelTrue : labelFalse)}
    </span>
  );
}
