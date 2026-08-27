/**
 * Bake a height grid for Sydney Harbour from AWS Open Data "Terrain Tiles" (terrarium PNGs).
 *
 * WHY THIS EXISTS: the keyless modes sat on Cesium's bare ellipsoid — a perfectly flat plate —
 * because world terrain is a Cesium ion asset. Sydney is not flat: the CBD stands on a ridge and
 * the foreshore is all headlands and gullies. Verified against known points before trusting it:
 * mid-harbour 0 m, Observatory Hill 42 m, Dover Heights 79 m.
 *
 * Terrarium encoding: height_m = (R * 256 + G + B / 256) - 32768.
 * Licence: AWS Open Data Terrain Tiles, sourced for Australia from Geoscience Australia's
 * SRTM-derived 1-second DEM. Free, keyless, redistributable with attribution.
 *
 * ⚠️ The real source is ~30 m posting, so there is nothing to gain above z13 (~16 m/px here) —
 * a finer grid would quadruple the file to interpolate data that does not exist.
 *
 * ⚠️ The seabed is clamped FLAT AT SEA LEVEL, deliberately. Cesium draws the globe surface itself,
 * so a real bathymetric dip would pull the harbour's aerial photo down into a visible trench under
 * the ferries. Sea level is also exactly where the vessels float, so the two agree by construction.
 *
 * Run: node scripts/bake-terrain.mjs
 * Out: public/data/terrain-sydney.bin (Int16 LE, metres above sea level) + .json metadata
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PNG } from 'pngjs';

import { TERRAIN_AOI, fetchRetry, lonLatToTile } from './lib/aoi.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_BIN = resolve(HERE, '../public/data/terrain-sydney.bin');
const OUT_META = resolve(HERE, '../public/data/terrain-sydney.json');

const Z = 13;
const URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

const nw = lonLatToTile(TERRAIN_AOI.west, TERRAIN_AOI.north, Z);
const se = lonLatToTile(TERRAIN_AOI.east, TERRAIN_AOI.south, Z);

const tilesX = se.x - nw.x + 1;
const tilesY = se.y - nw.y + 1;
const width = tilesX * 256;
const height = tilesY * 256;

console.log(`z${Z}  ${tilesX}x${tilesY} tiles  ->  ${width}x${height} samples`);

const grid = new Int16Array(width * height);
let fetched = 0;
let anomalies = 0;

for (let ty = 0; ty < tilesY; ty++) {
  for (let tx = 0; tx < tilesX; tx++) {
    const res = await fetchRetry(URL(Z, nw.x + tx, nw.y + ty));
    const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
    for (let py = 0; py < 256; py++) {
      for (let px = 0; px < 256; px++) {
        const i = (py * png.width + px) * 4;
        const h = png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
        // ⚠️ Clamp. A first bulk scan reported a 1755 m peak beside Sydney Harbour — a handful of
        // nodata pixels, not a mountain. Left unclamped they would punch spikes through the scene.
        // The floor is 0, not the true seabed: see the header note.
        let v = h;
        if (v > 400) {
          anomalies++;
          v = 400;
        }
        if (v < 0) v = 0;
        grid[(ty * 256 + py) * width + (tx * 256 + px)] = Math.round(v);
      }
    }
    fetched++;
    process.stdout.write(`\r  tiles ${fetched}/${tilesX * tilesY}`);
  }
}
console.log();

let min = Infinity;
let max = -Infinity;
let sea = 0;
for (const v of grid) {
  if (v < min) min = v;
  if (v > max) max = v;
  if (v <= 0) sea++;
}

// Sanity gates — a terrain file that is all one value would render as the flat plate it replaces.
if (max - min < 20) throw new Error(`relief is only ${max - min} m — the download is wrong`);
if (sea / grid.length < 0.05) throw new Error('less than 5% at sea level — this is not a harbour');

await mkdir(dirname(OUT_BIN), { recursive: true });
await writeFile(OUT_BIN, Buffer.from(grid.buffer));
await writeFile(
  OUT_META,
  JSON.stringify({
    width,
    height,
    zoom: Z,
    // Exact bounds of the sampled grid (tile edges, not the requested AOI).
    west: (nw.x / 2 ** Z) * 360 - 180,
    east: ((se.x + 1) / 2 ** Z) * 360 - 180,
    north: tileYToLat(nw.y, Z),
    south: tileYToLat(se.y + 1, Z),
    minHeight: min,
    maxHeight: max,
    encoding: 'Int16LE metres above sea level, row-major from the north-west corner',
    source: 'AWS Open Data Terrain Tiles (terrarium) — Geoscience Australia SRTM-derived 1s DEM',
  }),
);

function tileYToLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

console.log(`\nrelief   : ${min} .. ${max} m`);
console.log(`at/below sea level: ${((sea / grid.length) * 100).toFixed(1)}%`);
console.log(`clamped anomalies : ${anomalies}`);
console.log(`wrote    : ${OUT_BIN} (${(grid.byteLength / 1024).toFixed(0)} KB)`);
