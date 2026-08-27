import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { type CatalogReport } from '@/services/catalog';
import { catalogClient } from '@/services/catalogClient';

export function ReportsPage() {
  const [reports, setReports] = useState<CatalogReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    catalogClient
      .listReports()
      .then((r) => !cancelled && setReports(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = reports ?? [];
    if (!q) return rows;
    return rows.filter((r) =>
      [r.reportName, r.workspaceName, r.folderPath, r.reportType]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [reports, query]);

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Reports</h2>
          <p className="text-xs text-gray-500">
            {reports ? `${filtered.length} of ${reports.length}` : 'Loading…'} reports
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter reports, workspaces, folders…"
          className="w-72 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!error && (
        <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Report</th>
                <th className="px-4 py-2.5 font-medium">Workspace</th>
                <th className="px-4 py-2.5 font-medium">Folder</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((r) => (
                <tr key={r.reportId} className="hover:bg-gray-50/60">
                  <td className="px-4 py-2.5 font-medium text-gray-900">
                    <Link to={`/reports/${encodeURIComponent(r.reportId)}`} className="hover:underline">
                      {r.reportName}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-gray-700">{r.workspaceName}</td>
                  <td className="px-4 py-2.5 text-gray-500">{r.folderPath || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500">{r.reportType}</td>
                  <td className="px-4 py-2.5">
                    {r.webUrl ? (
                      <a
                        href={r.webUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        Open
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
              {reports && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    No reports match “{query}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
