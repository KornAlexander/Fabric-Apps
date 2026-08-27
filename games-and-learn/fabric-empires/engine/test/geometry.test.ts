import { describe, it, expect } from 'vitest';
import {
  DIRECTION_EDGE,
  HEX_CORNERS,
  directionEdgeIsPermutation,
  edgeCornerIndices,
  hexCornerOffset,
} from '../src/render/geometry.js';
import {
  HEX_DIRECTIONS,
  hexAdd,
  hexToPixel,
  type Hex,
} from '../src/hex/index.js';

const SIZE = 48;

describe('corners', () => {
  it('all sit at the hex size from the centre', () => {
    for (let i = 0; i < HEX_CORNERS; i++) {
      const c = hexCornerOffset(i, SIZE);
      expect(Math.hypot(c.x, c.y)).toBeCloseTo(SIZE, 9);
    }
  });

  it('are evenly spaced and start at the top vertex', () => {
    const top = hexCornerOffset(0, SIZE);
    expect(top.x).toBeCloseTo(0, 9);
    expect(top.y).toBeCloseTo(-SIZE, 9);

    for (let i = 0; i < HEX_CORNERS; i++) {
      const a = hexCornerOffset(i, SIZE);
      const b = hexCornerOffset((i + 1) % HEX_CORNERS, SIZE);
      // Every side of a regular hexagon equals its circumradius.
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(SIZE, 9);
    }
  });
});

describe('direction to edge mapping', () => {
  it('is a permutation of the six edges', () => {
    expect(directionEdgeIsPermutation()).toBe(true);
    expect(new Set(DIRECTION_EDGE).size).toBe(HEX_CORNERS);
  });

  /*
   * The load-bearing property: the edge assigned to a direction must be the
   * edge actually shared with that neighbour. If this is off by one, coastlines
   * and borders are drawn on the wrong side of every tile, which looks subtly
   * wrong everywhere and is very hard to diagnose from a screenshot.
   */
  it('puts each edge midpoint exactly halfway to that neighbour', () => {
    const centre: Hex = { q: 0, r: 0 };
    const centrePixel = hexToPixel(centre, SIZE);

    for (let d = 0; d < HEX_DIRECTIONS.length; d++) {
      const neighbour = hexAdd(centre, HEX_DIRECTIONS[d]!);
      const neighbourPixel = hexToPixel(neighbour, SIZE);

      const [i, j] = edgeCornerIndices(d);
      const a = hexCornerOffset(i, SIZE);
      const b = hexCornerOffset(j, SIZE);
      const midpoint = {
        x: centrePixel.x + (a.x + b.x) / 2,
        y: centrePixel.y + (a.y + b.y) / 2,
      };

      const expected = {
        x: (centrePixel.x + neighbourPixel.x) / 2,
        y: (centrePixel.y + neighbourPixel.y) / 2,
      };

      expect(midpoint.x).toBeCloseTo(expected.x, 9);
      expect(midpoint.y).toBeCloseTo(expected.y, 9);
    }
  });

  it('no direction shares an edge with a different direction', () => {
    const used = new Set<number>();
    for (let d = 0; d < HEX_DIRECTIONS.length; d++) {
      const [first] = edgeCornerIndices(d);
      expect(used.has(first)).toBe(false);
      used.add(first);
    }
  });

  it('wraps direction indices like hexNeighbour does', () => {
    expect(edgeCornerIndices(6)).toEqual(edgeCornerIndices(0));
    expect(edgeCornerIndices(-1)).toEqual(edgeCornerIndices(5));
  });
});
