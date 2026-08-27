import { useEffect, useMemo, useState } from 'react';

import { createVesselCheck, fetchVesselChecks, onVesselChecksChanged } from '@/services/checklistService';
import { CATEGORIES, STATUSES, categoryLabel, statusMeta, timeAgo } from '@/shared/checks';
import type { CheckCategory, CheckStatus, VesselCheck } from '@/shared/contract';

interface VesselChecksCardProps {
  /** Vessel business key (ferry_name) whose checks to show. */
  vesselName: string;
  onClose: () => void;
}

/**
 * Left-docked popup inside the ferry detail view. Lists every check previously
 * logged for this vessel and lets the operator add a new one inline. Persists
 * through the Rayfin backend in Fabric, or localStorage in local dev.
 */
export function VesselChecksCard({ vesselName, onClose }: VesselChecksCardProps) {
  const [checks, setChecks] = useState<VesselCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);

  const [category, setCategory] = useState<CheckCategory>('vessel');
  const [item, setItem] = useState('');
  const [status, setStatus] = useState<CheckStatus>('ok');
  const [notes, setNotes] = useState('');
  const [inspector, setInspector] = useState('');

  const reload = async () => {
    try {
      const rows = await fetchVesselChecks();
      setChecks(rows.filter((c) => c.ferryName === vesselName));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    return onVesselChecksChanged(() => {
      void reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vesselName]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item.trim()) return;
    setSaving(true);
    try {
      await createVesselCheck({
        ferryName: vesselName,
        category,
        item: item.trim(),
        status,
        notes: notes.trim() || undefined,
        inspector: inspector.trim() || undefined,
      });
      setItem('');
      setNotes('');
      setStatus('ok');
      setAdding(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const issueCount = useMemo(() => checks.filter((c) => c.status === 'issue').length, [checks]);

  const inputCls =
    'w-full rounded-md bg-white/[0.06] px-2.5 py-1.5 text-[12px] text-white ring-1 ring-white/10 placeholder:text-white/30 focus:outline-none focus:ring-emerald-400/50';

  return (
    <div className="absolute left-5 top-20 z-20 flex max-h-[70vh] w-80 flex-col overflow-hidden rounded-xl bg-slate-950/80 text-white shadow-xl backdrop-blur-md ring-1 ring-white/10">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-white/50">
            Vessel checks
          </span>
          {issueCount > 0 && (
            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-300 ring-1 ring-red-500/30">
              {issueCount} issue{issueCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded-md px-1 text-white/50 hover:text-white"
          aria-label="Close vessel checks"
        >
          ✕
        </button>
      </div>

      {/* Add form (collapsible) */}
      <div className="px-3 pb-2">
        {adding ? (
          <form onSubmit={submit} className="space-y-2 rounded-lg bg-white/[0.04] p-2.5 ring-1 ring-white/10">
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
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="rounded-md bg-white/[0.06] py-1.5 text-[12px] font-medium text-white/70 transition-colors hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !item.trim()}
                className="rounded-md bg-[#00843D] py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="w-full rounded-md bg-[#00843D] py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-emerald-600"
          >
            + Add check
          </button>
        )}
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
        {loading && <div className="px-1 py-3 text-[12px] text-white/40">Loading…</div>}
        {error && !loading && (
          <div className="rounded-md bg-red-500/10 px-2.5 py-2 text-[12px] text-red-300 ring-1 ring-red-500/20">
            {error}
          </div>
        )}
        {!loading && !error && checks.length === 0 && (
          <div className="px-1 py-3 text-[12px] text-white/40">No checks logged for this vessel.</div>
        )}
        {checks.map((c) => {
          const sm = statusMeta(c.status);
          return (
            <div
              key={c.id}
              className="rounded-lg bg-white/[0.04] p-2.5 ring-1 ring-white/10"
              style={c.status === 'issue' ? { boxShadow: 'inset 3px 0 0 #dc2626' } : undefined}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[12px] font-medium text-white/80">
                  {categoryLabel(c.category)}
                </span>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                  style={{ backgroundColor: sm.color }}
                >
                  {sm.label}
                </span>
              </div>
              <div className="mt-0.5 text-[12px] text-white/70">{c.item}</div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-white/40">
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
