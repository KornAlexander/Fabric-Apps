import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  type CatalogReport,
  type CatalogReportObject,
} from '@/services/catalog';
import { catalogClient } from '@/services/catalogClient';

export function ReportDetailPage() {
  const { reportId = '' } = useParams();
  const id = decodeURIComponent(reportId);
  const [objects, setObjects] = useState<CatalogReportObject[] | null>(null);
  const [report, setReport] = useState<CatalogReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([catalogClient.listReportObjects(id), catalogClient.listReports()])
      .then(([objs, reports]) => {
        if (cancelled) return;
        setObjects(objs);
        setReport(reports.find((r) => r.reportId === id) ?? null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const measures = (objects ?? []).filter((o) => o.objectType === 'Measure');
  const columns = (objects ?? []).filter((o) => o.objectType !== 'Measure');

  return (
    <>
      <div className="mb-4">
        <Link to="/" className="text-xs text-blue-600 hover:underline">
          ← Reports
        </Link>
        <h2 className="mt-1 text-base font-semibold text-gray-900">
          {report?.reportName ?? 'Report'}
        </h2>
        <p className="text-xs text-gray-500">
          {report ? `${report.workspaceName}${report.folderPath ? ` · ${report.folderPath}` : ''}` : id}
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!objects ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : objects.length === 0 ? (
        <div className="rounded-lg border border-gray-100 bg-white px-4 py-8 text-center text-sm text-gray-400">
          No model objects recorded (report may not be in PBIR format).
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ObjectCard title={`Measures (${measures.length})`} objs={measures} />
          <ObjectCard title={`Columns (${columns.length})`} objs={columns} />
        </div>
      )}
    </>
  );
}

function ObjectCard({ title, objs }: { title: string; objs: CatalogReportObject[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-900">
        {title}
      </div>
      {objs.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-gray-400">None</div>
      ) : (
        <ul className="divide-y divide-gray-50">
          {objs.map((o) => (
            <li key={`${o.tableName}|${o.objectName}`} className="px-4 py-2">
              <div className="text-sm text-gray-900">{o.objectName}</div>
              <div className="text-xs text-gray-400">{o.tableName}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
