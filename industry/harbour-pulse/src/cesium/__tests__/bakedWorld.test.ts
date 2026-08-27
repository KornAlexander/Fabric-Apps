import { Color, GeographicTilingScheme, Math as CesiumMath } from 'cesium';
import { describe, expect, it } from 'vitest';

import { wallColour } from '@/cesium/bakedCity';
import { BakedTerrainProvider, type TerrainGrid } from '@/cesium/bakedTerrain';
import { GEOID_OFFSET_M, IMAGERY_MODES, modeInfo } from '@/cesium/imageryModes';

const GEOID = GEOID_OFFSET_M;

/** A grid covering the whole globe so any tile we ask for lands inside it. */
function flatGrid(valueMetres: number): TerrainGrid {
  const width = 4;
  const height = 4;
  return {
    width,
    height,
    west: -180,
    east: 180,
    north: 90,
    south: -90,
    minHeight: valueMetres,
    maxHeight: valueMetres,
    heights: new Int16Array(width * height).fill(valueMetres),
  };
}

const luminance = (c: Color) => 0.2126 * c.red + 0.7152 * c.green + 0.0722 * c.blue;

describe('wall colour derivation', () => {
  // ⚠️ The bug this exists to prevent: walls taken straight from the class palette made every
  // building the same pale beige, so the whole city read as one sheet of cardboard from ferry
  // height. A wall must follow its OWN roof.
  it('gives two buildings of the same class different walls when their roofs differ', () => {
    const classHex = '#bab3a8';
    const a = wallColour('#8b3a2f', classHex); // terracotta roof
    const b = wallColour('#cfd4d8', classHex); // pale metal roof
    const delta =
      Math.abs(a.red - b.red) + Math.abs(a.green - b.green) + Math.abs(a.blue - b.blue);
    expect(delta).toBeGreaterThan(0.15);
  });

  it('makes the wall track its own roof, not the class palette', () => {
    // The property a class-palette regression breaks outright: a lighter roof must yield a lighter
    // wall. Asserting "always darker than its roof" instead would be false for very dark roofs,
    // where the class tint legitimately lifts them.
    const classHex = '#bab3a8';
    const ordered = ['#2f3436', '#8b3a2f', '#9a9a9a', '#cfd4d8', '#ffffff'].map((r) =>
      luminance(wallColour(r, classHex)),
    );
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i]).toBeGreaterThan(ordered[i - 1]);
    }
  });

  it('shades the wall below the blend it came from', () => {
    const roof = '#cfd4d8';
    const w = wallColour(roof, '#bab3a8');
    expect(luminance(w)).toBeLessThan(luminance(Color.fromCssColorString(roof)));
  });

  it('still lets the class tint move the result', () => {
    const roof = '#9a9a9a';
    const officeish = wallColour(roof, '#aeb4ba');
    const industrialish = wallColour(roof, '#a8a49c');
    expect(officeish.blue).toBeGreaterThan(industrialish.blue);
  });

  it('never produces a channel outside 0..1', () => {
    const c = wallColour('#ffffff', '#ffffff');
    for (const v of [c.red, c.green, c.blue]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('baked terrain provider', () => {
  const scheme = new GeographicTilingScheme();

  // ⚠️ THE FERRY INVARIANT. The baked files hold metres above SEA LEVEL and Cesium works from the
  // ellipsoid. Drop the geoid offset and the whole harbour renders 23 m below the boats floating
  // on it — which looks like a broken model, not like a missing constant.
  it('adds the geoid offset so sea level lands where the ferries float', async () => {
    const p = new BakedTerrainProvider(flatGrid(0), GEOID, 'test');
    const data = await p.requestTileGeometry(0, 0, 0)!;
    const rect = scheme.tileXYToRectangle(0, 0, 0);
    const h = data.interpolateHeight(rect, CesiumMath.toRadians(-90), CesiumMath.toRadians(0));
    expect(h).toBeCloseTo(GEOID, 5);
  });

  it('carries real relief through on top of that offset', async () => {
    const p = new BakedTerrainProvider(flatGrid(80), GEOID, 'test');
    const data = await p.requestTileGeometry(0, 0, 0)!;
    const rect = scheme.tileXYToRectangle(0, 0, 0);
    const h = data.interpolateHeight(rect, CesiumMath.toRadians(-90), CesiumMath.toRadians(0));
    expect(h).toBeCloseTo(80 + GEOID, 5);
  });

  it('reports sea level outside the baked rectangle instead of a cliff', async () => {
    const grid = flatGrid(120);
    // Shrink the covered area to a small box near Sydney; everywhere else must read as sea.
    Object.assign(grid, { west: 151.1, east: 151.3, south: -33.95, north: -33.8 });
    const p = new BakedTerrainProvider(grid, GEOID, 'test');
    const data = await p.requestTileGeometry(1, 0, 0)!;
    const rect = scheme.tileXYToRectangle(1, 0, 0);
    // Mid-Atlantic — far outside the box.
    const h = data.interpolateHeight(rect, CesiumMath.toRadians(20), CesiumMath.toRadians(10));
    expect(h).toBeCloseTo(GEOID, 5);
  });

  // ⚠️ Without a cap Cesium subdivides far past the ~16 m posting the data actually has, building
  // thousands of tiles that carry nothing the parent did not. Refusing them makes it upsample.
  it('stops offering tiles past the resolution the data has', () => {
    const p = new BakedTerrainProvider(flatGrid(0), GEOID, 'test');
    expect(p.getTileDataAvailable(0, 0, 14)).toBe(true);
    expect(p.getTileDataAvailable(0, 0, 15)).toBe(false);
    expect(p.requestTileGeometry(0, 0, 15)).toBeUndefined();
  });

  it('halves the geometric error each level', () => {
    const p = new BakedTerrainProvider(flatGrid(0), GEOID, 'test');
    expect(p.getLevelMaximumGeometricError(1)).toBeCloseTo(
      p.getLevelMaximumGeometricError(0) / 2,
      6,
    );
  });
});

describe('imagery modes', () => {
  it('marks exactly one mode as needing the ion token', () => {
    expect(IMAGERY_MODES.filter((m) => m.needsIonToken).map((m) => m.id)).toEqual(['ion']);
  });

  it('offers both keyless modes', () => {
    const keyless = IMAGERY_MODES.filter((m) => !m.needsIonToken).map((m) => m.id);
    expect(keyless).toContain('osm');
    expect(keyless).toContain('nsw');
  });

  it('falls back rather than returning undefined for an unknown mode', () => {
    expect(modeInfo('nope' as never).id).toBe(IMAGERY_MODES[0].id);
  });

  // ⚠️ Both keyless modes draw the baked OpenStreetMap buildings and trees, which are ODbL. A mode
  // added later without a visible credit would breach share-alike silently, so this is a licence
  // guard, not a copy check. Photoreal is exempt: Cesium renders Google's and ion's own logos.
  it('gives every keyless mode a visible credit naming OpenStreetMap', () => {
    const keyless = IMAGERY_MODES.filter((m) => !m.needsIonToken);
    expect(keyless.length).toBeGreaterThan(0);
    for (const m of keyless) {
      expect(m.attribution, `${m.id} has no attribution`).toBeTruthy();
      expect(m.attribution).toMatch(/OpenStreetMap/);
      expect(m.attribution).toMatch(/ODbL/);
    }
  });

  it('leaves photoreal attribution to Cesium', () => {
    expect(IMAGERY_MODES.find((m) => m.id === 'ion')?.attribution).toBeNull();
  });
});
