import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { configureDrapeTexture } from '../terrainLoader';

/**
 * One orientation convention, enforced.
 *
 * The drape rendered north-south mirrored over the terrain for as long as the drape existed,
 * because `THREE.DataTexture` and `THREE.TextureLoader` disagree about `flipY` — false and true
 * respectively — and the shader's `gridUv()` flips v for both alike. Nothing caught it: tsc
 * passed, every unit test passed, the deploy succeeded, and a registration scan against 1200
 * cadastral footprints reported a clean tenfold minimum at zero offset, because that scan sampled
 * the JPEG in Python and the Python path was never the broken one.
 *
 * A mirror is also unusually hard to see: reflecting an east-west valley about the middle of its
 * own box leaves the valley in the middle and the towns roughly on the towns.
 *
 * So the convention gets a test rather than a comment.
 */
describe('drape texture orientation', () => {
  it('matches the DataTextures it is sampled beside', () => {
    // What every other raster in the terrain material is built as.
    const data = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const drape = configureDrapeTexture(new THREE.Texture());

    expect(
      drape.flipY,
      'the drape must share the DataTexture orientation, or gridUv() flips it twice'
    ).toBe(data.flipY);
    expect(drape.flipY).toBe(false);
  });

  it('never wraps, so the east edge cannot bleed into the west', () => {
    const drape = configureDrapeTexture(new THREE.Texture());
    expect(drape.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(drape.wrapT).toBe(THREE.ClampToEdgeWrapping);
  });

  it('is treated as colour, not as data', () => {
    const drape = configureDrapeTexture(new THREE.Texture());
    expect(drape.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(drape.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    // `needsUpdate` is a write-only accessor in three.js — reading it back gives undefined, so the
    // observable effect is the version counter it bumps.
    expect(drape.version).toBeGreaterThan(0);
  });
});
