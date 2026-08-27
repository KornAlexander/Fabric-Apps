/**
 * Bake Sydney Harbour buildings: real footprints, real heights, roof colour MEASURED from the
 * aerial photograph, and a ground height so each one sits on the terrain.
 *
 * WHY: extruded footprints in one flat grey are what made the keyless modes look like a diagram.
 * The campus twins look like places because their roofs are sampled from the orthophoto and their
 * walls are classified from the building's function — the same two moves, done here against NSW's
 * aerial tiles and OSM's tags.
 *
 * ⚠️ Roof colour is MEASURED, wall colour is INVENTED. From above you see roofs and essentially no
 * wall, so sampling a wall from an orthophoto would mostly sample the roof next door. Walls come
 * from a small palette keyed on `building=` instead, and the two are kept in separate fields so
 * nobody later mistakes the invented half for the measured half.
 *
 * ⚠️ Overpass is called ONCE here, at build time, never from a browser session. It has failed this
 * app in the wild four times (504 mid-demo, 429 after 14 s, 504 twice while baking).
 *
 * Run: node scripts/bake-buildings.mjs   (requires bake-terrain.mjs to have run first)
 * Out: public/data/buildings-sydney.json
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

import { AOI, GEOID_OFFSET_M, fetchRetry, lonLatToTile } from './lib/aoi.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../public/data/buildings-sydney.json');
const TERRAIN_BIN = resolve(HERE, '../public/data/terrain-sydney.bin');
const TERRAIN_META = resolve(HERE, '../public/data/terrain-sydney.json');

const MIRRORS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

/** NSW aerial, for roof colour. z17 ≈ 1.2 m/px — plenty for a building's AVERAGE tone. */
const IMAGERY_Z = 17;
const IMAGERY = (z, x, y) =>
  `https://portal.spatial.nsw.gov.au/aid/tile/rest/services/NSWWebImagery/MapServer/tile/${z}/${y}/${x}`;

/**
 * Wall tones by what the building is for. Deliberately muted: these are invented, so they should
 * sit quietly under the measured roofs rather than compete with them.
 */
const WALL_BY_KIND = {
  commercial: '#b9b2a6',
  office: '#aeb4ba',
  retail: '#c0b6a8',
  industrial: '#a8a49c',
  warehouse: '#a8a49c',
  residential: '#c6bcae',
  apartments: '#c2b8ab',
  house: '#cabfb0',
  hotel: '#bcb3a8',
  church: '#c8c0b2',
  civic: '#bdb8ad',
  public: '#bdb8ad',
  university: '#bfb6a9',
  school: '#bfb6a9',
  hospital: '#c3bcb2',
  train_station: '#b2aca2',
  roof: '#b5aea4',
  default: '#bab3a8',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── OSM ───────────────────────────────────────────────────────────────────────────────────────
async function fetchBuildings() {
  const q =
    `[out:json][timeout:180];(way["building"](${AOI.south},${AOI.west},${AOI.north},${AOI.east});` +
    `relation["building"](${AOI.south},${AOI.west},${AOI.north},${AOI.east}););out geom;`;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    for (const url of MIRRORS) {
      try {
        process.stdout.write(`  overpass attempt ${attempt} -> ${new URL(url).host} ... `);
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'harbour-pulse-build/1.0 (one-off build-time fetch)',
          },
          body: `data=${encodeURIComponent(q)}`,
        });
        if (!res.ok) {
          console.log(`HTTP ${res.status}`);
          lastErr = new Error(`HTTP ${res.status}`);
          continue;
        }
        const json = await res.json();
        console.log(`ok, ${json.elements?.length ?? 0} elements`);
        return json.elements ?? [];
      } catch (err) {
        console.log(`failed (${err.message})`);
        lastErr = err;
      }
    }
    if (attempt < 3) await sleep(attempt * 20_000);
  }
  throw lastErr ?? new Error('no Overpass mirror responded');
}

function estimateHeight(tags = {}) {
  const h = parseFloat(tags.height ?? tags['building:height'] ?? '');
  if (Number.isFinite(h) && h > 0) return { h, measured: true };
  const levels = parseFloat(tags['building:levels'] ?? '');
  if (Number.isFinite(levels) && levels > 0) return { h: levels * 3.3, measured: false };
  return { h: 9, measured: false };
}

function kindOf(tags = {}) {
  const b = tags.building;
  if (b && b !== 'yes' && WALL_BY_KIND[b]) return b;
  if (tags.amenity === 'place_of_worship') return 'church';
  if (tags.office) return 'office';
  if (tags.shop) return 'retail';
  return 'default';
}

// ── terrain ───────────────────────────────────────────────────────────────────────────────────
const meta = JSON.parse(await readFile(TERRAIN_META, 'utf8'));
const terrainBuf = await readFile(TERRAIN_BIN);
const heights = new Int16Array(terrainBuf.buffer, terrainBuf.byteOffset, terrainBuf.byteLength / 2);

function groundAt(lon, lat) {
  if (lon < meta.west || lon > meta.east || lat < meta.south || lat > meta.north) return 0;
  const fx = ((lon - meta.west) / (meta.east - meta.west)) * (meta.width - 1);
  const fy = ((meta.north - lat) / (meta.north - meta.south)) * (meta.height - 1);
  return heights[Math.round(fy) * meta.width + Math.round(fx)];
}

// ── imagery ───────────────────────────────────────────────────────────────────────────────────
/**
 * ⚠️ The NSW cache advertises `format: MIXED` — most tiles come back as JPEG and only some as PNG.
 * A PNG-only decoder silently returned nothing for every tile and the bake produced 0% roof
 * colours, which is exactly what the coverage gate below exists to catch. Sniff the magic bytes.
 */
function decodeTile(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const img = jpeg.decode(buf, { useTArray: true });
    return { width: img.width, height: img.height, data: img.data };
  }
  throw new Error(`unknown tile format ${buf[0].toString(16)}${buf[1].toString(16)}`);
}

const tileCache = new Map();
async function tileAt(x, y) {
  const key = `${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);
  let img = null;
  try {
    const res = await fetchRetry(IMAGERY(IMAGERY_Z, x, y), { tries: 3 });
    img = decodeTile(Buffer.from(await res.arrayBuffer()));
  } catch {
    img = null; // a missing aerial tile is not a reason to fail the whole bake
  }
  // Keep the cache bounded — the whole AOI at z17 would otherwise sit in memory as RGBA.
  if (tileCache.size > 300) tileCache.clear();
  tileCache.set(key, img);
  return img;
}

/** Median of a small neighbourhood — a single pixel lands on a shadow or a skylight too often. */
function medianColour(png, px, py) {
  const rs = [];
  const gs = [];
  const bs = [];
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = px + dx;
      const y = py + dy;
      if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
      const i = (y * png.width + x) * 4;
      rs.push(png.data[i]);
      gs.push(png.data[i + 1]);
      bs.push(png.data[i + 2]);
    }
  }
  if (!rs.length) return null;
  const mid = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  return [mid(rs), mid(gs), mid(bs)];
}

const hex = (r, g, b) =>
  '#' +
  [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

// ── build ─────────────────────────────────────────────────────────────────────────────────────
console.log('fetching OSM buildings...');
const elements = await fetchBuildings();

const raw = [];
for (const el of elements) {
  const geom = el.geometry ?? (el.members ?? []).find((m) => m.role === 'outer')?.geometry;
  if (!geom || geom.length < 4) continue;
  const ring = geom.map((p) => [+p.lon.toFixed(6), +p.lat.toFixed(6)]);
  const [f, l] = [ring[0], ring[ring.length - 1]];
  if (f[0] !== l[0] || f[1] !== l[1]) ring.push(f);
  let cx = 0;
  let cy = 0;
  for (const [lon, lat] of ring) {
    cx += lon;
    cy += lat;
  }
  cx /= ring.length;
  cy /= ring.length;
  const { h, measured } = estimateHeight(el.tags);
  raw.push({ ring, cx, cy, h, measured, kind: kindOf(el.tags), name: el.tags?.name });
}
console.log(`  usable footprints: ${raw.length}`);

// Sort by imagery tile so each tile is fetched once and dropped.
for (const b of raw) {
  const t = lonLatToTile(b.cx, b.cy, IMAGERY_Z);
  b.tx = t.x;
  b.ty = t.y;
}
raw.sort((a, b) => a.tx - b.tx || a.ty - b.ty);

console.log(`sampling roof colour from NSW aerial (z${IMAGERY_Z})...`);
const n = 2 ** IMAGERY_Z;
let sampled = 0;
let done = 0;
for (const b of raw) {
  const png = await tileAt(b.tx, b.ty);
  if (png) {
    const fx = ((b.cx + 180) / 360) * n;
    const r = (b.cy * Math.PI) / 180;
    const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
    const c = medianColour(
      png,
      Math.floor((fx - b.tx) * png.width),
      Math.floor((fy - b.ty) * png.height),
    );
    if (c) {
      // Lift very dark samples (shadow, dark metal) so the city does not read as soot, and pull a
      // little toward the mean — raw aerial pixels are noisier than a roof really looks.
      const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      const target = Math.max(lum, 58);
      const k = lum > 1 ? target / lum : 1;
      b.roof = hex(c[0] * k * 0.82 + target * 0.18, c[1] * k * 0.82 + target * 0.18, c[2] * k * 0.82 + target * 0.18);
      sampled++;
    }
  }
  b.ground = groundAt(b.cx, b.cy);
  done++;
  if (done % 500 === 0) process.stdout.write(`\r  ${done}/${raw.length}  (${sampled} sampled)`);
}
console.log(`\r  ${done}/${raw.length}  (${sampled} sampled)      `);

if (sampled / raw.length < 0.5) {
  throw new Error(
    `only ${((sampled / raw.length) * 100).toFixed(0)}% got a roof colour — the imagery fetch is broken`,
  );
}

const out = {
  generated: new Date().toISOString(),
  aoi: AOI,
  geoidOffsetM: GEOID_OFFSET_M,
  roofColour: `measured from NSW aerial imagery at z${IMAGERY_Z}`,
  wallColour: 'INVENTED — palette keyed on the OSM building kind',
  source:
    'Footprints & heights © OpenStreetMap contributors (ODbL) · roof colour from NSW Spatial Services imagery',
  count: raw.length,
  // Compact on purpose: this is a baked internal asset, not an interchange format.
  // r = ring [[lon,lat]…], h = height m, g = ground m above sea level, rf/wl = roof/wall colour.
  buildings: raw.map((b) => ({
    r: b.ring,
    h: +b.h.toFixed(1),
    g: b.ground,
    rf: b.roof ?? '#b0aaa0',
    wl: WALL_BY_KIND[b.kind] ?? WALL_BY_KIND.default,
    ...(b.measured ? { m: 1 } : {}),
    ...(b.name ? { n: b.name } : {}),
  })),
};

await mkdir(dirname(OUT), { recursive: true });
const text = JSON.stringify(out);
await writeFile(OUT, text);
console.log(
  `\nbaked ${raw.length} buildings (${sampled} with measured roof colour) -> ${OUT} (${(text.length / 1024).toFixed(0)} KB)`,
);
console.log(
  `heights: ${raw.filter((b) => b.measured).length} measured, ${raw.filter((b) => !b.measured).length} from levels/default`,
);
