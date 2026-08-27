/**
 * Bake Sydney Harbour trees from OpenStreetMap.
 *
 * Sydney is unusually well mapped for individual trees — the harbour AOI carries ~7.7k `natural=tree`
 * nodes plus tree rows — so this is the same move as the campus twins' Bavarian tree cadastre: real
 * mapped positions, not a scatter. Nothing is invented except the canopy size where OSM is silent,
 * and that is varied deterministically from the node id so a rebuild does not reshuffle the park.
 *
 * Run: node scripts/bake-trees.mjs   (requires bake-terrain.mjs to have run first)
 * Out: public/data/trees-sydney.json
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AOI, GEOID_OFFSET_M } from './lib/aoi.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../public/data/trees-sydney.json');
const TERRAIN_BIN = resolve(HERE, '../public/data/terrain-sydney.bin');
const TERRAIN_META = resolve(HERE, '../public/data/terrain-sydney.json');

const MIRRORS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ask(q) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    for (const url of MIRRORS) {
      try {
        process.stdout.write(`  attempt ${attempt} -> ${new URL(url).host} ... `);
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

// ── terrain ───────────────────────────────────────────────────────────────────────────────────
const meta = JSON.parse(await readFile(TERRAIN_META, 'utf8'));
const buf = await readFile(TERRAIN_BIN);
const heights = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);

function groundAt(lon, lat) {
  if (lon < meta.west || lon > meta.east || lat < meta.south || lat > meta.north) return 0;
  const fx = ((lon - meta.west) / (meta.east - meta.west)) * (meta.width - 1);
  const fy = ((meta.north - lat) / (meta.north - meta.south)) * (meta.height - 1);
  return heights[Math.round(fy) * meta.width + Math.round(fx)];
}

/** Deterministic 0..1 from an id — same tree, same size, every rebuild. */
function jitter(id) {
  let x = (id ^ 0x9e3779b9) >>> 0;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >> 17;
  x ^= x << 5;
  x >>>= 0;
  return x / 0xffffffff;
}

const box = `${AOI.south},${AOI.west},${AOI.north},${AOI.east}`;

console.log('fetching individually mapped trees...');
const nodes = await ask(`[out:json][timeout:120];node["natural"="tree"](${box});out body;`);

console.log('fetching tree rows...');
const rows = await ask(`[out:json][timeout:120];way["natural"="tree_row"](${box});out geom;`);

const trees = [];

function push(lon, lat, tags, id, fromRow) {
  const g = groundAt(lon, lat);
  const j = jitter(id);
  // OSM height/crown where mapped, otherwise a plausible street-tree spread. Australian harbour
  // planting is mostly figs and gums, so the default runs a little taller than a European default.
  const h = parseFloat(tags?.height ?? '') || 7 + j * 9;
  const crown = parseFloat(tags?.['diameter_crown'] ?? '') || h * (0.5 + j * 0.25);
  trees.push({
    o: +lon.toFixed(6),
    a: +lat.toFixed(6),
    g,
    h: +h.toFixed(1),
    c: +(crown / 2).toFixed(1), // radius
    ...(fromRow ? { w: 1 } : {}),
  });
}

for (const n of nodes) push(n.lon, n.lat, n.tags, n.id, false);

// A tree row is a line of trees, so place one every ~8 m along it.
let rowTrees = 0;
for (const w of rows) {
  const pts = w.geometry ?? [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dLon = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180);
    const metres = Math.hypot(dLon, b.lat - a.lat) * 111_320;
    const steps = Math.max(1, Math.round(metres / 8));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      push(a.lon + (b.lon - a.lon) * t, a.lat + (b.lat - a.lat) * t, w.tags, w.id * 31 + i * 7 + s, true);
      rowTrees++;
    }
  }
}

if (trees.length < 1000) throw new Error(`only ${trees.length} trees — the fetch is wrong`);

const out = {
  generated: new Date().toISOString(),
  aoi: AOI,
  geoidOffsetM: GEOID_OFFSET_M,
  source: '© OpenStreetMap contributors (ODbL) — natural=tree nodes and natural=tree_row ways',
  note: 'Positions are REAL mapped trees. Canopy size is from OSM where tagged, otherwise varied deterministically from the id.',
  count: trees.length,
  // o = lon, a = lat, g = ground m above sea level, h = height m, c = canopy radius m, w = from a row
  trees,
};

await mkdir(dirname(OUT), { recursive: true });
const text = JSON.stringify(out);
await writeFile(OUT, text);
console.log(
  `\nbaked ${trees.length} trees (${nodes.length} mapped individually, ${rowTrees} along ${rows.length} rows) -> ${OUT} (${(text.length / 1024).toFixed(0)} KB)`,
);
