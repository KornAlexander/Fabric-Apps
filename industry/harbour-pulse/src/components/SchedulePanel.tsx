import { useEffect, useState } from 'react';

import { fetchFerrySchedule } from '@/services/ferryService';
import type { FerryDeparture } from '@/shared/contract';

/** Sydney Ferries line colours, keyed by GTFS route code. */
const ROUTE_COLORS: Record<string, string> = {
  F1: '#006e51',
  F2: '#0098c3',
  F3: '#7a2382',
  F4: '#e6a01e',
  F5: '#d2222d',
  F6: '#f18f01',
  F7: '#c2185b',
  F8: '#5d4037',
  F9: '#0277bd',
  F10: '#00843D',
};

function routeColor(code: string): string {
  return ROUTE_COLORS[code] ?? '#64748b';
}

/** "HH:MM:SS" (may exceed 24h) → "9:05 am". */
function formatTime(hms: string): string {
  const [hRaw = '0', m = '00'] = hms.split(':');
  const h24 = Number(hRaw) % 24;
  const ampm = h24 < 12 ? 'am' : 'pm';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m} ${ampm}`;
}

/** Current seconds-since-midnight in the Sydney timezone. */
function sydneySecondsOfDay(): number {
  const t = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Australia/Sydney',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date());
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

function hmsToSeconds(hms: string): number {
  const [h = 0, m = 0, s = 0] = hms.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

/** Minutes until departure, relative to Sydney "now". */
function minutesUntil(hms: string): number {
  return Math.round((hmsToSeconds(hms) - sydneySecondsOfDay()) / 60);
}

function etaLabel(mins: number): string {
  if (mins <= 0) return 'now';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

const REFRESH_MS = 60_000;

/**
 * Right-docked, collapsible panel showing today's scheduled ferry departures
 * from the TfNSW GTFS timetable (GET /api/ferries/schedule).
 */
export function SchedulePanel() {
  const [allDay, setAllDay] = useState(false);
  const [date, setDate] = useState<string | null>(null);
  const [departures, setDepartures] = useState<FerryDeparture[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [, force] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    let disposed = false;

    const load = async () => {
      try {
        const feed = await fetchFerrySchedule(
          { upcoming: !allDay, limit: allDay ? 400 : 60 },
          abort.signal,
        );
        if (disposed) return;
        setDate(feed.date);
        setDepartures(feed.departures);
        setError(null);
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    // Re-render each minute so the "in Xm" labels tick.
    const ticker = window.setInterval(() => force((n) => n + 1), 30_000);
    return () => {
      disposed = true;
      abort.abort();
      window.clearInterval(timer);
      window.clearInterval(ticker);
    };
  }, [allDay]);

  // Collapse to the next upcoming departure per route (the last outstanding one).
  const seenRoutes = new Set<string>();
  const shown = departures.filter((d) => {
    if (seenRoutes.has(d.route)) return false;
    seenRoutes.add(d.route);
    return true;
  });

  const count = shown.length;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between px-4 pb-3 pt-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#00843D]/20 text-emerald-300 ring-1 ring-[#00843D]/40">
            🕑
          </span>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold tracking-wide text-white">Timetable</div>
            <div className="text-[11px] text-white/45">
              TfNSW GTFS{date ? ` · ${date}` : ''}
            </div>
          </div>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-white tabular-nums">
          {count}
        </span>
      </div>

        {/* Upcoming / All-day toggle */}
        <div className="mx-4 mb-3 grid grid-cols-2 gap-1 rounded-lg bg-white/[0.06] p-1 text-[12px] font-medium">
          <button
            onClick={() => setAllDay(false)}
            className={`rounded-md py-1 transition-colors ${
              !allDay ? 'bg-[#00843D] text-white' : 'text-white/55 hover:text-white'
            }`}
          >
            Upcoming
          </button>
          <button
            onClick={() => setAllDay(true)}
            className={`rounded-md py-1 transition-colors ${
              allDay ? 'bg-[#00843D] text-white' : 'text-white/55 hover:text-white'
            }`}
          >
            All day
          </button>
        </div>

        <div className="flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
          {shown.map((d) => {
            const color = routeColor(d.route);
            const mins = minutesUntil(d.time);
            const soon = !allDay && mins >= 0 && mins <= 10;
            return (
              <div
                key={d.tripId}
                className="group relative overflow-hidden rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/5 transition-all hover:bg-white/[0.08]"
              >
                <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: color }} />
                <div className="flex items-center justify-between gap-2 pl-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
                      style={{ backgroundColor: color }}
                    >
                      {d.route || 'F'}
                    </span>
                    <span className="text-[14px] font-semibold tabular-nums text-white">
                      {formatTime(d.time)}
                    </span>
                  </div>
                  {!allDay && (
                    <span
                      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                        soon ? 'bg-emerald-400/20 text-emerald-300' : 'text-white/45'
                      }`}
                    >
                      {etaLabel(mins)}
                    </span>
                  )}
                </div>
                <div className="mt-1 truncate pl-1.5 text-[12px] text-white/55">
                  {d.from} <span className="text-white/30">→</span> {d.headsign}
                </div>
              </div>
            );
          })}

          {!loading && departures.length === 0 && !error && (
            <p className="px-1 py-8 text-center text-sm text-white/40">
              No more ferries scheduled today.
            </p>
          )}
          {loading && (
            <p className="px-1 py-8 text-center text-sm text-white/40">Loading timetable…</p>
          )}
          {error && (
            <p className="px-1 py-8 text-center text-xs text-red-200">Timetable error: {error}</p>
          )}
        </div>

        <div className="border-t border-white/10 px-4 py-2.5 text-[10px] text-white/35">
          Scheduled departures · TfNSW Open Data GTFS · times in Sydney local
        </div>
    </div>
  );
}
