/**
 * ADS-B and air-quality relay for München Zwilling.
 *
 * ## Why this exists
 *
 * Measured from a real browser on 2026-09-21: adsb.lol, adsb.fi, adsb.one, airplanes.live and
 * OpenSky ALL fail with `TypeError: Failed to fetch`, and so do the Umweltbundesamt and the LfU
 * Bayern air-quality APIs. None of them sends an `Access-Control-Allow-Origin` header, so no web
 * page may read them, whatever its origin. The identical requests succeed from a server.
 * Microsoft Fabric is NOT the obstacle — the Munich construction WFS, the MVG departures API and
 * Sensor.Community all work from the hosted app, so its Content-Security-Policy permits outbound
 * calls. The obstacle is purely the providers' missing CORS headers.
 *
 * ## ⚠️ This is a RELAY, not a proxy, and the difference is the whole security design
 *
 * A general CORS proxy is an open relay: anyone who finds the URL can route arbitrary requests
 * through this subscription, attributable to its owner. Four things make that impossible here,
 * and none of them may be relaxed without thinking about that sentence again:
 *
 *  1. **Every upstream is hard-coded.** No part of an incoming URL chooses a host, scheme or
 *     path prefix. The ROUTE decides which of two fixed upstreams is called; the caller never
 *     does. Adding a third upstream means adding a route here, deliberately.
 *  2. **Only validated parameters are accepted**, each range-checked — and the ADS-B coordinates
 *     are additionally confined to a box around Munich, so that route cannot be repurposed as a
 *     worldwide aircraft-tracking endpoint.
 *  3. **Nothing from the caller is forwarded.** No headers, no cookies, no credentials, no body.
 *     Every upstream request is constructed from scratch.
 *  4. **CORS is restricted to known origins**, so another site cannot silently use it as its own
 *     backend.
 *
 * It is still an unauthenticated public endpoint, and that is a deliberate, bounded choice: both
 * upstreams publish open data, the worst case is someone reading Munich air traffic or German
 * air-quality measurements slightly more conveniently than from the source, and the app has no
 * server side that could hold a secret anyway.
 *
 * ## Being a good citizen upstream
 *
 * adsb.lol is a volunteer receiver community and the Umweltbundesamt is a public authority.
 * A shared short cache means twenty people opening the app do not become twenty times the
 * request rate, and a per-address limit stops one client hammering them. The cache window is far
 * shorter than the app's poll interval, and for ADS-B the feed's own `seen_pos` still carries
 * the true age of every position, so caching cannot make the app claim data is fresher than it
 * is. Cache age is reported in `x-relay-age-ms` for callers that need to correct for it.
 */

import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8080);

/**
 * The ONLY upstream this service can reach.
 *
 * ⚠️ THE OVERRIDE IS LOOPBACK-ONLY, AND THAT RESTRICTION IS THE POINT. Tests need to stub the
 * provider, and the obvious way to allow that — read the origin from the environment — would
 * hand anyone who can set an environment variable a general-purpose proxy, which is exactly the
 * property this file exists to deny. Accepting the override only when it resolves to 127.0.0.1
 * keeps the test seam and makes a production misconfiguration impossible rather than unlikely:
 * a deployed container has no loopback service to point at.
 */
function resolveUpstream() {
  return resolveOrigin(process.env.UPSTREAM_ORIGIN, 'https://api.adsb.lol', 'UPSTREAM_ORIGIN');
}

/**
 * Shared implementation of the loopback-only override.
 *
 * Factored out so BOTH fixed upstreams get exactly the same guard. Two copies of a security
 * check drift; this one is deliberately the only place the rule is written down.
 */
function resolveOrigin(override, fallback, name) {
  if (!override) return fallback;
  try {
    const url = new URL(override);
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    if (loopback && url.protocol === 'http:') return url.origin;
  } catch { /* fall through to the real upstream */ }
  console.warn(`ignoring non-loopback ${name} override`);
  return fallback;
}

const UPSTREAM_ORIGIN = resolveUpstream();
const UPSTREAM_PATH = '/v2/point';

/**
 * The second fixed upstream: the Umweltbundesamt's Air Data API.
 *
 * ⚠️ FIXED HOST AND FIXED PATH PREFIX, exactly like the first. Three routes are exposed and each
 * one builds a complete upstream URL from a constant plus validated values. There is no route
 * that takes a path, a host or a query string from the caller.
 *
 * ⚠️ THIS IS THE CANONICAL HOST, AND FINDING IT WAS THE POINT OF A FAILURE. The documented
 * `www.umweltbundesamt.de/api/air_data/v3/...` answers **301 to a DIFFERENT ORIGIN**:
 * `luftdaten.umweltbundesamt.de/api/air-data/v3/...` — different subdomain, and `air-data` with
 * a hyphen rather than an underscore. Every PowerShell probe followed that redirect silently and
 * looked perfectly healthy, so the move only surfaced once the relay, which sets
 * `redirect: 'error'`, returned 502.
 *
 * The fix is to call the canonical endpoint, NOT to start following redirects. `redirect: 'error'`
 * is a security setting: it is what stops an upstream from bouncing this service to a host it is
 * not allowed to call. Trading that away to paper over a moved URL would be a poor bargain.
 *
 * ⚠️ THE SAME LOOPBACK-ONLY TEST SEAM AS THE FLIGHT UPSTREAM, AND IT EARNED ITS PLACE. Without
 * it the suite's "an air-quality request cannot reach the flight upstream" test made REAL calls
 * to the Umweltbundesamt and swallowed the failures. That is a security test quietly depending
 * on a third party being up and fast — and on the day the catalogue endpoint took 60 seconds,
 * the gate went red for reasons that had nothing to do with the code.
 */
const UBA_ORIGIN = resolveOrigin(
  process.env.UBA_ORIGIN, 'https://luftdaten.umweltbundesamt.de', 'UBA_ORIGIN',
);
const UBA_PATH = '/api/air-data/v3';

/**
 * Origins allowed to read the response.
 *
 * ⚠️ Exact-match strings, never a regular expression and never a suffix test. `endsWith`
 * ('.fabricapps.net') would also accept `evil-fabricapps.net`, which is the classic way an
 * origin allow-list turns into no allow-list at all.
 *
 * ⚠️ NO localhost ENTRIES. An earlier draft allowed the dev ports "for convenience" and that
 * quietly widened a production boundary for no benefit: local development does not use this
 * relay at all, it uses the Vite dev-server proxy. Anything that needs adding here should be
 * added because a real deployed origin needs it.
 */
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);

/**
 * The only geography this relay will ask about.
 *
 * Munich city core is 48.13/11.57, the airport 48.35/11.79, and the modelled world is a
 * 36.5 x 46.8 km shell around them. This box is generously larger than that and very much
 * smaller than the world.
 */
const BOX = { minLat: 47.5, maxLat: 49.5, minLon: 10.0, maxLon: 13.5 };
const MAX_RADIUS_NM = 60;

/** Cache windows and upstream patience are per route; see BUDGET below. */
/** Refuse a response larger than this rather than buffering it. */
const MAX_BYTES = 4_000_000;

/** Per-address budget, a plain fixed window. */
const RATE_LIMIT = { windowMs: 60_000, max: 120 };
/**
 * Hard ceiling on tracked addresses.
 *
 * ⚠️ A SIZE CAP, NOT JUST AN EXPIRY SWEEP. Sweeping only expired entries means an attacker
 * rotating addresses grows the map without bound AND makes every new request scan all of it —
 * the cleanup becomes the denial of service. Above this ceiling the oldest entries are dropped
 * outright, which at worst grants a few extra requests and never costs unbounded memory.
 */
const MAX_TRACKED_ADDRESSES = 10_000;

/** @type {Map<string, { body: string, at: number }>} */
const cache = new Map();
/**
 * In-flight upstream request per key, so simultaneous callers share one call.
 *
 * ⚠️ WITHOUT THIS THE CACHE DOES NOT LIMIT ANYTHING. A cache only populated on completion lets
 * twenty simultaneous misses become twenty upstream requests — exactly the burst the cache was
 * added to prevent, and against a volunteer-run service.
 * @type {Map<string, Promise<{ body: string, at: number }>>}
 */
const inFlight = new Map();
/** @type {Map<string, { count: number, resetAt: number }>} */
const buckets = new Map();

function corsHeaders(origin) {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'vary': 'Origin',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'Accept',
    // ⚠️ REQUIRED, not decoration. Cross-origin JavaScript can read only safelisted response
    // headers unless they are named here, and the client needs the cache age to state a correct
    // position age. Without this the header is invisible and the app silently under-reports.
    'access-control-expose-headers': 'x-relay-age-ms, x-relay-cache',
    'access-control-max-age': '600',
  };
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    // This service returns data, never markup; the headers cost nothing and close off a class of
    // mistakes if a future response is ever rendered somewhere.
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  });
  response.end(body);
}

function rateLimited(address) {
  const now = Date.now();
  const bucket = buckets.get(address);
  if (bucket && now <= bucket.resetAt) {
    bucket.count += 1;
    return bucket.count > RATE_LIMIT.max;
  }
  if (buckets.size >= MAX_TRACKED_ADDRESSES) {
    // Drop the oldest tracked addresses. Map preserves insertion order, so this is O(k) for a
    // fixed small k rather than a full scan on every request.
    let dropped = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++dropped >= 1000) break;
    }
  }
  buckets.set(address, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
  return false;
}

/**
 * The caller's address, as far as it can be trusted.
 *
 * ⚠️ THE RIGHTMOST VALUE, NOT THE LEFTMOST, AND THIS WAS THE WRONG WAY ROUND AT FIRST.
 * Container Apps ingress APPENDS the observed client address to any `X-Forwarded-For` the caller
 * already sent, so the trustworthy value is the LAST one. Reading the first means the caller
 * chooses it, and a limiter keyed on an attacker-supplied string is not a limiter — rotating it
 * grants unlimited fresh budgets.
 */
function callerAddress(request) {
  const forwarded = String(request.headers['x-forwarded-for'] ?? '');
  const parts = forwarded.split(',').map((value) => value.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : (request.socket.remoteAddress || 'unknown');
}

/** Strict numeric parse: rejects '1e3', '0x10', ' 1 ', '', Infinity and NaN. */
function strictNumber(raw) {
  if (typeof raw !== 'string' || !/^-?\d{1,3}(?:\.\d{1,6})?$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Per-route cache and timeout budgets.
 *
 * ⚠️ ONE BUDGET FOR EVERYTHING WAS WRONG, AND IT WAS MEASURED RATHER THAN SUSPECTED. On
 * 2026-09-21 the Umweltbundesamt's station catalogue answered in **59.9 seconds** for 110 KB,
 * while every other call that minute came back inside 200 ms. Against an 8 s upstream timeout
 * that is a guaranteed 502, and against a 5 s cache it is a 502 that repeats forever.
 *
 * The catalogue is also the one response that barely changes: stations are commissioned and
 * retired over years. Caching it for hours turns a pathological upstream into an inconvenience
 * that is met at most a few times a day, and never during a demo that has already loaded once.
 */
const BUDGET = {
  /** Live positions. Must stay fresh, and the upstream is normally fast. */
  adsb: { cacheMs: 5_000, timeoutMs: 8_000 },
  /** Station catalogue and component dictionary. Effectively static, sometimes very slow. */
  ubaCatalogue: { cacheMs: 6 * 60 * 60 * 1000, timeoutMs: 60_000 },
  /** Hourly measurements. Polling faster than this cannot reveal anything new. */
  ubaReadings: { cacheMs: 120_000, timeoutMs: 20_000 },
};

/**
 * Fetch one fixed upstream URL, with a shared cache and request coalescing.
 *
 * ⚠️ `url` IS ALWAYS BUILT BY A ROUTE HANDLER FROM CONSTANTS PLUS VALIDATED VALUES. It is never
 * taken from, or influenced by, anything the caller sent. `key` identifies the cache entry.
 */
async function fetchUpstream(key, url, budget) {
  const { cacheMs, timeoutMs } = budget ?? BUDGET.adsb;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < cacheMs) {
    return { body: hit.body, ageMs: Date.now() - hit.at };
  }

  // Share one upstream call between simultaneous callers for the same query.
  const existing = inFlight.get(key);
  if (existing) {
    const result = await existing;
    return { body: result.body, ageMs: Date.now() - result.at };
  }

  const attempt = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Constructed from scratch. Nothing from the caller's request reaches this call.
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          'user-agent': 'muenchen-zwilling-relay/1.1 (+internal Microsoft demo)',
        },
        redirect: 'error',
      });
      if (!response.ok) throw new Error(`upstream ${response.status}`);
      const declared = Number(response.headers.get('content-length') ?? '0');
      if (declared > MAX_BYTES) throw new Error('upstream response too large');
      const body = await response.text();
      // ⚠️ This is a post-buffer check, and it counts UTF-16 units rather than bytes. Against
      // fixed, known upstreams that is an acceptable resilience guard; it would NOT be an
      // adequate defence against an attacker-chosen host, and there is no path to one here.
      if (body.length > MAX_BYTES) throw new Error('upstream response too large');
      // Parsed only to confirm it is JSON; the bytes are relayed unchanged so the relay cannot
      // quietly alter, filter or enrich what the source published.
      JSON.parse(body);
      const at = Date.now();
      cache.set(key, { body, at });
      // The cache holds a handful of query shapes; this only guards against a pathological caller.
      if (cache.size > 64) {
        for (const oldest of cache.keys()) { cache.delete(oldest); break; }
      }
      return { body, at };
    } finally {
      clearTimeout(timer);
    }
  })();

  inFlight.set(key, attempt);
  try {
    const result = await attempt;
    return { body: result.body, ageMs: Date.now() - result.at };
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Resolve a request path to a fixed upstream URL, or reject it.
 *
 * ⚠️ THIS FUNCTION IS THE SECURITY BOUNDARY. Every branch builds a complete URL from module
 * constants plus values that have already been validated, and returns a plain object. There is
 * deliberately no branch that concatenates caller text into a host, a path prefix or a query
 * key, and no default case that falls through to "just fetch it".
 *
 * @returns {{ key: string, url: string } | { error: number }}
 */
function route(pathname) {
  const adsb = /^\/adsb\/point\/(-?[\d.]+)\/(-?[\d.]+)\/(\d{1,3})$/.exec(pathname);
  if (adsb) {
    const lat = strictNumber(adsb[1]);
    const lon = strictNumber(adsb[2]);
    const radius = strictNumber(adsb[3]);
    if (lat === null || lon === null || radius === null) return { error: 400 };
    if (lat < BOX.minLat || lat > BOX.maxLat || lon < BOX.minLon || lon > BOX.maxLon) return { error: 403 };
    if (radius < 1 || radius > MAX_RADIUS_NM) return { error: 400 };
    const key = `adsb:${lat}/${lon}/${radius}`;
    return { key, url: `${UPSTREAM_ORIGIN}${UPSTREAM_PATH}/${lat}/${lon}/${radius}`, budget: BUDGET.adsb };
  }

  // The station catalogue and the component dictionary. No caller input at all.
  if (pathname === '/uba/stations') {
    return {
      key: 'uba:stations',
      url: `${UBA_ORIGIN}${UBA_PATH}/stations/json?use=airquality&lang=de`,
      budget: BUDGET.ubaCatalogue,
    };
  }
  if (pathname === '/uba/components') {
    return {
      key: 'uba:components',
      url: `${UBA_ORIGIN}${UBA_PATH}/components/json?lang=de`,
      budget: BUDGET.ubaCatalogue,
    };
  }

  // Measurements for one station over a short window.
  const uba = /^\/uba\/airquality\/(\d{1,5})\/(\d{4}-\d{2}-\d{2})\/(\d{1,2})\/(\d{4}-\d{2}-\d{2})\/(\d{1,2})$/
    .exec(pathname);
  if (uba) {
    const [, station, dateFrom, hourFrom, dateTo, hourTo] = uba;
    if (!plausibleDate(dateFrom) || !plausibleDate(dateTo)) return { error: 400 };
    // The API counts hours 1..24, not 0..23.
    for (const hour of [Number(hourFrom), Number(hourTo)]) {
      if (!Number.isInteger(hour) || hour < 1 || hour > 24) return { error: 400 };
    }
    const query = new URLSearchParams({
      date_from: dateFrom, time_from: hourFrom, date_to: dateTo, time_to: hourTo,
      station, lang: 'de',
    });
    return {
      key: `uba:aq:${station}:${dateFrom}:${hourFrom}:${dateTo}:${hourTo}`,
      url: `${UBA_ORIGIN}${UBA_PATH}/airquality/json?${query}`,
      budget: BUDGET.ubaReadings,
    };
  }

  return { error: 404 };
}

/**
 * A calendar date within a week of today.
 *
 * ⚠️ Bounded on purpose. The app only ever asks for the last few hours, and an unbounded date
 * range would let someone use this to pull years of national measurements through the relay —
 * which is public data, but it would be this service's traffic and this subscription's bill.
 */
function plausibleDate(value) {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return false;
  const days = (Date.now() - parsed) / 86_400_000;
  return days >= -1 && days <= 7;
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  const cors = corsHeaders(origin);

  if (request.method === 'OPTIONS') { send(response, 204, '', cors); return; }
  if (request.method !== 'GET') { send(response, 405, '{"error":"method"}', cors); return; }

  let url;
  try {
    url = new URL(request.url ?? '/', 'http://relay.invalid');
  } catch {
    send(response, 400, '{"error":"url"}', cors);
    return;
  }

  // Liveness for the Container App probe. Deliberately says nothing about the upstreams: a health
  // check that fails when a third party is down would restart this container pointlessly.
  if (url.pathname === '/health') { send(response, 200, '{"status":"ok"}', {}); return; }

  const resolved = route(url.pathname);
  if ('error' in resolved) {
    const message = resolved.error === 403 ? 'outside the served area' : 'request';
    send(response, resolved.error, JSON.stringify({ error: message }), cors);
    return;
  }

  const address = callerAddress(request);
  if (rateLimited(address)) { send(response, 429, '{"error":"rate"}', cors); return; }

  try {
    const { body, ageMs } = await fetchUpstream(resolved.key, resolved.url, resolved.budget);
    // ⚠️ THE AGE IS PART OF THE ANSWER for the flight feed. ADS-B reports each position's age as
    // `seen_pos`, relative to the snapshot it came from — not as an absolute timestamp that keeps
    // advancing inside cached bytes. Serving a four-second-old snapshot without saying so makes
    // every position look four seconds younger than it is, which in that app decides whether an
    // aircraft is still shown. The client adds this back.
    send(response, 200, body, {
      ...cors,
      'x-relay-age-ms': String(ageMs),
      'x-relay-cache': ageMs > 0 ? 'hit' : 'miss',
    });
  } catch (error) {
    // The upstream's own message is not echoed: it is a third party's text and could contain
    // anything. The app distinguishes "unreachable" from "CORS" on its own side.
    console.error('upstream failure:', error instanceof Error ? error.message : error);
    send(response, 502, '{"error":"upstream"}', cors);
  }
});

// Reports the port actually bound, not the one requested: with PORT=0 the operating system
// chooses, and logging the request would print "listening on 0".
server.listen(PORT, () => {
  const address = server.address();
  const bound = typeof address === 'object' && address ? address.port : PORT;
  console.log(`adsb relay listening on ${bound}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
