import * as THREE from 'three';

import type { LiveLayer, PickDetail, WorldPlacement } from '../map/worldScene';
import { clock, describeError, fetchJson, type StatusReporter } from './source';
import {
  newestReading, parseComponents, parseStations, requestWindow,
} from './luftParse.mjs';

/**
 * Amtliche Luftqualität: die Messstationen des Umweltbundesamtes in München.
 *
 * This is the reference-grade layer. Five stations, all currently active, published hourly by the
 * Umweltbundesamt from the Bavarian network. It is the layer that lets a viewer compare a
 * kerbside station with a background station a few streets away, which is the whole reason the
 * Verkehr/Hintergrund distinction is carried into the panel verbatim.
 *
 * ⚠️ THE HOST MOVED, AND IT MOVED QUIETLY. The widely documented
 * `www.umweltbundesamt.de/api/air_data/v3` answers **301** to
 * `luftdaten.umweltbundesamt.de/api/air-data/v3` — different subdomain, and `air-data` with a
 * hyphen instead of an underscore. Anything that follows redirects hides this; the relay, which
 * refuses them on purpose, surfaced it as a 502.
 *
 * ⚠️ THERE IS NO PUBLISHED INDEX WORDING, SO THIS LAYER DOES NOT INVENT ANY. The endpoint that
 * would carry the class names and thresholds, `airquality/limits`, returns 404 on both the old
 * and the canonical host. The API gives a bare numeric index. Writing "gut" or "mäßig" next to a
 * station would therefore mean sourcing the wording from general knowledge and presenting it as
 * the Umweltbundesamt's own judgement, in front of the people who run the network. The layer
 * shows the number, and the measured concentrations behind it, and stops there.
 *
 * ⚠️ WHAT THE COLUMN IS, AND IS NOT. A column is a SYMBOL whose height and colour encode the
 * index. It is not a physical object and is deliberately the only thing in this scene that is
 * not drawn at its true size — everything real here is strictly 1:1. A station is a cabinet a
 * few metres across; drawn truthfully it would be invisible from any useful camera height, and
 * an invisible layer communicates nothing. The numbers in the panel are the actual measurement.
 *
 * ⚠️ WHAT A READING IS NOT. One hour at one station is not "the air in Munich". These are point
 * measurements at five specific kerbsides and courtyards, they lag by up to an hour, and a gap
 * in the data is a gap, not a zero.
 */

const RELAY_ORIGIN = (import.meta.env.VITE_RELAY_ORIGIN ?? '').replace(/\/$/, '');

/** Origins served by the Vite proxy rather than by the relay. */
const DEV_ORIGINS = new Set([
  'http://127.0.0.1:5190', 'http://127.0.0.1:4190',
  'http://localhost:5190', 'http://localhost:4190',
]);

/**
 * The two request shapes.
 *
 * The dev proxy forwards a path straight through to the API, so it uses the API's own query
 * form. The relay exposes three fixed, parameter-validated routes instead and builds the query
 * itself, because a relay that forwards a caller-supplied query string is an open proxy. Same
 * data, deliberately different surface.
 */
function endpoints(baseUrl: string) {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const dev = DEV_ORIGINS.has(origin);
  return {
    stations: () => dev
      ? `${baseUrl}api/uba/stations/json?use=airquality&lang=de`
      : `${RELAY_ORIGIN}/uba/stations`,
    components: () => dev
      ? `${baseUrl}api/uba/components/json?lang=de`
      : `${RELAY_ORIGIN}/uba/components`,
    airquality: (station: string, w: Window_) => dev
      ? `${baseUrl}api/uba/airquality/json?date_from=${w.dateFrom}&time_from=${w.hourFrom}`
        + `&date_to=${w.dateTo}&time_to=${w.hourTo}&station=${station}&lang=de`
      : `${RELAY_ORIGIN}/uba/airquality/${station}/${w.dateFrom}/${w.hourFrom}/${w.dateTo}/${w.hourTo}`,
  };
}

interface Window_ { dateFrom: string; hourFrom: number; dateTo: string; hourTo: number }

/** How far back to ask. Hourly data with a publication lag; eight hours is comfortably safe. */
const HOURS_BACK = 8;
/** Hourly data. Polling faster would be noise, and these are other people's servers. */
const POLL_MS = 300_000;

/**
 * Patience for the station catalogue, separately from everything else.
 *
 * ⚠️ MEASURED, NOT PADDED FOR COMFORT. On 2026-09-21 this one endpoint took **59.9 seconds**
 * to return 110 KB while every other call in the same minute answered inside 200 ms. At the
 * 20 s used elsewhere the layer failed with a timeout and reported nothing, which looks like a
 * dead source rather than a slow one. Hosted, the relay caches this response for hours, so the
 * wait is met at most a few times a day; in local dev it is met directly.
 */
const CATALOGUE_TIMEOUT_MS = 75_000;
const READING_TIMEOUT_MS = 20_000;

/**
 * Colour per index step.
 *
 * ⚠️ THIS RAMP IS THE APP'S OWN AND IS LABELLED AS SUCH. It is NOT the Umweltbundesamt's
 * published colour scheme, because that scheme is not retrievable from the API (see the note on
 * `airquality/limits` above).
 *
 * ⚠️ THE SCALE STARTS AT 0, NOT 1, AND ASSUMING OTHERWISE WAS A REAL DEFECT. Measured over a
 * week at the five Munich stations: total index 0 occurred 351 times, 1 occurred 481 times and
 * 2 occurred 73 times. An earlier version began the ramp at 1, so every one of those 351 hours
 * — most of them overnight, when the air is cleanest — was painted in the same grey used for
 * "no data". Conflating the best reading with a missing reading is exactly the sort of error
 * that gets noticed by the people who publish the data.
 *
 * The upper bound is NOT asserted anywhere in the UI: the API publishes no scale definition, so
 * the app shows the number it was given and colours what it can. Anything outside this table
 * falls back to grey, which is honest for an unknown code.
 */
const INDEX_COLOUR: Record<number, number> = {
  0: 0x1f7a4d,
  1: 0x2e9e5b,
  2: 0x9ccb3b,
  3: 0xf2c230,
  4: 0xff0000,
  5: 0x8a0033,
};
const UNKNOWN_COLOUR = 0x9aa3ab;

/**
 * Symbol geometry.
 *
 * ⚠️ SIZED FOR LEGIBILITY, AND THAT IS ONLY ACCEPTABLE BECAUSE IT IS A SYMBOL. The first
 * version used a 26 m radius and a 190 m column, which is roughly true to a measuring station's
 * mast. Measured at the default München camera (1872 m up): about ten pixels wide, and in
 * practice invisible. Everything in this scene that represents a real object — buildings, trees,
 * aircraft — stays strictly 1:1; this one is a chart drawn in the world, and the attribution
 * says so.
 */
const COLUMN_RADIUS_M = 70;
const COLUMN_BASE_M = 400;
const COLUMN_PER_INDEX_M = 180;

interface StationsResponse { indices?: string[]; data?: Record<string, unknown[]> }
type ComponentsResponse = Record<string, unknown>;
interface AirqualityResponse { data?: Record<string, Record<string, unknown[]>> }

interface Station {
  id: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
  setting: string;
  type: string;
  street: string;
}

interface ComponentMeta { symbol: string; unit: string; name: string }

/** One hour at one station, exactly as published. */
interface Reading {
  start: string;
  end: string;
  totalIndex: number | null;
  incomplete: boolean;
  values: { componentId: string; value: number; index: number | null }[];
}

function detailFor(
  station: Station,
  reading: Reading | null,
  components: Map<string, ComponentMeta>,
  colour: number,
): PickDetail {
  const fields: { label: string; value: string }[] = [];
  const add = (label: string, value: string | null) => {
    if (value && value.length) fields.push({ label, value });
  };

  add('Stationstyp', [station.type, station.setting].filter(Boolean).join(', ') || null);
  add('Adresse', station.street || null);

  if (!reading) {
    add('Messwerte', 'für das abgefragte Zeitfenster nicht veröffentlicht');
  } else {
    add('Messzeitraum', `${reading.start} bis ${reading.end} (MEZ)`);
    // ⚠️ NO "von 5". The API publishes no scale definition, so the maximum is not ours to state.
    add('Gesamtindex', reading.totalIndex === null ? null : String(reading.totalIndex));
    if (reading.incomplete) {
      // The source's own flag, named "data incomplete" in the response's `indices`. It does NOT
      // mean the hour is still being assembled, so the wording must not say that: at Stachus and
      // Landshuter Allee it reflects that no ozone is measured there at all.
      add('Hinweis', 'Die Quelle kennzeichnet die Daten dieser Stunde als unvollständig.');
    }
    for (const value of reading.values) {
      const meta = components.get(value.componentId);
      const label = meta ? `${meta.symbol} ${meta.name}`.trim() : `Komponente ${value.componentId}`;
      const unit = meta?.unit ? ` ${meta.unit}` : '';
      // Index 0 is a published class, not an absent one, and it is by far the most common:
      // 2160 of 2760 component readings in a measured week. Suppressing it hid the normal case.
      const index = value.index === null ? '' : ` · Index ${value.index}`;
      add(label, `${value.value}${unit}${index}`);
    }
  }

  return {
    layerId: 'luft-amtlich',
    title: station.name,
    subtitle: `Messstation ${station.id} · amtlich`,
    accent: colour,
    fields,
    source: 'Umweltbundesamt, Air Data (luftdaten.umweltbundesamt.de), stündlich',
  };
}

export interface LuftAmtlichOptions {
  placement: WorldPlacement;
  onStatus: StatusReporter;
  baseUrl?: string;
  /** Overrides for tests. */
  urls?: ReturnType<typeof endpoints>;
  /** Which city's stations to show. */
  city?: string;
  /**
   * Called once, with the world positions of the columns, the first time any are drawn.
   *
   * Lets the caller frame them. The layer does not move the camera itself: a layer that grabs
   * the view is impossible to compose with the others.
   */
  onFirstDraw?: (points: THREE.Vector3[]) => void;
  /**
   * Called when a refresh replaces the features, while one of them was selected.
   *
   * ⚠️ The detail panel holds the object it was opened with. A five-minute refresh builds new
   * objects, so without this the panel keeps showing the previous hour's numbers next to a map
   * that has already moved on, with nothing to indicate it.
   */
  onSelectionStale?: () => void;
}

export async function createLuftAmtlichLayer(options: LuftAmtlichOptions): Promise<LiveLayer> {
  const { placement, onStatus } = options;
  const urls = options.urls ?? endpoints(options.baseUrl ?? import.meta.env.BASE_URL);
  const city = options.city ?? 'München';

  const group = new THREE.Group();
  group.name = 'luft-amtlich';
  group.visible = false;
  placement.group.add(group);

  const abort = new AbortController();
  const owned: (THREE.BufferGeometry | THREE.Material)[] = [];
  let visible = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Promise<void> | null = null;

  let stations: Station[] | null = null;
  let components: Map<string, ComponentMeta> = new Map();
  /** Stations that are real but fall outside the modelled terrain. Counted, never drawn. */
  let offMap = 0;
  let announcedFirstDraw = false;

  const geometry = new THREE.CylinderGeometry(COLUMN_RADIUS_M, COLUMN_RADIUS_M, 1, 16, 1, true);
  owned.push(geometry);

  const materials = new Map<number, THREE.MeshBasicMaterial>();
  const materialFor = (colour: number) => {
    let material = materials.get(colour);
    if (!material) {
      // MeshBasicMaterial, like every other live layer here: the scene bakes its shading in
      // custom shaders and a lit material would render black.
      material = new THREE.MeshBasicMaterial({
        color: colour, transparent: true, opacity: 0.72, depthWrite: false,
      });
      materials.set(colour, material);
      owned.push(material);
    }
    return material;
  };

  const highlight = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.92, depthWrite: false,
  });
  owned.push(highlight);
  let highlighted: THREE.Mesh | null = null;
  /** The detail currently open in the panel, if it came from this layer. */
  let selectedDetail: PickDetail | null = null;

  const clearColumns = () => {
    for (const child of [...group.children]) group.remove(child);
    highlighted = null;
    if (selectedDetail) {
      selectedDetail = null;
      options.onSelectionStale?.();
    }
  };

  const draw = (readings: Map<string, Reading | null>) => {
    clearColumns();
    offMap = 0;
    let drawn = 0;
    const placed: THREE.Vector3[] = [];
    const [minX, minZ, maxX, maxZ] = placement.worldBoundsM;

    for (const station of stations ?? []) {
      const ground = placement.toWorld(station.lat, station.lon);
      if (ground.x < minX || ground.x > maxX || ground.z < minZ || ground.z > maxZ) {
        offMap++;
        continue;
      }
      const reading = readings.get(station.id) ?? null;
      const index = reading?.totalIndex ?? null;
      const colour = index !== null ? (INDEX_COLOUR[index] ?? UNKNOWN_COLOUR) : UNKNOWN_COLOUR;
      const height = COLUMN_BASE_M + (index ?? 0) * COLUMN_PER_INDEX_M;

      const mesh = new THREE.Mesh(geometry, materialFor(colour));
      // The cylinder is a unit height centred on its origin, so it is scaled and then lifted by
      // half its own height to stand on the ground rather than through it.
      mesh.scale.set(1, height, 1);
      mesh.position.set(ground.x, ground.y + height / 2, ground.z);
      mesh.renderOrder = 2;
      mesh.userData.pick = detailFor(station, reading, components, colour);
      mesh.userData.baseColour = colour;
      group.add(mesh);
      // The TOP of the column, so framing accounts for the full symbol rather than cutting it off.
      placed.push(new THREE.Vector3(ground.x, ground.y + height, ground.z));
      drawn++;
    }
    placement.invalidate();
    // ⚠️ ONLY WHEN THE LAYER IS ACTUALLY ON. Switch the layer on and off again while the first
    // request is still running and this used to fly the camera for a layer the user had already
    // dismissed, and burn the one-shot flag so the next genuine activation framed nothing.
    if (drawn > 0 && !announcedFirstDraw && visible) {
      announcedFirstDraw = true;
      options.onFirstDraw?.(placed);
    }
    return drawn;
  };

  const loadOnce = async () => {
    // The catalogue and the dictionary change on the scale of years; the readings change hourly.
    if (!stations) {
      if (visible) {
        onStatus({
          state: 'loading',
          text: 'Stationsverzeichnis wird geladen (kann beim ersten Mal dauern)…',
          fetchedAt: null,
          count: 0,
        });
      }
      const [stationPayload, componentPayload] = await Promise.all([
        fetchJson<StationsResponse>(urls.stations(), {
          signal: abort.signal, timeoutMs: CATALOGUE_TIMEOUT_MS,
        }),
        fetchJson<ComponentsResponse>(urls.components(), {
          signal: abort.signal, timeoutMs: CATALOGUE_TIMEOUT_MS,
        }),
      ]);
      if (abort.signal.aborted) return;
      stations = parseStations(stationPayload, city);
      components = parseComponents(componentPayload);
      if (visible) {
        onStatus({
          state: 'loading',
          text: `${stations.length} Stationen gefunden, Messwerte werden geladen…`,
          fetchedAt: null,
          count: 0,
        });
      }
    }

    const window_ = requestWindow(new Date(), HOURS_BACK);
    const readings = new Map<string, Reading | null>();
    // Sequential on purpose: five polite requests to a public service, not a burst.
    for (const station of stations) {
      if (abort.signal.aborted) return;
      try {
        const payload = await fetchJson<AirqualityResponse>(
          urls.airquality(station.id, window_),
          { signal: abort.signal, timeoutMs: READING_TIMEOUT_MS },
        );
        readings.set(station.id, newestReading(payload, station.id));
      } catch (error) {
        if (abort.signal.aborted) return;
        // One station failing must not blank the other four. It is drawn grey with a panel note.
        readings.set(station.id, null);
      }
    }
    if (abort.signal.aborted) return;

    const drawn = draw(readings);
    const withData = [...readings.values()].filter((reading) => reading !== null).length;
    const at = new Date();

    // ⚠️ EVERY MEASUREMENT REQUEST FAILING IS NOT A LIVE LAYER. Reporting 'live' with five grey
    // columns, each claiming the values were "nicht veröffentlicht", states something a failed
    // request cannot establish: the source was never successfully asked.
    if (stations.length > 0 && withData === 0) {
      clearColumns();
      if (visible) {
        onStatus({
          state: 'error',
          text: 'Messwerte derzeit nicht abrufbar',
          fetchedAt: null,
          count: 0,
        });
      }
      return;
    }

    const parts = [`${drawn} Messstationen`];
    if (withData < drawn) parts.push(`${drawn - withData} ohne aktuelle Werte`);
    if (offMap > 0) parts.push(`${offMap} außerhalb des Modells`);
    parts.push(`Abruf ${clock(at)}`);
    if (visible) {
      onStatus({ state: 'live', text: parts.join(' · '), fetchedAt: at, count: drawn });
    }
  };

  const queueNextPoll = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => { void poll(); }, POLL_MS);
  };

  const poll = async () => {
    if (!visible || abort.signal.aborted) return;
    if (pending) return pending;
    pending = (async () => {
      try {
        await loadOnce();
      } catch (error) {
        if (!abort.signal.aborted && visible) {
          // Nothing stale stays on screen: the rule for every layer here is that an unreachable
          // source draws nothing rather than leaving an old picture that still looks current.
          clearColumns();
          onStatus({
            state: 'error',
            text: `Luftqualität ${describeError(error)}`,
            fetchedAt: null,
            count: 0,
          });
        }
      } finally {
        pending = null;
        if (visible && !abort.signal.aborted) queueNextPoll();
      }
    })();
    return pending;
  };

  const applyHighlight = (detail: PickDetail | null) => {
    if (highlighted) {
      highlighted.material = materialFor(highlighted.userData.baseColour as number);
      highlighted = null;
    }
    selectedDetail = detail && detail.layerId === 'luft-amtlich' ? detail : null;
    if (!detail || detail.layerId !== 'luft-amtlich') return;
    for (const child of group.children) {
      if (!(child instanceof THREE.Mesh) || child.userData.pick !== detail) continue;
      child.material = highlight;
      highlighted = child;
      break;
    }
    placement.invalidate();
  };

  return {
    id: 'luft-amtlich',
    setVisible(next) {
      visible = next;
      group.visible = next;
      if (next) {
        onStatus({ state: 'loading', text: 'Messwerte werden geladen…', fetchedAt: null, count: 0 });
        void poll();
      } else {
        if (timer !== null) { clearTimeout(timer); timer = null; }
        onStatus({ state: 'idle', text: 'aus', fetchedAt: null, count: 0 });
      }
    },
    onPicked(detail) { applyHighlight(detail); },
    dispose() {
      abort.abort();
      if (timer !== null) { clearTimeout(timer); timer = null; }
      clearColumns();
      for (const resource of owned) resource.dispose();
      owned.length = 0;
      materials.clear();
      placement.group.remove(group);
    },
  };
}

/** Exported for tests, which must be able to check the parsing without a network. */
export const __internals = { detailFor };
