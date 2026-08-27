import { useEffect, useMemo, useState } from 'react';

import {
  type CatalogKpi,
  type CatalogUsageReport,
} from '@/services/catalog';
import { catalogClient } from '@/services/catalogClient';

const typeBadge: Record<string, string> = {
  Measure: 'bg-blue-50 text-blue-700',
  Column: 'bg-emerald-50 text-emerald-700',
  Hierarchy: 'bg-amber-50 text-amber-700',
};

export function KpiIndexPage() {
  const [kpis, setKpis] = useState<CatalogKpi[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CatalogKpi | null>(null);
  const [reports, setReports] = useState<CatalogUsageReport[] | null>(null);
  const [reportsLoading, setReportsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    catalogClient
      .listKpis()
      .then((k) => !cancelled && setKpis(k))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selected) {
      setReports(null);
      return;
    }
    let cancelled = false;
    setReportsLoading(true);
    catalogClient
      .listReportsForKpi(selected)
      .then((r) => !cancelled && setReports(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setReportsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = kpis ?? [];
    if (!q) return rows;
    return rows.filter((k) =>
      `${k.objectName} ${k.tableName} ${k.objectType}`.toLowerCase().includes(q)
    );
  }, [kpis, query]);

  const isSelected = (k: CatalogKpi) =>
    selected != null &&
    selected.objectName === k.objectName &&
    selected.tableName === k.tableName &&
    selected.objectType === k.objectType;

  return (
    <>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">KPIs → Reports</h2>
        <p className="text-xs text-gray-500">
          Pick a measure or column to see which reports use it.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* KPI list */}
        <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 p-3">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter KPIs…"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
            />
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            <ul className="divide-y divide-gray-50">
              {filtered.map((k) => (
                <li key={`${k.tableName}|${k.objectName}|${k.objectType}`}>
                  <button
                    type="button"
                    onClick={() => setSelected(k)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-gray-50 ${
                      isSelected(k) ? 'bg-blue-50/60' : ''
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-gray-900">
                        {k.objectName}
                      </span>
                      <span className="block truncate text-xs text-gray-400">{k.tableName}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          typeBadge[k.objectType] ?? 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {k.objectType}
                      </span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        {k.reportCount}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {kpis && filtered.length === 0 && (
                <li className="px-4 py-8 text-center text-sm text-gray-400">No KPIs match.</li>
              )}
            </ul>
          </div>
        </div>

        {/* Reports for the selected KPI */}
        <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
          {!selected ? (
            <div className="p-8 text-center text-sm text-gray-400">
              Select a KPI to see the reports that use it.
            </div>
          ) : (
            <>
              <div className="border-b border-gray-100 px-4 py-3">
                <div className="text-sm font-semibold text-gray-900">{selected.objectName}</div>
                <div className="text-xs text-gray-400">
                  {selected.tableName} · {selected.objectType}
                </div>
              </div>
              {reportsLoading ? (
                <div className="p-6 text-center text-sm text-gray-400">Loading…</div>
              ) : (reports ?? []).length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-400">No reports use this KPI.</div>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {(reports ?? []).map((r) => (
                    <li key={r.reportId} className="px-4 py-2.5">
                      <div className="text-sm font-medium text-gray-900">{r.reportName}</div>
                      <div className="text-xs text-gray-400">{r.workspaceName}</div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
