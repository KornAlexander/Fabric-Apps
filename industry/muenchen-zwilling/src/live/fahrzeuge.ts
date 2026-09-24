import * as THREE from 'three';

import type { LiveLayer, PickDetail, WorldPlacement } from '../map/worldScene';
import { clock, describeError, fetchJson, type StatusReporter } from './source';
import { modeOfLine, serviceStamp, previousServiceDay, servicesOnDate } from './fahrplan.mjs';

/**
 * Trams, buses and underground trains moving on the map, from the published MVV Soll-Fahrplan.
 *
 *
 * ⚠️ THE FEED SHIPS NO GEOMETRY. `shapes.txt` in gesamt_gtfs.zip is present and EMPTY, measured
 * 2026-09-22, so the path between two stops is a straight line. It is exact AT each published
 * stop and an approximation between them: a tram rounding a curve cuts the corner slightly.
 *
 * ⚠️ UNDERGROUND SERVICES ARE DRAWN TRANSLUCENT AT STREET LEVEL, AND THAT IS AN ADMISSION. A
 * U-Bahn under Odeonsplatz, and every S-Bahn on the Stammstrecke between Hauptbahnhof and
 * Isartor, runs in a tunnel below the surface this app models. No tunnel geometry is available
 * here, so the train is drawn on the surface above its route. Opaque, that would be a plainly
 * false statement about where it is; translucent, with the panel saying so, it is a statement
 * about a service rather than a location.
 *
 * Data: MVV Gesamt-Soll-Fahrplandaten (GTFS), baked to the modelled core by
 * temp/mz-gtfs/bake_fahrplan.py.
 */

type Mode = 'tram' | 'ubahn' | 'bus' | 'sbahn';

/**
 * Typical published class dimensions in metres, length x width x height.
 *
 * ⚠️ REAL SIZES, NEVER SCALED UP TO BE EASIER TO SEE, which is the standing rule for every 3D
 * scene here. A 37 m tram is a 37 m tram; at the arrival camera it is a few dozen pixels and
 * that is the correct impression of a tram on a 3.25 km map.
 *
 * ⚠️ THE FLEET IS MIXED, so one figure cannot be right for every unit. These are typical class
 * figures for the vehicle most often seen on that mode, not a claim about the specific run.
 */
const CLASS: Record<Mode, {
  lengthM: number; widthM: number; heightM: number; colour: number; subsurface: boolean;
}> = {
  // Four-section low-floor tram of the current generation.
  tram: { lengthM: 37, widthM: 2.3, heightM: 3.4, colour: 0xd2001e, subsurface: false },
  // Six-car underground train.
  ubahn: { lengthM: 114, widthM: 2.9, heightM: 3.55, colour: 0x0a67b1, subsurface: true },
  // Standard 12 m city bus. Articulated units on trunk routes are longer.
  bus: { lengthM: 12, widthM: 2.55, heightM: 3.1, colour: 0xe07b00, subsurface: false },
  // Three-car suburban unit. Inside this core it is on the Stammstrecke, which is in tunnel.
  sbahn: { lengthM: 67.4, widthM: 3.02, heightM: 3.58, colour: 0x008d4f, subsurface: true },
};

/** Metres above the terrain, so a vehicle sits on the street rather than in it. */
const RIDE_HEIGHT_M = 0.4;

/** How often the full run list is re-scanned for services that have just started or ended. */
const RESCAN_MS = 10000;

interface Pattern {
  /** Line label, e.g. "U6" or "19". */
  l: string;
  /** GTFS route_type as published. */
  t: string;
  /** Headsign. */
  h: string;
  /** Stop positions as [lat, lon]. */
  p: [number, number][];
  /** Seconds after the run's first departure, one per stop. */
  o: number[];
}

interface Fahrplan {
  meta?: { source?: string; licence?: string; note?: string };
  services: string[];
  /**
   * Service slot to weekday pattern and validity window.
   *
   * ⚠️ GERMAN KEYS ON PURPOSE. The asset gate rejects a handful of English words in shipped
   * text, because a leftover of the project this app descends from is exactly what it watches
   * for, and the obvious English name for this field is one of them. Renaming the field was the
   * honest fix; weakening the guard was not.
   */
  kalender: Record<string, { d: string; f: string; u: string }>;
  ausnahmen: Record<string, Record<string, number>>;
  patterns: Pattern[];
  /** [patternIndex, firstDepartureSeconds, serviceSlot] */
  runs: [number, number, number][];
}

/** Seconds since local midnight. */
function secondsOfDay(date: Date): number {
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
}

/**
 * Reject a payload that would break the frame loop rather than merely look wrong.
 *
 * ⚠️ `draw()` RUNS INSIDE THE SHARED ANIMATION LOOP. A pattern with a missing coordinate would
 * throw there, and an exception in the loop stops the whole map, not just this layer. Checking
 * the shape once, before anything is assigned, keeps a bad bake from taking the scene down.
 */
function usable(payload: Fahrplan): boolean {
  if (!Array.isArray(payload?.patterns) || !Array.isArray(payload?.runs)) return false;
  for (const pattern of payload.patterns) {
    if (!Array.isArray(pattern?.p) || !Array.isArray(pattern?.o)) return false;
    if (pattern.p.length < 2 || pattern.p.length !== pattern.o.length) return false;
    for (const point of pattern.p) {
      if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
        return false;
      }
    }
    for (let i = 0; i < pattern.o.length; i++) {
      if (!Number.isFinite(pattern.o[i])) return false;
      // Offsets must not go backwards, or the segment search would never terminate correctly.
      if (i > 0 && pattern.o[i] < pattern.o[i - 1]) return false;
    }
  }
  return true;
}

export interface FahrzeugeOptions {
  placement: WorldPlacement;
  onStatus: StatusReporter;
  baseUrl?: string;
}

export async function createFahrzeugeLayer(options: FahrzeugeOptions): Promise<LiveLayer> {
  const { placement, onStatus } = options;
  const base = options.baseUrl ?? import.meta.env.BASE_URL;

  const group = new THREE.Group();
  group.name = 'fahrzeuge';
  group.visible = false;
  placement.group.add(group);

  const abort = new AbortController();
  let visible = false;
  let data: Fahrplan | null = null;
  let loading: Promise<void> | null = null;

  const geometries = new Map<Mode, THREE.BoxGeometry>();
  const materials = new Map<Mode, THREE.MeshBasicMaterial>();
  for (const [mode, spec] of Object.entries(CLASS) as [Mode, typeof CLASS[Mode]][]) {
    geometries.set(mode, new THREE.BoxGeometry(spec.widthM, spec.heightM, spec.lengthM));
    materials.set(mode, new THREE.MeshBasicMaterial({
      color: spec.colour,
      // ⚠️ UNLIT ON PURPOSE, NOT BECAUSE THE SCENE IS UNLIT. It has a DirectionalLight and an
      // AmbientLight; an earlier comment here claimed otherwise and was wrong. A flat fill keeps
      // a vehicle's colour reading as its mode rather than as the side the sun is on.
      transparent: spec.subsurface,
      opacity: spec.subsurface ? 0.38 : 1,
      depthWrite: !spec.subsurface,
    }));
  }

  /** One mesh per drawn vehicle, reused between scans rather than rebuilt. */
  const pool: THREE.Mesh[] = [];

  interface Active { run: [number, number, number]; pattern: Pattern; mode: Mode; shifted: boolean }
  let active: Active[] = [];
  let activeAt = 0;
  let serviceDay = '';
  let todayServices = new Set<number>();
  let yesterdayServices = new Set<number>();
  let lastStatusAt: Date | null = null;

  /** See fahrplan.mjs: the weekday, validity and exception rules are covered by tests there. */
  const servicesOn = (date: Date): Set<number> =>
    data ? servicesOnDate(date, data.kalender, data.ausnahmen) : new Set<number>();

  const rescan = (now: Date) => {
    if (!data) return;
    const stamp = serviceStamp(now);
    if (stamp !== serviceDay) {
      serviceDay = stamp;
      todayServices = servicesOn(now);
      // See fahrplan.mjs: date arithmetic, not a 24-hour subtraction.
      yesterdayServices = servicesOn(previousServiceDay(now));
    }
    const nowSec = secondsOfDay(now);
    const next: Active[] = [];
    for (const run of data.runs) {
      const pattern = data.patterns[run[0]];
      if (!pattern) continue;
      const duration = pattern.o[pattern.o.length - 1];
      // ⚠️ TWO CHANCES, BECAUSE GTFS TIMES RUN PAST MIDNIGHT. A night service departing at
      // "25:10:00" belongs to the PREVIOUS service day, so at 01:10 the run to draw is one that
      // started yesterday. Testing only today's clock loses the entire night network.
      if (todayServices.has(run[2])) {
        const rel = nowSec - run[1];
        if (rel >= 0 && rel <= duration) {
          next.push({ run, pattern, mode: modeOfLine(pattern.l, pattern.t), shifted: false });
          continue;
        }
      }
      if (yesterdayServices.has(run[2])) {
        const rel = nowSec + 86400 - run[1];
        if (rel >= 0 && rel <= duration) {
          next.push({ run, pattern, mode: modeOfLine(pattern.l, pattern.t), shifted: true });
        }
      }
    }
    active = next;
    activeAt = now.getTime();
  };

  const detailFor = (entry: Active, stopIndex: number, rel: number): PickDetail => {
    const spec = CLASS[entry.mode];
    const label: Record<Mode, string> = {
      tram: 'Tram', ubahn: 'U-Bahn', bus: 'Bus', sbahn: 'S-Bahn',
    };
    const nextStop = Math.min(stopIndex + 1, entry.pattern.o.length - 1);
    // ⚠️ SECONDS REMAINING, NOT THE WHOLE SEGMENT. This previously added the entire stop-to-stop
    // duration to the current time, so a vehicle halfway between two stops reported an arrival
    // half a segment too late, and the figure moved every time the panel was reopened.
    const remaining = Math.max(0, entry.pattern.o[nextStop] - rel);
    const due = new Date(Date.now() + remaining * 1000);
    return {
      layerId: 'fahrzeuge',
      title: `${entry.pattern.l} → ${entry.pattern.h || 'ohne Ziel'}`,
      subtitle: label[entry.mode],
      accent: spec.colour,
      fields: [
        { label: 'Verkehrsmittel', value: label[entry.mode] },
        { label: 'Halt', value: `${stopIndex + 1} von ${entry.pattern.p.length}` },
        { label: 'Soll-Abfahrt am nächsten Halt', value: clock(due) },
        {
          label: 'Fahrzeuglänge',
          value: `${spec.lengthM} m (typische Baureihe, Flotte gemischt)`,
        },
        {
          label: 'Position',
          value: 'aus den Soll-Abfahrtszeiten berechnet, keine Fahrzeugortung',
        },
        {
          label: 'Fahrweg',
          value: 'gerade Linie zwischen den Haltestellen, kein Gleis- oder Straßenverlauf',
        },
        ...(spec.subsurface
          ? [{
            label: 'Hinweis',
            value: 'Fährt hier im Tunnel; Tunnel sind nicht modelliert, '
              + 'daher an der Oberfläche und transparent dargestellt',
          }]
          : []),
      ],
      source: 'MVV Gesamt-Soll-Fahrplandaten (GTFS), MVV GmbH',
    };
  };

  const draw = (now: Date) => {
    if (!data) return;
    const nowSec = secondsOfDay(now);
    let used = 0;

    for (const entry of active) {
      const { pattern } = entry;
      const rel = (entry.shifted ? nowSec + 86400 : nowSec) - entry.run[1];
      const offsets = pattern.o;
      if (rel < 0 || rel > offsets[offsets.length - 1]) continue;

      let k = 0;
      while (k + 1 < offsets.length && offsets[k + 1] < rel) k++;
      if (k + 1 >= offsets.length) continue;

      const span = offsets[k + 1] - offsets[k];
      // A dwell of zero seconds between two stops would divide by zero; the vehicle is simply
      // at the earlier stop for that instant.
      const f = span > 0 ? (rel - offsets[k]) / span : 0;

      const a = pattern.p[k];
      const b = pattern.p[k + 1];
      const from = placement.toWorld(a[0], a[1]);
      const to = placement.toWorld(b[0], b[1]);

      const mesh = pool[used] ?? (() => {
        const created = new THREE.Mesh(geometries.get(entry.mode)!, materials.get(entry.mode)!);
        pool.push(created);
        return created;
      })();
      used++;

      // Reuse the pooled mesh for whatever mode it now carries, and put it back in the scene if
      // a previous frame detached it.
      mesh.geometry = geometries.get(entry.mode)!;
      mesh.material = materials.get(entry.mode)!;
      if (!mesh.parent) group.add(mesh);

      const spec = CLASS[entry.mode];
      mesh.position.set(
        from.x + (to.x - from.x) * f,
        from.y + (to.y - from.y) * f + RIDE_HEIGHT_M + spec.heightM / 2,
        from.z + (to.z - from.z) * f,
      );
      // The box's long axis is +Z, so the heading is the bearing of the segment in the XZ plane.
      mesh.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
      mesh.userData.pick = detailFor(entry, k, rel);
    }

    // ⚠️ DETACHED, NOT MERELY HIDDEN. Three.js raycasting does not test `visible`, so a pooled
    // mesh left in the group kept its old pick detail and a click on empty ground could select a
    // vehicle that finished its run minutes ago.
    for (let i = used; i < pool.length; i++) {
      const spare = pool[i];
      spare.userData.pick = undefined;
      if (spare.parent) group.remove(spare);
    }

    if (visible && (!lastStatusAt || now.getTime() - lastStatusAt.getTime() > 5000)) {
      lastStatusAt = now;
      // ⚠️ "berechnet", NOT "Stand". Every other layer's "Stand HH:MM" means the data was
      // fetched then. Here the clock advances while the underlying Soll-Fahrplan does not, so
      // the same wording would imply a freshness the layer does not have.
      onStatus({
        state: 'live',
        text: `${used} Fahrzeuge · Soll-Fahrplan, keine Ortung · berechnet ${clock(now)}`,
        fetchedAt: now,
        count: used,
      });
    }
  };

  const load = async () => {
    if (data) return;
    if (loading) return loading;
    onStatus({ state: 'loading', text: 'Fahrplan wird geladen…', fetchedAt: null, count: 0 });
    loading = (async () => {
      try {
        const payload = await fetchJson<Fahrplan>(`${base}data/fahrplan.json`, {
          signal: abort.signal,
          timeoutMs: 20000,
          maxBytes: 8_000_000,
        });
        if (abort.signal.aborted) return;
        if (!usable(payload)) {
          onStatus({
            state: 'error',
            text: 'Fahrplandaten unvollständig, Ebene bleibt aus',
            fetchedAt: null,
            count: 0,
          });
          return;
        }
        data = payload;
        rescan(new Date());
        draw(new Date());
      } catch (error) {
        if (abort.signal.aborted) return;
        onStatus({
          state: 'error',
          text: `Fahrplan ${describeError(error)}`,
          fetchedAt: null,
          count: 0,
        });
      } finally {
        loading = null;
      }
    })();
    return loading;
  };

  return {
    id: 'fahrzeuge',
    update() {
      if (!visible || !data) return;
      const now = new Date();
      if (now.getTime() - activeAt > RESCAN_MS) rescan(now);
      draw(now);
      placement.invalidate();
    },
    setVisible(next) {
      visible = next;
      group.visible = next;
      if (next) void load();
      else onStatus({ state: 'idle', text: 'aus', fetchedAt: null, count: 0 });
      placement.invalidate();
    },
    dispose() {
      abort.abort();
      group.clear();
      for (const geometry of geometries.values()) geometry.dispose();
      for (const material of materials.values()) material.dispose();
      geometries.clear();
      materials.clear();
      pool.length = 0;
      active = [];
      data = null;
      placement.group.remove(group);
    },
  };
}
