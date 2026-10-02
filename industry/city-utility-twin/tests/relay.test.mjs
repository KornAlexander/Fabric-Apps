/**
 * The relay's guarantees, checked against a real running instance of it.
 *
 * ⚠️ THESE ARE THE SECURITY PROPERTIES, not nice-to-haves. The relay is a public unauthenticated
 * endpoint in a customer-facing subscription, and every assertion below corresponds to a way it
 * could otherwise be turned into an open proxy, an abuse amplifier, or a source of quietly wrong
 * timestamps.
 *
 * The upstream is stubbed, so nothing here touches adsb.lol.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../relay/server.mjs', import.meta.url));
const APP_ORIGIN = 'https://app.example.test';

/** A stand-in for an upstream that records what the relay asked it. */
async function startUpstream(body) {
  const { createServer } = await import('node:http');
  const calls = [];
  const server = createServer((request, response) => {
    calls.push(request.url);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, calls, port: server.address().port };
}

async function startRelay(upstreamPort, ubaPort) {
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: '0',
      ALLOWED_ORIGINS: APP_ORIGIN,
      UPSTREAM_ORIGIN: `http://127.0.0.1:${upstreamPort}`,
      // ⚠️ A SECOND STUB, NOT THE REAL UMWELTBUNDESAMT. These tests used to let the air-quality
      // routes out to the live API and swallow the failures, which made a security assertion
      // depend on a third party being up. On 2026-09-21 that endpoint took 60 seconds and the
      // gate went red for reasons unrelated to the code.
      UBA_ORIGIN: `http://127.0.0.1:${ubaPort}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let port = 0;
  for await (const chunk of child.stdout) {
    const match = /listening on (\d+)/.exec(String(chunk));
    if (match) { port = Number(match[1]); break; }
  }
  if (!port) throw new Error('relay did not report a port');
  return { child, port };
}

let upstream;
let ubaUpstream;
let relay;
let base;

test.before(async () => {
  upstream = await startUpstream({ ac: [{ hex: 'abc123', lat: 48.35, lon: 11.78, seen_pos: 3 }] });
  ubaUpstream = await startUpstream({ indices: [], data: {}, count: 0 });
  relay = await startRelay(upstream.port, ubaUpstream.port);
  base = `http://127.0.0.1:${relay.port}`;
});

test.after(() => {
  relay?.child.kill();
  upstream?.server.close();
  ubaUpstream?.server.close();
});

const get = (path, headers = {}) => fetch(`${base}${path}`, { headers });

test('serves a valid in-area query', async () => {
  const response = await get('/adsb/point/48.3538/11.7861/25', { Origin: APP_ORIGIN });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ac.length, 1);
  assert.equal(response.headers.get('access-control-allow-origin'), APP_ORIGIN);
  // Without this header the browser cannot read the age and the app under-reports position age.
  assert.match(response.headers.get('access-control-expose-headers') ?? '', /x-relay-age-ms/);
});

test('refuses coordinates outside the served area', async () => {
  // London. A worldwide aircraft-tracking endpoint is not what this is allowed to be.
  const response = await get('/adsb/point/51.5/-0.12/25', { Origin: APP_ORIGIN });
  assert.equal(response.status, 403);
});

test('refuses parameter shapes that are not plain decimals', async () => {
  for (const path of [
    '/adsb/point/4.8e1/11.7/25',        // exponent
    '/adsb/point/0x30/11.7/25',         // hex
    '/adsb/point/48.3538/11.7861/0',    // radius below range
    '/adsb/point/48.3538/11.7861/999',  // radius above range
    '/adsb/point/48.3538/11.7861/25/x', // extra segment
    '/adsb/point/48.3538/11.7861',      // missing segment
    '/v2/point/48.3538/11.7861/25',     // upstream path shape, not ours
  ]) {
    const response = await get(path, { Origin: APP_ORIGIN });
    assert.ok(response.status >= 400, `${path} returned ${response.status}`);
  }
});

test('cannot be pointed at another host', async () => {
  // Every classic escape shape. None may reach anything but the fixed upstream, and the upstream
  // stub records every call it receives, so a leak would show up there.
  const before = upstream.calls.length;
  for (const path of [
    '/adsb/point/48.3538/11.7861/25/../../../etc/passwd',
    '/adsb/point/..%2F..%2Fevil/11.7861/25',
    '/https://evil.test/adsb/point/48.3/11.7/25',
    '/adsb/point/48.3538/11.7861/25?x=https://evil.test',
  ]) {
    await get(path, { Origin: APP_ORIGIN }).catch(() => {});
  }
  const added = upstream.calls.slice(before);
  for (const call of added) {
    assert.match(call, /^\/v2\/point\/[\d.-]+\/[\d.-]+\/\d+$/, `upstream saw ${call}`);
  }
});

test('a foreign origin cannot read the body', async () => {
  const response = await get('/adsb/point/48.3538/11.7861/25', { Origin: 'https://evil.test' });
  // The request still reaches the service — CORS is not authentication — but no allow-origin
  // header means the browser refuses to hand the body to the calling page.
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('simultaneous misses become ONE upstream call', async () => {
  const before = upstream.calls.length;
  await Promise.all(Array.from({ length: 12 }, () =>
    get('/adsb/point/48.1/11.6/25', { Origin: APP_ORIGIN })));
  const added = upstream.calls.length - before;
  assert.equal(added, 1, `expected coalescing to one call, saw ${added}`);
});

test('reports how long it has been holding the answer', async () => {
  const first = await get('/adsb/point/48.2/11.5/25', { Origin: APP_ORIGIN });
  assert.equal(first.headers.get('x-relay-age-ms'), '0');
  await new Promise((resolve) => setTimeout(resolve, 60));
  const second = await get('/adsb/point/48.2/11.5/25', { Origin: APP_ORIGIN });
  // Served from cache, and honest about it: the client adds this to every position's age.
  assert.equal(second.headers.get('x-relay-cache'), 'hit');
  assert.ok(Number(second.headers.get('x-relay-age-ms')) >= 50);
});

test('health does not depend on the upstream', async () => {
  const response = await get('/health');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
});

// ---------------------------------------------------------------- second upstream
//
// ⚠️ The air-quality routes point at a DIFFERENT fixed upstream (the Umweltbundesamt), which is
// the one change to the relay's original "exactly one upstream" design. These tests exist to
// prove that adding it did not turn the route table into a place where a caller can express a
// destination.

test('air-quality routes accept only the three fixed shapes', async () => {
  const today = new Date().toISOString().slice(0, 10);
  for (const path of [
    '/uba/stations/extra',
    '/uba/airquality/471',                          // missing window
    `/uba/airquality/471/${today}/0/${today}/9`,    // hour 0: the API counts 1..24
    `/uba/airquality/471/${today}/25/${today}/25`,  // hour above range
    `/uba/airquality/471/2019-01-01/1/${today}/9`,  // far outside the allowed window
    `/uba/airquality/abc/${today}/1/${today}/9`,    // non-numeric station
    '/uba/components/json?lang=de',                 // caller-supplied query
  ]) {
    const response = await get(path, { Origin: APP_ORIGIN });
    assert.ok(response.status >= 400, `${path} returned ${response.status}`);
  }
});

test('an air-quality request cannot reach the flight upstream, or any other host', async () => {
  // Both upstreams are stubs, so this runs entirely offline and asserts on what each one saw.
  const beforeFlight = upstream.calls.length;
  const beforeUba = ubaUpstream.calls.length;
  const today = new Date().toISOString().slice(0, 10);
  for (const path of [
    '/uba/stations',
    `/uba/airquality/471/${today}/1/${today}/9`,
    '/uba/../adsb/point/48.3/11.7/25',
    '/uba/stations/../../adsb/point/48.3/11.7/25',
  ]) {
    await get(path, { Origin: APP_ORIGIN }).catch(() => {});
  }
  for (const call of upstream.calls.slice(beforeFlight)) {
    // Only the ADS-B shape can ever reach the flight upstream. A traversal that tries to walk
    // out of /uba into /adsb must either be rejected or arrive as a legitimate ADS-B request.
    assert.match(call, /^\/v2\/point\/[\d.-]+\/[\d.-]+\/\d+$/, `flight upstream saw ${call}`);
  }
  for (const call of ubaUpstream.calls.slice(beforeUba)) {
    // Everything the air-quality upstream sees must be one of the three fixed shapes, built by
    // the relay. Nothing the caller wrote may appear as a path segment or a query key.
    assert.match(
      call,
      /^\/api\/air-data\/v3\/(?:stations\/json\?use=airquality&lang=de|components\/json\?lang=de|airquality\/json\?[\w=&%.:+-]+)$/,
      `air-quality upstream saw ${call}`,
    );
  }
  // ⚠️ NOT OPTIONAL. The loop above passes trivially if the stub was never reached at all, and
  // the catalogue is cached for hours, so an earlier test in the same run can legitimately
  // leave this slice empty. Asserting the stub has been used at some point is what stops this
  // from silently becoming a test that checks nothing.
  assert.ok(ubaUpstream.calls.length > 0, 'the air-quality upstream stub was never reached');
});

