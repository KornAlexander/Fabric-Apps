import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hex, type Hex } from '@fabric-empires/engine';
import { HEX_RADIUS, hexRing, hexToWorld, type Terrain } from '../src/three/terrain.js';

/*
  How a proposed city site is marked.

  ⚠️ The defect this file exists to prevent is not a crash; it is advice that
  is computed correctly, drawn correctly, and cannot be seen. Measured on the
  deployed build, the five proposals were a soft mint WASH over grass: against
  the ground immediately around it the best of them stood out about seven times
  less than the selection marker, and at the camera a game opens on all five
  together covered roughly 24 by 11 pixels.

  So two things have to stay true, and neither is about correctness of the
  suggestion itself:

  1. the mark must not COVER the tile it is recommending, because the player is
     being asked to compare ground; and
  2. at least part of the mark must be sized in SCREEN space, or it disappears
     at the zoom people actually plan at.
*/

const scene3d = readFileSync(
  fileURLToPath(new URL('../src/three/scene3d.ts', import.meta.url)),
  'utf8',
);

/** A terrain with a slope, so "follows the ground" can fail. */
function slopedTerrain(): Terrain {
  return {
    heightAt: (h: Hex) => h.q * 0.5,
    peakAt: (h: Hex) => h.q * 0.5,
    surfaceAt: (x: number, z: number) => x * 0.1 + z * 0.05,
    sampleHeight: () => 0,
    setGridVisible: () => {},
    triangleCount: 0,
  } as unknown as Terrain;
}

function positions(geometry: ReturnType<typeof hexRing>) {
  const p = geometry.getAttribute('position');
  return Array.from({ length: p.count }, (_, i) => ({
    x: p.getX(i),
    y: p.getY(i),
    z: p.getZ(i),
  }));
}

describe('the ring that marks a proposed site', () => {
  it('is a closed band of twelve triangles, two per edge', () => {
    const g = hexRing(hex(0, 0), slopedTerrain(), 0.05);
    expect(positions(g)).toHaveLength(36);
  });

  it('⚠️ leaves the middle of the tile uncovered', () => {
    /*
     * The whole reason this is a ring. A filled patch hides the ground the
     * advice is about, which is the one thing the player needs to look at
     * while choosing between five of them.
     */
    const terrain = slopedTerrain();
    const centre = hexToWorld(hex(0, 0));
    const inner = 0.76;
    for (const v of positions(hexRing(hex(0, 0), terrain, 0.05, 0.98, inner))) {
      const r = Math.hypot(v.x - centre.x, v.z - centre.z);
      expect(r, 'no vertex may sit in the middle of the hex').toBeGreaterThan(0.1);
    }
  });

  it('follows the ground rather than floating flat above it', () => {
    const g = hexRing(hex(0, 0), slopedTerrain(), 0.05);
    const ys = positions(g).map((v) => v.y);
    // The stub slopes, so a flat ring would be a bug.
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.05);
  });

  it('⚠️ takes its heights from the TRUE corner, not the inset one', () => {
    /*
     * The band is inset, so its vertices deliberately do NOT coincide with the
     * neighbouring hex's: they are pulled towards their own centre. What must
     * still agree is the HEIGHT, and it does because both hexes sample
     * `surfaceAt` at the corner they genuinely share rather than at their own
     * inset position. Sampling the inset point would put two bands at slightly
     * different heights along every shared edge, which is the same family of
     * bug as the fog lids in section 78.8.
     *
     * ⚠️ The first version of this test asserted that the two rings share
     * vertex POSITIONS, which an inset band never does. It failed on its own
     * "or this proves nothing" guard rather than passing vacuously, which is
     * the only reason the premise got corrected instead of shipped.
     */
    const terrain = slopedTerrain();
    const lift = 0.05;
    const { x, z } = hexToWorld(hex(0, 0));

    const cornerHeights = new Set<number>();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 180) * (60 * i - 90);
      const cx = x + HEX_RADIUS * Math.cos(angle);
      const cz = z + HEX_RADIUS * Math.sin(angle);
      cornerHeights.add(Number((terrain.surfaceAt(cx, cz) + lift).toFixed(6)));
    }
    expect(cornerHeights.size, 'the stub must slope, or this proves nothing').toBe(6);

    for (const v of positions(hexRing(hex(0, 0), terrain, lift))) {
      expect(cornerHeights).toContain(Number(v.y.toFixed(6)));
    }
  });
});

describe('⚠️ the marks that survive zooming out', () => {
  it('sizes rank numbers and the beacon in screen space', () => {
    /*
     * `sizeAttenuation: false` is the entire fix for "I am not seeing them".
     * Everything else on the map shrinks with the camera, which is correct for
     * terrain and wrong for advice: five hexes at the opening camera share
     * about 24 by 11 pixels, so no amount of colour saves a mark painted on
     * the ground there.
     */
    expect(scene3d).toMatch(/sizeAttenuation:\s*false/);
  });

  it('draws proposals as a ring and a sprite, never as a filled patch', () => {
    const block = scene3d.slice(
      scene3d.indexOf('if (view.settleSites)'),
      scene3d.indexOf('if (view.hover'),
    );
    expect(block).toContain('addRing(');
    expect(block).toContain('addSprite(');
    expect(block, 'a wash is what made this invisible').not.toContain('addPatch(');
  });

  it('gives the best site a beacon and only the best site', () => {
    const block = scene3d.slice(
      scene3d.indexOf('if (view.settleSites)'),
      scene3d.indexOf('if (view.hover'),
    );
    expect(block).toMatch(/index === 0 && addSprite|if \(index === 0\) addSprite/);
  });

  it('⚠️ does not depth-test the marks', () => {
    /*
     * A pin standing on the far side of a ridge is otherwise hidden by the
     * ridge, which is exactly the moment it is worth having.
     */
    expect(scene3d).toMatch(/depthTest:\s*false/);
  });

  it('caches a texture per rank instead of per rebuild', () => {
    // Overlays are rebuilt on every selection change, so five canvases per
    // click would be five canvases per click for ever.
    expect(scene3d).toMatch(/rankTextures\.set\(rank, texture\)/);
    expect(scene3d).toMatch(/rankTextures\.get\(rank\)/);
  });

  it('⚠️ disposes sprite materials but never the shared textures', () => {
    const clear = scene3d.slice(
      scene3d.indexOf('function clearOverlays'),
      scene3d.indexOf('function addPatch'),
    );
    expect(clear).toContain('object.material.dispose()');
    expect(clear, 'the digit textures are shared and must outlive a rebuild')
      .not.toContain('.map.dispose()');
  });
});
