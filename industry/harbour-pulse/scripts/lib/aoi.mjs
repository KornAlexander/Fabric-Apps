/**
 * The one place that says where "Sydney Harbour" is for every bake script.
 *
 * ⚠️ Change a bbox here and you must re-run ALL the bakers — the building, tree and terrain files
 * are joined by position at build time (each building and tree carries the ground height sampled
 * from the terrain grid), so a terrain bake over a different area silently sinks or floats them.
 */

/** Buildings and trees. CBD, Barangaroo, Darling Harbour, North Sydney, Kirribilli, Garden Island. */
export const AOI = { south: -33.885, west: 151.19, north: -33.838, east: 151.245 };

/**
 * Terrain runs wider than the AOI so the relief does not end in a cliff just off screen when the
 * camera looks out over the heads.
 */
export const TERRAIN_AOI = { south: -33.93, west: 151.14, north: -33.79, east: 151.31 };

/**
 * Sydney sea level sits ~23 m above the WGS84 ellipsoid (geoid separation). Cesium works in
 * ellipsoidal heights and the elevation source is metres above sea level, so every baked height
 * gets this added — the same constant the ferry models already use, which is what keeps the
 * vessels floating ON the water rather than 23 m under it.
 */
export const GEOID_OFFSET_M = 23;

/** Web-Mercator slippy tile x/y for a lat/lon. ⚠️ ArcGIS caches want /{z}/{y}/{x}, XYZ wants /{z}/{x}/{y}. */
export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n),
  };
}

/** Fetch with a few retries — these are one-off build-time downloads, so be patient, not clever. */
export async function fetchRetry(url, { tries = 4, headers = {}, timeoutMs = 60_000 } = {}) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, {
        headers: { 'User-Agent': 'harbour-pulse-build/1.0 (one-off build-time fetch)', ...headers },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastErr = err;
      if (i < tries) await new Promise((r) => setTimeout(r, i * 1500));
    }
  }
  throw new Error(`${url} failed after ${tries} tries: ${lastErr?.message}`);
}
