import { useState } from 'react';

import { type CatalogSearchHit } from '@/services/catalog';
import { catalogClient } from '@/services/catalogClient';

const kindBadge: Record<string, string> = {
  Report: 'bg-blue-50 text-blue-700',
  Model: 'bg-violet-50 text-violet-700',
  Measure: 'bg-emerald-50 text-emerald-700',
  Column: 'bg-amber-50 text-amber-700',
};

export function SearchPage() {
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<CatalogSearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = term.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      setHits(await catalogClient.search(q));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">Search</h2>
        <p className="text-xs text-gray-500">
          Search reports, models, measures &amp; columns by name — and inside measure DAX.
        </p>
      </div>

      <form onSubmit={run} className="mb-4 flex gap-2">
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="e.g. SUMX, Umsatz, Calendar…"
          className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
        />
        <button
          type="submit"
          disabled={loading || !term.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {hits && (
        <p className="mb-2 text-xs text-gray-500">
          {hits.length} result{hits.length === 1 ? '' : 's'}
        </p>
      )}

      {hits && hits.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
          <ul className="divide-y divide-gray-50">
            {hits.map((h, i) => (
              <li key={`${h.kind}:${h.name}:${h.context}:${i}`} className="flex items-center gap-3 px-4 py-2.5">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${kindBadge[h.kind] ?? 'bg-gray-100 text-gray-600'}`}>
                  {h.kind}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900">{h.name}</span>
                  <span className="block truncate text-xs text-gray-400">{h.context}</span>
                </span>
                {h.matchedIn === 'DAX' && (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                    in DAX
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {hits && hits.length === 0 && !loading && (
        <p className="text-sm text-gray-400">No matches for “{term}”.</p>
      )}
    </>
  );
}
