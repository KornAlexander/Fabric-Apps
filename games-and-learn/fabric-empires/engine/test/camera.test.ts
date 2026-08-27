import { describe, it, expect } from 'vitest';
import {
  BASE_HEX_SIZE,
  DEFAULT_ZOOM_INDEX,
  ZOOM_LEVELS,
  centreOn,
  clampToBounds,
  createCamera,
  hexAtScreen,
  hexToScreen,
  panByScreen,
  panByWorld,
  resize,
  screenToWorld,
  visibleHexRange,
  visibleHexes,
  worldBounds,
  worldToScreen,
  zoomAt,
  zoomIndexOf,
  type Camera,
} from '../src/render/index.js';
import { generateMap } from '../src/map/index.js';
import { hexKey, hexSpiral, hexToPixel, type Hex } from '../src/hex/index.js';
import { createRng } from '../src/rng/index.js';

const VIEWPORT = { width: 1280, height: 720 };

function cam(zoomIndex = DEFAULT_ZOOM_INDEX, centre = { x: 0, y: 0 }): Camera {
  return createCamera(VIEWPORT, centre, zoomIndex);
}

describe('construction', () => {
  it('starts at the default zoom', () => {
    expect(cam().zoom).toBe(ZOOM_LEVELS[DEFAULT_ZOOM_INDEX]);
  });

  it('clamps an out-of-range zoom index instead of producing NaN', () => {
    expect(createCamera(VIEWPORT, { x: 0, y: 0 }, -5).zoom).toBe(ZOOM_LEVELS[0]);
    expect(createCamera(VIEWPORT, { x: 0, y: 0 }, 99).zoom).toBe(
      ZOOM_LEVELS[ZOOM_LEVELS.length - 1],
    );
  });

  it('offers zoom levels that are sorted and span the intended range', () => {
    // The floor is deliberately below the plan's original 0.5x: see the note
    // on ZOOM_LEVELS. A radius-25 map does not fit on screen at 0.5x.
    expect(ZOOM_LEVELS[0]).toBe(0.2);
    expect(ZOOM_LEVELS[ZOOM_LEVELS.length - 1]).toBe(2);
    for (let i = 1; i < ZOOM_LEVELS.length; i++) {
      expect(ZOOM_LEVELS[i]!).toBeGreaterThan(ZOOM_LEVELS[i - 1]!);
    }
  });

  it('can fit a full-size map on a normal laptop viewport', () => {
    // The regression this guards: zooming all the way out must actually show
    // the continent, not a quarter of it.
    const bounds = worldBounds(25);
    const minZoom = ZOOM_LEVELS[0]!;
    expect((bounds.maxX - bounds.minX) * minZoom).toBeLessThanOrEqual(1280);
    expect((bounds.maxY - bounds.minY) * minZoom).toBeLessThanOrEqual(800);
  });
});

describe('transforms', () => {
  it('round trips world to screen and back at every zoom', () => {
    const rng = createRng('camera', 'points');
    for (let z = 0; z < ZOOM_LEVELS.length; z++) {
      const c = cam(z, { x: rng.float(-500, 500), y: rng.float(-500, 500) });
      for (let i = 0; i < 50; i++) {
        const world = { x: rng.float(-4000, 4000), y: rng.float(-4000, 4000) };
        const back = screenToWorld(c, worldToScreen(c, world));
        expect(back.x).toBeCloseTo(world.x, 6);
        expect(back.y).toBeCloseTo(world.y, 6);
      }
    }
  });

  it('puts the camera centre at the middle of the viewport', () => {
    const c = cam(3, { x: 137, y: -42 });
    const screen = worldToScreen(c, c.centre);
    expect(screen.x).toBeCloseTo(VIEWPORT.width / 2, 6);
    expect(screen.y).toBeCloseTo(VIEWPORT.height / 2, 6);
  });

  it('scales distances by the zoom factor', () => {
    for (let z = 0; z < ZOOM_LEVELS.length; z++) {
      const c = cam(z);
      const a = worldToScreen(c, { x: 0, y: 0 });
      const b = worldToScreen(c, { x: 100, y: 0 });
      expect(b.x - a.x).toBeCloseTo(100 * ZOOM_LEVELS[z]!, 6);
    }
  });
});

describe('picking', () => {
  it('resolves the hex under the centre of the screen', () => {
    for (const h of hexSpiral({ q: 0, r: 0 }, 4)) {
      const c = centreOn(cam(), h);
      expect(hexAtScreen(c, { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 })).toEqual(h);
    }
  });

  it('picking is the inverse of drawing, at every zoom', () => {
    // If these two ever disagree, clicks land on a different tile than the one
    // under the cursor, which is the single most infuriating map bug there is.
    const rng = createRng('camera', 'picking');
    for (let z = 0; z < ZOOM_LEVELS.length; z++) {
      const c = cam(z, { x: rng.float(-300, 300), y: rng.float(-300, 300) });
      for (const h of hexSpiral({ q: 0, r: 0 }, 3)) {
        expect(hexAtScreen(c, hexToScreen(c, h))).toEqual(h);
      }
    }
  });

  it('resolves points inside a hex, not just its exact centre', () => {
    const rng = createRng('camera', 'jitter');
    for (let z = 0; z < ZOOM_LEVELS.length; z++) {
      const c = cam(z);
      const zoomedSize = BASE_HEX_SIZE * ZOOM_LEVELS[z]!;
      for (const h of hexSpiral({ q: 0, r: 0 }, 2)) {
        const centre = hexToScreen(c, h);
        for (let i = 0; i < 8; i++) {
          const angle = rng.float(0, Math.PI * 2);
          const radius = rng.float(0, zoomedSize * 0.75);
          expect(
            hexAtScreen(c, {
              x: centre.x + Math.cos(angle) * radius,
              y: centre.y + Math.sin(angle) * radius,
            }),
          ).toEqual(h);
        }
      }
    }
  });
});

describe('panning', () => {
  it('moves the world under the cursor by the drag distance', () => {
    const c = cam(3);
    const before = worldToScreen(c, { x: 0, y: 0 });
    const after = worldToScreen(panByScreen(c, 100, -60), { x: 0, y: 0 });
    expect(after.x - before.x).toBeCloseTo(100, 6);
    expect(after.y - before.y).toBeCloseTo(-60, 6);
  });

  it('a screen pan is zoom-independent, so dragging feels the same at any zoom', () => {
    for (let z = 0; z < ZOOM_LEVELS.length; z++) {
      const c = cam(z);
      const before = worldToScreen(c, { x: 0, y: 0 });
      const after = worldToScreen(panByScreen(c, 50, 50), { x: 0, y: 0 });
      expect(after.x - before.x).toBeCloseTo(50, 6);
      expect(after.y - before.y).toBeCloseTo(50, 6);
    }
  });

  it('panning back and forth returns to the start', () => {
    const c = cam(4, { x: 12, y: 34 });
    const returned = panByScreen(panByScreen(c, 210, -75), -210, 75);
    expect(returned.centre.x).toBeCloseTo(c.centre.x, 6);
    expect(returned.centre.y).toBeCloseTo(c.centre.y, 6);
  });

  it('world panning moves the centre directly', () => {
    const c = panByWorld(cam(2, { x: 10, y: 10 }), 5, -5);
    expect(c.centre).toEqual({ x: 15, y: 5 });
  });
});

describe('zooming', () => {
  it('steps through the levels and stops at the ends', () => {
    let c = cam(0);
    expect(zoomIndexOf(c)).toBe(0);
    c = zoomAt(c, -1);
    expect(zoomIndexOf(c)).toBe(0); // already at minimum

    c = cam(ZOOM_LEVELS.length - 1);
    c = zoomAt(c, 1);
    expect(zoomIndexOf(c)).toBe(ZOOM_LEVELS.length - 1);
  });

  it('returns the same camera object when the zoom cannot change', () => {
    const c = cam(0);
    expect(zoomAt(c, -1)).toBe(c);
  });

  it('keeps the point under the cursor fixed', () => {
    // The property that makes wheel zoom feel right: whatever you point at
    // stays where it is, rather than sliding towards the viewport centre.
    const anchor = { x: 320, y: 180 };
    for (let z = 0; z < ZOOM_LEVELS.length - 1; z++) {
      const before = cam(z, { x: 250, y: -125 });
      const worldUnderAnchor = screenToWorld(before, anchor);
      const after = zoomAt(before, 1, anchor);
      const screenAfter = worldToScreen(after, worldUnderAnchor);
      expect(screenAfter.x).toBeCloseTo(anchor.x, 6);
      expect(screenAfter.y).toBeCloseTo(anchor.y, 6);
    }
  });

  it('zooming without an anchor keeps the viewport centre fixed', () => {
    const before = cam(2, { x: 99, y: -33 });
    const after = zoomAt(before, 1);
    expect(after.centre.x).toBeCloseTo(before.centre.x, 6);
    expect(after.centre.y).toBeCloseTo(before.centre.y, 6);
  });

  it('zoom in then out returns to the original view', () => {
    const anchor = { x: 900, y: 210 };
    const before = cam(2, { x: 40, y: 60 });
    const round = zoomAt(zoomAt(before, 1, anchor), -1, anchor);
    expect(round.zoom).toBe(before.zoom);
    expect(round.centre.x).toBeCloseTo(before.centre.x, 6);
    expect(round.centre.y).toBeCloseTo(before.centre.y, 6);
  });

  it('recovers the nearest level for a camera restored with an odd zoom', () => {
    const odd: Camera = { ...cam(), zoom: 0.9 };
    expect(ZOOM_LEVELS[zoomIndexOf(odd)]).toBe(1.0);
  });
});

describe('culling', () => {
  it('includes every hex whose centre is on screen', () => {
    const map = generateMap('CULL', { radius: 14 });
    const has = (h: Hex) => map.tiles.has(hexKey(h));

    for (let z = 0; z < ZOOM_LEVELS.length; z++) {
      const c = cam(z, { x: 120, y: -80 });
      const visible = new Set(visibleHexes(c, has).map(hexKey));

      for (const tile of map.tiles.values()) {
        const s = hexToScreen(c, tile.hex);
        const onScreen =
          s.x >= 0 && s.x <= VIEWPORT.width && s.y >= 0 && s.y <= VIEWPORT.height;
        if (onScreen) {
          expect(visible.has(hexKey(tile.hex))).toBe(true);
        }
      }
    }
  });

  it('includes hexes that are only partly on screen', () => {
    const map = generateMap('CULL', { radius: 14 });
    const has = (h: Hex) => map.tiles.has(hexKey(h));
    const c = cam(4);
    const visible = new Set(visibleHexes(c, has).map(hexKey));

    for (const tile of map.tiles.values()) {
      const s = hexToScreen(c, tile.hex);
      const margin = BASE_HEX_SIZE * c.zoom;
      const touching =
        s.x >= -margin &&
        s.x <= VIEWPORT.width + margin &&
        s.y >= -margin &&
        s.y <= VIEWPORT.height + margin;
      if (touching) {
        expect(visible.has(hexKey(tile.hex))).toBe(true);
      }
    }
  });

  it('actually culls: a zoomed-in view draws far fewer tiles than the map holds', () => {
    const map = generateMap('CULL');
    const has = (h: Hex) => map.tiles.has(hexKey(h));
    const zoomedIn = visibleHexes(cam(ZOOM_LEVELS.length - 1), has);
    expect(zoomedIn.length).toBeLessThan(map.tiles.size / 4);
    expect(zoomedIn.length).toBeGreaterThan(0);
  });

  it('never returns a hex that is not on the map', () => {
    const map = generateMap('CULL', { radius: 6 });
    const has = (h: Hex) => map.tiles.has(hexKey(h));
    // A camera pointed well past the edge of a small map.
    const c = cam(0, { x: 5000, y: 5000 });
    expect(visibleHexes(c, has)).toEqual([]);
  });

  it('produces a range that widens as the camera zooms out', () => {
    const wide = visibleHexRange(cam(0));
    const tight = visibleHexRange(cam(ZOOM_LEVELS.length - 1));
    expect(wide.maxQ - wide.minQ).toBeGreaterThan(tight.maxQ - tight.minQ);
    expect(wide.maxR - wide.minR).toBeGreaterThan(tight.maxR - tight.minR);
  });
});

describe('bounds', () => {
  it('covers the whole map', () => {
    const radius = 20;
    const bounds = worldBounds(radius);
    for (const h of hexSpiral({ q: 0, r: 0 }, radius)) {
      const p = hexToPixel(h, BASE_HEX_SIZE);
      expect(p.x).toBeGreaterThanOrEqual(bounds.minX);
      expect(p.x).toBeLessThanOrEqual(bounds.maxX);
      expect(p.y).toBeGreaterThanOrEqual(bounds.minY);
      expect(p.y).toBeLessThanOrEqual(bounds.maxY);
    }
  });

  it('is symmetric about the origin', () => {
    const b = worldBounds(12);
    expect(b.minX).toBeCloseTo(-b.maxX, 6);
    expect(b.minY).toBeCloseTo(-b.maxY, 6);
  });

  it('stops the player panning the map off screen', () => {
    const bounds = worldBounds(25);
    const runaway = cam(ZOOM_LEVELS.length - 1, { x: 99999, y: -99999 });
    const clamped = clampToBounds(runaway, bounds);
    expect(clamped.centre.x).toBeLessThanOrEqual(bounds.maxX);
    expect(clamped.centre.x).toBeGreaterThanOrEqual(bounds.minX);
    expect(clamped.centre.y).toBeLessThanOrEqual(bounds.maxY);
    expect(clamped.centre.y).toBeGreaterThanOrEqual(bounds.minY);
  });

  it('leaves a camera already inside the bounds untouched', () => {
    const bounds = worldBounds(25);
    const inside = cam(ZOOM_LEVELS.length - 1, { x: 10, y: 10 });
    expect(clampToBounds(inside, bounds).centre).toEqual(inside.centre);
  });

  it('centres a map smaller than the viewport instead of letting it drift', () => {
    const bounds = worldBounds(2); // tiny map, viewport is far larger
    const shoved = cam(0, { x: 4000, y: 4000 });
    const clamped = clampToBounds(shoved, bounds);
    expect(clamped.centre.x).toBeCloseTo((bounds.minX + bounds.maxX) / 2, 6);
    expect(clamped.centre.y).toBeCloseTo((bounds.minY + bounds.maxY) / 2, 6);
  });
});

describe('viewport changes', () => {
  it('resizing keeps the centred world point centred', () => {
    const c = cam(3, { x: 77, y: 88 });
    const resized = resize(c, { width: 640, height: 480 });
    const screen = worldToScreen(resized, resized.centre);
    expect(screen.x).toBeCloseTo(320, 6);
    expect(screen.y).toBeCloseTo(240, 6);
  });

  it('centreOn puts the requested hex in the middle', () => {
    const target = { q: 7, r: -3 };
    const c = centreOn(cam(4), target);
    expect(hexAtScreen(c, { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 })).toEqual(
      target,
    );
  });
});
