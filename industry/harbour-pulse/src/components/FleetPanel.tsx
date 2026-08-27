import { useEffect, useRef, useState } from 'react';

import { fetchFerries } from '@/services/ferryService';
import type { Ferry, HeroFerry } from '@/shared/contract';
import { CONFIG } from '@/shared/config';

interface FleetRow extends HeroFerry {
  lat: number;
  lon: number;
}

interface FleetPanelProps {
  /** Called when a ferry card is clicked — used to fly the camera to it. */
  onSelect: (ferry: FleetRow) => void;
}

interface RouteLine {
  code: string;
  label: string;
  color: string;
}

function bearing(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(a[1]);
  const φ2 = toRad(b[1]);
  const dλ = toRad(b[0] - a[0]);
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dφ = toRad(b[1] - a[1]);
  const dλ = toRad(b[0] - a[0]);
  const s =
    Math.sin(dφ / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function compass(deg: number): string {
  return COMPASS[Math.round(deg / 45) % 8];
}

/** Classify a ferry onto a Sydney Ferries line from its destination text. */
function routeOf(destination: string): RouteLine {
  const d = destination.toLowerCase();
  if (d.includes('manly')) return { code: 'F1', label: 'F1 Manly', color: '#006e51' };
  if (d.includes('taronga')) return { code: 'F2', label: 'F2 Taronga Zoo', color: '#0098c3' };
  if (d.includes('parramatta') || d.includes('rydalmere') || d.includes('sydney olympic'))
    return { code: 'F3', label: 'F3 Parramatta Rv', color: '#7a2382' };
  if (d.includes('pyrmont') || d.includes('barangaroo'))
    return { code: 'F4', label: 'F4 Pyrmont Bay', color: '#e6a01e' };
  if (d.includes('neutral bay')) return { code: 'F5', label: 'F5 Neutral Bay', color: '#d2222d' };
  if (d.includes('mosman') || d.includes('old cremorne') || d.includes('cremorne'))
    return { code: 'F6', label: 'F6 Mosman Bay', color: '#f18f01' };
  if (d.includes('double bay') || d.includes('rose bay'))
    return { code: 'F7', label: 'F7 Double Bay', color: '#c2185b' };
  if (d.includes('cockatoo') || d.includes('birchgrove') || d.includes('greenwich'))
    return { code: 'F8', label: 'F8 Cockatoo Is', color: '#5d4037' };
  if (d.includes('watsons bay')) return { code: 'F9', label: 'F9 Watsons Bay', color: '#0277bd' };
  return { code: 'F', label: 'Harbour', color: '#64748b' };
}

/** Pull the endpoint ("to") out of "01:25pm Mosman Bay - Circular Quay". */
function endpointOf(destination: string): string {
  const parts = destination.split(' - ');
  const to = (parts[parts.length - 1] ?? destination).trim();
  return to.replace(/^\d{1,2}:\d{2}\s*[ap]m\s*/i, '').trim() || destination;
}

function ageLabel(ms?: number): { text: string; live: boolean } {
  if (!ms) return { text: '—', live: false };
  const s = Math.max(0, (Date.now() - ms) / 1000);
  const live = s < 90;
  if (s < 60) return { text: `${Math.round(s)}s`, live };
  if (s < 3600) return { text: `${Math.round(s / 60)}m`, live };
  return { text: `${Math.round(s / 3600)}h`, live };
}

function speedBand(kn: number): string {
  if (kn < 8) return '#22c55e';
  if (kn < 16) return '#f59e0b';
  return '#dc2626';
}

export function FleetPanel({ onSelect }: FleetPanelProps) {
  const [rows, setRows] = useState<FleetRow[]>([]);
  const [, force] = useState(0);
  const prev = useRef(new Map<string, { lon: number; lat: number; t: number }>());
  const meta = useRef(new Map<string, { headingDeg: number; speedKn: number }>());

  useEffect(() => {
    const abort = new AbortController();
    let timer = 0;
    let disposed = false;

    const poll = async () => {
      try {
        const feed = await fetchFerries(abort.signal);
        if (disposed) return;
        const out: FleetRow[] = feed.ferries.map((f: Ferry) => {
          const p = prev.current.get(f.id);
          const m = meta.current.get(f.id) ?? { headingDeg: 0, speedKn: 0 };
          const moved = !p || p.lon !== f.lon || p.lat !== f.lat;
          if (p && moved) {
            const dtH = (Date.now() - p.t) / 3_600_000;
            if (dtH > 0) m.speedKn = haversineM([p.lon, p.lat], [f.lon, f.lat]) / 1852 / dtH;
            m.headingDeg = bearing([p.lon, p.lat], [f.lon, f.lat]);
          }
          if (moved) prev.current.set(f.id, { lon: f.lon, lat: f.lat, t: Date.now() });
          meta.current.set(f.id, m);
          return {
            id: f.id,
            name: f.name,
            destination: f.destination,
            lat: f.lat,
            lon: f.lon,
            headingDeg: m.headingDeg,
            speedKn: m.speedKn,
            lastSeenMs: f.ts,
          };
        });
        out.sort((a, b) => a.name.localeCompare(b.name));
        setRows(out);
      } catch {
        /* keep last known rows */
      }
    };
    void poll();
    timer = window.setInterval(poll, CONFIG.pollMs);
    // Re-render every second so the "updated Xs ago" labels tick.
    const ticker = window.setInterval(() => force((n) => n + 1), 1000);
    return () => {
      disposed = true;
      abort.abort();
      window.clearInterval(timer);
      window.clearInterval(ticker);
    };
  }, []);

  const count = rows.length;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between px-4 pb-3 pt-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#00843D]/20 text-emerald-300 ring-1 ring-[#00843D]/40">
            ⚓
          </span>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold tracking-wide text-white">Active Fleet</div>
            <div className="text-[11px] text-white/45">Sydney Ferries · live</div>
          </div>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-white tabular-nums">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400" />
          {count}
        </span>
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
        {rows.map((f) => {
          const line = routeOf(f.destination);
          const kn = f.speedKn ?? 0;
          const age = ageLabel(f.lastSeenMs);
          const pct = Math.min(100, (kn / 28) * 100);
          return (
            <button
              key={f.id}
              onClick={() => onSelect(f)}
              title={`Zoom to ${f.name}`}
              className="group relative w-full overflow-hidden rounded-xl bg-white/[0.04] p-3 text-left ring-1 ring-white/5 transition-all hover:bg-white/[0.09] hover:ring-white/20"
            >
              <span
                className="absolute inset-y-0 left-0 w-1"
                style={{ backgroundColor: line.color }}
              />

              <div className="flex items-center justify-between gap-2 pl-1.5">
                <span className="truncate text-[14px] font-semibold text-white">{f.name}</span>
                <span
                  className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
                  style={{ backgroundColor: line.color }}
                >
                  {line.code}
                </span>
              </div>

              <div className="mt-1 flex items-center justify-between gap-2 pl-1.5">
                <span className="truncate text-[12px] text-white/55">
                  → {endpointOf(f.destination)}
                </span>
                <span
                  className={`flex shrink-0 items-center gap-1 text-[10px] font-medium ${
                    age.live ? 'text-emerald-400' : 'text-white/35'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      age.live ? 'bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400' : 'bg-white/30'
                    }`}
                  />
                  {age.live ? 'Live' : 'Idle'}
                </span>
              </div>

              <div className="mt-2.5 flex items-end gap-4 pl-1.5 tabular-nums">
                <div>
                  <span className="text-[15px] font-bold leading-none text-white">
                    {kn.toFixed(1)}
                  </span>
                  <span className="ml-1 text-[10px] text-white/40">kn</span>
                </div>
                <div className="text-white/25">|</div>
                <div>
                  <span className="text-[13px] font-semibold leading-none text-white/90">
                    {compass(f.headingDeg ?? 0)}
                  </span>
                  <span className="ml-1 text-[10px] text-white/40">{Math.round(f.headingDeg ?? 0)}°</span>
                </div>
                <div className="text-white/25">|</div>
                <div>
                  <span className="text-[13px] font-semibold leading-none text-white/90">
                    {age.text}
                  </span>
                  <span className="ml-1 text-[10px] text-white/40">ago</span>
                </div>
              </div>

              <div className="mt-2.5 ml-1.5 h-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: speedBand(kn) }}
                />
              </div>
            </button>
          );
        })}
        {rows.length === 0 && (
          <p className="px-1 py-8 text-center text-sm text-white/40">Waiting for live positions…</p>
        )}
      </div>

      <div className="border-t border-white/10 px-4 py-2.5 text-[10px] text-white/35">
        Speed &amp; heading derived from live KQL positions · click a ferry to zoom to it
      </div>
    </div>
  );
}
