import * as THREE from 'three';

import type { LiveLayer, PickDetail, WorldPlacement } from '../map/worldScene';
import { clock, describeError, fetchJson, type StatusReporter } from './source';

/**
 * MVG-Echtzeitabfahrten an den Haltestellen im Kartenausschnitt.
 *
 * Two real sources, joined on a real key:
 *
 *  * `mor_wfs:oepnv_u_t_b_mvg_neu` on geoportal.muenchen.de gives the stops with a `stop_id` in
 *    the `de:09162:1` form — and that is exactly the `globalId` the MVG departures API takes.
 *    The join is the dataset's own identifier, not a name match, which is what makes this layer
 *    defensible rather than approximately right.
 *  * `mvg.de/api/bgw-pt/v3/departures` gives planned and realtime departure times per stop.
 *
 * ⚠️ THE STOP COUNT IS CAPPED, AND THE CAP IS A POLITENESS BUDGET. The API takes one stop per
 * request, so drawing every stop in the core would mean dozens of calls every refresh against a
 * public endpoint that owes this app nothing. The nearest `MAX_STOPS` to the site anchor are
 * polled; the rest are drawn as plain markers with no live data and are labelled as such.
 *
 * ⚠️ DELAY IS DERIVED, NOT REPORTED. The API returns a planned time and a realtime time; the
 * difference is the delay. An entry with `realtime: false` has no measurement behind it and is
 * counted as unknown rather than as punctual — treating a missing measurement as zero delay is
 * how a live board comes to claim everything is on time.
 */

const WFS = 'https://geoportal.muenchen.de/geoserver/mor_wfs/ows';
const STOP_TYPE = 'mor_wfs:oepnv_u_t_b_mvg_neu';
const DEPARTURES = 'https://www.mvg.de/api/bgw-pt/v3/departures';

const MAX_STOPS = 10;
const POLL_MS = 30000;

/** Metres. Tall enough to read from the arrival camera without dwarfing a four-storey street. */
const MAST_HEIGHT_M = 90;
const MAST_RADIUS_M = 6;

const PUNCTUAL = 0x2f9e57;
const SLIGHT = 0xf0a824;
const LATE = 0xff0000;
const UNKNOWN = 0x8c97a3;

interface StopFeature {
  geometry?: { type?: string; coordinates?: [number, number] };
  properties?: { stop_id?: string; stop_name?: string; verkehrsmi?: string; loc_type?: string };
}
interface StopCollection { features?: StopFeature[] }

interface Departure {
  plannedDepartureTime?: number;
  realtimeDepartureTime?: number;
  realtime?: boolean;
  cancelled?: boolean;
  label?: string;
  destination?: string;
  transportType?: string;
}

interface Stop {
  id: string;
  name: string;
  modes: string;
  easting: number;
  northing: number;
  mast: THREE.Mesh;
  head: THREE.Mesh;
  live: boolean;
  worstDelayMin: number | null;
  departures: number;
  /** The rows behind the colour, kept so a click can show them instead of just a number. */
  list: Departure[];
  /** Why the last attempt for this stop failed, if it did. */
  failed: string | null;
}

export interface MvgOptions {
  placement: WorldPlacement;
  onStatus: StatusReporter;
  siteId?: string;
  /**
   * Re-show the detail panel for a stop whose departures arrived after it was clicked.
   *
   * ⚠️ NEEDED BECAUSE THE PANEL IS NOT REACTIVE. A pick hands the panel one object and the
   * panel renders it once. Only ten stops are polled, so clicking any of the others has nothing
   * to show at the moment of the click; without a way to push the answer back, the honest
   * options would be to leave the panel empty or to poll every stop on a timer, and the second
   * one spends somebody else's API budget on stops nobody looked at.
   */
  onDetail?: (detail: PickDetail) => void;
}

export async function createMvgLayer(options: MvgOptions): Promise<LiveLayer> {
  const { placement, onStatus } = options;
  const siteId = options.siteId ?? 'munich';

  /** Which stop the detail panel is currently showing, so a late answer cannot hijack it. */
  let selectedStopId: string | null = null;
  /** Stops already asked for on demand, so a repeated click is not a repeated request. */
  const requested = new Set<string>();

  const group = new THREE.Group();
  group.name = 'mvg';
  group.visible = false;
  placement.group.add(group);

  const abort = new AbortController();
  const stops: Stop[] = [];
  const mastGeometry = new THREE.CylinderGeometry(MAST_RADIUS_M * 0.35, MAST_RADIUS_M * 0.35, MAST_HEIGHT_M, 6);
  const headGeometry = new THREE.SphereGeometry(MAST_RADIUS_M, 12, 8);
  const materials = new Map<number, THREE.MeshBasicMaterial>();
  const materialFor = (colour: number) => {
    let material = materials.get(colour);
    if (!material) {
      // No lights in this scene: every other surface shades itself. See baustellen.ts.
      material = new THREE.MeshBasicMaterial({ color: colour });
      materials.set(colour, material);
    }
    return material;
  };

  let visible = false;
  let stopsLoaded = false;
  let timer = 0;
  let fetchedAt: Date | null = null;

  const loadStops = async () => {
    if (stopsLoaded) return;
    const box = placement.coreBboxUtm(siteId);
    const params = new URLSearchParams({
      service: 'WFS', version: '1.1.0', request: 'GetFeature',
      typeName: STOP_TYPE, outputFormat: 'application/json',
    });
    if (box) {
      params.set('bbox', `${box.minE},${box.minN},${box.maxE},${box.maxN},urn:ogc:def:crs:EPSG::25832`);
    }
    const data = await fetchJson<StopCollection>(`${WFS}?${params}`, {
      signal: abort.signal, timeoutMs: 20000,
    });
    if (abort.signal.aborted) return;

    const seen = new Set<string>();
    for (const feature of data.features ?? []) {
      const id = feature.properties?.stop_id?.trim();
      const name = feature.properties?.stop_name?.trim();
      const coordinates = feature.geometry?.coordinates;
      if (!id || !name || !Array.isArray(coordinates) || coordinates.length < 2) continue;
      // The dataset carries one row per platform as well as one per station; only the station
      // rows (`loc_type` 1) have departures, and the rest would be duplicate masts on one corner.
      if (feature.properties?.loc_type !== '1') continue;
      if (seen.has(id)) continue;
      seen.add(id);

      const [easting, northing] = coordinates;
      const anchor = placement.toWorldUtm(easting, northing);
      const mast = new THREE.Mesh(mastGeometry, materialFor(UNKNOWN));
      mast.position.set(anchor.x, anchor.y + MAST_HEIGHT_M / 2, anchor.z);
      const head = new THREE.Mesh(headGeometry, materialFor(UNKNOWN));
      head.position.set(anchor.x, anchor.y + MAST_HEIGHT_M, anchor.z);
      group.add(mast, head);

      stops.push({
        id, name,
        modes: feature.properties?.verkehrsmi?.trim() ?? '',
        easting, northing, mast, head,
        live: false, worstDelayMin: null, departures: 0, list: [], failed: null,
      });
      const stop = stops[stops.length - 1];
      const detail = detailFor(stop);
      mast.userData.pick = detail;
      head.userData.pick = detail;
    }
    stopsLoaded = true;
  };

  const colourFor = (stop: Stop) => {
    if (!stop.live || stop.worstDelayMin === null) return UNKNOWN;
    if (stop.worstDelayMin >= 5) return LATE;
    if (stop.worstDelayMin >= 2) return SLIGHT;
    return PUNCTUAL;
  };

  const hhmm = (ms: number) =>
    new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  /**
   *
   * ⚠️ THE DELAY IS SHOWN ONLY WHERE IT WAS MEASURED. `realtime: false` means the API returned a
   * planned time and nothing else, so the difference between the two timestamps is zero by
   * construction rather than by observation. Printing "pünktlich" there would turn the absence of
   * a measurement into a claim about the service, which is the same mistake the layer's status
   * line already avoids.
   */
  const rowFor = (departure: Departure): string => {
    const label = departure.label?.trim() || '?';
    const destination = departure.destination?.trim() || 'unbekanntes Ziel';
    const planned = departure.plannedDepartureTime;
    const actual = departure.realtimeDepartureTime;
    const shown = typeof actual === 'number' ? actual : planned;
    const time = typeof shown === 'number' ? hhmm(shown) : 'ohne Zeit';

    let suffix = ' · ohne Echtzeit';
    if (departure.realtime === true && typeof planned === 'number' && typeof actual === 'number') {
      const minutes = Math.round((actual - planned) / 60000);
      suffix = minutes === 0
        ? ' · pünktlich'
        : minutes > 0 ? ` · +${minutes} min` : ` · ${minutes} min`;
    }
    return `${label} → ${destination}, ${time}${suffix}`;
  };

  const detailFor = (stop: Stop): PickDetail => {
    const fields: { label: string; value: string }[] = [];
    if (stop.modes) fields.push({ label: 'Verkehrsmittel', value: stop.modes });
    fields.push({ label: 'Haltestellen-ID', value: stop.id });

    if (stop.live) {
      const cancelled = stop.list.filter((d) => d.cancelled === true).length;
      const rows = [...stop.list]
        .filter((d) => d.cancelled !== true)
        // Soonest first: the API's order is not guaranteed to be chronological.
        .sort((a, b) =>
          (a.realtimeDepartureTime ?? a.plannedDepartureTime ?? 0)
          - (b.realtimeDepartureTime ?? b.plannedDepartureTime ?? 0))
        .slice(0, 8);
      if (rows.length === 0) {
        fields.push({ label: 'Abfahrten', value: 'derzeit keine Abfahrten gemeldet' });
      } else {
        rows.forEach((departure, index) => {
          fields.push({ label: index === 0 ? 'Nächste Abfahrten' : ' ', value: rowFor(departure) });
        });
      }
      if (cancelled) {
        fields.push({ label: 'Entfällt', value: `${cancelled} Fahrt(en) als entfallen gemeldet` });
      }
    } else {
      fields.push({
        label: 'Abfahrten',
        value: stop.failed
          ? `nicht abrufbar (${stop.failed})`
          : requested.has(stop.id) ? 'werden abgefragt…' : 'noch nicht abgefragt',
      });
    }

    return {
      layerId: 'mvg',
      title: stop.name,
      subtitle: 'MVG-Haltestelle',
      accent: colourFor(stop),
      fields,
      source: 'Haltestellen: Landeshauptstadt München (mor_wfs:oepnv_u_t_b_mvg_neu) · '
        + 'Abfahrten: MVG, Echtzeit',
      haltestelleId: stop.id,
      easting: stop.easting,
      northing: stop.northing,
    };
  };

  /** Rebuild the pick detail and push it to the panel when this stop is the one on screen. */
  const refreshDetail = (stop: Stop) => {
    const detail = detailFor(stop);
    stop.mast.userData.pick = detail;
    stop.head.userData.pick = detail;
    if (selectedStopId === stop.id) options.onDetail?.(detail);
  };

  const pollStop = async (stop: Stop) => {
    const url = `${DEPARTURES}?globalId=${encodeURIComponent(stop.id)}&limit=8`;
    const list = await fetchJson<Departure[]>(url, { signal: abort.signal, timeoutMs: 15000 });
    if (abort.signal.aborted) return;
    const usable = (Array.isArray(list) ? list : []).filter((d) => !d.cancelled);
    stop.departures = usable.length;
    stop.list = Array.isArray(list) ? list : [];
    const delays = usable
      .filter((d) => d.realtime === true
        && typeof d.plannedDepartureTime === 'number'
        && typeof d.realtimeDepartureTime === 'number')
      .map((d) => (d.realtimeDepartureTime! - d.plannedDepartureTime!) / 60000);
    // ⚠️ `measured` is not the same as `live`. A stop can answer perfectly and still contain no
    // realtime departure — every entry carrying only a planned time. Counting that as punctual is
    // how a live board comes to claim everything is running on time; it is reported as
    // measured-but-unknown instead.
    stop.worstDelayMin = delays.length ? Math.max(...delays) : null;
    stop.live = true;
    stop.failed = null;
    const colour = materialFor(colourFor(stop));
    stop.mast.material = colour;
    stop.head.material = colour;
    refreshDetail(stop);
  };

  /**
   * Forget what a stop last told us.
   *
   * ⚠️ CALLED BEFORE EVERY POLL, and this is the whole point. Without it a single successful
   * refresh made every later failure look successful: `stop.live` stayed true, the marker kept
   * its old colour, and the panel reported "10 live" beside a NEW timestamp. Ten minutes of
   * outage would have been indistinguishable from ten minutes of punctual service.
   */
  const forget = (stop: Stop) => {
    stop.live = false;
    stop.worstDelayMin = null;
    stop.departures = 0;
    stop.list = [];
    const colour = materialFor(UNKNOWN);
    stop.mast.material = colour;
    stop.head.material = colour;
  };

  const poll = async () => {
    if (!visible) return;
    try {
      await loadStops();
      if (abort.signal.aborted || stops.length === 0) {
        onStatus({ state: 'live', text: 'keine Haltestellen im Ausschnitt', fetchedAt: new Date(), count: 0 });
        return;
      }
      // Nearest to the world origin of this core, which is where the camera arrives.
      const anchor = placement.coreBboxUtm(siteId);
      const centreE = anchor ? (anchor.minE + anchor.maxE) / 2 : stops[0].easting;
      const centreN = anchor ? (anchor.minN + anchor.maxN) / 2 : stops[0].northing;
      const nearest = [...stops]
        .sort((a, b) =>
          Math.hypot(a.easting - centreE, a.northing - centreN)
          - Math.hypot(b.easting - centreE, b.northing - centreN))
        .slice(0, MAX_STOPS);

      for (const stop of nearest) forget(stop);
      const results = await Promise.allSettled(nearest.map(pollStop));
      if (abort.signal.aborted || !visible) return;
      const failed = results.filter((r) => r.status === 'rejected').length;
      const live = nearest.filter((s) => s.live);
      const delayed = live.filter((s) => (s.worstDelayMin ?? 0) >= 2).length;
      const unknown = live.filter((s) => s.worstDelayMin === null).length;

      if (live.length === 0) {
        const reason = results.find((r) => r.status === 'rejected');
        onStatus({
          state: 'error',
          text: `MVG ${describeError(reason && 'reason' in reason ? reason.reason : null)}`,
          fetchedAt: null, count: 0,
        });
        return;
      }
      // The timestamp belongs to THIS poll's successful measurements, never to retained ones.
      fetchedAt = new Date();
      const parts = [
        `${stops.length} Haltestellen`,
        `${live.length} abgefragt`,
        `${delayed} mit Verspätung`,
      ];
      if (unknown) parts.push(`${unknown} ohne Echtzeit`);
      if (failed) parts.push(`${failed} ohne Antwort`);
      parts.push(`Stand ${clock(fetchedAt)}`);
      onStatus({ state: 'live', text: parts.join(' · '), fetchedAt, count: stops.length });
    } catch (error) {
      if (abort.signal.aborted) return;
      onStatus({ state: 'error', text: `MVG ${describeError(error)}`, fetchedAt: null, count: 0 });
    }
  };

  const stop = () => { if (timer) { window.clearInterval(timer); timer = 0; } };

  return {
    id: 'mvg',
    /**
     * Fetch a clicked stop's departures if nobody has asked for them yet.
     *
     * ⚠️ THIS IS WHY THE POLL CAP IS NOT A PROBLEM. Ten stops are polled on a timer out of
     * politeness, but the core holds far more, and a marker that answers "nothing to show"
     * when clicked teaches people the layer is decorative. A click is a deliberate act by one
     * person, so spending one request on it is proportionate, and `requested` keeps an
     * impatient second click from becoming a second request.
     */
    onPicked(detail) {
      selectedStopId = detail?.layerId === 'mvg' ? detail.haltestelleId ?? null : null;
      if (!selectedStopId) return;
      const stop = stops.find((candidate) => candidate.id === selectedStopId);
      if (!stop || stop.live || requested.has(stop.id)) return;
      requested.add(stop.id);
      refreshDetail(stop);
      void pollStop(stop).catch((error) => {
        if (abort.signal.aborted) return;
        stop.failed = describeError(error);
        // Allow a later retry: the failure may have been a passing network problem.
        requested.delete(stop.id);
        refreshDetail(stop);
      });
    },
    setVisible(next) {
      visible = next;
      group.visible = next;
      if (next) {
        onStatus({ state: 'loading', text: 'MVG-Daten werden geladen…', fetchedAt: null, count: 0 });
        void poll();
        if (!timer) timer = window.setInterval(() => { void poll(); }, POLL_MS);
      } else {
        stop();
        onStatus({ state: 'idle', text: 'aus', fetchedAt: null, count: 0 });
      }
    },
    dispose() {
      stop();
      abort.abort();
      group.clear();
      mastGeometry.dispose();
      headGeometry.dispose();
      for (const material of materials.values()) material.dispose();
      materials.clear();
      stops.length = 0;
      placement.group.remove(group);
    },
  };
}
