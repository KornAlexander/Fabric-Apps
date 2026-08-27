import { useRef, useState } from 'react';

import { CesiumView, type CesiumHandle, type CesiumStatus } from '@/components/CesiumView';
import { IMAGERY_MODES, modeInfo, type ImageryMode } from '@/cesium/imageryModes';
import { FerryVoxelView } from '@/components/FerryVoxelView';
import { SidePanel } from '@/components/SidePanel';
import { useAuth } from '@/hooks/AuthContext';
import { connectDataInteractive } from '@/services/kustoClient';

export function HomePage() {
  const { signOut } = useAuth();
  const cesium = useRef<CesiumHandle>(null);
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [status, setStatus] = useState<CesiumStatus>({
    count: 0,
    asOf: null,
    imagery: 'osm',
    available: [],
    needsAuth: false,
  });

  const updated = status.asOf ? new Date(status.asOf).toLocaleTimeString() : null;

  // Triggers a one-time interactive sign-in for the Eventhouse. Embedded in the
  // Fabric portal this may be blocked by the host frame, so report why.
  const connectLiveData = async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      await connectDataInteractive();
    } catch (err) {
      setConnectError((err as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#0a1826]">
      {/* ── App chrome ─────────────────────────────────────────────────────── */}
      <header className="z-40 flex h-16 shrink-0 items-center justify-between border-b border-white/10 bg-slate-950/80 px-4 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#00843D]/20 text-lg text-emerald-300 ring-1 ring-[#00843D]/40">
            ⚓
          </span>
          <div className="leading-tight">
            <h1 className="text-[15px] font-semibold tracking-wide text-white">Sydney Ferries</h1>
            <p className="text-[11px] text-white/45">Live Ferry Tracker</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white ring-1 ring-white/10">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400" />
            <span className="tabular-nums">{status.count}</span> live
            {updated && <span className="text-white/40">· {updated}</span>}
          </span>
          <select
            value={status.imagery}
            onChange={(e) => cesium.current?.setImagery(e.target.value as ImageryMode)}
            title={modeInfo(status.imagery).hint}
            aria-label="Map imagery"
            data-testid="imagery-select-header"
            className={`hidden cursor-pointer rounded-full px-3 py-1.5 text-[11px] font-medium ring-1 transition-colors sm:inline-flex ${
              status.imagery === 'ion'
                ? 'bg-sky-500/15 text-sky-200 ring-sky-400/30 hover:bg-sky-500/25'
                : status.imagery === 'nsw'
                  ? 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30 hover:bg-emerald-500/25'
                  : 'bg-white/[0.06] text-white/60 ring-white/10 hover:bg-white/[0.12] hover:text-white/80'
            }`}
          >
            {IMAGERY_MODES.filter((m) => status.available.includes(m.id)).map((m) => (
              <option key={m.id} value={m.id} title={m.hint} className="bg-slate-900 text-white">
                {m.short}
              </option>
            ))}
          </select>
          {status.needsAuth && (
            <button
              onClick={() => void connectLiveData()}
              disabled={connecting}
              className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow ring-1 ring-emerald-400/40 transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {connecting ? 'Connecting…' : 'Connect live data'}
            </button>
          )}
          {connectError && (
            <span
              role="alert"
              title={connectError}
              className="hidden max-w-xs truncate rounded-full bg-rose-500/15 px-3 py-1.5 text-[11px] font-medium text-rose-200 ring-1 ring-rose-400/30 md:inline"
            >
              {connectError}
            </span>
          )}
          <button
            onClick={() => void signOut()}
            className="rounded-full px-3 py-1.5 text-xs font-medium text-white/55 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Sign out"
          >
            Sign out
          </button>
        </div>
      </header>
      {/* TfNSW green brand accent */}
      <div className="h-0.5 w-full shrink-0 bg-gradient-to-r from-[#00843D] via-emerald-400 to-transparent" />

      {/* ── Map canvas (framed like an app surface) ────────────────────────── */}
      <main className="relative min-h-0 flex-1 p-3">
        <div className="relative h-full w-full overflow-hidden rounded-2xl ring-1 ring-white/10 shadow-2xl">
          <CesiumView ref={cesium} onStatus={setStatus} onSelectFerry={setSelected} />
          <SidePanel onSelectFerry={(lon, lat) => cesium.current?.flyToFerry(lon, lat)} />
          {!selected && (
            <div className="pointer-events-none absolute bottom-4 left-1/2 z-30 -translate-x-1/2">
              <div className="flex items-center gap-2 rounded-full bg-slate-950/75 px-4 py-2 text-xs font-medium text-white/80 ring-1 ring-white/15 shadow-lg backdrop-blur-md">
                <span className="text-emerald-300">⚓</span>
                Click on a ferry to see details
              </div>
            </div>
          )}
        </div>
      </main>

      {selected && (
        <FerryVoxelView
          vesselId={selected.id}
          vesselName={selected.name}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
