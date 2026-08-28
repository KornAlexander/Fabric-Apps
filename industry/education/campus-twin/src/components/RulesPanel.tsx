import { useCallback, useEffect, useRef, useState } from 'react';

import { getJson, postJson } from '@/api/scheduler';
import { useI18n } from '@/i18n';

/**
 * The Regelwerk — the rules the solver obeys, and the room capacities it obeys them with.
 *
 * PLAN §26.5-26.8, §39. Until this existed, "I would rather move the room than the time" was a `3`
 * against a `6` in `server/tools.py` that nobody outside the repository could see and nobody at all
 * could change without a deploy. §23.5 Tier 4 asks the customer *"welche Regeln sind hart, welche
 * sind Wunsch?"* — this is the screen that can finally answer it, and the screen they can point at.
 *
 * ⚠️ **THE ORDERING IS DRAGGABLE; THE WEIGHTS ARE NOT TYPEABLE** (§26.8, ratified 2026-08-20). The
 * planner ranks what they would rather keep and the backend maps that onto the cost ladder. A
 * ranking cannot be incoherent, whereas free weights permit `Raum > Standort`, which nobody means.
 * The derived weight is still SHOWN, because a planner is entitled to see what their ranking did.
 *
 * ⚠️ **EVERY WRITE REPORTS WHAT IT BROKE, NEVER JUST "GESPEICHERT".** Shrinking a room below what
 * is booked into it does not move anything — it makes the existing plan illegal, which is a
 * legitimate thing to record and a terrible thing to hide behind a green banner. Same contract as
 * the availability editor.
 */

interface RuleOrderRow { id: string; label: string; weight: number; rank: number }
interface RuleNumber {
  id: string; value: number; unit: string; min: number; max: number;
  kind: string; provenance: string; note: string;
}
interface RulesDoc {
  order: RuleOrderRow[];
  numbers: RuleNumber[];
  $durability: string;
}
interface RoomRow {
  roomId: string; roomType: string | null; buildingId: string | null;
  capacity: number | null; capacityProvenance: string | null;
  areaM2: number | null; bookedSlots: number;
}

export function RulesPanel({ site }: { site?: string }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'rules' | 'rooms'>('rules');
  const [rules, setRules] = useState<RulesDoc | null>(null);
  const [rooms, setRooms] = useState<RoomRow[] | null>(null);
  const [unknownCapacity, setUnknownCapacity] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const dragging = useRef<string | null>(null);

  const params: Record<string, string> = site ? { site } : {};

  const loadRules = useCallback(() => {
    getJson<RulesDoc>('/api/rules', params)
      .then(setRules)
      .catch(() => setError('rules.errLoad'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site]);

  const loadRooms = useCallback(() => {
    getJson<{ rooms: RoomRow[]; unknownCapacity: number }>('/api/rooms', params)
      .then((r) => { setRooms(r.rooms); setUnknownCapacity(r.unknownCapacity); })
      .catch(() => setError('rules.errLoad'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site]);

  useEffect(() => { loadRules(); }, [loadRules]);
  useEffect(() => { if (tab === 'rooms' && !rooms) loadRooms(); }, [tab, rooms, loadRooms]);

  /** Move a term to a new rank and persist the whole ranking. */
  async function reorder(fromId: string, toId: string) {
    if (!rules || fromId === toId) return;
    const ids = rules.order.map((o) => o.id);
    const next = ids.filter((i) => i !== fromId);
    next.splice(ids.indexOf(toId), 0, fromId);
    const res = await postJson<{ rules: RulesDoc; refused: { reason: string }[] }>(
      '/api/rules', { ...params, order: next }
    ).catch(() => null);
    if (!res) { setError('rules.errSave'); return; }
    setRules(res.rules);
    setNote(res.refused.length ? res.refused[0].reason : t('rules.savedOrder'));
  }

  async function setNumber(id: string, value: number) {
    const res = await postJson<{ rules: RulesDoc; refused: { reason: string }[] }>(
      '/api/rules', { ...params, [id]: value }
    ).catch(() => null);
    if (!res) { setError('rules.errSave'); return; }
    setRules(res.rules);
    // ⚠️ A refusal is the interesting answer here — out of range, or a value the catalogue will
    // not take — so it wins over the cheerful one.
    setNote(res.refused.length ? res.refused[0].reason : t('rules.saved'));
  }

  async function setCapacity(roomId: string, raw: string) {
    const value = raw.trim() === '' ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0)) { setNote(t('rules.badNumber')); return; }
    const res = await postJson<{
      to: number | null; nowOverCapacity: { sessionId: string }[]; error?: string;
    }>('/api/rooms/capacity', { ...params, roomId, capacity: value }).catch(() => null);
    if (!res || res.error) { setError('rules.errSave'); return; }
    setRooms((prev) => prev?.map((r) => (
      r.roomId === roomId ? { ...r, capacity: res.to, capacityProvenance: res.to === null ? null : 'planner' } : r
    )) ?? prev);
    // ⚠️ THE POINT OF THE WHOLE PANEL. A capacity that no longer fits what is booked has made the
    // plan illegal, and saying "gespeichert" would hide the only consequence that mattered.
    setNote(res.nowOverCapacity.length
      ? t('rules.nowOver', { count: String(res.nowOverCapacity.length) })
      : t('rules.saved'));
  }

  const shown = (rooms ?? []).filter((r) =>
    !query || r.roomId.toLowerCase().includes(query.toLowerCase())
    || (r.roomType ?? '').toLowerCase().includes(query.toLowerCase()));

  return (
    <section data-testid="rules-panel" className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
      {/*
        ⚠️ THE PANEL SURVIVES ITS OWN FAILURES. An earlier version returned a bare sentence INSTEAD
        of the panel, so a backend that predates `/api/rules` — which is exactly what a
        frontend-first deploy produces — left the viewer with a rail item that opens nothing and no
        way to tell "broken" from "not built yet". The frame stays; the trouble is reported inside
        it. Same reasoning as the planner-waking notice.
      */}
      {error && (
        <p data-testid="rules-error" className="rounded bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {t(error)}
        </p>
      )}

      <div className="flex gap-2">
        {(['rules', 'rooms'] as const).map((id) => (
          <button
            key={id}
            type="button"
            data-testid={`rules-tab-${id}`}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
            className={`rounded px-3 py-1 text-xs ${tab === id
              ? 'bg-stone-700 font-semibold text-stone-50'
              : 'bg-stone-800 text-stone-400 hover:text-stone-200'}`}
          >
            {t(id === 'rules' ? 'rules.tabRules' : 'rules.tabRooms')}
          </button>
        ))}
      </div>

      {note && <p data-testid="rules-note" className="rounded bg-stone-800 px-3 py-2 text-xs text-amber-300">{note}</p>}

      {tab === 'rules' && !rules ? (
        <p data-testid="rules-loading" className="text-xs text-stone-400">{t('rules.loading')}</p>
      ) : null}

      {tab === 'rules' && rules ? (
        <>
          <p className="text-xs leading-relaxed text-stone-400">{t('rules.orderIntro')}</p>
          <ol data-testid="rules-order" className="flex flex-col gap-1">
            {rules.order.map((o) => (
              <li
                key={o.id}
                draggable
                data-testid={`rules-order-${o.id}`}
                data-rank={o.rank}
                onDragStart={() => { dragging.current = o.id; }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dragging.current && reorder(dragging.current, o.id)}
                className="flex cursor-grab items-center gap-3 rounded border border-stone-700 bg-stone-800/70 px-3 py-2 text-xs"
              >
                <span className="w-5 text-stone-500">{o.rank}</span>
                <span className="flex-1 text-stone-100">{o.label}</span>
                {/* Shown, not editable: the planner may see what their ranking produced. */}
                <span className="tabular-nums text-stone-500" title={t('rules.weightTitle')}>
                  {t('rules.weight')} {o.weight}
                </span>
              </li>
            ))}
          </ol>

          <table className="w-full text-xs">
            <tbody>
              {rules.numbers.map((n) => (
                <tr key={n.id} className="border-t border-stone-800">
                  <td className="py-2 pr-2 text-stone-200">
                    {t(`rules.num.${n.id}`)}
                    {/* ⚠️ Provenance on the row, so a planner knows they are correcting a GUESS
                        rather than overriding a measurement. `breakMin` has never been agreed
                        with a university, and the note says so. */}
                    <span className={`ml-2 rounded px-1.5 py-0.5 text-[0.6rem] uppercase ${
                      n.provenance === 'assumed' ? 'bg-amber-500/20 text-amber-300' : 'bg-stone-700 text-stone-400'}`}>
                      {t(`rules.prov.${n.provenance}`)}
                    </span>
                    <span className="ml-2 text-stone-500">{n.kind === 'hard' ? t('rules.hard') : t('rules.soft')}</span>
                    <p className="mt-0.5 text-[0.65rem] text-stone-500">{n.note}</p>
                  </td>
                  <td className="w-28 py-2 text-right">
                    <input
                      data-testid={`rules-num-${n.id}`}
                      type="number"
                      defaultValue={n.value}
                      min={n.min}
                      max={n.max}
                      onBlur={(e) => setNumber(n.id, Number(e.currentTarget.value))}
                      className="w-16 rounded border border-stone-600 bg-stone-900 px-2 py-1 text-right tabular-nums text-stone-100"
                    />
                    <span className="ml-1 text-stone-500">{n.unit}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button
            type="button"
            data-testid="rules-reset"
            onClick={async () => {
              const res = await postJson<{ rules: RulesDoc }>('/api/rules', { ...params, reset: true })
                .catch(() => null);
              if (res) { setRules(res.rules); setNote(t('rules.reset')); }
            }}
            className="self-start rounded border border-stone-600 px-3 py-1 text-xs text-stone-300 hover:bg-stone-800"
          >
            {t('rules.resetBtn')}
          </button>
          <p className="text-[0.65rem] leading-relaxed text-stone-500">{rules.$durability}</p>
        </>
      ) : null}

      {tab === 'rooms' ? (
        <>
          <div className="flex items-center gap-2">
            <input
              data-testid="rules-room-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('rules.searchRoom')}
              className="flex-1 rounded border border-stone-600 bg-stone-900 px-2 py-1 text-xs text-stone-100"
            />
            <span className="text-[0.65rem] text-stone-500">
              {t('rules.unknownCount', { count: String(unknownCapacity) })}
            </span>
          </div>
          {!rooms ? (
            <p className="text-xs text-stone-400">{t('rules.loading')}</p>
          ) : (
            <table data-testid="rules-room-table" className="w-full text-xs">
              <thead className="text-stone-500">
                <tr>
                  <th className="py-1 text-left">{t('rules.room')}</th>
                  <th className="py-1 text-left">{t('rules.type')}</th>
                  <th className="py-1 text-right">{t('rules.booked')}</th>
                  <th className="py-1 text-right">{t('rules.seats')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 300).map((r) => (
                  <tr key={r.roomId} data-testid={`rules-room-${r.roomId}`} className="border-t border-stone-800">
                    <td className="py-1 text-stone-100">{r.roomId}</td>
                    <td className="py-1 text-stone-400">{r.roomType ?? '—'}</td>
                    <td className="py-1 text-right tabular-nums text-stone-400">{r.bookedSlots}</td>
                    <td className="py-1 text-right">
                      <input
                        data-testid={`rules-capacity-${r.roomId}`}
                        type="number"
                        min={0}
                        defaultValue={r.capacity ?? ''}
                        /* ⚠️ An EMPTY field is a value: "nobody has measured this". It is not the
                           same as 0, and the backend records it as unknown rather than as a room
                           that holds nobody. */
                        placeholder={t('rules.unknown')}
                        onBlur={(e) => setCapacity(r.roomId, e.currentTarget.value)}
                        className={`w-20 rounded border px-2 py-0.5 text-right tabular-nums ${
                          r.capacityProvenance === 'planner'
                            ? 'border-amber-500/60 bg-stone-900 text-amber-200'
                            : 'border-stone-700 bg-stone-900 text-stone-100'}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-[0.65rem] leading-relaxed text-stone-500">{t('rules.roomsNote')}</p>
        </>
      ) : null}
    </section>
  );
}
