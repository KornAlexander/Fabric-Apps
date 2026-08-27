import type {
  FerryFeed,
  FerryScheduleFeed,
  FleetRoster,
  ReferenceFeed,
  ScheduleSnapshot,
} from '@/shared/contract';

import { colIndex, isDirectKustoConfigured, queryKusto } from './kustoClient';

const API_BASE = import.meta.env.VITE_FERRY_API ?? '/api';

/** True when served from the Vite dev server (the `/api` middleware exists). */
function isLocalFrontend(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1';
}

/**
 * In the deployed app there is no `/api` middleware, so query the Eventhouse
 * directly (browser → Kusto with the signed-in user's token). Locally we keep
 * using the Vite dev API.
 *
 * This applies inside the Fabric portal too: live vessel positions always come
 * from the Eventhouse, never from Fabric SQL. Inside the portal the token is
 * brokered via Nested App Auth where possible, otherwise the UI surfaces a
 * one-time "Connect live data" sign-in (a second auth on top of the Fabric
 * session). Fabric SQL / Rayfin is reserved for data capture (vessel checks).
 */
const useDirectKusto = !isLocalFrontend() && isDirectKustoConfigured();

// --- Direct-Kusto query layer (mirrors vite/ferryApi.ts) --------------------

// Only surface ferries whose latest ping is within this window of the most
// recent sample in the table — i.e. the current active batch.
const ACTIVE_WINDOW = '15m';
const LATEST_KQL = `SydneyFerries | summarize latest = max(timestamp)`;

function ferriesKql(latestIso: string): string {
  return `
SydneyFerries
| summarize arg_max(timestamp, *) by ferry_name
| where timestamp > todatetime('${latestIso}') - ${ACTIVE_WINDOW}
| project ferry_name, ferry_lat, ferry_long, ferry_destination, timestamp
`;
}

const REF_KQL = `
ReferenceLocation
| project LocationId, LocationName, Latitude, Longitude
`;

// Every vessel that has ever reported, regardless of whether it is sailing
// right now. Used by the vessel-checks form so an inspection can be logged
// against any ferry in the fleet, not only the current active batch.
const FLEET_KQL = `
SydneyFerries
| summarize lastSeen = max(timestamp) by ferry_name
| where isnotempty(ferry_name)
| project ferry_name, lastSeen
| order by ferry_name asc
`;

async function fetchFerriesDirect(signal?: AbortSignal): Promise<FerryFeed> {
  const lt = await queryKusto(LATEST_KQL, signal);
  const latestIso = String(lt.Rows?.[0]?.[0] ?? '');
  const t = await queryKusto(ferriesKql(latestIso), signal);
  const iName = colIndex(t, 'ferry_name');
  const iLat = colIndex(t, 'ferry_lat');
  const iLon = colIndex(t, 'ferry_long');
  const iDest = colIndex(t, 'ferry_destination');
  const iTs = colIndex(t, 'timestamp');
  const ferries = t.Rows.map((r) => ({
    id: String(r[iName]),
    name: String(r[iName]),
    lat: Number(r[iLat]),
    lon: Number(r[iLon]),
    destination: r[iDest] == null ? '' : String(r[iDest]),
    ts: new Date(String(r[iTs])).getTime(),
  })).filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon));
  return { asOf: new Date().toISOString(), ferries };
}

async function fetchReferenceDirect(signal?: AbortSignal): Promise<ReferenceFeed> {
  const t = await queryKusto(REF_KQL, signal);
  const iId = colIndex(t, 'LocationId');
  const iName = colIndex(t, 'LocationName');
  const iLat = colIndex(t, 'Latitude');
  const iLon = colIndex(t, 'Longitude');
  const locations = t.Rows.map((r) => ({
    id: String(r[iId]),
    name: String(r[iName]),
    lat: Number(r[iLat]),
    lon: Number(r[iLon]),
  })).filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lon));
  return { locations };
}

// --- Static timetable snapshot (deployed builds) ---------------------------

const SNAPSHOT_URL = `${import.meta.env.BASE_URL}ferries/schedule.json`;

let snapshotPromise: Promise<ScheduleSnapshot> | null = null;

function loadSnapshot(signal?: AbortSignal): Promise<ScheduleSnapshot> {
  if (!snapshotPromise) {
    snapshotPromise = fetch(SNAPSHOT_URL, { signal })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<ScheduleSnapshot>;
      })
      .catch((err: Error) => {
        snapshotPromise = null; // allow a retry on the next poll
        throw new Error(`No timetable snapshot in this build (${err.message}).`);
      });
  }
  return snapshotPromise;
}

/** Sydney-local date/time parts, matching the GTFS service day. */
function sydneyParts(): { ymd: string; hms: string } {
  const now = new Date();
  return {
    ymd: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Australia/Sydney',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now),
    hms: new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Australia/Sydney',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(now),
  };
}

async function scheduleFromSnapshot(
  opts: { upcoming?: boolean; limit?: number },
  signal?: AbortSignal,
): Promise<FerryScheduleFeed> {
  const snapshot = await loadSnapshot(signal);
  const { ymd, hms } = sydneyParts();
  const day = snapshot.byDate[ymd];
  if (!day) {
    const dates = Object.keys(snapshot.byDate).sort();
    throw new Error(
      `Timetable snapshot has expired (covers ${dates[0]} – ${dates[dates.length - 1]}). Rebuild the app to refresh it.`,
    );
  }
  let departures = day;
  if (opts.upcoming ?? true) departures = departures.filter((d) => d.time >= hms);
  if (opts.limit && opts.limit > 0) departures = departures.slice(0, opts.limit);
  return { date: ymd, asOf: snapshot.generatedAt, count: departures.length, departures };
}

// --- Public API -------------------------------------------------------------

/** Fetch the latest ferry positions. */
export async function fetchFerries(signal?: AbortSignal): Promise<FerryFeed> {
  if (useDirectKusto) return fetchFerriesDirect(signal);
  const res = await fetch(`${API_BASE}/ferries/live`, { signal });
  if (!res.ok) throw new Error(`ferries/live failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as FerryFeed;
}

/**
 * Fetch the full vessel roster — every ferry known to the Eventhouse, ordered
 * by name. Unlike {@link fetchFerries} this is *not* limited to the active
 * window, so the vessel-checks form can target any ship in the fleet.
 */
export async function fetchFleetRoster(signal?: AbortSignal): Promise<FleetRoster> {
  if (useDirectKusto) {
    const t = await queryKusto(FLEET_KQL, signal);
    const iName = colIndex(t, 'ferry_name');
    const iSeen = colIndex(t, 'lastSeen');
    const vessels = t.Rows.map((r) => ({
      name: String(r[iName]),
      lastSeen: new Date(String(r[iSeen])).getTime(),
    })).filter((v) => v.name);
    return { vessels };
  }
  const res = await fetch(`${API_BASE}/ferries/fleet`, { signal });
  if (!res.ok) throw new Error(`ferries/fleet failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as FleetRoster;
}

/** Fetch wharves / landmarks used to dress the scene (called once at startup). */
export async function fetchReferenceLocations(signal?: AbortSignal): Promise<ReferenceFeed> {
  try {
    if (useDirectKusto) return await fetchReferenceDirect(signal);
    const res = await fetch(`${API_BASE}/reference-locations`, { signal });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as ReferenceFeed;
  } catch {
    return { locations: [] };
  }
}

/**
 * Fetch today's scheduled ferry departures (TfNSW GTFS static timetable).
 * @param opts.upcoming Only departures at/after now (default true).
 * @param opts.limit    Cap the number of departures returned.
 *
 * The GTFS feed requires a secret API key, so it can only be called
 * server-side. Locally that is the Vite `/api` middleware; in the deployed
 * static build it is a snapshot baked in at build time (see
 * `vite/scheduleSnapshot.ts`).
 */
export async function fetchFerrySchedule(
  opts: { upcoming?: boolean; limit?: number } = {},
  signal?: AbortSignal,
): Promise<FerryScheduleFeed> {
  if (useDirectKusto) return scheduleFromSnapshot(opts, signal);
  const params = new URLSearchParams();
  if (opts.upcoming === false) params.set('scope', 'all');
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/ferries/schedule${qs ? `?${qs}` : ''}`, { signal });
  if (!res.ok) throw new Error(`ferries/schedule failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as FerryScheduleFeed;
}
