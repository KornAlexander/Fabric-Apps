import * as THREE from 'three';

import type { LiveLayer, PickDetail, WorldPlacement } from '../map/worldScene';
import { clock, describeError, fetchJson, type StatusReporter } from './source';
import { colourForPm25, parseArea } from './luftParse.mjs';

/**
 * Bürgermessnetz: Feinstaubsensoren aus dem Sensor.Community-Projekt.
 *
 * The counterpart to the five official stations. Sensor.Community is a volunteer network of
 * self-built sensors, mostly on balconies and window sills, publishing openly under ODbL. It is
 * the layer that shows what a city looks like when the measurement network is a thousand times
 * denser and a hundred times less accurate, which is a genuinely interesting conversation to
 * have next to the Umweltbundesamt's reference stations rather than instead of them.
 *
 * ⚠️ THIS IS NOT REFERENCE-GRADE MEASUREMENT, AND THE APP SAYS SO EVERYWHERE IT APPEARS.
 * The common SDS011 is an uncalibrated optical particle counter. Its readings are known to run
 * high in humid air, because it sizes swollen droplets as particles. Comparing a value here with
 * a value from the amtliche station three streets away is not a like-for-like comparison, and
 * presenting the two layers as interchangeable would be the single most misleading thing this
 * app could do.
 *
 * ⚠️ THE POSITIONS ARE DELIBERATELY BLURRED BY THE SOURCE. Measured 2026-09-21: every record
 * carries `exact_location: 0` and coordinates rounded to three decimals, roughly 110 m north to
 * south and 75 m east to west at this latitude. That is a privacy measure — these are people's
 * homes. A marker is therefore placed at the published coordinate and must NOT be read as the
 * address of a sensor, let alone of its owner.
 *
 * ⚠️ INDOOR SENSORS ARE EXCLUDED. The feed flags them, and an indoor reading says nothing about
 * outdoor air quality while looking identical on a map.
 */

const AREA_URL = 'https://data.sensor.community/airrohr/v1/filter/area=';

/**
 * The two query areas, as the user chose: city core and airport.
 *
 * Sensor.Community answers the browser directly with `Access-Control-Allow-Origin: *`, so unlike
 * ADS-B and the Umweltbundesamt this layer needs no relay and no dev proxy at all.
 */
const AREAS = [
  { label: 'Stadt', lat: 48.137, lon: 11.575, radiusKm: 6 },
  { label: 'Flughafen', lat: 48.354, lon: 11.786, radiusKm: 6 },
] as const;

/** The feed republishes every few minutes. */
const POLL_MS = 180_000;

/** A reading older than this is dropped rather than drawn as if it were current. */
const MAX_AGE_MS = 60 * 60 * 1000;

/** Metres above the terrain, so a marker is not buried in a roof. */
const LIFT_M = 40;
const MARKER_RADIUS_M = 22;

/**
 * The colour scale lives in `luftParse.mjs` beside the parsing, so the breakpoints printed in
 * the legend and the breakpoints used to paint a marker cannot drift apart.
 */

interface Sensor {
  id: string;
  lat: number;
  lon: number;
  at: number;
  timestamp: string;
  model: string;
  pm10: number | null;
  pm25: number | null;
  blurred: boolean;
}

function detailFor(sensor: Sensor, colour: number): PickDetail {
  const fields: { label: string; value: string }[] = [];
  const add = (label: string, value: string | null) => {
    if (value && value.length) fields.push({ label, value });
  };

  if (sensor.pm25 !== null) add('PM₂,₅ Feinstaub', `${sensor.pm25} µg/m³`);
  if (sensor.pm10 !== null) add('PM₁₀ Feinstaub', `${sensor.pm10} µg/m³`);
  add('Messzeitpunkt', `${sensor.timestamp} UTC`);
  add('Sensortyp', sensor.model || null);
  add('Sensor-ID', sensor.id);
  if (sensor.blurred) {
    add('Standort', 'von der Quelle gerundet veröffentlicht (Datenschutz), nicht die genaue Adresse');
  }
  add(
    'Einordnung',
    'Bürgermessnetz, nicht amtlich kalibriert. Optische Sensoren messen bei hoher Luftfeuchte '
    + 'tendenziell zu hoch. Nicht direkt mit den amtlichen Stationen vergleichbar.',
  );

  return {
    layerId: 'luft-buerger',
    title: `Bürgersensor ${sensor.id}`,
    subtitle: 'Sensor.Community · nicht amtlich',
    accent: colour,
    fields,
    source: 'Sensor.Community (data.sensor.community), offene Daten unter ODbL',
  };
}

export interface LuftBuergerOptions {
  placement: WorldPlacement;
  onStatus: StatusReporter;
  /** Overrides for tests. */
  areaUrl?: (lat: number, lon: number, radiusKm: number) => string;
  /** Called when a refresh replaces the markers while one of them was selected. */
  onSelectionStale?: () => void;
}

export async function createLuftBuergerLayer(options: LuftBuergerOptions): Promise<LiveLayer> {
  const { placement, onStatus } = options;
  const areaUrl = options.areaUrl
    ?? ((lat: number, lon: number, radiusKm: number) => `${AREA_URL}${lat},${lon},${radiusKm}`);

  const group = new THREE.Group();
  group.name = 'luft-buerger';
  group.visible = false;
  placement.group.add(group);

  const abort = new AbortController();
  const owned: (THREE.BufferGeometry | THREE.Material)[] = [];
  let visible = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Promise<void> | null = null;

  const geometry = new THREE.SphereGeometry(MARKER_RADIUS_M, 12, 8);
  owned.push(geometry);

  const materials = new Map<number, THREE.MeshBasicMaterial>();
  const materialFor = (colour: number) => {
    let material = materials.get(colour);
    if (!material) {
      material = new THREE.MeshBasicMaterial({
        color: colour, transparent: true, opacity: 0.85, depthWrite: false,
      });
      materials.set(colour, material);
      owned.push(material);
    }
    return material;
  };

  const highlight = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false,
  });
  owned.push(highlight);
  let highlighted: THREE.Mesh | null = null;
  /** The detail currently open in the panel, if it came from this layer. */
  let selectedDetail: PickDetail | null = null;

  const clearMarkers = () => {
    for (const child of [...group.children]) group.remove(child);
    highlighted = null;
    if (selectedDetail) {
      selectedDetail = null;
      options.onSelectionStale?.();
    }
  };

  const draw = (sensors: Sensor[]) => {
    clearMarkers();
    let drawn = 0;
    let offMap = 0;
    const [minX, minZ, maxX, maxZ] = placement.worldBoundsM;

    for (const sensor of sensors) {
      const ground = placement.toWorld(sensor.lat, sensor.lon);
      if (ground.x < minX || ground.x > maxX || ground.z < minZ || ground.z > maxZ) {
        offMap++;
        continue;
      }
      const colour = colourForPm25(sensor.pm25);
      const mesh = new THREE.Mesh(geometry, materialFor(colour));
      mesh.position.set(ground.x, ground.y + LIFT_M, ground.z);
      mesh.renderOrder = 2;
      mesh.userData.pick = detailFor(sensor, colour);
      mesh.userData.baseColour = colour;
      group.add(mesh);
      drawn++;
    }
    placement.invalidate();
    return { drawn, offMap };
  };

  const loadOnce = async () => {
    const now = Date.now();
    const byId = new Map<string, Sensor>();
    for (const area of AREAS) {
      if (abort.signal.aborted) return;
      const payload = await fetchJson<unknown>(
        areaUrl(area.lat, area.lon, area.radiusKm),
        { signal: abort.signal, timeoutMs: 20000 },
      );
      // The two areas do not overlap here, but merging by id costs nothing and makes a future
      // third area safe to add without double-drawing the sensors in the seam.
      for (const sensor of parseArea(payload, now, MAX_AGE_MS)) {
        const existing = byId.get(sensor.id);
        if (!existing || existing.at < sensor.at) byId.set(sensor.id, sensor);
      }
    }
    if (abort.signal.aborted) return;

    const sensors = [...byId.values()];
    const { drawn, offMap } = draw(sensors);
    const at = new Date();
    const parts = [`${drawn} Bürgersensoren`];
    if (offMap > 0) parts.push(`${offMap} außerhalb des Modells`);
    parts.push('nicht amtlich');
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
          // Nothing stale stays on screen. Markers left from an earlier poll would keep a failed
          // refresh looking like live data, which is the one thing this app must never do.
          clearMarkers();
          onStatus({
            state: 'error',
            text: `Bürgersensoren ${describeError(error)}`,
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
    selectedDetail = detail && detail.layerId === 'luft-buerger' ? detail : null;
    if (!detail || detail.layerId !== 'luft-buerger') return;
    for (const child of group.children) {
      if (!(child instanceof THREE.Mesh) || child.userData.pick !== detail) continue;
      child.material = highlight;
      highlighted = child;
      break;
    }
    placement.invalidate();
  };

  return {
    id: 'luft-buerger',
    setVisible(next) {
      visible = next;
      group.visible = next;
      if (next) {
        onStatus({ state: 'loading', text: 'Bürgersensoren werden geladen…', fetchedAt: null, count: 0 });
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
      clearMarkers();
      for (const resource of owned) resource.dispose();
      owned.length = 0;
      materials.clear();
      placement.group.remove(group);
    },
  };
}

/** Exported for tests, which must be able to check the parsing without a network. */
export const __internals = { detailFor };
