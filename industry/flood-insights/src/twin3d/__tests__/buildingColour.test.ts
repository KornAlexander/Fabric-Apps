import { describe, expect, it } from 'vitest';

import { buildColourAttribute, WALL_COLOURS, type Lod2Meta } from '../buildings';

/**
 * The colour attribute is built from two OPTIONAL binaries whose failure modes are all silent.
 *
 * Nothing here is hypothetical. A single-page host answers a request for a missing file with
 * `index.html` and HTTP 200, so `response.ok` is not evidence that a payload is a payload; a span
 * carries a start and no length, so an unclipped one repaints the next building; and a build made
 * before the drape existed has no colour at all and must still render.
 */

function meta(buildings: Lod2Meta['buildings']): Lod2Meta {
  return {
    count: buildings.length,
    vertexCount: buildings.reduce((n, b) => Math.max(n, b.vertexStart + b.vertexCount), 0),
    perVillage: {},
    attribution: 'test',
    buildings,
  };
}

// Two buildings of 10 vertices each; roofs are the last 4 of each.
const TWO = meta([
  { village: 'a', groundElevM: 0, vertexStart: 0, vertexCount: 10, roofVertexStart: 6, wall: 0, easting: 0, northing: 0 },
  { village: 'b', groundElevM: 0, vertexStart: 10, vertexCount: 10, roofVertexStart: 16, wall: 1, easting: 0, northing: 0 },
]);

const ROOFS = new Uint8Array([200, 100, 80, 255, 90, 95, 110, 255]);

function rgbaAt(colours: Uint8Array, vertex: number) {
  return Array.from(colours.subarray(vertex * 4, vertex * 4 + 4));
}

describe('buildColourAttribute', () => {
  it('paints walls from the class and roofs from the measurement', () => {
    const c = buildColourAttribute(TWO, 20, ROOFS, null);
    expect(rgbaAt(c, 0)).toEqual([...WALL_COLOURS[0], 0]);
    expect(rgbaAt(c, 5)).toEqual([...WALL_COLOURS[0], 0]);
    expect(rgbaAt(c, 6)).toEqual([200, 100, 80, 255]);
    expect(rgbaAt(c, 9)).toEqual([200, 100, 80, 255]);
    expect(rgbaAt(c, 10)).toEqual([...WALL_COLOURS[1], 0]);
    expect(rgbaAt(c, 16)).toEqual([90, 95, 110, 255]);
  });

  it('leaves no vertex uncoloured', () => {
    const c = buildColourAttribute(TWO, 20, ROOFS, null);
    for (let v = 0; v < 20; v++) {
      const [r, g, b] = rgbaAt(c, v);
      expect(r + g + b, `vertex ${v} is pure black, i.e. never painted`).toBeGreaterThan(0);
    }
  });

  it('renders without colour at all, as a pre-drape build must', () => {
    const c = buildColourAttribute(TWO, 20, null, null);
    expect(rgbaAt(c, 0)).toEqual([...WALL_COLOURS[0], 0]);
    // No roof measurement means no roof flag — the shader then treats it as wall, not as black.
    expect(rgbaAt(c, 9)).toEqual([...WALL_COLOURS[0], 0]);
  });

  it('ignores a payload of the wrong length instead of parsing HTML as colour', () => {
    // What index.html actually arrives as: bytes, plausible, and the wrong shape.
    const html = new Uint8Array(1234).fill(60);
    const c = buildColourAttribute(TWO, 20, html, html);
    expect(rgbaAt(c, 6)).toEqual([...WALL_COLOURS[0], 0]);
  });

  it('clips a span to its own building instead of bleeding into the next', () => {
    // One span starting inside building A, with nothing after it. Unclipped it would run to the
    // end of the mesh and repaint building B's roof as well.
    const spans = new Uint8Array(7);
    new DataView(spans.buffer).setUint32(0, 8, true);
    spans.set([1, 2, 3], 4);

    const c = buildColourAttribute(TWO, 20, ROOFS, spans);
    expect(rgbaAt(c, 8)).toEqual([1, 2, 3, 255]);
    expect(rgbaAt(c, 9)).toEqual([1, 2, 3, 255]);
    // Building B is untouched.
    expect(rgbaAt(c, 16)).toEqual([90, 95, 110, 255]);
  });

  it('keeps a span that starts exactly on a building boundary inside that building', () => {
    // The `>=` version of the binary search drops this one, because building A ends at exactly 10.
    const spans = new Uint8Array(7);
    new DataView(spans.buffer).setUint32(0, 10, true);
    spans.set([7, 8, 9], 4);

    const c = buildColourAttribute(TWO, 20, ROOFS, spans);
    expect(rgbaAt(c, 10)).toEqual([7, 8, 9, 255]);
    expect(rgbaAt(c, 19)).toEqual([7, 8, 9, 255]);
  });

  it('never writes past the end of the attribute', () => {
    const overrun = meta([
      { village: 'a', groundElevM: 0, vertexStart: 0, vertexCount: 999, roofVertexStart: 4, wall: 0, easting: 0, northing: 0 },
    ]);
    expect(() => buildColourAttribute(overrun, 8, null, null)).not.toThrow();
    expect(buildColourAttribute(overrun, 8, null, null)).toHaveLength(32);
  });
});
