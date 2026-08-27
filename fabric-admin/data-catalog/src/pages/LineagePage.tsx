import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  type CatalogUsageReport,
  type LineageNeighbors,
  type LineageNode,
} from '@/services/catalog';
import { catalogClient } from '@/services/catalogClient';

const typeChip: Record<string, string> = {
  Measure: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Column: 'bg-amber-50 text-amber-700 border-amber-200',
};

function NodeChip({
  node,
  onClick,
}: {
  node: LineageNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${
        typeChip[node.type] ?? 'bg-gray-50 text-gray-700 border-gray-200'
      } ${onClick ? 'hover:brightness-95' : 'cursor-default'}`}
    >
      <span className="rounded px-1.5 py-0.5 text-[10px] font-medium">{node.type}</span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{node.name}</span>
        <span className="block truncate text-xs opacity-70">{node.tableName}</span>
      </span>
    </button>
  );
}

export function LineagePage() {
  const [measures, setMeasures] = useState<LineageNode[] | null>(null);
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState<LineageNode | null>(null);
  const [neighbors, setNeighbors] = useState<LineageNeighbors | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    catalogClient
      .listLineageMeasures()
      .then((m) => !cancelled && setMeasures(m))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!focus) {
      setNeighbors(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    catalogClient
      .getLineage(focus)
      .then((n) => !cancelled && setNeighbors(n))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [focus]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = measures ?? [];
    if (!q) return rows.slice(0, 40);
    return rows
      .filter((m) => `${m.name} ${m.tableName} ${m.datasetName}`.toLowerCase().includes(q))
      .slice(0, 60);
  }, [measures, query]);

  return (
    <>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">Lineage</h2>
        <p className="text-xs text-gray-500">
          Pick a measure, then walk the chain: what it depends on, and what uses it. Click any
          node to re-focus.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Measure picker */}
        <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 p-3">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a measure…"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
            />
          </div>
          <div className="max-h-[62vh] overflow-y-auto">
            <ul className="divide-y divide-gray-50">
              {filtered.map((m) => (
                <li key={`${m.datasetName}|${m.tableName}|${m.name}`}>
                  <button
                    type="button"
                    onClick={() => setFocus(m)}
                    className={`block w-full px-4 py-2.5 text-left hover:bg-gray-50 ${
                      focus?.name === m.name && focus?.datasetName === m.datasetName
                        ? 'bg-blue-50/60'
                        : ''
                    }`}
                  >
                    <span className="block truncate text-sm font-medium text-gray-900">{m.name}</span>
                    <span className="block truncate text-xs text-gray-400">
                      {m.datasetName} · {m.tableName}
                    </span>
                  </button>
                </li>
              ))}
              {measures && filtered.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-gray-400">No measures match.</li>
              )}
            </ul>
          </div>
        </div>

        {/* Lineage panel */}
        <div className="lg:col-span-2">
          {!focus && (
            <div className="rounded-xl border border-dashed border-gray-200 bg-white/60 p-8 text-center text-sm text-gray-400">
              Select a measure to see its lineage.
            </div>
          )}

          {focus && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {/* Depends on */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Depends on
                </h3>
                <div className="space-y-2">
                  {loading && <p className="text-xs text-gray-400">Loading…</p>}
                  {neighbors?.dependsOn.map((n) => (
                    <NodeChip
                      key={`d:${n.tableName}|${n.name}`}
                      node={n}
                      onClick={n.type === 'Measure' ? () => setFocus(n) : undefined}
                    />
                  ))}
                  {neighbors && neighbors.dependsOn.length === 0 && !loading && (
                    <p className="text-xs text-gray-400">— none —</p>
                  )}
                </div>
              </section>

              {/* Focus */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Focus
                </h3>
                <div className="rounded-lg border-2 border-blue-300 bg-blue-50 px-3 py-2 text-sm">
                  <span className="block truncate font-semibold text-blue-900">{focus.name}</span>
                  <span className="block truncate text-xs text-blue-700/70">
                    {focus.datasetName} · {focus.tableName}
                  </span>
                </div>
              </section>

              {/* Used by */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Used by
                </h3>
                <div className="space-y-2">
                  {neighbors?.usedByMeasures.map((n) => (
                    <NodeChip key={`u:${n.tableName}|${n.name}`} node={n} onClick={() => setFocus(n)} />
                  ))}
                  {neighbors?.usedByReports.map((r: CatalogUsageReport) => (
                    <Link
                      key={`r:${r.reportId}`}
                      to={`/reports/${r.reportId}`}
                      className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 hover:brightness-95"
                    >
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-medium">Report</span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{r.reportName}</span>
                        <span className="block truncate text-xs opacity-70">{r.workspaceName}</span>
                      </span>
                    </Link>
                  ))}
                  {neighbors &&
                    neighbors.usedByMeasures.length === 0 &&
                    neighbors.usedByReports.length === 0 &&
                    !loading && <p className="text-xs text-gray-400">— none —</p>}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
