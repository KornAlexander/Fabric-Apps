/**
 * Chainage resolution — which point on the river a building answers to.
 *
 * The flow field carries, per 16 m cell, the index of the nearest hydraulically connected
 * chainage point, or a sentinel where no water route exists. Every building resolves that
 * index once at load, and from then on its depth is simply the water surface at that point
 * minus its own ground elevation.
 *
 * This lives in its own module, away from the Three.js scene, because it is the one step
 * where a data-shape mistake is invisible: it produces no error, no warning and no wrong
 * *number* — only a wrong picture. It has already done so once. See `resolveBuildingChainage`.
 */

export interface ChainageGrid {
  /** Nearest chainage index per cell, row-major, `notConnected` where there is no route. */
  data: Uint16Array;
  width: number;
  height: number;
  resolutionM: number;
  /** Sentinel value standing for "no water reaches this cell at any discharge". */
  notConnected: number;
  /** Number of points along the reach; indices are clamped into this range. */
  chainagePoints: number;
}

export interface ChainageOrigin {
  /** UTM easting of the grid's west edge. */
  easting: number;
  /** UTM northing of the grid's *north* edge — rows count southwards from here. */
  northingTop: number;
}

/** The two fields a building must carry for this to work. */
export interface ChainageSite {
  easting: number;
  northing: number;
}

export const NOT_CONNECTED = -1;

/**
 * Resolve one site to a chainage index, or −1 when no river point governs it.
 *
 * The finite check is not defensive noise. `buildings_lod2.json` is written by a Python
 * pipeline and read by a TypeScript interface that cannot verify it; when the pipeline
 * stopped emitting `easting`/`northing`, the subtraction produced NaN, every bounds
 * comparison against NaN was false so the guard let it through, the typed-array read
 * returned undefined, and `Math.min(undefined, n)` stored 0 in an Int32Array. Result: every
 * building in the valley took the water surface at the top of the reach, and 97 % of them
 * rendered as more than 2.5 m submerged. Silent, plausible and completely wrong. A NaN
 * coordinate now means "not connected", which is the honest answer to "where is this?"
 */
export function resolveSiteChainage(
  site: ChainageSite,
  grid: ChainageGrid,
  origin: ChainageOrigin
): number {
  if (!Number.isFinite(site.easting) || !Number.isFinite(site.northing)) return NOT_CONNECTED;
  const col = Math.round((site.easting - origin.easting) / grid.resolutionM);
  const row = Math.round((origin.northingTop - site.northing) / grid.resolutionM);
  if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) return NOT_CONNECTED;
  const value = grid.data[row * grid.width + col];
  if (value === undefined || value === grid.notConnected) return NOT_CONNECTED;
  return Math.min(value, grid.chainagePoints - 1);
}

/**
 * Resolve a whole building list, and say out loud when the input cannot be trusted.
 *
 * If a meaningful share of the sites have no usable coordinate, that is a broken asset
 * rather than a valley where nothing is connected, and it belongs in the console where the
 * next person can see it instead of in the picture where it looks like a result.
 */
export function resolveBuildingChainage(
  sites: readonly ChainageSite[],
  grid: ChainageGrid,
  origin: ChainageOrigin
): Int32Array {
  const out = new Int32Array(sites.length);
  let unlocatable = 0;
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    if (!Number.isFinite(site?.easting) || !Number.isFinite(site?.northing)) unlocatable++;
    out[i] = site ? resolveSiteChainage(site, grid, origin) : NOT_CONNECTED;
  }
  if (unlocatable > 0) {
    console.warn(
      `chainage: ${unlocatable} of ${sites.length} buildings carry no usable easting/northing ` +
        `and are treated as dry. Rebuild with tools/geodata/build_lod2_mesh.py.`
    );
  }
  return out;
}
