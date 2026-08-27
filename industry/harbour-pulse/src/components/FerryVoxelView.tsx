import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { fetchFerryTwin } from '@/services/twinService';
import type { FerryTwin } from '@/shared/contract';
import { ferryPhotoUrl, getFerrySpec } from '@/three/ferries';
import { HarbourBackdrop } from '@/three/HarbourBackdrop';
import { createVoxelFerry } from '@/three/models';
import type { PassengerTicket, StaffCard, VoxelFerry } from '@/three/VoxelFerry';
import { VesselChecksCard } from '@/components/VesselChecksCard';

const DECK_LABEL: Record<string, string> = {
  lower: 'Lower saloon',
  upper: 'Upper deck',
  bridge: 'Wheelhouse',
};

interface FerryVoxelViewProps {
  /** Ferry business key (ferry_name) whose digital twin to render. */
  vesselId: string;
  /** Display name shown in the header. */
  vesselName: string;
  onClose: () => void;
}

/**
 * Full-screen popup that renders a clicked ferry as a voxel vessel with its
 * decks and wheelhouse, populated with voxel passengers walking around. The
 * passenger counts come from the Fabric digital-twin occupancy telemetry
 * (`FerryTwinTelemetry`), refreshed on a short interval.
 */
export function FerryVoxelView({ vesselId, vesselName, onClose }: FerryVoxelViewProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const ferryRef = useRef<VoxelFerry | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const [twin, setTwin] = useState<FerryTwin | null>(null);
  const [ticket, setTicket] = useState<PassengerTicket | null>(null);
  const [staff, setStaff] = useState<StaffCard | null>(null);
  const [autoOrbit, setAutoOrbit] = useState(false);
  const [showPhoto, setShowPhoto] = useState(true);
  const [showDeck, setShowDeck] = useState(true);
  const [showChecks, setShowChecks] = useState(false);

  const total = useMemo(
    () => (twin ? twin.decks.reduce((n, d) => n + d.occupancy, 0) : 0),
    [twin],
  );
  const spec = useMemo(() => getFerrySpec(vesselName), [vesselName]);
  const photoUrl = useMemo(() => ferryPhotoUrl(vesselName), [vesselName]);

  // ── Three.js scene ────────────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current!;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xdfeaf2, 130, 520);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.set(34, 26, 40);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.domElement.style.display = 'block'; // no inline-baseline gap
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    // Auto-orbit is off by default; toggled on via the on-screen button.
    controls.autoRotate = false;
    controls.autoRotateSpeed = 0.6;
    controlsRef.current = controls;
    // Match the earth (Cesium) view: left mouse drags/pans, right mouse orbits.
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    controls.target.set(0, 6, 0);
    controls.minDistance = 25;
    controls.maxDistance = 110;
    controls.maxPolarAngle = Math.PI * 0.49;

    scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x14324a, 1.0));
    const sun = new THREE.DirectionalLight(0xfff6e0, 1.6);
    sun.position.set(30, 50, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -50;
    sun.shadow.camera.right = 50;
    sun.shadow.camera.top = 50;
    sun.shadow.camera.bottom = -50;
    scene.add(sun);

    // Daytime Sydney-harbour backdrop: graded sky, animated water with a bow
    // wake, and a foreshore skyline with the Harbour Bridge and Opera House.
    const backdrop = new HarbourBackdrop();
    scene.background = backdrop.sky;
    scene.add(backdrop.group);

    const ferry = createVoxelFerry(spec);
    ferryRef.current = ferry;
    scene.add(ferry.group);

    // Center the vessel and frame it so it fills the screen. We measure the
    // model's bounding box, aim the orbit target at its centre, and pull the
    // camera back far enough that the whole ferry fits the current viewport.
    const bounds = new THREE.Box3().setFromObject(ferry.group);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    bounds.getCenter(center);
    bounds.getSize(size);
    const frame = () => {
      const { clientWidth: w, clientHeight: h } = mount;
      const fov = (camera.fov * Math.PI) / 180;
      const fitH = size.y / 2 / Math.tan(fov / 2);
      const fitW = size.x / 2 / Math.tan(fov / 2) / Math.max(0.5, w / h);
      const dist = Math.max(fitH, fitW, size.z / 2) * 1.35;
      controls.target.set(0, center.y, 0);
      // Start rotated 45° to the right for a three-quarter view of the vessel.
      const az = Math.PI / 4;
      const px = dist * 0.72;
      const pz = dist;
      camera.position.set(
        px * Math.cos(az) + pz * Math.sin(az),
        center.y + size.y * 0.55,
        -px * Math.sin(az) + pz * Math.cos(az),
      );
      controls.minDistance = dist * 0.6;
      controls.maxDistance = dist * 2.2;
      controls.update();
    };

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount;
      // Track zoom changes, and let three write the canvas CSS size: without it
      // the canvas lays out at w * devicePixelRatio, so any ratio other than 1
      // (as in the Fabric embed) leaves it not filling the mount.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(w, h);
      camera.aspect = w / h;
      // Nudge the framed vessel slightly up and to the left on screen.
      camera.setViewOffset(w, h, w * 0.02, h * 0.08, w, h);
      camera.updateProjectionMatrix();
    };
    resize();
    frame();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const clock = new THREE.Clock();
    let raf = 0;
    const tick = () => {
      const dt = Math.min(clock.getDelta(), 0.1);
      // Gentle harbour bob.
      ferry.group.position.y = Math.sin(clock.elapsedTime * 1.1) * 0.4;
      ferry.group.rotation.z = Math.sin(clock.elapsedTime * 0.7) * 0.01;
      ferry.update(dt);
      backdrop.update(clock.elapsedTime);
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Click a voxel passenger to reveal their (fictional) travel card.
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let downX = 0;
    let downY = 0;

    // Highlight the passenger currently under the cursor.
    let hovered: THREE.Object3D | null = null;
    const setHighlight = (grp: THREE.Object3D | null, on: boolean) => {
      grp?.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (mat && 'emissive' in mat) {
          mat.emissive.setHex(on ? 0x38bdf8 : 0x000000);
          mat.emissiveIntensity = on ? 0.7 : 0;
        }
      });
    };
    const pick = (e: PointerEvent): THREE.Object3D | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(ferry.group, true);
      for (const h of hits) {
        const p = ferry.passengerFor(h.object);
        if (p) return p;
      }
      return null;
    };
    const onPointerMove = (e: PointerEvent) => {
      const grp = pick(e);
      if (grp === hovered) return;
      setHighlight(hovered, false);
      setHighlight(grp, true);
      hovered = grp;
      renderer.domElement.style.cursor = grp ? 'pointer' : '';
    };
    const onPointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };
    const onPointerUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return; // was a drag
      const grp = pick(e);
      setStaff(grp ? ((grp.userData.staff as StaffCard) ?? null) : null);
      setTicket(grp ? ((grp.userData.ticket as PassengerTicket) ?? null) : null);
    };
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      controlsRef.current = null;
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      ferry.dispose();
      backdrop.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [spec]);

  // ── Poll digital-twin occupancy ───────────────────────────────────────────
  useEffect(() => {
    const abort = new AbortController();
    let disposed = false;
    const poll = async () => {
      try {
        const t = await fetchFerryTwin(vesselId, abort.signal);
        if (disposed) return;
        setTwin(t);
        ferryRef.current?.setOccupancy(t.decks);
      } catch {
        /* keep last snapshot */
      }
    };
    void poll();
    const timer = window.setInterval(poll, 4000);
    return () => {
      disposed = true;
      abort.abort();
      window.clearInterval(timer);
    };
  }, [vesselId]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-[#0a1826]">
      <div ref={mountRef} className="h-full w-full" />

      {/* Header */}
      <div className="pointer-events-none absolute left-5 top-4 select-none">
        <h2 className="text-xl font-semibold text-white drop-shadow">{vesselName}</h2>
        <p className="mt-1 text-sm text-white/70 drop-shadow">
          {spec.fleetClass} · Digital twin · {total} passengers aboard
        </p>
      </div>

      {/* Vessel checks — left-side popup with previous checks + add form */}
      {showChecks ? (
        <VesselChecksCard vesselName={vesselName} onClose={() => setShowChecks(false)} />
      ) : (
        <button
          onClick={() => setShowChecks(true)}
          className="absolute left-5 top-20 z-20 rounded-lg bg-slate-900/70 px-3 py-1.5 text-sm font-medium text-white/80 shadow ring-1 ring-white/15 hover:bg-slate-800"
        >
          ✓ Vessel checks
        </button>
      )}

      {/* Real reference photo of the actual ferry, for comparison with the voxel model */}
      {photoUrl && showPhoto && (
        <div className="absolute right-5 bottom-16 w-56 origin-bottom-right scale-[2] overflow-hidden rounded-xl bg-slate-950/70 shadow-xl ring-1 ring-white/10">
          <button
            onClick={() => setShowPhoto(false)}
            className="absolute right-1 top-1 z-10 rounded-md bg-slate-950/60 px-1.5 text-white/60 hover:text-white"
            aria-label="Close ferry photo"
          >
            ✕
          </button>
          <img src={photoUrl} alt={vesselName} className="h-32 w-full object-cover" />
          <div className="px-3 py-2 text-[11px] text-white/60">{spec.fleetClass}</div>
        </div>
      )}

      {/* Deck occupancy readout from the twin telemetry */}
      {showDeck && (
      <div className="absolute bottom-5 left-5 w-64 origin-bottom-left scale-[1.4] rounded-xl bg-slate-950/70 p-3 text-white shadow-xl backdrop-blur-md ring-1 ring-white/10">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-white/50">
            Deck occupancy
          </span>
          <button
            onClick={() => setShowDeck(false)}
            className="rounded-md px-1 text-white/50 hover:text-white"
            aria-label="Close deck occupancy"
          >
            ✕
          </button>
        </div>
        {(twin?.decks ?? []).map((d) => {
          const pct = Math.min(100, (d.occupancy / Math.max(1, d.capacity)) * 100);
          return (
            <div key={d.deck} className="mb-2 last:mb-0">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-white/80">{DECK_LABEL[d.deck] ?? d.deck}</span>
                <span className="tabular-nums text-white/60">
                  {d.occupancy}/{d.capacity}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-emerald-400 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
        {!twin && <p className="text-[12px] text-white/40">Loading twin telemetry…</p>}
      </div>
      )}

      {/* Passenger travel card, shown when a voxel figure is clicked */}
      {ticket && (
        <div className="absolute right-5 top-16 w-72 rounded-xl bg-slate-950/80 p-4 text-white shadow-xl backdrop-blur-md ring-1 ring-white/10">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300/80">
                Passenger ticket
              </div>
              <div className="mt-0.5 text-lg font-semibold">{ticket.name}</div>
            </div>
            <button
              onClick={() => setTicket(null)}
              className="rounded-md px-1.5 text-white/50 hover:text-white"
              aria-label="Dismiss ticket"
            >
              ✕
            </button>
          </div>

          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="font-medium">{ticket.from}</span>
            <span className="text-white/40">→</span>
            <span className="font-medium">{ticket.to}</span>
          </div>

          <dl className="mt-3 space-y-1.5 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-white/50">Journey</dt>
              <dd className="tabular-nums">{ticket.journeyMin} min</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-white/50">Aboard</dt>
              <dd>{ticket.deck}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-white/50">Mood</dt>
              <dd>{ticket.mood}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-white/50">Wants to see</dt>
              <dd className="text-right">{ticket.wantsToSee}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-white/50">Drink</dt>
              <dd>{ticket.drink}</dd>
            </div>
          </dl>

          <div className="mt-3 border-t border-white/10 pt-2 text-[11px] text-white/40">
            Ticket {ticket.ticketNo}
          </div>
        </div>
      )}

      {/* Crew card, shown when a uniformed staff figure is clicked */}
      {staff && (
        <div className="absolute right-5 top-16 w-72 origin-top-right scale-[1.4] rounded-xl bg-slate-950/80 p-4 text-white shadow-xl backdrop-blur-md ring-1 ring-white/10">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-300/80">
                Ferry crew
              </div>
              <div className="mt-0.5 text-lg font-semibold">{staff.name}</div>
            </div>
            <button
              onClick={() => setStaff(null)}
              className="rounded-md px-1.5 text-white/50 hover:text-white"
              aria-label="Dismiss crew card"
            >
              ✕
            </button>
          </div>

          <div className="mt-2 inline-block rounded-md bg-sky-500/20 px-2 py-0.5 text-sm font-medium text-sky-200">
            {staff.role}
          </div>

          <dl className="mt-3 space-y-1.5 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-white/50">Station</dt>
              <dd>{staff.station}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-white/50">Duty</dt>
              <dd className="text-right">{staff.duty}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-white/50">Status</dt>
              <dd className="text-emerald-300">On duty</dd>
            </div>
          </dl>
        </div>
      )}

      <button
        onClick={onClose}
        className="absolute right-5 top-4 rounded-lg bg-white/90 px-3 py-1.5 text-sm font-medium text-slate-800 shadow hover:bg-white"
      >
        Close
      </button>

      <button
        onClick={() => {
          const next = !autoOrbit;
          setAutoOrbit(next);
          if (controlsRef.current) controlsRef.current.autoRotate = next;
        }}
        className={`absolute right-24 top-4 rounded-lg px-3 py-1.5 text-sm font-medium shadow ring-1 ring-white/15 ${
          autoOrbit ? 'bg-emerald-500 text-white hover:bg-emerald-400' : 'bg-slate-900/70 text-white/80 hover:bg-slate-800'
        }`}
      >
        Auto orbit {autoOrbit ? 'on' : 'off'}
      </button>

      <div className="pointer-events-none absolute bottom-5 right-5 text-xs text-white/50 drop-shadow">
        Click a passenger · left-drag to pan · right-drag to rotate · scroll to zoom · Esc to close
      </div>
    </div>
  );
}
