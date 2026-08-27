import {
  Credit,
  Event as CesiumEvent,
  GeographicTilingScheme,
  HeightmapTerrainData,
  TerrainProvider,
  Math as CesiumMath,
} from 'cesium';

/**
 * ── Terrain without Cesium ion ─────────────────────────────────────────────────────────────────
 *
 * Cesium World Terrain is an ion asset, so the keyless modes used to sit on the bare ellipsoid: a
 * perfectly flat plate. That is the single biggest reason they read as "a map" rather than a place —
 * Sydney's CBD stands on a ridge, and the foreshore is nothing but headlands and gullies.
 *
 * Cesium will accept any object satisfying the TerrainProvider interface, so this one serves height
 * tiles out of a small grid baked into the bundle by `scripts/bake-terrain.mjs`. No token, no tile
 * server, and — unlike the Overpass lesson — no third party in the runtime path at all.
 *
 * Outside the baked rectangle every sample is sea level, which is correct for an app whose subject
 * is one harbour and keeps the rest of the globe from becoming a cliff edge.
 */

export interface TerrainGrid {
  width: number;
  height: number;
  west: number;
  east: number;
  north: number;
  south: number;
  minHeight: number;
  maxHeight: number;
  heights: Int16Array;
}

/** Samples per heightmap tile edge. 65 is Cesium's own convention for this format. */
const TILE_SAMPLES = 65;

/**
 * ⚠️ Stop subdividing at the resolution the DATA actually has. A geographic tile at level 14 is
 * ~16 m per sample here, which is the baked grid's own posting. Allowing deeper levels would ask
 * the CPU to build thousands of tiles that carry no information the parent did not already have;
 * refusing them makes Cesium upsample instead, which is both smoother and free.
 */
const MAX_LEVEL = 14;

export async function loadTerrainGrid(
  metaUrl = '/data/terrain-sydney.json',
  binUrl = '/data/terrain-sydney.bin',
  signal?: AbortSignal,
): Promise<TerrainGrid> {
  const [metaRes, binRes] = await Promise.all([fetch(metaUrl, { signal }), fetch(binUrl, { signal })]);
  if (!metaRes.ok || !binRes.ok) throw new Error('terrain assets missing');
  const meta = (await metaRes.json()) as Omit<TerrainGrid, 'heights'>;
  const heights = new Int16Array(await binRes.arrayBuffer());
  if (heights.length !== meta.width * meta.height) {
    throw new Error(`terrain grid is ${heights.length} samples, metadata claims ${meta.width * meta.height}`);
  }
  return { ...meta, heights };
}

export class BakedTerrainProvider {
  readonly tilingScheme = new GeographicTilingScheme();
  readonly errorEvent = new CesiumEvent();
  readonly hasWaterMask = false;
  readonly hasVertexNormals = false;
  readonly credit: Credit;
  readonly availability = undefined;

  private readonly grid: TerrainGrid;
  private readonly geoidOffset: number;
  private readonly levelZeroError: number;

  /**
   * @param geoidOffset Sea level in Sydney is ~23 m above the WGS84 ellipsoid, and Cesium works in
   * ellipsoidal heights. Without this the whole harbour sits 23 m below the ferries floating on it.
   */
  constructor(grid: TerrainGrid, geoidOffset: number, credit: string) {
    this.grid = grid;
    this.geoidOffset = geoidOffset;
    this.credit = new Credit(credit);
    this.levelZeroError = TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(
      this.tilingScheme.ellipsoid,
      TILE_SAMPLES,
      this.tilingScheme.getNumberOfXTilesAtLevel(0),
    );
  }

  getLevelMaximumGeometricError(level: number): number {
    return this.levelZeroError / (1 << level);
  }

  getTileDataAvailable(_x: number, _y: number, level: number): boolean {
    return level <= MAX_LEVEL;
  }

  loadTileDataAvailability(): undefined {
    return undefined;
  }

  requestTileGeometry(x: number, y: number, level: number): Promise<HeightmapTerrainData> | undefined {
    if (level > MAX_LEVEL) return undefined;
    const rect = this.tilingScheme.tileXYToRectangle(x, y, level);
    const buffer = new Int16Array(TILE_SAMPLES * TILE_SAMPLES);

    for (let j = 0; j < TILE_SAMPLES; j++) {
      // Row 0 of a heightmap is the NORTH edge; the rectangle runs south→north.
      const lat = CesiumMath.lerp(rect.north, rect.south, j / (TILE_SAMPLES - 1));
      for (let i = 0; i < TILE_SAMPLES; i++) {
        const lon = CesiumMath.lerp(rect.west, rect.east, i / (TILE_SAMPLES - 1));
        buffer[j * TILE_SAMPLES + i] = this.sample(
          CesiumMath.toDegrees(lon),
          CesiumMath.toDegrees(lat),
        );
      }
    }

    return Promise.resolve(
      new HeightmapTerrainData({
        buffer,
        width: TILE_SAMPLES,
        height: TILE_SAMPLES,
        structure: {
          heightScale: 1,
          heightOffset: this.geoidOffset,
          elementsPerHeight: 1,
          stride: 1,
          elementMultiplier: 256,
          isBigEndian: false,
        },
      }),
    );
  }

  /** Bilinear sample in metres above sea level; 0 outside the baked rectangle. */
  private sample(lonDeg: number, latDeg: number): number {
    const g = this.grid;
    if (lonDeg < g.west || lonDeg > g.east || latDeg < g.south || latDeg > g.north) return 0;
    const fx = ((lonDeg - g.west) / (g.east - g.west)) * (g.width - 1);
    const fy = ((g.north - latDeg) / (g.north - g.south)) * (g.height - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, g.width - 1);
    const y1 = Math.min(y0 + 1, g.height - 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const h = g.heights;
    const top = h[y0 * g.width + x0] * (1 - tx) + h[y0 * g.width + x1] * tx;
    const bottom = h[y1 * g.width + x0] * (1 - tx) + h[y1 * g.width + x1] * tx;
    return Math.round(top * (1 - ty) + bottom * ty);
  }
}
