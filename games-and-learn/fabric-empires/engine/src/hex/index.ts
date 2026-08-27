/**
 * Axial hex coordinates for a pointy-top layout.
 *
 * Axial (q, r) maps to cube (x, y, z) as x = q, z = r, y = -x - z, which is why
 * every cube value in here is derived rather than stored. Storing two numbers
 * instead of three keeps save files smaller and makes map keys trivial.
 *
 * This module is pure: no rendering, no game state, no randomness.
 */

export interface Hex {
  readonly q: number;
  readonly r: number;
}

export interface Cube {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Collapse negative zero to positive zero.
 *
 * Math.round(-0.2) is -0, and -0 stringifies to "-0", so a hex could otherwise
 * key as "0,-0" and never match the identical hex keyed as "0,0". That is a
 * silent duplicate cell in every Map in the engine, so every Hex constructor
 * in this file goes through here.
 */
function nz(value: number): number {
  return value === 0 ? 0 : value;
}

export function hex(q: number, r: number): Hex {
  return { q: nz(q), r: nz(r) };
}

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

/** Stable string key for maps and sets. */
export function hexKey(h: Hex): string {
  return `${h.q},${h.r}`;
}

export function hexFromKey(key: string): Hex {
  const comma = key.indexOf(',');
  if (comma < 0) throw new Error(`Malformed hex key: ${key}`);
  const q = Number(key.slice(0, comma));
  const r = Number(key.slice(comma + 1));
  if (!Number.isFinite(q) || !Number.isFinite(r)) {
    throw new Error(`Malformed hex key: ${key}`);
  }
  return hex(q, r);
}

export function toCube(h: Hex): Cube {
  return { x: h.q, y: -h.q - h.r, z: h.r };
}

export function fromCube(c: Cube): Hex {
  return hex(c.x, c.z);
}

/**
 * The six neighbour directions, in clockwise order starting from east.
 * Index order is part of the contract: map generation and unit facing both
 * rely on direction 0 being east and the sequence being clockwise.
 */
export const HEX_DIRECTIONS: readonly Hex[] = Object.freeze([
  { q: 1, r: 0 }, // east
  { q: 1, r: -1 }, // north-east
  { q: 0, r: -1 }, // north-west
  { q: -1, r: 0 }, // west
  { q: -1, r: 1 }, // south-west
  { q: 0, r: 1 }, // south-east
]);

export function hexAdd(a: Hex, b: Hex): Hex {
  return hex(a.q + b.q, a.r + b.r);
}

export function hexSubtract(a: Hex, b: Hex): Hex {
  return hex(a.q - b.q, a.r - b.r);
}

export function hexScale(h: Hex, factor: number): Hex {
  return hex(h.q * factor, h.r * factor);
}

export function hexNeighbour(h: Hex, direction: number): Hex {
  const d = HEX_DIRECTIONS[((direction % 6) + 6) % 6];
  // The modulo above guarantees an in-range index, so d is always defined.
  return hexAdd(h, d!);
}

export function hexNeighbours(h: Hex): Hex[] {
  return HEX_DIRECTIONS.map((d) => hexAdd(h, d));
}

/** Number of steps between two hexes, ignoring terrain. */
export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

/** The hexes at exactly `radius` steps from `centre`, clockwise. */
export function hexRing(centre: Hex, radius: number): Hex[] {
  if (radius < 0) throw new Error(`hexRing radius must be >= 0, got ${radius}`);
  if (radius === 0) return [hex(centre.q, centre.r)];

  const results: Hex[] = [];
  // Start due west of centre, then walk each of the six sides.
  let current = hexAdd(centre, hexScale(HEX_DIRECTIONS[4]!, radius));
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      results.push(current);
      current = hexNeighbour(current, side);
    }
  }
  return results;
}

/** Every hex within `radius` steps of `centre`, centre first, ring by ring. */
export function hexSpiral(centre: Hex, radius: number): Hex[] {
  if (radius < 0) throw new Error(`hexSpiral radius must be >= 0, got ${radius}`);
  const results: Hex[] = [hex(centre.q, centre.r)];
  for (let ring = 1; ring <= radius; ring++) {
    results.push(...hexRing(centre, ring));
  }
  return results;
}

function cubeRound(x: number, y: number, z: number): Cube {
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);

  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);

  // Reset whichever component moved furthest, so x + y + z stays 0.
  if (dx > dy && dx > dz) {
    rx = -ry - rz;
  } else if (dy > dz) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }

  return { x: rx, y: ry, z: rz };
}

/** Snap fractional axial coordinates to the nearest whole hex. */
export function hexRound(q: number, r: number): Hex {
  return fromCube(cubeRound(q, -q - r, r));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** The straight line of hexes from `a` to `b` inclusive. */
export function hexLine(a: Hex, b: Hex): Hex[] {
  const n = hexDistance(a, b);
  if (n === 0) return [hex(a.q, a.r)];

  const ac = toCube(a);
  const bc = toCube(b);
  const results: Hex[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // Nudge off exact edge midpoints so the line never sits ambiguously
    // between two hexes and round in an unstable direction.
    const c = cubeRound(
      lerp(ac.x + 1e-6, bc.x + 1e-6, t),
      lerp(ac.y + 1e-6, bc.y + 1e-6, t),
      lerp(ac.z - 2e-6, bc.z - 2e-6, t),
    );
    results.push(fromCube(c));
  }
  return results;
}

const SQRT3 = Math.sqrt(3);

/**
 * Centre point of a hex in screen space, pointy-top.
 * `size` is the distance from the centre to any corner.
 */
export function hexToPixel(h: Hex, size: number): Point {
  return {
    x: size * (SQRT3 * h.q + (SQRT3 / 2) * h.r),
    y: size * (1.5 * h.r),
  };
}

/** Inverse of hexToPixel. Used for mouse picking, so it must be exact. */
export function pixelToHex(p: Point, size: number): Hex {
  const q = ((SQRT3 / 3) * p.x - (1 / 3) * p.y) / size;
  const r = ((2 / 3) * p.y) / size;
  return hexRound(q, r);
}

/** The six corners of a hex in screen space, clockwise from the top. */
export function hexCorners(h: Hex, size: number): Point[] {
  const centre = hexToPixel(h, size);
  const corners: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 90);
    corners.push({
      x: centre.x + size * Math.cos(angle),
      y: centre.y + size * Math.sin(angle),
    });
  }
  return corners;
}
