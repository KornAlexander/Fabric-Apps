import { describe, expect, it } from 'vitest';

import { depthTextureShape } from '../buildings';

/**
 * The smallest MAX_TEXTURE_SIZE any WebGL2 implementation is allowed to report is 2048; the
 * machines this runs on report 16384. The depth texture must stay under the lower of the two,
 * because when it does not the upload fails with GL_INVALID_VALUE, every sample reads back 0,
 * and the flood renders as if it never happened — without an error, and with the test suite
 * still green.
 */
const WEBGL2_MINIMUM_MAX_TEXTURE_SIZE = 2048;

describe('depthTextureShape', () => {
  it('keeps a small valley in a single row', () => {
    expect(depthTextureShape(1)).toEqual({ width: 1, height: 1 });
    expect(depthTextureShape(1500)).toEqual({ width: 1500, height: 1 });
  });

  it('always holds at least one texel per building', () => {
    for (const count of [1, 999, 2048, 2049, 30_207, 1_000_000]) {
      const { width, height } = depthTextureShape(count);
      expect(width * height).toBeGreaterThanOrEqual(count);
    }
  });

  it('never asks the GPU for a texture larger than it must support', () => {
    // 30 207 is the Kreuzberg–Kripp count that broke the original one-row layout.
    for (const count of [30_207, 1_000_000, 4_000_000]) {
      const { width, height } = depthTextureShape(count);
      expect(width).toBeLessThanOrEqual(WEBGL2_MINIMUM_MAX_TEXTURE_SIZE);
      expect(height).toBeLessThanOrEqual(WEBGL2_MINIMUM_MAX_TEXTURE_SIZE);
    }
  });

  it('wraps the Kreuzberg–Kripp valley into the shape the shader indexes', () => {
    expect(depthTextureShape(30_207)).toEqual({ width: 2048, height: 15 });
  });
});
