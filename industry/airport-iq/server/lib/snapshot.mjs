// Loads the vendored Airport IQ operations snapshots (data/<AP>/snapshot.json)
// and exposes derived helpers used by the grounded chat/voice tools.
//
// The snapshot is the exact same file the frontend Live-Ops view renders, so
// the assistant answers about precisely what the operator sees on screen.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "data");

const SUPPORTED = new Set(["DUS", "BER"]);
const cache = new Map();

export function supportedAirports() {
  return [...SUPPORTED];
}

export function resolveAirport(airport, fallback = "DUS") {
  const code = String(airport ?? "").trim().toUpperCase();
  if (SUPPORTED.has(code)) return code;
  const fb = String(fallback ?? "DUS").trim().toUpperCase();
  return SUPPORTED.has(fb) ? fb : "DUS";
}

/** Load (and cache) the snapshot for an airport. Returns null if missing. */
export function loadSnapshot(airport) {
  const code = resolveAirport(airport);
  if (cache.has(code)) return cache.get(code);
  const file = resolve(DATA_DIR, code, "snapshot.json");
  if (!existsSync(file)) {
    cache.set(code, null);
    return null;
  }
  const snap = JSON.parse(readFileSync(file, "utf8"));
  cache.set(code, snap);
  return snap;
}

// ── derived helpers ──────────────────────────────────────────────────

export function nowMs(snap) {
  return Date.parse(snap?.meta?.now ?? "") || Date.now();
}

export function airlineName(snap, iataOrId) {
  const airlines = snap?.airlines ?? {};
  const byId = airlines[iataOrId];
  if (byId?.name) return byId.name;
  for (const a of Object.values(airlines)) {
    if (a.iata === iataOrId) return a.name;
  }
  return iataOrId;
}

export function airportCity(snap, code) {
  const a = snap?.airports?.[code];
  return a ? `${a.city} (${code})` : code;
}

export function flightsArray(snap) {
  const f = snap?.flights ?? {};
  return Object.values(f);
}

export function delaysMap(snap) {
  return snap?.delays ?? {};
}

/** Route string like "BLQ → BER" using city names when known. */
export function routeLabel(snap, flight) {
  const o = snap?.airports?.[flight.o]?.city ?? flight.o;
  const d = snap?.airports?.[flight.d]?.city ?? flight.d;
  return `${o} (${flight.o}) → ${d} (${flight.d})`;
}

/** The gate assignment covering `atMs` for a given gate id (or null). */
export function assignmentAt(snap, gateId, atMs) {
  for (const a of snap?.assignments ?? []) {
    if (a.gid !== gateId) continue;
    const s = Date.parse(a.s);
    const e = Date.parse(a.e);
    if (Number.isFinite(s) && Number.isFinite(e) && atMs >= s && atMs <= e) return a;
  }
  return null;
}

export function gateByNumber(snap, gateNumber) {
  const want = String(gateNumber ?? "").trim().toUpperCase();
  return (snap?.gates ?? []).find(
    (g) => String(g.num).toUpperCase() === want || String(g.id).toUpperCase() === want
  );
}

export function flightByNumber(snap, flightNumber) {
  const want = String(flightNumber ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return flightsArray(snap).find(
    (f) => String(f.num).toUpperCase() === want || String(f.id).toUpperCase() === want
  );
}
