import { AzureCliCredential } from '@azure/identity';
import type { Plugin } from 'vite';

import { buildFerrySchedule } from './gtfsSchedule';

/**
 * Dev-only Vite middleware that turns the Eventhouse (KQL) into a clean JSON
 * feed for the 3D frontend. Runs inside the Vite node process, so there is no
 * CORS and it authenticates with your local `az login` identity.
 *
 * Endpoints (same-origin, no proxy needed):
 *   GET /api/ferries/live          → { asOf, ferries: [...] }
 *   GET /api/ferries/fleet         → { vessels: [...] }   (full roster)
 *   GET /api/reference-locations   → { locations: [...] }
 *
 * Production note: static content on Fabric can't reach this local server —
 * for a deployed build expose the same two queries through a Fabric User Data
 * Function and point VITE_FERRY_API at it (see README).
 */

// Falls back to the browser's VITE_KUSTO_CLUSTER so provisioning only has to
// generate one value. No hardcoded default: a wrong cluster fails as an opaque
// 403, which is far harder to diagnose than a missing variable.
function cluster(): string {
  const uri = process.env.KUSTO_CLUSTER_URI || process.env.VITE_KUSTO_CLUSTER;
  if (!uri) {
    throw new Error(
      'No Eventhouse configured. Copy .env.example to .env and set VITE_KUSTO_CLUSTER ' +
        'to your Eventhouse query URI (Fabric portal → your Eventhouse → System ' +
        'overview → Query URI). scripts/provision-environment.ps1 writes it for you.',
    );
  }
  return uri;
}

const DATABASE =
  process.env.KUSTO_DATABASE || process.env.VITE_KUSTO_DATABASE || 'SydneyFerriesKustoDB';

// Only surface ferries whose latest ping is within this window of the most
// recent sample in the table — i.e. the current active batch. Anchoring to the
// newest record (rather than real `now()`) keeps the map populated even if the
// simulated feed pauses, while still dropping vessels that stopped reporting.
const ACTIVE_WINDOW = process.env.FERRY_ACTIVE_WINDOW || '15m';

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

// Full roster: every vessel that has ever reported, ignoring the active window.
const FLEET_KQL = `
SydneyFerries
| summarize lastSeen = max(timestamp) by ferry_name
| where isnotempty(ferry_name)
| project ferry_name, lastSeen
| order by ferry_name asc
`;

interface KustoTable {
  TableName?: string;
  Columns: { ColumnName: string }[];
  Rows: unknown[][];
}

const credential = new AzureCliCredential();
let cachedToken: { token: string; expiresOn: number } | null = null;

async function getToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresOn - now > 60_000) return cachedToken.token;
  const res = await credential.getToken(`${cluster()}/.default`);
  if (!res) throw new Error('Could not acquire a Kusto token via Azure CLI. Run `az login`.');
  cachedToken = { token: res.token, expiresOn: res.expiresOnTimestamp };
  return res.token;
}

async function runKql(csl: string): Promise<KustoTable> {
  const token = await getToken();
  const res = await fetch(`${cluster()}/v1/rest/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ db: DATABASE, csl }),
  });
  if (!res.ok) {
    throw new Error(`KQL query failed: ${res.status} ${res.statusText} — ${await res.text()}`);
  }
  const json = (await res.json()) as { Tables: KustoTable[] };
  // v1 REST: first table holds the primary result set.
  return json.Tables[0];
}

function colIndex(table: KustoTable, name: string): number {
  return table.Columns.findIndex((c) => c.ColumnName === name);
}

// Small TTL cache to protect KQL from poll storms.
const cache = new Map<string, { at: number; body: string }>();
const TTL_MS = 3000;

async function cached(key: string, build: () => Promise<unknown>): Promise<string> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.body;
  const body = JSON.stringify(await build());
  cache.set(key, { at: Date.now(), body });
  return body;
}

async function buildFerries() {
  const lt = await runKql(LATEST_KQL);
  const latestIso = String(lt.Rows?.[0]?.[0] ?? '');
  const t = await runKql(ferriesKql(latestIso));
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

async function buildReference() {
  const t = await runKql(REF_KQL);
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

async function buildFleet() {
  const t = await runKql(FLEET_KQL);
  const iName = colIndex(t, 'ferry_name');
  const iSeen = colIndex(t, 'lastSeen');
  const vessels = t.Rows.map((r) => ({
    name: String(r[iName]),
    lastSeen: new Date(String(r[iSeen])).getTime(),
  })).filter((v) => v.name);
  return { vessels };
}

export function ferryApiPlugin(): Plugin {
  return {
    name: 'ferry-kql-dev-api',
    configureServer(server) {
      const root = server.config.root;
      server.middlewares.use(async (req, res, next) => {
        const [url, rawQuery] = (req.url ?? '').split('?');
        if (
          url !== '/api/ferries/live' &&
          url !== '/api/ferries/fleet' &&
          url !== '/api/reference-locations' &&
          url !== '/api/ferries/schedule'
        ) {
          return next();
        }
        try {
          let body: string;
          if (url === '/api/ferries/live') {
            body = await cached('ferries', buildFerries);
          } else if (url === '/api/ferries/fleet') {
            body = await cached('fleet', buildFleet);
          } else if (url === '/api/reference-locations') {
            body = await cached('reference', buildReference);
          } else {
            const q = new URLSearchParams(rawQuery ?? '');
            const limit = Number(q.get('limit')) || undefined;
            const upcoming = q.get('scope') !== 'all';
            body = JSON.stringify(await buildFerrySchedule(root, { upcoming, limit }));
          }
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(body);
        } catch (err) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
    },
  };
}
