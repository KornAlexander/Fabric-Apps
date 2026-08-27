import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchFleetRoster } from '@/services/ferryService';
import {
  createVesselCheck,
  deleteVesselCheck,
  fetchVesselChecks,
  onVesselChecksChanged,
} from '@/services/checklistService';
import { onKustoConnected } from '@/services/kustoClient';
import { CATEGORIES, STATUSES, categoryLabel, statusMeta, timeAgo } from '@/shared/checks';
import type { CheckCategory, CheckStatus, VesselCheck } from '@/shared/contract';

/** Positions poll continuously; the roster is one snapshot, so it needs its own retry. */
const ROSTER_RETRY_MS = 10_000;

/**
 * Right-docked panel where a ferry operator logs pre-departure / in-service
 * checks per vessel and reviews any open issues. Data is persisted through the
 * Rayfin backend inside the Fabric portal, or localStorage in local dev.
 */
export function ChecklistPanel() {
  const [ferries, setFerries] = useState<string[]>([]);
  const [rosterEmpty, setRosterEmpty] = useState(false);
  const [checks, setChecks] = useState<VesselCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issuesOnly, setIssuesOnly] = useState(false);

  const [ferryName, setFerryName] = useState('');
  const [category, setCategory] = useState<CheckCategory>('vessel');
  const [item, setItem] = useState('');
  const [status, setStatus] = useState<CheckStatus>('ok');
  const [notes, setNotes] = useState('');
  const [inspector, setInspector] = useState('');

  const reload = async () => {
    try {
      const rows = await fetchVesselChecks();
      setChecks(rows);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const loadRoster = useCallback(async (signal?: AbortSignal) => {
    const roster = await fetchFleetRoster(signal);
    const names = [...new Set(roster.vessels.map((v) => v.name))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    if (!names.length) {
      setRosterEmpty(true);
      return false;
    }
    setFerries(names);
    setFerryName((n) => n || names[0]);
    return true;
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setInterval> | undefined;
    const stopRetrying = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };

    // Two ways to get an empty roster: Kusto is not connected yet, or it is
    // connected and SydneyFerries has no rows — which is the normal state of a
    // tenant deployed minutes ago, while the loader notebook warms up. Both
    // resolve on their own, so keep asking rather than giving up after one try.
    const attempt = () => {
      void loadRoster(abort.signal)
        .then((loaded) => {
          if (loaded) stopRetrying();
        })
        .catch(() => {
          if (!abort.signal.aborted) setRosterEmpty(false);
        });
    };

    attempt();
    timer = setInterval(attempt, ROSTER_RETRY_MS);
    const unsubscribe = onKustoConnected(attempt);
    void reload();
    // Checks can also be logged from the vessel view, so follow every write.
    const unsubscribeChecks = onVesselChecksChanged(() => {
      void reload();
    });
    return () => {
      stopRetrying();
      unsubscribe();
      unsubscribeChecks();
      abort.abort();
    };
  }, [loadRoster]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ferryName.trim() || !item.trim()) return;
    setSaving(true);
    try {
      await createVesselCheck({
        ferryName: ferryName.trim(),
        category,
        item: item.trim(),
        status,
        notes: notes.trim() || undefined,
        inspector: inspector.trim() || undefined,
      });
      setItem('');
      setNotes('');
      setStatus('ok');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteVesselCheck(id);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  const visible = useMemo(
    () => (issuesOnly ? checks.filter((c) => c.status === 'issue') : checks),
    [checks, issuesOnly],
  );
  const issueCount = useMemo(() => checks.filter((c) => c.status === 'issue').length, [checks]);

  const inputCls =
    'w-full rounded-md bg-white/[0.06] px-2.5 py-1.5 text-[12px] text-white ring-1 ring-white/10 placeholder:text-white/30 focus:outline-none focus:ring-emerald-400/50';

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between px-4 pb-3 pt-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#00843D]/20 text-emerald-300 ring-1 ring-[#00843D]/40">
            ✓
          </span>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold tracking-wide text-white">Vessel Checks</div>
            <div className="text-[11px] text-white/45">Pre-departure log</div>
          </div>
        </div>
        {issueCount > 0 && (
          <span className="flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-300 ring-1 ring-red-500/30 tabular-nums">
            {issueCount} issue{issueCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* Log form */}
      <form onSubmit={submit} className="mx-3 mb-3 space-y-2 rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/10">
        {/* Always a picker: free text would let typos fork a vessel's history. */}
        <select
          value={ferryName}
          onChange={(e) => setFerryName(e.target.value)}
          disabled={!ferries.length}
          className={`${inputCls} disabled:cursor-not-allowed disabled:text-white/40`}
        >
          {ferries.length ? (
            ferries.map((n) => (
              <option key={n} value={n} className="bg-slate-900">
                {n}
              </option>
            ))
          ) : (
            <option value="" className="bg-slate-900">
              {rosterEmpty
                ? 'Waiting for ferry data — is the loader notebook running?'
                : 'Connect live data to load the fleet'}
            </option>
          )}
        </select>

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as CheckCategory)}
          className={inputCls}
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value} className="bg-slate-900">
              {c.label}
            </option>
          ))}
        </select>

        <input
          value={item}
          onChange={(e) => setItem(e.target.value)}
          placeholder="Check item (e.g. Bilge pumps operational)"
          className={inputCls}
        />

        <div className="grid grid-cols-3 gap-1 rounded-lg bg-white/[0.06] p-1">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setStatus(s.value)}
              className={`rounded-md py-1 text-[12px] font-medium transition-colors ${
                status === s.value ? 'text-white' : 'text-white/50 hover:text-white'
              }`}
              style={status === s.value ? { backgroundColor: s.color } : undefined}
            >
              {s.label}
            </button>
          ))}
        </div>

        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          className={inputCls}
        />
        <input
          value={inspector}
          onChange={(e) => setInspector(e.target.value)}
          placeholder="Inspector (optional)"
          className={inputCls}
        />

        <button
          type="submit"
          disabled={saving || !ferryName.trim() || !item.trim()}
          className="w-full rounded-md bg-[#00843D] py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Log check'}
        </button>
      </form>

      {/* Issues-only toggle */}
      <div className="mx-3 mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-white/40">
            {visible.length} logged
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            title="Refresh"
            aria-label="Refresh checks"
            className={`rounded-full px-1 text-[13px] leading-none text-white/40 transition-colors hover:text-white disabled:opacity-40 ${
              refreshing ? 'animate-spin' : ''
            }`}
          >
            ⟳
          </button>
        </div>
        <button
          onClick={() => setIssuesOnly((v) => !v)}
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
            issuesOnly ? 'bg-red-500/20 text-red-300 ring-1 ring-red-500/30' : 'text-white/50 hover:text-white'
          }`}
        >
          Issues only
        </button>
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
        {loading && <div className="px-1 py-4 text-[12px] text-white/40">Loading…</div>}
        {error && !loading && (
          <div className="rounded-md bg-red-500/10 px-2.5 py-2 text-[12px] text-red-300 ring-1 ring-red-500/20">
            {error}
          </div>
        )}
        {!loading && !error && visible.length === 0 && (
          <div className="px-1 py-4 text-[12px] text-white/40">No checks logged yet.</div>
        )}
        {visible.map((c) => {
          const sm = statusMeta(c.status);
          return (
            <div
              key={c.id}
              className="rounded-lg bg-white/[0.04] p-2.5 ring-1 ring-white/10"
              style={c.status === 'issue' ? { boxShadow: 'inset 3px 0 0 #dc2626' } : undefined}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[12px] font-semibold text-white">{c.ferryName}</span>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                  style={{ backgroundColor: sm.color }}
                >
                  {sm.label}
                </span>
                <button
                  type="button"
                  onClick={() => void remove(c.id)}
                  disabled={deletingId === c.id}
                  title="Delete this check"
                  aria-label={`Delete ${c.ferryName} check: ${c.item}`}
                  className="shrink-0 rounded-md px-1 text-[12px] leading-none text-white/30 transition-colors hover:text-red-300 disabled:opacity-40"
                >
                  ✕
                </button>
              </div>
              <div className="mt-0.5 text-[12px] text-white/70">{c.item}</div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-white/40">
                <span>{categoryLabel(c.category)}</span>
                <span>·</span>
                <span>{timeAgo(c.ts)}</span>
                {c.inspector && (
                  <>
                    <span>·</span>
                    <span className="truncate">{c.inspector}</span>
                  </>
                )}
              </div>
              {c.notes && <div className="mt-1 text-[11px] text-white/50">{c.notes}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
