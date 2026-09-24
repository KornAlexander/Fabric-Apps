import * as THREE from 'three';

import type { LiveLayer, WorldPlacement } from '../map/worldScene';
import { clock, describeError, fetchJson, type StatusReporter } from './source';

/**
 * Live air traffic over Munich and the airport, from ADS-B.
 *
 * ⚠️ SOURCE CHANGED ON 2026-09-21 AND THE REASON IS RECORDED HERE. The plan named
 * `api.airplanes.live`, which is what the Airport IQ app uses. Measured before writing a line of
 * this file: it answers **HTTP 403 to every request** — plain, with a browser User-Agent, and
 * with a Referer. `api.adsb.lol` answered 200 with 81 aircraft, and its licence is better for
 * this audience: ODbL open data rather than explicitly non-commercial terms.
 *
 * ⚠️ IT IS NOT FETCHED DIRECTLY, AND IT CANNOT BE. Measured from a real browser: adsb.lol,
 * adsb.fi, adsb.one, airplanes.live and OpenSky ALL fail with `TypeError: Failed to fetch`. None
 * sends an `Access-Control-Allow-Origin` header, so no web page may read them, whatever its
 * origin — the identical requests succeed from a terminal on the same machine. The request
 * therefore goes to a same-origin path that the Vite dev and preview servers proxy. The layer is
 * live where that proxy runs, unavailable in the hosted app, and says which.
 *
 * ## What this layer refuses to invent
 *
 * The standing requirement here is real data only. That is easy to satisfy for a position and
 * surprisingly easy to breach everywhere around it, so each case is explicit:
 *
 *  * **Age** comes from the feed's own `seen_pos`, not from when the response arrived. A stale
 *    position inside a fresh response is stale.
 *  * **Motion between polls** is extrapolated only when the aircraft reports BOTH a speed and a
 *    ground track. Without a track there is no direction to move in, and defaulting to north
 *    draws invented movement.
 *  * **Nothing moves while the feed is down.** Extrapolation stops on the first failure rather
 *    than continuing convincingly from the last good frame.
 *  * **Size** comes from the published length of the reported type. An aircraft whose type is
 *    not in the table is NOT drawn at a default size; it is counted and reported as not shown.
 *  * **Altitude**: `alt_baro` is a PRESSURE altitude referenced to 1013.25 hPa, not height above
 *    ground and not geometric altitude. Aircraft reporting `ground` are placed on the terrain
 *    instead, which is both more accurate and the only way they sit on the apron.
 *  * **Positions outside the model** are dropped. The feed is queried by radius and does not
 *    know where the terrain ends.
 */

/**
 * Where the ADS-B request goes.
 *
 * Two paths, because there are two situations and neither can serve the other:
 *
 *  * **Hosted** — the Fabric App has no server side (Rayfin functions are disabled in this
 *    tenant), so it calls a small relay running as an Azure Container App. The relay exists only
 *    because no ADS-B provider sends CORS headers; see relay/server.mjs.
 *  * **Local dev and preview** — the Vite server proxies `/api/adsb` itself, so no relay is
 *    needed and the relay's origin allow-list deliberately does NOT include localhost.
 */
const RELAY_ORIGIN = (import.meta.env.VITE_RELAY_ORIGIN ?? '').replace(/\/$/, '');
const RELAY_PATH = '/adsb/point';
/** Origins served by the Vite proxy rather than by the relay. */
const DEV_ORIGINS = new Set([
  'http://127.0.0.1:5190', 'http://127.0.0.1:4190',
  'http://localhost:5190', 'http://localhost:4190',
]);

function endpointFor(baseUrl: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return DEV_ORIGINS.has(origin)
    ? `${baseUrl}api/adsb/point`
    : `${RELAY_ORIGIN}${RELAY_PATH}`;
}

/** Munich Airport reference position, OSM relation/20786018. */
const CENTRE = { lat: 48.3538, lon: 11.7861 };

/**
 * Nautical miles.
 *
 * ⚠️ SIZED TO THE MODEL, NOT TO THE FEED. The shell is 36.5 x 46.8 km, so the far corner is
 * about 30 km from the airport — roughly 16 NM. 25 NM covers the whole modelled world with
 * margin and still holds the full approach; asking for 60 returned aircraft over Augsburg and
 * Salzburg that can only be discarded.
 */
const RADIUS_NM = 25;

/** The feed is a volunteer receiver network; 12 s is well inside its 1 request/second limit. */
const POLL_MS = 12000;

/**
 * Drop an aircraft whose last REPORTED position is older than this.
 *
 * Dead reckoning is a short-term bridge, not a simulation: it moves an aircraft along its last
 * reported ground track at its last reported speed so the scene is smooth between polls. Run it
 * for minutes and it becomes invented motion. Sixty seconds is a little over four poll intervals
 * — long enough to ride out a missed response, short enough that nothing on screen is mostly
 * extrapolation. It is measured against `seen_pos`, so an aircraft the receivers lost five
 * minutes ago is gone even though the feed still lists it.
 */
const MAX_AGE_MS = 60000;

const FT_TO_M = 0.3048;
const KT_TO_MS = 0.514444;
const EARTH_R = 6371008.8;

interface AdsbAircraft {
  hex?: string;
  flight?: string;
  r?: string;
  t?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | 'ground';
  gs?: number;
  track?: number;
  true_heading?: number;
  dir?: number;
  /** Seconds since this position was received. Absent on some records. */
  seen_pos?: number;
}

interface AdsbResponse { ac?: AdsbAircraft[] }

/** A response plus how long the relay had been holding it. */
interface AdsbFetch { data: AdsbResponse; relayAgeMs: number }

type Family = 'regional' | 'narrow' | 'wide2' | 'quad' | 'super';

/**
 * Published overall length in metres, by ICAO type designator.
 *
 * ⚠️ MANUFACTURER FIGURES, USED ONLY FOR SCALE, AND DELIBERATELY WITHOUT A CATCH-ALL DEFAULT.
 * The model files are shared per family, so without a real length every A319 and every A350
 * would be drawn the same size. An earlier version of this file fell back to "37.6 m, narrow
 * body" for any unlisted type, which silently drew a light aircraft, a helicopter and a ground
 * vehicle as an A320.
 *
 * \u26a0\ufe0f IT LISTS AIRLINERS AND REGIONAL TURBOPROPS ONLY, AND THAT IS A SHAPE DECISION RATHER THAN
 * AN OVERSIGHT. Five silhouettes are available. Scaling the regional-jet model down to 8.3 m to
 * stand in for a Cessna 172, or to 9.6 m for an EC120, would produce something the right length
 * and the wrong aircraft — and a helicopter drawn as a tiny jet on a live airport map is exactly
 * the detail an airport operator spots first. Measured over MUC on 2026-09-21, this affects a
 * handful of movements per sweep (PC12, PC7, C172, GA7C, EC45, EC20 and records with no type at
 * all).
 *
 * ⚠️ THEY ARE STILL DRAWN, AS AN AVOWEDLY GENERIC MARKER. An earlier version dropped them and
 * only reported a count, which meant a real aircraft over the field was invisible. A neutral
 * octahedron says "something is here, and its position is measured" without claiming a type or
 * a size it cannot support. It deliberately does not resemble an aircraft: a small silhouette
 * would be read as a small aeroplane, which for a helicopter is simply wrong.
 */
const TYPE_LENGTH_M: Record<string, number> = {
  A318: 31.4, A319: 33.8, A320: 37.6, A20N: 37.6, A321: 44.5, A21N: 44.5,
  A332: 58.8, A333: 63.7, A339: 63.7, A343: 63.7, A346: 75.4,
  A359: 66.8, A35K: 73.8, A388: 72.7,
  B712: 37.8, B733: 33.4, B734: 36.4, B735: 31.0, B736: 31.2,
  B737: 33.6, B738: 39.5, B739: 42.1, B38M: 39.5, B39M: 42.2,
  B752: 47.3, B753: 54.5, B762: 48.5, B763: 54.9, B764: 61.4,
  B772: 63.7, B77W: 73.9, B77L: 63.7, B788: 56.7, B789: 62.8, B78X: 68.3,
  B741: 70.6, B744: 70.6, B748: 76.3,
  BCS1: 35.0, BCS3: 38.7, SU95: 29.9,
  E170: 29.9, E75L: 31.7, E75S: 31.7, E190: 36.2, E195: 38.7, E290: 36.2, E295: 41.5,
  CRJ9: 36.4, CRJX: 39.1, AT45: 22.7, AT72: 27.2, AT76: 27.2, DH8D: 32.8, SB20: 27.3,
};

function familyFor(type: string, length: number): Family {
  if (type === 'A388') return 'super';
  if (/^B74|^A34|^A38/.test(type)) return 'quad';
  if (length >= 50) return 'wide2';
  if (length >= 30) return 'narrow';
  return 'regional';
}

/** Metres per degree of latitude and of longitude at a given latitude. */
function metresPerDegree(latDeg: number) {
  const lat = (latDeg * Math.PI) / 180;
  return {
    lat: (Math.PI / 180) * EARTH_R,
    lon: (Math.PI / 180) * EARTH_R * Math.cos(lat),
  };
}

interface Track {
  callsign: string;
  lat: number;
  lon: number;
  /** Metres above sea level, or null when the aircraft reports itself on the ground. */
  altitudeM: number | null;
  /** Ground speed in metres per second. */
  speedMs: number;
  /** Ground track in degrees clockwise from north, or null when the feed reports none. */
  trackDeg: number | null;
  /** The feed's own report time, translated onto the performance clock. */
  reportedAt: number;
  groundLiftM: number;
  object: THREE.Object3D;
}

export interface FlugverkehrOptions {
  placement: WorldPlacement;
  onStatus: StatusReporter;
  endpoint?: string;
  baseUrl?: string;
  /** Cancels model loading as well as polling, so a torn-down world stops this layer mid-build. */
  signal?: AbortSignal;
}

export async function createFlugverkehrLayer(options: FlugverkehrOptions): Promise<LiveLayer> {
  const { placement, onStatus } = options;
  const endpoint = options.endpoint ?? endpointFor(options.baseUrl ?? import.meta.env.BASE_URL);

  const abort = new AbortController();
  const cancelOuter = () => abort.abort();
  options.signal?.addEventListener('abort', cancelOuter, { once: true });
  if (options.signal?.aborted) abort.abort();

  // ------------------------------------------------------------------ models
  interface Prototype { object: THREE.Object3D; lengthM: number; bottomM: number }
  const prototypes = new Map<Family, Prototype>();

  /**
   * ⚠️ IN DIESEM PAKET GIBT ES KEINE FLUGZEUGMODELL-DATEIEN. Die Lizenz der ursprünglichen
   * glTF-Modelle ließ sich nicht belegen, also baut jede Familie eine einfache Silhouette im
   * Code: Rumpf, Tragflächen, Höhenleitwerk, Seitenleitwerk, Triebwerke. Achsen wie im Rest dieser
   * Ebene: Nase auf +X, Tragflächen auf Z, oben +Y. Die Länge wird gemessen und später auf die
   * veröffentlichte Länge des Typs skaliert, also wird nichts übertrieben.
   * Eigene, lizenzierte Modelle lassen sich wieder anbinden: GLTFLoader, Achsen wie oben.
   */
  const FAMILY_SHAPE: Record<Family, { span: number; engines: 2 | 4; body: number }> = {
    regional: { span: 0.95, engines: 2, body: 0.085 },
    narrow: { span: 0.95, engines: 2, body: 0.095 },
    wide2: { span: 0.93, engines: 2, body: 0.1 },
    quad: { span: 0.92, engines: 4, body: 0.095 },
    super: { span: 0.99, engines: 4, body: 0.115 },
  };
  const hull = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.55, metalness: 0.1 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x8a96a3, roughness: 0.6, metalness: 0.2 });
  const loadFamily = async (family: Family) => {
    const s = FAMILY_SHAPE[family];
    const L = 40;
    const r = (L * s.body) / 2;
    const span = L * s.span;
    const object = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(r, L - 2 * r, 6, 16), hull);
    body.rotation.z = Math.PI / 2;
    object.add(body);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(L * 0.16, r * 0.18, span), hull);
    wing.position.set(L * 0.02, -r * 0.35, 0);
    object.add(wing);
    const tailplane = new THREE.Mesh(new THREE.BoxGeometry(L * 0.08, r * 0.14, span * 0.34), hull);
    tailplane.position.set(-L * 0.43, r * 0.25, 0);
    object.add(tailplane);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(L * 0.12, L * 0.15, r * 0.16), hull);
    fin.position.set(-L * 0.41, r + L * 0.07, 0);
    object.add(fin);
    const pod = new THREE.CylinderGeometry(r * 0.32, r * 0.32, L * 0.1, 12);
    for (const f of s.engines === 4 ? [0.2, 0.37] : [0.24]) {
      for (const side of [-1, 1]) {
        const engine = new THREE.Mesh(pod, trim);
        engine.rotation.z = Math.PI / 2;
        engine.position.set(L * 0.08, -r * 0.85, side * span * f);
        object.add(engine);
      }
    }
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const size = new THREE.Vector3();
    box.getSize(size);
    prototypes.set(family, { object, lengthM: size.x, bottomM: box.min.y });
  };

  await Promise.all((Object.keys(FAMILY_SHAPE) as Family[]).map(loadFamily));
  abort.signal.throwIfAborted();

  /**
   * The marker for an aircraft whose type carries no published silhouette.
   *
   * Built in code rather than loaded, because the whole point is that it is NOT an aircraft
   * shape. Size is a fixed symbol size: the record gives a measured position, and nothing about
   * a length, so drawing any particular length would be an invention.
   */
  const GENERIC_SPAN_M = 46;
  const genericGeometry = new THREE.OctahedronGeometry(GENERIC_SPAN_M / 2);
  const genericMaterial = new THREE.MeshBasicMaterial({
    color: 0xf2f4f7, transparent: true, opacity: 0.9,
  });
  const genericEdges = new THREE.EdgesGeometry(genericGeometry);
  const genericEdgeMaterial = new THREE.LineBasicMaterial({ color: 0x1b2733, transparent: true, opacity: 0.85 });

  // ------------------------------------------------------------------ state
  const group = new THREE.Group();
  group.name = 'flugverkehr';
  group.visible = false;
  placement.group.add(group);

  const tracks = new Map<string, Track>();
  let timer = 0;
  let visible = false;
  let fetchedAt: Date | null = null;
  /** True while the last poll failed: nothing is extrapolated from data known to be stale. */
  let feedDown = false;
  let genericCount = 0;
  let skippedOffMap = 0;

  const spawn = (family: Family, realLengthM: number) => {
    const prototype = prototypes.get(family)!;
    const model = prototype.object.clone(true);
    const scale = realLengthM / prototype.lengthM;
    model.scale.setScalar(scale);
    // ⚠️ A SEPARATE PIVOT FOR HEADING, AND THIS WAS A REAL BUG, NOT A PRECAUTION. The axis fix
    // lives on the model as `rotation.x = -PI/2`. Placement used to write the heading straight
    // onto that same object with `rotation.set(0, y, 0)`, which silently wiped the X term and
    // stood every airliner on its wingtips. It was invisible in a screenshot because the
    // orthophoto already contains parked aircraft from the survey flight, so the eye reads the
    // photo and not the model. Heading now goes on a parent and the correction stays untouched.
    const pivot = new THREE.Group();
    pivot.add(model);
    return { object: pivot as THREE.Object3D, groundLiftM: -prototype.bottomM * scale };
  };

  const spawnGeneric = () => {
    const object = new THREE.Mesh(genericGeometry, genericMaterial);
    // A dark outline keeps the marker readable against both the bright apron and dark woodland.
    object.add(new THREE.LineSegments(genericEdges, genericEdgeMaterial));
    return { object: object as THREE.Object3D, groundLiftM: GENERIC_SPAN_M / 2 };
  };

  const [minX, minZ, maxX, maxZ] = placement.worldBoundsM;
  const insideWorld = (x: number, z: number) => x >= minX && x <= maxX && z >= minZ && z <= maxZ;

  const place = (track: Track): boolean => {
    const probe = placement.toWorld(track.lat, track.lon, 0);
    if (!insideWorld(probe.x, probe.z)) return false;
    if (track.altitudeM === null) {
      const ground = placement.groundAt(probe.x, probe.z);
      // No modelled ground means no honest place to stand it.
      if (ground === null) return false;
      track.object.position.set(probe.x, ground + track.groundLiftM, probe.z);
    } else {
      track.object.position.set(probe.x, track.altitudeM, probe.z);
    }
    // Scene north is -Z and the model's nose is +X after the axis fix, so +90 degrees about Y
    // points a track of 0 (north) at -Z, and a track of 90 (east) at +X.
    const heading = ((track.trackDeg ?? 0) * Math.PI) / 180;
    track.object.rotation.set(0, Math.PI / 2 - heading, 0);
    return true;
  };

  const remove = (hex: string, track: Track) => {
    group.remove(track.object);
    tracks.delete(hex);
  };

  const apply = (aircraft: AdsbAircraft[], relayAgeMs: number) => {
    const now = performance.now();
    const seen = new Set<string>();
    genericCount = 0;
    skippedOffMap = 0;

    for (const item of aircraft) {
      const hex = item.hex?.trim();
      if (!hex) continue;
      if (typeof item.lat !== 'number' || typeof item.lon !== 'number') continue;
      if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) continue;

      // The feed's own age for this position, not the age of the response carrying it.
      //
      // ⚠️ PLUS THE RELAY'S CACHE AGE. `seen_pos` is relative to the snapshot the provider built,
      // not an absolute timestamp, so a snapshot the relay has been holding for four seconds
      // describes every position in it as four seconds younger than it really is. Ignoring that
      // would keep aircraft past the 60 s cutoff and extrapolate them from a position older than
      // advertised — small, and exactly the kind of small that turns "live" into "nearly live".
      const ageS = typeof item.seen_pos === 'number' && Number.isFinite(item.seen_pos)
        ? Math.max(item.seen_pos, 0)
        : 0;
      const reportedAt = now - ageS * 1000 - relayAgeMs;
      if (now - reportedAt > MAX_AGE_MS) continue;

      const onGround = item.alt_baro === 'ground';
      const altitudeM = onGround
        ? null
        : typeof item.alt_baro === 'number' && Number.isFinite(item.alt_baro)
          ? item.alt_baro * FT_TO_M
          : null;
      // Airborne with no usable altitude cannot be placed honestly: on the ground it would be
      // wrong, at a guessed height it would be invented.
      if (!onGround && altitudeM === null) continue;

      const type = item.t?.trim();
      const lengthM = type ? TYPE_LENGTH_M[type] : undefined;
      // No silhouette available for this type, or no type at all. Drawn as a neutral position
      // symbol rather than dropped.
      const generic = !type || lengthM === undefined;

      const speedMs = typeof item.gs === 'number' && Number.isFinite(item.gs) ? item.gs * KT_TO_MS : 0;
      const reported = [item.track, item.true_heading, item.dir]
        .find((value) => typeof value === 'number' && Number.isFinite(value));
      const trackDeg = reported ?? null;

      let track = tracks.get(hex);
      if (!track) {
        const spawned = generic ? spawnGeneric() : spawn(familyFor(type!, lengthM!), lengthM!);
        track = {
          callsign: item.flight?.trim() || item.r?.trim() || hex.toUpperCase(),
          lat: item.lat, lon: item.lon, altitudeM, speedMs, trackDeg, reportedAt,
          groundLiftM: spawned.groundLiftM,
          object: spawned.object,
        };
        if (!place(track)) { skippedOffMap++; continue; }
        tracks.set(hex, track);
        group.add(track.object);
      } else {
        track.lat = item.lat;
        track.lon = item.lon;
        track.altitudeM = altitudeM;
        track.speedMs = speedMs;
        track.trackDeg = trackDeg;
        track.reportedAt = reportedAt;
        if (!place(track)) { remove(hex, track); skippedOffMap++; continue; }
      }
      seen.add(hex);
      // ⚠️ COUNTED HERE, AFTER PLACEMENT SUCCEEDED, NOT AT THE TOP OF THE LOOP. Counting before
      // the world-bounds check reported symbols that were never drawn, so the panel's own two
      // numbers disagreed with each other.
      if (generic) genericCount++;
    }

    for (const [hex, track] of [...tracks]) {
      if (seen.has(hex)) continue;
      if (now - track.reportedAt < MAX_AGE_MS) continue;
      remove(hex, track);
    }
  };

  const liveText = (at: Date) => {
    const parts = [`${tracks.size} Flugzeuge`];
    // ⚠️ "als Positionssymbol", NOT "ohne Musterangabe". Most of these DO carry a type in the
    // feed — C172, EC45, PC12 — it is this app that has no silhouette for them. Saying the
    // source gave no type would blame the source for the app's own limitation.
    if (genericCount) parts.push(`${genericCount} als Positionssymbol`);
    if (skippedOffMap) parts.push(`${skippedOffMap} außerhalb des Modells`);
    parts.push(`Stand ${clock(at)}`);
    return parts.join(' \u00b7 ');
  };

  const poll = async () => {
    if (!visible) return;
    try {
      const url = `${endpoint}/${CENTRE.lat}/${CENTRE.lon}/${RADIUS_NM}`;
      const { data, relayAgeMs } = await fetchAdsb(url, abort.signal);
      if (abort.signal.aborted || !visible) return;
      apply(Array.isArray(data.ac) ? data.ac : [], relayAgeMs);
      feedDown = false;
      fetchedAt = new Date();
      onStatus({ state: 'live', text: liveText(fetchedAt), fetchedAt, count: tracks.size });
    } catch (error) {
      if (abort.signal.aborted) return;
      // ⚠️ Freeze rather than carry on. Extrapolating from a position the source can no longer
      // confirm is precisely the shape of invented data this app is not allowed to show. Aircraft
      // stop moving immediately and disappear as they pass MAX_AGE_MS, so the sky empties within
      // a minute instead of drifting convincingly for as long as nobody checks.
      feedDown = true;
      fetchedAt = null;
      onStatus({ state: 'error', text: describeProxyFailure(error), fetchedAt: null, count: tracks.size });
    }
  };

  const clear = () => { for (const [hex, track] of [...tracks]) remove(hex, track); };
  const stop = () => { if (timer) { window.clearInterval(timer); timer = 0; } };

  return {
    id: 'flugverkehr',
    setVisible(next) {
      visible = next;
      group.visible = next;
      if (next) {
        onStatus({ state: 'loading', text: 'Flugdaten werden geladen\u2026', fetchedAt: null, count: 0 });
        void poll();
        if (!timer) timer = window.setInterval(() => { void poll(); }, POLL_MS);
      } else {
        stop();
        // Everything on screen is cleared, so switching the layer back on cannot show a single
        // stale aircraft from minutes ago.
        clear();
        feedDown = false;
        fetchedAt = null;
        onStatus({ state: 'idle', text: 'aus', fetchedAt: null, count: 0 });
      }
    },
    update(dt) {
      if (!visible) return;
      const now = performance.now();
      for (const [hex, track] of [...tracks]) {
        if (now - track.reportedAt > MAX_AGE_MS) { remove(hex, track); continue; }
        if (feedDown) continue;
        // No speed, or no reported direction, means no honest direction to move in.
        if (track.speedMs <= 0.5 || track.trackDeg === null) continue;
        const perDegree = metresPerDegree(track.lat);
        const heading = (track.trackDeg * Math.PI) / 180;
        track.lat += (Math.cos(heading) * track.speedMs * dt) / perDegree.lat;
        track.lon += (Math.sin(heading) * track.speedMs * dt) / perDegree.lon;
        if (!place(track)) remove(hex, track);
      }
    },
    dispose() {
      stop();
      abort.abort();
      options.signal?.removeEventListener('abort', cancelOuter);
      clear();
      for (const prototype of prototypes.values()) {
        prototype.object.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            node.geometry.dispose();
            const material = node.material;
            if (Array.isArray(material)) material.forEach((m) => m.dispose());
            else material.dispose();
          }
        });
      }
      prototypes.clear();
      // The generic marker's geometry and materials are shared by every marker instance, so they
      // are owned here rather than by any one track.
      genericGeometry.dispose();
      genericEdges.dispose();
      genericMaterial.dispose();
      genericEdgeMaterial.dispose();
      placement.group.remove(group);
    },
  };
}

/**
 * Say which of the two failures this is.
 *
 * Without the proxy the same-origin path resolves to the app shell, so the response is HTML with
 * HTTP 200 and the JSON parse fails somewhere deep in the parser. Reported as-is that reads as a
 * broken app; it is in fact the expected behaviour of a static host with no server side, and the
 * operator needs to know to run the local preview rather than to debug anything.
 */
function describeProxyFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/JSON|Unexpected token|<!doctype/i.test(message)) {
    return 'Live-Flugdaten nur \u00fcber den lokalen Datenzugang verf\u00fcgbar (kein CORS beim Anbieter)';
  }
  return `Flugdaten ${describeError(error)}`;
}
/**
 * Fetch the feed and read how long the relay had been holding the answer.
 *
 * ⚠️ NOT `fetchJson`, and the difference is the header. The shared helper returns only a parsed
 * body, and the relay's `x-relay-age-ms` is what lets the caller state a correct position age.
 * The relay names that header in `Access-Control-Expose-Headers`; on the local Vite proxy path
 * it is simply absent, which is correctly read as zero because that path does not cache.
 */
async function fetchAdsb(url: string, signal: AbortSignal): Promise<AdsbFetch> {
  const timeout = AbortSignal.timeout(12000);
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, timeout]),
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 8_000_000) throw new Error('Antwort zu groß');
  const declared = Number(response.headers.get('x-relay-age-ms') ?? '0');
  return {
    data: JSON.parse(text) as AdsbResponse,
    relayAgeMs: Number.isFinite(declared) && declared >= 0 ? Math.min(declared, MAX_AGE_MS) : 0,
  };
}