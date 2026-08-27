import { describe, it, expect } from 'vitest';
import {
  HEX_DIRECTIONS,
  hex,
  hexAdd,
  hexCorners,
  hexDistance,
  hexEquals,
  hexFromKey,
  hexKey,
  hexLine,
  hexNeighbour,
  hexNeighbours,
  hexRing,
  hexRound,
  hexSpiral,
  hexSubtract,
  hexToPixel,
  pixelToHex,
  toCube,
} from '../src/hex/index.js';
import { createRng } from '../src/rng/index.js';

/** A deterministic spread of hexes, including negatives and the origin. */
function sampleHexes(count = 400) {
  const rng = createRng('hex-test-sample', 'coords');
  const out = [hex(0, 0), hex(1, 0), hex(0, 1), hex(-1, 0), hex(0, -1)];
  for (let i = out.length; i < count; i++) {
    out.push(hex(rng.int(-60, 60), rng.int(-60, 60)));
  }
  return out;
}

describe('cube invariant', () => {
  it('x + y + z is always 0', () => {
    for (const h of sampleHexes()) {
      const c = toCube(h);
      expect(c.x + c.y + c.z).toBe(0);
    }
  });
});

describe('neighbours', () => {
  it('there are exactly six, all distinct', () => {
    for (const h of sampleHexes(60)) {
      const ns = hexNeighbours(h);
      expect(ns).toHaveLength(6);
      expect(new Set(ns.map(hexKey)).size).toBe(6);
    }
  });

  it('every neighbour is exactly one step away', () => {
    for (const h of sampleHexes(60)) {
      for (const n of hexNeighbours(h)) {
        expect(hexDistance(h, n)).toBe(1);
      }
    }
  });

  it('is symmetric: if b neighbours a, a neighbours b', () => {
    for (const h of sampleHexes(60)) {
      for (const n of hexNeighbours(h)) {
        expect(hexNeighbours(n).some((x) => hexEquals(x, h))).toBe(true);
      }
    }
  });

  it('opposite directions cancel out', () => {
    for (let d = 0; d < 6; d++) {
      const forward = HEX_DIRECTIONS[d]!;
      const back = HEX_DIRECTIONS[(d + 3) % 6]!;
      expect(hexAdd(forward, back)).toEqual(hex(0, 0));
    }
  });

  it('wraps direction indices in both directions', () => {
    const h = hex(3, -2);
    expect(hexNeighbour(h, 6)).toEqual(hexNeighbour(h, 0));
    expect(hexNeighbour(h, -1)).toEqual(hexNeighbour(h, 5));
  });
});

describe('distance', () => {
  it('is zero only for the same hex', () => {
    for (const h of sampleHexes(60)) {
      expect(hexDistance(h, h)).toBe(0);
    }
  });

  it('is symmetric', () => {
    const hexes = sampleHexes(60);
    for (const a of hexes) {
      for (const b of hexes.slice(0, 20)) {
        expect(hexDistance(a, b)).toBe(hexDistance(b, a));
      }
    }
  });

  it('is always a non-negative integer', () => {
    const hexes = sampleHexes(60);
    for (const a of hexes) {
      for (const b of hexes.slice(0, 20)) {
        const d = hexDistance(a, b);
        expect(Number.isInteger(d)).toBe(true);
        expect(d).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('obeys the triangle inequality', () => {
    const hexes = sampleHexes(30);
    for (const a of hexes) {
      for (const b of hexes) {
        for (const c of hexes.slice(0, 8)) {
          expect(hexDistance(a, c)).toBeLessThanOrEqual(
            hexDistance(a, b) + hexDistance(b, c),
          );
        }
      }
    }
  });

  it('translation does not change distance', () => {
    const offset = hex(7, -13);
    const hexes = sampleHexes(40);
    for (const a of hexes) {
      for (const b of hexes.slice(0, 10)) {
        expect(hexDistance(hexAdd(a, offset), hexAdd(b, offset))).toBe(
          hexDistance(a, b),
        );
      }
    }
  });
});

describe('rings', () => {
  it('radius 0 is just the centre', () => {
    expect(hexRing(hex(4, -1), 0)).toEqual([hex(4, -1)]);
  });

  it('has 6 * radius hexes', () => {
    for (let r = 1; r <= 8; r++) {
      expect(hexRing(hex(0, 0), r)).toHaveLength(6 * r);
    }
  });

  it('every hex sits at exactly the ring radius', () => {
    const centre = hex(-3, 5);
    for (let r = 1; r <= 6; r++) {
      for (const h of hexRing(centre, r)) {
        expect(hexDistance(centre, h)).toBe(r);
      }
    }
  });

  it('is a closed loop of adjacent hexes', () => {
    const ring = hexRing(hex(0, 0), 4);
    for (let i = 0; i < ring.length; i++) {
      const current = ring[i]!;
      const next = ring[(i + 1) % ring.length]!;
      expect(hexDistance(current, next)).toBe(1);
    }
  });

  it('contains no duplicates', () => {
    const ring = hexRing(hex(2, 2), 5);
    expect(new Set(ring.map(hexKey)).size).toBe(ring.length);
  });

  it('rejects a negative radius', () => {
    expect(() => hexRing(hex(0, 0), -1)).toThrow();
  });
});

describe('spiral', () => {
  it('has the centred hexagonal number of hexes', () => {
    for (let r = 0; r <= 8; r++) {
      // 1, 7, 19, 37, ...
      expect(hexSpiral(hex(0, 0), r)).toHaveLength(1 + 3 * r * (r + 1));
    }
  });

  it('starts at the centre and contains no duplicates', () => {
    const centre = hex(-2, 6);
    const spiral = hexSpiral(centre, 5);
    expect(spiral[0]).toEqual(centre);
    expect(new Set(spiral.map(hexKey)).size).toBe(spiral.length);
  });

  it('contains every hex within the radius and nothing beyond it', () => {
    const centre = hex(0, 0);
    const radius = 4;
    for (const h of hexSpiral(centre, radius)) {
      expect(hexDistance(centre, h)).toBeLessThanOrEqual(radius);
    }
  });
});

describe('lines', () => {
  it('a line to itself is a single hex', () => {
    expect(hexLine(hex(3, 3), hex(3, 3))).toEqual([hex(3, 3)]);
  });

  it('has distance + 1 hexes and the right endpoints', () => {
    const hexes = sampleHexes(40);
    for (const a of hexes) {
      for (const b of hexes.slice(0, 10)) {
        const line = hexLine(a, b);
        expect(line).toHaveLength(hexDistance(a, b) + 1);
        expect(line[0]).toEqual(a);
        expect(line[line.length - 1]).toEqual(b);
      }
    }
  });

  it('every consecutive pair is adjacent, so there are no gaps', () => {
    const hexes = sampleHexes(30);
    for (const a of hexes) {
      for (const b of hexes.slice(0, 8)) {
        const line = hexLine(a, b);
        for (let i = 1; i < line.length; i++) {
          expect(hexDistance(line[i - 1]!, line[i]!)).toBe(1);
        }
      }
    }
  });
});

describe('pixel conversion', () => {
  it('round trips exactly at every zoom level we ship', () => {
    // The six zoom steps from the plan, plus the extremes.
    for (const size of [24, 32, 40, 48, 64, 96, 12.5]) {
      for (const h of sampleHexes(200)) {
        expect(pixelToHex(hexToPixel(h, size), size)).toEqual(h);
      }
    }
  });

  it('resolves a point anywhere inside a hex back to that hex', () => {
    const size = 48;
    const rng = createRng('pixel-jitter', 'points');
    for (const h of sampleHexes(80)) {
      const centre = hexToPixel(h, size);
      for (let i = 0; i < 12; i++) {
        // Stay well inside the inradius (size * sqrt(3) / 2 ~ 0.866 * size)
        // so the point is unambiguously within this hex.
        const angle = rng.float(0, Math.PI * 2);
        const radius = rng.float(0, size * 0.8);
        const p = {
          x: centre.x + Math.cos(angle) * radius,
          y: centre.y + Math.sin(angle) * radius,
        };
        expect(pixelToHex(p, size)).toEqual(h);
      }
    }
  });

  it('neighbouring hexes are one hex-width apart on screen', () => {
    const size = 48;
    const centre = hexToPixel(hex(0, 0), size);
    const expected = Math.sqrt(3) * size;
    for (const n of hexNeighbours(hex(0, 0))) {
      const p = hexToPixel(n, size);
      const d = Math.hypot(p.x - centre.x, p.y - centre.y);
      expect(d).toBeCloseTo(expected, 6);
    }
  });

  it('gives six corners at exactly the hex size from the centre', () => {
    const size = 48;
    for (const h of sampleHexes(20)) {
      const centre = hexToPixel(h, size);
      const corners = hexCorners(h, size);
      expect(corners).toHaveLength(6);
      for (const c of corners) {
        expect(Math.hypot(c.x - centre.x, c.y - centre.y)).toBeCloseTo(size, 6);
      }
    }
  });
});

describe('rounding', () => {
  it('leaves whole coordinates untouched', () => {
    for (const h of sampleHexes(60)) {
      expect(hexRound(h.q, h.r)).toEqual(h);
    }
  });

  it('snaps a small perturbation back to the same hex', () => {
    for (const h of sampleHexes(60)) {
      expect(hexRound(h.q + 0.2, h.r - 0.2)).toEqual(h);
    }
  });
});

describe('keys', () => {
  it('round trip through a string, including negatives', () => {
    for (const h of sampleHexes(100)) {
      expect(hexFromKey(hexKey(h))).toEqual(h);
    }
  });

  it('are unique per hex', () => {
    const hexes = hexSpiral(hex(0, 0), 12);
    expect(new Set(hexes.map(hexKey)).size).toBe(hexes.length);
  });

  it('rejects malformed input rather than returning NaN coordinates', () => {
    expect(() => hexFromKey('nonsense')).toThrow();
    expect(() => hexFromKey('1,two')).toThrow();
  });
});

describe('arithmetic', () => {
  it('subtract undoes add', () => {
    const hexes = sampleHexes(40);
    for (const a of hexes) {
      for (const b of hexes.slice(0, 10)) {
        expect(hexSubtract(hexAdd(a, b), b)).toEqual(a);
      }
    }
  });
});
