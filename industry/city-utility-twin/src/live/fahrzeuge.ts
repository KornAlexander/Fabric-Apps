import * as THREE from 'three';

import type { LiveLayer, PickDetail, WorldPlacement } from '../map/worldScene';
import { clock, failure, fetchJson, type StatusReporter } from './source';
import { later, t, type MessageKey, type Text } from '../i18n';
import { modeOfLine, serviceStamp, previousServiceDay, servicesOnDate } from './fahrplan.mjs';
import type { WorldId } from '../config/world';

/**
 * Trams, buses and trains moving on the map, from each city's published Soll-Fahrplan.
 *
 * ⚠️ THE PATH BETWEEN TWO STOPS IS A STRAIGHT LINE. The MVV feed ships no geometry (shapes.txt is
 * present and EMPTY, measured 2026-09-22); HVV and VVS do, but it is not used yet, so all three
 * cities are drawn the same way. Exact AT each published stop, an approximation between them.
 *
 * ⚠️ UNDERGROUND SERVICES ARE DRAWN TRANSLUCENT AT STREET LEVEL, AND THAT IS AN ADMISSION. No
 * tunnel or viaduct geometry is available here, so the train is drawn on the surface above its
 * route. Opaque, that would be a plainly false statement about where it is; translucent, with the
 * panel saying so, it is a statement about a service rather than a location. Each city's note says
 * what is actually underground there.
 *
 * Data: public/data/fahrplan-<city>.json, baked by tools/transit/bake_fahrplan.py.
 */

type Mode = 'tram' | 'ubahn' | 'bus' | 'sbahn' | 'ferry' | 'rack';

interface VehicleClass {
  lengthM: number;
  widthM: number;
  heightM: number;
  colour: number;
  subsurface: boolean;
  /** Drawn as a position symbol, because no verified dimensions exist for this class. */
  symbol?: boolean;
  /** One unit of a class that often runs coupled; the panel says so next to the length. */
  unit?: boolean;
}

/** Standard 12 m city bus. Articulated units on trunk routes are longer. */
const BUS: VehicleClass = { lengthM: 12, widthM: 2.55, heightM: 3.1, colour: 0xe07b00, subsurface: false };

/**
 * A position symbol, NOT a vehicle. Same idea as the air-traffic layer's marker for aircraft
 * without a verified silhouette: the planned service gives a position, and drawing a ferry or a rack
 * railway car at a guessed size would break the real-size rule. Its size is a fixed symbol size.
 */
const SYMBOL_SPAN_M = 24;
const SYMBOL = (colour: number): VehicleClass => ({
  lengthM: SYMBOL_SPAN_M, widthM: SYMBOL_SPAN_M, heightM: SYMBOL_SPAN_M, colour, subsurface: false, symbol: true,
});

/**
 * Published class dimensions in metres, length x width x height, per city.
 *
 * ⚠️ REAL SIZES, NEVER SCALED UP TO BE EASIER TO SEE, which is the standing rule for every 3D
 * scene here. ⚠️ THE FLEET IS MIXED and trains run coupled, so one figure cannot be right for
 * every run. These are the class figures of the vehicle most often seen on that mode:
 * - Munich: four-section low-floor tram, six-car U-Bahn train, ET 423 S-Bahn unit.
 * - Hamburg: one DT5 unit (39.6 x 2.6 x 3.37 m) and one ET 490 unit (66.0 x 3.014 x 3.76 m),
 *   which run as two or three coupled units at busy times.
 * - Stuttgart: one DT 8 Stadtbahn unit (38.8 x 2.65 x 3.715 m, often run in pairs) and one
 *   ET 430 S-Bahn unit (68.3 x 3.02 x 4.273 m).
 * Ferries (HADAG, height not published) and the rack railway and funicular (no verified vehicle
 * figures) are symbols. Figures as published in each class's reference data (German Wikipedia
 * infoboxes, citing operators and manufacturers), checked 2026-10-05.
 */
const CLASSES: Record<WorldId, Partial<Record<Mode, VehicleClass>>> = {
  munich: {
    tram: { lengthM: 37, widthM: 2.3, heightM: 3.4, colour: 0xd2001e, subsurface: false },
    ubahn: { lengthM: 114, widthM: 2.9, heightM: 3.55, colour: 0x0a67b1, subsurface: true },
    bus: BUS,
    sbahn: { lengthM: 67.4, widthM: 3.02, heightM: 3.58, colour: 0x008d4f, subsurface: true },
  },
  hamburg: {
    ubahn: { lengthM: 39.6, widthM: 2.6, heightM: 3.37, colour: 0x0a67b1, subsurface: true, unit: true },
    sbahn: { lengthM: 66, widthM: 3.014, heightM: 3.76, colour: 0x008d4f, subsurface: true, unit: true },
    bus: BUS,
    ferry: SYMBOL(0x1f6fd1),
  },
  stuttgart: {
    ubahn: { lengthM: 38.8, widthM: 2.65, heightM: 3.715, colour: 0xf2b600, subsurface: true, unit: true },
    sbahn: { lengthM: 68.3, widthM: 3.02, heightM: 4.273, colour: 0x008d4f, subsurface: true, unit: true },
    bus: BUS,
    rack: SYMBOL(0x8a5a2b),
  },
};

/** A mode a city's table does not list is drawn as a neutral symbol rather than at a borrowed size. */
const UNKNOWN = SYMBOL(0x9aa3ab);

/** What a mode is called in the panel, per city: Stuttgart's "U" lines are a Stadtbahn. */
const MODE_NAME: Record<Mode, MessageKey> = {
  tram: 'vehicles.kind.tram',
  ubahn: 'vehicles.kind.ubahn',
  bus: 'vehicles.kind.bus',
  sbahn: 'vehicles.kind.sbahn',
  ferry: 'vehicles.kind.ferry',
  rack: 'vehicles.kind.rack',
};

function modeName(mode: Mode, city: WorldId): Text {
  return later(city === 'stuttgart' && mode === 'ubahn' ? 'vehicles.kind.stadtbahn' : MODE_NAME[mode]);
}

/** The tunnel note per city: what is really underground there, and what is not. */
const TUNNEL_NOTE: Record<WorldId, MessageKey> = {
  munich: 'vehicles.tunnel',
  hamburg: 'vehicles.tunnel.hamburg',
  stuttgart: 'vehicles.tunnel.stuttgart',
};

const SOURCE: Record<WorldId, MessageKey> = {
  munich: 'vehicles.source',
  hamburg: 'vehicles.source.hamburg',
  stuttgart: 'vehicles.source.stuttgart',
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
  /** Whose planned service, vehicle classes and wording. */
  city?: WorldId;
}

export async function createFahrzeugeLayer(options: FahrzeugeOptions): Promise<LiveLayer> {
  const { placement, onStatus } = options;
  const base = options.baseUrl ?? import.meta.env.BASE_URL;
  const city: WorldId = options.city ?? 'munich';
  const classes = CLASSES[city];
  const classOf = (mode: Mode): VehicleClass => classes[mode] ?? UNKNOWN;

  const group = new THREE.Group();
  group.name = 'fahrzeuge';
  group.visible = false;
  placement.group.add(group);

  const abort = new AbortController();
  let visible = false;
  let data: Fahrplan | null = null;
  let loading: Promise<void> | null = null;

  const geometries = new Map<VehicleClass, THREE.BufferGeometry>();
  const materials = new Map<VehicleClass, THREE.MeshBasicMaterial>();
  for (const spec of [...Object.values(classes), UNKNOWN]) {
    geometries.set(spec, spec.symbol
      // A neutral octahedron: it says "something is here" without claiming a shape or a size.
      ? new THREE.OctahedronGeometry(spec.lengthM / 2)
      : new THREE.BoxGeometry(spec.widthM, spec.heightM, spec.lengthM));
    materials.set(spec, new THREE.MeshBasicMaterial({
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
    const spec = classOf(entry.mode);
    const kind = modeName(entry.mode, city);
    const nextStop = Math.min(stopIndex + 1, entry.pattern.o.length - 1);
    // ⚠️ SECONDS REMAINING, NOT THE WHOLE SEGMENT. This previously added the entire stop-to-stop
    // duration to the current time, so a vehicle halfway between two stops reported an arrival
    // half a segment too late, and the figure moved every time the panel was reopened.
    const remaining = Math.max(0, entry.pattern.o[nextStop] - rel);
    const due = new Date(Date.now() + remaining * 1000);
    return {
      layerId: 'fahrzeuge',
      title: entry.pattern.h
        ? `${entry.pattern.l} → ${entry.pattern.h}`
        : () => `${entry.pattern.l} → ${t('vehicles.noDestination')}`,
      subtitle: kind,
      accent: spec.colour,
      fields: [
        { label: later('vehicles.mode'), value: kind },
        { label: later('vehicles.stop'), value: later('vehicles.stopOf', stopIndex + 1, entry.pattern.p.length) },
        { label: later('vehicles.nextDeparture'), value: () => clock(due) },
        spec.symbol
          ? { label: later('vehicles.length'), value: later('vehicles.symbolValue') }
          : { label: later('vehicles.length'), value: later(spec.unit ? 'vehicles.lengthUnitValue' : 'vehicles.lengthValue', spec.lengthM) },
        { label: later('vehicles.position'), value: later('vehicles.positionValue') },
        { label: later('vehicles.path'), value: later('vehicles.pathValue') },
        ...(spec.subsurface
          ? [{ label: later('vehicles.note'), value: later(TUNNEL_NOTE[city]) }]
          : []),
      ],
      source: later(SOURCE[city]),
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
        const spec = classOf(entry.mode);
        const created = new THREE.Mesh(geometries.get(spec)!, materials.get(spec)!);
        pool.push(created);
        return created;
      })();
      used++;

      // Reuse the pooled mesh for whatever class it now carries, and put it back in the scene if
      // a previous frame detached it.
      const spec = classOf(entry.mode);
      mesh.geometry = geometries.get(spec)!;
      mesh.material = materials.get(spec)!;
      if (!mesh.parent) group.add(mesh);

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
      // ⚠️ THE BADGE SAYS "FAHRPLAN", NOT "LIVE". Its time is when the positions were computed;
      // the clock advances while the underlying Soll-Fahrplan does not, so calling it live or a
      // fetch would imply a freshness the layer does not have.
      onStatus({
        state: 'live',
        text: later('vehicles.live', used),
        fetchedAt: now,
        timeBasis: 'computed',
        count: used,
      });
    }
  };

  const load = async () => {
    if (data) return;
    if (loading) return loading;
    onStatus({ state: 'loading', text: later('vehicles.loading'), fetchedAt: null, count: 0 });
    loading = (async () => {
      try {
        const payload = await fetchJson<Fahrplan>(`${base}data/fahrplan-${city}.json`, {
          signal: abort.signal,
          timeoutMs: 20000,
          maxBytes: 8_000_000,
        });
        if (abort.signal.aborted) return;
        if (!usable(payload)) {
          onStatus({
            state: 'error',
            text: later('vehicles.incomplete'),
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
          text: failure(later('vehicles.name'), error),
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
      else onStatus({ state: 'idle', text: later('layer.off'), fetchedAt: null, count: 0 });
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
