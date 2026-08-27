/**
 * Hex geometry shared by renderers.
 *
 * Pure, and therefore testable. The direction-to-edge mapping in particular is
 * exactly the kind of off-by-one that looks almost right on screen and is
 * miserable to debug by eye, so it is derived once here and asserted in tests.
 */

import { HEX_DIRECTIONS, type Point } from '../hex/index.js';

export const HEX_CORNERS = 6;

/**
 * Offset of corner `i` from a hex centre, pointy-top.
 * Corner 0 is the top vertex; corners run clockwise on screen, where y grows
 * downwards.
 */
export function hexCornerOffset(i: number, size: number): Point {
  const angle = (Math.PI / 180) * (60 * i - 90);
  return { x: size * Math.cos(angle), y: size * Math.sin(angle) };
}

/**
 * The edge shared with each neighbour, as the index of its first corner.
 *
 * Edge `e` runs from corner `e` to corner `e + 1`, and its midpoint lies at
 * angle `60e - 60`. Matching those angles against HEX_DIRECTIONS
 * (east, north-east, north-west, west, south-west, south-east) gives:
 *
 *   direction 0 east        ->  0 degrees   -> edge 1
 *   direction 1 north-east  -> -60 degrees  -> edge 0
 *   direction 2 north-west  -> 240 degrees  -> edge 5
 *   direction 3 west        -> 180 degrees  -> edge 4
 *   direction 4 south-west  -> 120 degrees  -> edge 3
 *   direction 5 south-east  ->  60 degrees  -> edge 2
 */
export const DIRECTION_EDGE: readonly number[] = Object.freeze([1, 0, 5, 4, 3, 2]);

/** The two corner indices bounding the edge facing `direction`. */
export function edgeCornerIndices(direction: number): [number, number] {
  const wrapped = ((direction % HEX_CORNERS) + HEX_CORNERS) % HEX_CORNERS;
  const first = DIRECTION_EDGE[wrapped]!;
  return [first, (first + 1) % HEX_CORNERS];
}

/** Sanity guard: the mapping must be a permutation of the six edges. */
export function directionEdgeIsPermutation(): boolean {
  return (
    new Set(DIRECTION_EDGE).size === HEX_CORNERS &&
    DIRECTION_EDGE.length === HEX_DIRECTIONS.length
  );
}
