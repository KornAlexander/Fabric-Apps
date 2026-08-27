/**
 * GTFS static schedule helper for the dev ferry API.
 *
 * Fetches the TfNSW "Sydney Ferries" GTFS bundle and derives the ferry trips
 * scheduled for *today* (Australia/Sydney), joined to routes and origin stops.
 *
 *   GET https://api.transport.nsw.gov.au/v1/gtfs/schedule/ferries/sydneyferries
 *   Auth: header  ->  Authorization: apikey <KEY>
 *
 * The API key is read from `TFNSW_API_KEY` (process env), falling back to the
 * same var in the app-local `.env` / `.env.local` files. These are git-ignored
 * and the key is used only in this Node process — never sent to the browser.
 *
 * This runs inside the Vite node process (dev only), so there is no CORS and
 * the bundle (~0.8 MB) is parsed in memory with a long-lived cache.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { unzipSync } from 'fflate';

import type { FerryDeparture, FerryScheduleFeed, ScheduleSnapshot } from '../src/shared/contract';

const GTFS_URL =
  process.env.TFNSW_FERRY_SCHEDULE_URL ||
  'https://api.transport.nsw.gov.au/v1/gtfs/schedule/ferries/sydneyferries';

// Static timetables change rarely; cache the parsed day for 30 minutes.
const CACHE_TTL_MS = 30 * 60 * 1000;
const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

type Row = Record<string, string>;

let dayCache: { ymd: string; at: number; departures: FerryDeparture[] } | null = null;

/** Resolve the TfNSW API key from env or the app-local .env / .env.local files. */
function resolveApiKey(rootDir: string): string {
  if (process.env.TFNSW_API_KEY) return process.env.TFNSW_API_KEY.trim();
  for (const file of ['.env.local', '.env']) {
    const envPath = resolve(rootDir, file);
    if (!existsSync(envPath)) continue;
    for (const raw of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const [key, ...rest] = line.split('=');
      if (key.trim() === 'TFNSW_API_KEY') {
        return rest.join('=').trim().replace(/^["']|["']$/g, '');
      }
    }
  }
  throw new Error(
    'No TfNSW API key. Set TFNSW_API_KEY (env) or add it to Test_App/.env.',
  );
}

/** Minimal RFC-4180 CSV parser (handles quoted fields with commas/quotes). */
function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      record.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      field = '';
      if (record.length > 1 || record[0] !== '') rows.push(record);
      record = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || record.length) {
    record.push(field);
    rows.push(record);
  }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.replace(/^\uFEFF/, '').trim());
  return rows.slice(1).map((r) => {
    const obj: Row = {};
    header.forEach((h, idx) => (obj[h] = r[idx] ?? ''));
    return obj;
  });
}

/** Current date/time parts in the Sydney timezone. */
function sydneyNow(): { ymd: string; weekday: (typeof WEEKDAYS)[number]; hms: string } {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now); // YYYY-MM-DD
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Australia/Sydney',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(now); // HH:MM:SS
  const wdIdx = new Date(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Australia/Sydney' }).format(now),
  ).getDay();
  return { ymd: date, weekday: WEEKDAYS[wdIdx], hms: time };
}

/** Service ids running on the given day from calendar + calendar_dates. */
function activeServices(files: Record<string, Row[]>, ymd: string, weekday: string): Set<string> {
  const ymdCompact = ymd.replace(/-/g, '');
  const active = new Set<string>();
  for (const row of files['calendar.txt'] ?? []) {
    if (row[weekday] === '1' && row.start_date <= ymdCompact && ymdCompact <= row.end_date) {
      active.add(row.service_id);
    }
  }
  for (const row of files['calendar_dates.txt'] ?? []) {
    if (row.date !== ymdCompact) continue;
    if (row.exception_type === '1') active.add(row.service_id);
    else if (row.exception_type === '2') active.delete(row.service_id);
  }
  return active;
}

async function downloadAndParse(apiKey: string): Promise<Record<string, Row[]>> {
  const res = await fetch(GTFS_URL, {
    headers: { Authorization: `apikey ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`GTFS schedule fetch failed: ${res.status} ${res.statusText}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const unzipped = unzipSync(buf);
  const decoder = new TextDecoder('utf-8');
  const wanted = [
    'routes.txt',
    'trips.txt',
    'stops.txt',
    'stop_times.txt',
    'calendar.txt',
    'calendar_dates.txt',
  ];
  const files: Record<string, Row[]> = {};
  for (const name of wanted) {
    if (unzipped[name]) files[name] = parseCsv(decoder.decode(unzipped[name]));
  }
  return files;
}

/** Derive the origin departures for one service day from already-parsed GTFS files. */
function departuresForDay(files: Record<string, Row[]>, ymd: string, weekday: string): FerryDeparture[] {
  const routes = new Map((files['routes.txt'] ?? []).map((r) => [r.route_id, r]));
  const stops = new Map((files['stops.txt'] ?? []).map((s) => [s.stop_id, s]));
  const active = activeServices(files, ymd, weekday);

  const todayTrips = new Map<string, Row>();
  for (const t of files['trips.txt'] ?? []) {
    if (active.has(t.service_id)) todayTrips.set(t.trip_id, t);
  }

  const departures: FerryDeparture[] = [];
  const seen = new Set<string>();
  for (const st of files['stop_times.txt'] ?? []) {
    const tid = st.trip_id;
    if (st.stop_sequence !== '1' || seen.has(tid) || !todayTrips.has(tid)) continue;
    seen.add(tid);
    const trip = todayTrips.get(tid)!;
    const route = routes.get(trip.route_id ?? '');
    departures.push({
      time: st.departure_time ?? '',
      route: route?.route_short_name || route?.route_long_name || '',
      headsign: trip.trip_headsign ?? '',
      from: stops.get(st.stop_id ?? '')?.stop_name ?? st.stop_id ?? '',
      tripId: tid,
    });
  }
  departures.sort((a, b) => a.time.localeCompare(b.time));
  return departures;
}

/** Build the full list of ferry origin departures scheduled for today. */
async function buildDayDepartures(rootDir: string, ymd: string, weekday: string): Promise<FerryDeparture[]> {
  return departuresForDay(await downloadAndParse(resolveApiKey(rootDir)), ymd, weekday);
}

/**
 * Build a static, multi-day timetable snapshot starting from today (Sydney).
 *
 * The deployed app is static content with no server, so it cannot hold the
 * TfNSW API key. Instead this snapshot is generated at build time and shipped
 * as an asset; the browser then picks the entry for the current Sydney date.
 *
 * @param rootDir Project root (used to locate `.env` for the API key).
 * @param days    Number of consecutive service days to include.
 */
export async function buildScheduleSnapshot(
  rootDir: string,
  days = 14,
): Promise<ScheduleSnapshot> {
  const files = await downloadAndParse(resolveApiKey(rootDir));
  const { ymd } = sydneyNow();
  const start = Date.parse(`${ymd}T00:00:00Z`);
  const byDate: Record<string, FerryDeparture[]> = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(start + i * 86_400_000);
    byDate[d.toISOString().slice(0, 10)] = departuresForDay(
      files,
      d.toISOString().slice(0, 10),
      WEEKDAYS[d.getUTCDay()],
    );
  }
  return { generatedAt: new Date().toISOString(), byDate };
}

/**
 * Return today's scheduled ferry departures.
 * @param rootDir Vite server root (used to locate `.env_api`).
 * @param opts.upcoming When true (default), only departures at/after now.
 * @param opts.limit Optional cap on the number of departures returned.
 */
export async function buildFerrySchedule(
  rootDir: string,
  opts: { upcoming?: boolean; limit?: number } = {},
): Promise<FerryScheduleFeed> {
  const { ymd, weekday, hms } = sydneyNow();
  if (!dayCache || dayCache.ymd !== ymd || Date.now() - dayCache.at > CACHE_TTL_MS) {
    dayCache = { ymd, at: Date.now(), departures: await buildDayDepartures(rootDir, ymd, weekday) };
  }

  let departures = dayCache.departures;
  if (opts.upcoming ?? true) departures = departures.filter((d) => d.time >= hms);
  if (opts.limit && opts.limit > 0) departures = departures.slice(0, opts.limit);

  return {
    date: ymd,
    asOf: new Date().toISOString(),
    count: departures.length,
    departures,
  };
}
