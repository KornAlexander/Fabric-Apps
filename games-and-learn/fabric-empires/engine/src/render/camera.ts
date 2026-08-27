/**
 * Camera for the hex map.
 *
 * Pure maths, no canvas and no DOM, so it can be unit tested and so the engine
 * stays renderer-agnostic (D35). The app layer owns pixels; this owns the
 * transform between world space, screen space and hexes.
 *
 * World space is the unzoomed pixel layout produced by hexToPixel at
 * BASE_HEX_SIZE. Screen space is what the player sees after pan and zoom.
 */

import {
  hexRing,
  hexToPixel,
  pixelToHex,
  type Hex,
  type Point,
} from '../hex/index.js';

/** Hex size at zoom 1. Everything scales from here. */
export const BASE_HEX_SIZE = 48;

/**
 * Discrete zoom levels.
 *
 * The plan specified 0.5x to 2.0x, which was written before the map had a
 * size. A radius-25 map is about 4160 by 3600 world pixels, so at 0.5x it
 * still needs a 2078 pixel viewport: the player could never see their own
 * continent. The floor is now 0.2x, which puts the whole map inside 1280x800,
 * and that overview is what makes it a strategy game rather than a scrolling
 * window.
 */
export const ZOOM_LEVELS: readonly number[] = Object.freeze([
  0.2, 0.3, 0.45, 0.7, 1.0, 1.4, 2.0,
]);

export const DEFAULT_ZOOM_INDEX = 1; // 0.3, most of the continent in view

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface Camera {
  /** World-space point at the centre of the viewport. */
  readonly centre: Point;
  readonly zoom: number;
  readonly viewport: Viewport;
}

export interface WorldBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

export function createCamera(
  viewport: Viewport,
  centre: Point = { x: 0, y: 0 },
  zoomIndex: number = DEFAULT_ZOOM_INDEX,
): Camera {
  const clampedIndex = Math.min(
    Math.max(zoomIndex, 0),
    ZOOM_LEVELS.length - 1,
  );
  return {
    centre,
    zoom: ZOOM_LEVELS[clampedIndex]!,
    viewport,
  };
}

export function worldToScreen(camera: Camera, world: Point): Point {
  return {
    x: (world.x - camera.centre.x) * camera.zoom + camera.viewport.width / 2,
    y: (world.y - camera.centre.y) * camera.zoom + camera.viewport.height / 2,
  };
}

export function screenToWorld(camera: Camera, screen: Point): Point {
  return {
    x: (screen.x - camera.viewport.width / 2) / camera.zoom + camera.centre.x,
    y: (screen.y - camera.viewport.height / 2) / camera.zoom + camera.centre.y,
  };
}

/** Screen position of a hex centre. */
export function hexToScreen(camera: Camera, h: Hex): Point {
  return worldToScreen(camera, hexToPixel(h, BASE_HEX_SIZE));
}

/**
 * The hex under a screen point.
 *
 * This is the whole of mouse picking: no hit-test loop over tiles, because the
 * hex grid is invertible. Selection stays O(1) no matter how big the map gets.
 */
export function hexAtScreen(camera: Camera, screen: Point): Hex {
  return pixelToHex(screenToWorld(camera, screen), BASE_HEX_SIZE);
}

/** Pan by a screen-space delta, which is what a mouse drag produces. */
export function panByScreen(camera: Camera, dx: number, dy: number): Camera {
  return {
    ...camera,
    centre: {
      x: camera.centre.x - dx / camera.zoom,
      y: camera.centre.y - dy / camera.zoom,
    },
  };
}

export function panByWorld(camera: Camera, dx: number, dy: number): Camera {
  return {
    ...camera,
    centre: { x: camera.centre.x + dx, y: camera.centre.y + dy },
  };
}

export function zoomIndexOf(camera: Camera): number {
  const index = ZOOM_LEVELS.indexOf(camera.zoom);
  if (index >= 0) return index;
  // Tolerate a camera restored from a save written under different levels.
  let best = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ZOOM_LEVELS.length; i++) {
    const delta = Math.abs(ZOOM_LEVELS[i]! - camera.zoom);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  return best;
}

/**
 * Step the zoom, keeping the world point under `anchor` pinned to that screen
 * position.
 *
 * Without the anchor, zooming always pulls towards the viewport centre and the
 * thing the player is pointing at slides away, which feels broken even though
 * nothing is technically wrong.
 */
export function zoomAt(camera: Camera, steps: number, anchor?: Point): Camera {
  const currentIndex = zoomIndexOf(camera);
  const nextIndex = Math.min(
    Math.max(currentIndex + steps, 0),
    ZOOM_LEVELS.length - 1,
  );
  const nextZoom = ZOOM_LEVELS[nextIndex]!;
  if (nextZoom === camera.zoom) return camera;

  const anchorPoint = anchor ?? {
    x: camera.viewport.width / 2,
    y: camera.viewport.height / 2,
  };
  const worldAnchor = screenToWorld(camera, anchorPoint);

  return {
    ...camera,
    zoom: nextZoom,
    centre: {
      x: worldAnchor.x - (anchorPoint.x - camera.viewport.width / 2) / nextZoom,
      y: worldAnchor.y - (anchorPoint.y - camera.viewport.height / 2) / nextZoom,
    },
  };
}

export function resize(camera: Camera, viewport: Viewport): Camera {
  return { ...camera, viewport };
}

/** World-space extent of a hex map of the given radius. */
export function worldBounds(radius: number): WorldBounds {
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  // The rim contains every extreme, so there is no need to walk the interior.
  for (const h of hexRing({ q: 0, r: 0 }, radius)) {
    const p = hexToPixel(h, BASE_HEX_SIZE);
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Keep the map on screen.
 *
 * When the map is smaller than the viewport on an axis it is centred on that
 * axis, rather than being allowed to drift, because a map that can be shoved
 * into a corner looks like a bug.
 */
export function clampToBounds(camera: Camera, bounds: WorldBounds): Camera {
  const halfW = camera.viewport.width / 2 / camera.zoom;
  const halfH = camera.viewport.height / 2 / camera.zoom;

  const worldWidth = bounds.maxX - bounds.minX;
  const worldHeight = bounds.maxY - bounds.minY;

  let x: number;
  if (worldWidth <= halfW * 2) {
    x = (bounds.minX + bounds.maxX) / 2;
  } else {
    x = Math.min(Math.max(camera.centre.x, bounds.minX + halfW), bounds.maxX - halfW);
  }

  let y: number;
  if (worldHeight <= halfH * 2) {
    y = (bounds.minY + bounds.maxY) / 2;
  } else {
    y = Math.min(Math.max(camera.centre.y, bounds.minY + halfH), bounds.maxY - halfH);
  }

  return { ...camera, centre: { x, y } };
}

/**
 * Every hex that could be visible, as an axial bounding box.
 *
 * Screen space to axial space is affine, so the image of the viewport
 * rectangle is a parallelogram and its axial bounding box is exactly the
 * min and max over the four screen corners. One padding ring covers hexes
 * whose centre is off screen but whose body is not.
 */
export function visibleHexRange(camera: Camera): {
  minQ: number;
  maxQ: number;
  minR: number;
  maxR: number;
} {
  const corners: Point[] = [
    { x: 0, y: 0 },
    { x: camera.viewport.width, y: 0 },
    { x: 0, y: camera.viewport.height },
    { x: camera.viewport.width, y: camera.viewport.height },
  ].map((c) => screenToWorld(camera, c));

  let minQ = Number.POSITIVE_INFINITY;
  let maxQ = Number.NEGATIVE_INFINITY;
  let minR = Number.POSITIVE_INFINITY;
  let maxR = Number.NEGATIVE_INFINITY;

  for (const world of corners) {
    const h = pixelToHex(world, BASE_HEX_SIZE);
    if (h.q < minQ) minQ = h.q;
    if (h.q > maxQ) maxQ = h.q;
    if (h.r < minR) minR = h.r;
    if (h.r > maxR) maxR = h.r;
  }

  const PAD = 2;
  return {
    minQ: minQ - PAD,
    maxQ: maxQ + PAD,
    minR: minR - PAD,
    maxR: maxR + PAD,
  };
}

/**
 * Visible hexes, filtered against a tile lookup so the caller never has to
 * think about the difference between the bounding box and the real map.
 */
export function visibleHexes(
  camera: Camera,
  has: (h: Hex) => boolean,
): Hex[] {
  const range = visibleHexRange(camera);
  const out: Hex[] = [];
  for (let r = range.minR; r <= range.maxR; r++) {
    for (let q = range.minQ; q <= range.maxQ; q++) {
      const h = { q, r };
      if (has(h)) out.push(h);
    }
  }
  return out;
}

/** Centre the camera on a hex, without changing zoom. */
export function centreOn(camera: Camera, h: Hex): Camera {
  return { ...camera, centre: hexToPixel(h, BASE_HEX_SIZE) };
}
