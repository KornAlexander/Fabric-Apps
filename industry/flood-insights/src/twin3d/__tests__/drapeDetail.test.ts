import { describe, expect, it } from 'vitest';

import {
  MIN_WINDOW_COVER,
  SHARPNESS_HEADROOM,
  TIER_HYSTERESIS,
  chooseDetailTile,
  detailKey,
  groundFocusPoint,
  screenMetresPerPixel,
  tierForScreen,
  type DetailTileMeta,
  type DrapeDetailManifest,
} from '../drapeDetail';

/**
 * The detail-tile choice is the part of photorealistic rendering that can be wrong invisibly.
 *
 * A mis-registered photograph announces itself — roofs land beside their buildings. Choosing the
 * WRONG village's tile does not: it is still a sharp aerial photograph of a village in the Ahr
 * valley, blended under a feathered edge, at exactly the resolution it claims. Nor does choosing
 * no tile at all, or a needlessly fine one — the first looks like the feature is switched off and
 * the second is four megabytes nobody can see. So the decision is pure, and tested here.
 */

/** The Ahr's own figure: one texture over a 23.6 km box, at WebGL2's guaranteed 8192 px side. */
const BASE_MPP = 2.878;

const TIERS = [
  { id: 'near', spanM: 1024, px: 4096, metresPerPixel: 0.25 },
  { id: 'mid', spanM: 2048, px: 4096, metresPerPixel: 0.5 },
];

function tile(u0: number, v0: number, u1: number, v1: number): DetailTileMeta {
  return {
    file: `${u0}_${v0}.jpg`,
    px: 4096,
    spanM: 1024,
    metresPerPixel: 0.25,
    bytes: 3_500_000,
    renderGamma: 0.8,
    meanGroundLuma: 0.39,
    rect: { u0, v0, u1, v1 },
    centre: { easting: 0, northing: 0 },
  };
}

const MANIFEST: DrapeDetailManifest = {
  alignedTo: 'heightmap_4m.json',
  crs: 'EPSG:25832',
  tiers: TIERS,
  source: 'https://example.invalid/wms',
  layer: 'rp_dop20',
  licence: 'dl-de/by-2-0',
  attribution: 'GeoBasis-DE / LVermGeoRP',
  acquisitionNote: 'aktuell, nicht 2021',
  places: [
    {
      id: 'altenahr',
      name: 'Altenahr',
      tiles: { near: tile(0.1, 0.4, 0.2, 0.6), mid: tile(0.05, 0.3, 0.25, 0.7) },
    },
    {
      id: 'dernau',
      name: 'Dernau',
      // Overlaps Altenahr's mid window on purpose: between two villages something has to break the
      // tie, and it has to be the one the camera is nearer the middle of.
      tiles: { near: tile(0.22, 0.4, 0.32, 0.6), mid: tile(0.17, 0.3, 0.37, 0.7) },
    },
  ],
};

/** A screen fine enough to demand `mpp` from a texture, once the headroom is taken out. */
const demanding = (mpp: number) => mpp * SHARPNESS_HEADROOM;
/** Wide enough that both windows clear the coverage rule, unless a test says otherwise. */
const view = (screenMpp: number, viewWidthM = 500) => ({ screenMpp, baseMpp: BASE_MPP, viewWidthM });

describe('screenMetresPerPixel', () => {
  it('is the ground a drawing-buffer pixel covers, and shrinks with range', () => {
    // 42° vertical field of view, 800 rows, 3400 m away — the twin's opening framing.
    const far = screenMetresPerPixel(3400, 42, 800);
    expect(far).toBeCloseTo((2 * 3400 * Math.tan((42 * Math.PI) / 360)) / 800, 6);
    expect(screenMetresPerPixel(850, 42, 800)).toBeCloseTo(far / 4, 6);
  });

  it('halves on a retina drawing buffer, which is why CSS pixels are the wrong unit', () => {
    expect(screenMetresPerPixel(1000, 42, 1600)).toBeCloseTo(
      screenMetresPerPixel(1000, 42, 800) / 2,
      6
    );
  });

  it('refuses to divide by a canvas that has not been sized yet', () => {
    expect(screenMetresPerPixel(1000, 42, 0)).toBe(Infinity);
  });
});

describe('tierForScreen', () => {
  it('asks for nothing once the base photograph out-resolves the screen', () => {
    // The crossover is a measurement, not a preference: with 800 rows and a 42° field of view the
    // base drape stops being the limiting factor somewhere around 4.5 km, so beyond that a 4 MB
    // window changes nothing anyone can see.
    expect(tierForScreen(TIERS, screenMetresPerPixel(6000, 42, 800), BASE_MPP, null)).toBeNull();
    expect(tierForScreen(TIERS, screenMetresPerPixel(3400, 42, 800), BASE_MPP, null)?.id).toBe(
      'mid'
    );
  });

  it('scales that crossover with the viewport, which a distance table could not', () => {
    // Same camera, twice the rows: the screen now resolves twice as much and the window earns its
    // download where a moment ago it did not. This is why the rule is stated in metres per pixel.
    expect(tierForScreen(TIERS, screenMetresPerPixel(6000, 42, 800), BASE_MPP, null)).toBeNull();
    expect(tierForScreen(TIERS, screenMetresPerPixel(6000, 42, 1600), BASE_MPP, null)?.id).toBe(
      'mid'
    );
  });

  it('takes the COARSEST window that still resolves the screen, not the finest', () => {
    // Once the base is no longer enough, a 0.5 m/px window is as good to look at as a 0.25 m/px
    // one and half the download. "Best available" would be four megabytes of nothing.
    expect(tierForScreen(TIERS, demanding(1.2), BASE_MPP, null)?.id).toBe('mid');
  });

  it('goes to the finest window only when the screen out-resolves the coarser one', () => {
    expect(tierForScreen(TIERS, demanding(0.3), BASE_MPP, null)?.id).toBe('near');
  });

  it('holds a loaded tier through a dead band around the boundary', () => {
    // Just past the point where mid would win from cold...
    expect(tierForScreen(TIERS, demanding(0.52), BASE_MPP, null)?.id).toBe('mid');
    // ...but re-downloading megabytes because the wheel moved once is worse than a finer tile.
    expect(tierForScreen(TIERS, demanding(0.52), BASE_MPP, 'near')?.id).toBe('near');
    // The band is finite, and it works in both directions.
    expect(tierForScreen(TIERS, demanding(0.7), BASE_MPP, 'near')?.id).toBe('mid');
    expect(tierForScreen(TIERS, demanding(0.45), BASE_MPP, 'mid')?.id).toBe('mid');
    expect(tierForScreen(TIERS, demanding(0.3), BASE_MPP, 'mid')?.id).toBe('near');
  });

  it('keeps a resident tile a little past the point the base drape catches up', () => {
    const screen = demanding(BASE_MPP) * 1.1;
    expect(tierForScreen(TIERS, screen, BASE_MPP, null)).toBeNull();
    expect(tierForScreen(TIERS, screen, BASE_MPP, 'mid')?.id).toBe('mid');
    expect(
      tierForScreen(TIERS, demanding(BASE_MPP) * TIER_HYSTERESIS * 1.05, BASE_MPP, 'mid')
    ).toBeNull();
  });

  it('treats a missing base resolution as "never enough" rather than as a number', () => {
    expect(tierForScreen(TIERS, 10, Infinity, null)?.id).toBe('mid');
    expect(tierForScreen(TIERS, NaN, BASE_MPP, null)).toBeNull();
  });
});

describe('chooseDetailTile', () => {
  const CLOSE = view(demanding(0.3));
  const MEDIUM = view(demanding(1.2));

  it('picks the village the camera is looking at', () => {
    const choice = chooseDetailTile(MANIFEST, { u: 0.15, v: 0.5 }, CLOSE);
    expect(choice?.placeId).toBe('altenahr');
    expect(choice?.tier).toBe('near');
  });

  it('falls through to the wider window when the fine one does not reach', () => {
    // Close to the ground, but in the gap between the two near windows.
    expect(chooseDetailTile(MANIFEST, { u: 0.21, v: 0.5 }, CLOSE)?.tier).toBe('mid');
  });

  it('loads nothing when the view is outside every window', () => {
    expect(chooseDetailTile(MANIFEST, { u: 0.9, v: 0.5 }, CLOSE)).toBeNull();
  });

  it('breaks a tie on the nearer window centre, not on manifest order', () => {
    // Inside both mid windows. 0.30 is nearer Dernau's centre (0.27) than Altenahr's (0.15).
    expect(chooseDetailTile(MANIFEST, { u: 0.3, v: 0.5 }, MEDIUM)?.placeId).toBe('dernau');
    // ...and the same test on the other side picks the other village, so this is not a constant.
    expect(chooseDetailTile(MANIFEST, { u: 0.19, v: 0.5 }, MEDIUM)?.placeId).toBe('altenahr');
  });

  it('answers null rather than guessing for an AOI with no tiles, or a broken camera', () => {
    expect(chooseDetailTile(null, { u: 0.15, v: 0.5 }, CLOSE)).toBeNull();
    expect(chooseDetailTile(MANIFEST, { u: NaN, v: 0.5 }, CLOSE)).toBeNull();
    expect(chooseDetailTile(MANIFEST, { u: 0.15, v: 0.5 }, view(NaN))).toBeNull();
  });

  it('will not put a sharp patch in the middle of a wider view', () => {
    // A 1024 m window across a 2 km view is not an improvement, it is a rectangle with a visible
    // edge across the hillside. The near tier drops out first, then the mid one.
    const nearOnly = view(demanding(0.3), 1024 / MIN_WINDOW_COVER - 1);
    expect(chooseDetailTile(MANIFEST, { u: 0.15, v: 0.5 }, nearOnly)?.tier).toBe('near');

    const tooWideForNear = view(demanding(0.3), 1024 / MIN_WINDOW_COVER + 1);
    expect(chooseDetailTile(MANIFEST, { u: 0.15, v: 0.5 }, tooWideForNear)?.tier).toBe('mid');

    const tooWideForBoth = view(demanding(0.3), 2048 / MIN_WINDOW_COVER + 1);
    expect(chooseDetailTile(MANIFEST, { u: 0.15, v: 0.5 }, tooWideForBoth)).toBeNull();
  });

  it('names a choice by place AND tier, so zooming in counts as a different tile', () => {
    expect(detailKey(chooseDetailTile(MANIFEST, { u: 0.15, v: 0.5 }, CLOSE))).toBe('altenahr:near');
    expect(detailKey(chooseDetailTile(MANIFEST, { u: 0.15, v: 0.5 }, MEDIUM))).toBe('altenahr:mid');
    expect(detailKey(null)).toBeNull();
  });
});

describe('groundFocusPoint', () => {
  it('lands where the view meets the ground', () => {
    const hit = groundFocusPoint({ x: 0, y: 100, z: 0 }, { x: 0, y: -1, z: 0 }, 0, 20000);
    expect(hit.rangeM).toBeCloseTo(100, 6);
    expect(hit.x).toBeCloseTo(0, 6);
    expect(hit.z).toBeCloseTo(0, 6);
  });

  it('is the orbit distance when looking obliquely down, which is the orbit case', () => {
    const d = Math.SQRT1_2;
    const hit = groundFocusPoint({ x: 0, y: 100, z: 100 }, { x: 0, y: -d, z: -d }, 0, 20000);
    expect(hit.rangeM).toBeCloseTo(100 / d, 6);
    expect(hit.z).toBeCloseTo(0, 6);
  });

  it('clamps at the horizon instead of returning a point behind the camera', () => {
    // Looking level, and looking up. Neither meets the ground ahead; solving anyway gives a
    // negative or enormous t, which would put the view centre somewhere arbitrary and load that
    // village's photograph.
    for (const dy of [0, 0.5]) {
      const hit = groundFocusPoint({ x: 0, y: 100, z: 0 }, { x: 1, y: dy, z: 0 }, 0, 20000);
      expect(hit.rangeM).toBe(20000);
      expect(hit.x).toBe(20000);
    }
  });

  it('never reaches past its cap even on a nearly level view', () => {
    const hit = groundFocusPoint({ x: 0, y: 400, z: 0 }, { x: 1, y: -0.0005, z: 0 }, 0, 20000);
    expect(hit.rangeM).toBe(20000);
  });
});
