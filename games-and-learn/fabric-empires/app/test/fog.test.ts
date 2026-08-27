import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BufferAttribute, Mesh, ShaderMaterial } from 'three';
import { hex, hexKey, type Hex } from '@fabric-empires/engine';
import { createFog } from '../src/three/fog.js';
import type { Terrain } from '../src/three/terrain.js';

/*
  The fog SHEET, as opposed to the lid geometry underneath it (`fogLid.test.ts`).

  ⚠️ Two defects live in this file's history, and they are different in kind.

  The first was that the sheet was, measured on screen, rgb(9, 13, 19) with a
  luminance standard deviation of 2 in 255: a hole cut in the world rather than
  weather. Nothing was broken. The colour was authored in sRGB and then seen
  through ACES filmic tone mapping at exposure 0.78, which crushes darks, and
  the mottling meant to break it up moved a near-black value by less than one
  level.

  The second was that changing the fog rebuilt its geometry, which measured
  **44.8 ms** at full map size. That was affordable while the fog only moved
  when a turn ended, and stopped being affordable the moment it had to keep up
  with a unit walking. Geometry is now built once per map and every tile
  carries its own state as an attribute.

  Neither can be asserted from pixels here, because the audio of this file is a
  GPU and there is not one. What CAN be pinned is the arithmetic and the rules
  that keep the sheet from revealing ground it is supposed to hide.
*/

const source = readFileSync(
  fileURLToPath(new URL('../src/three/fog.ts', import.meta.url)),
  'utf8',
);

/** A flat terrain is enough: this file is about the sheet, not the lids. */
function flatTerrain(): Terrain {
  return {
    heightAt: () => 1,
    peakAt: () => 1,
    surfaceAt: () => 1,
    sampleHeight: () => 1,
    setGridVisible: () => {},
    triangleCount: 0,
  } as unknown as Terrain;
}

const MAP: Hex[] = [hex(0, 0), hex(1, 0), hex(0, 1), hex(1, 1), hex(2, 0)];

function build(map: Hex[] = MAP) {
  const added: Mesh[] = [];
  const removed: Mesh[] = [];
  const layer = createFog((a, r) => {
    added.push(...a);
    removed.push(...r);
  });
  layer.setMap(map, flatTerrain());
  return { layer, added, removed };
}

const attr = (mesh: Mesh, name: string) =>
  mesh.geometry.getAttribute(name) as BufferAttribute;

/** The state the sheet is heading towards for a given hex. */
function targetOf(mesh: Mesh, h: Hex): number {
  const spanStart = MAP.findIndex((m) => hexKey(m) === hexKey(h)) * 36;
  return attr(mesh, 'aTo').getX(spanStart);
}

describe('the fog sheet', () => {
  it('is one mesh for the whole map, however many tiles are hidden', () => {
    const { added } = build();
    expect(added).toHaveLength(1);
    // Every tile gets geometry, not only the fogged ones.
    expect(attr(added[0]!, 'position').count).toBe(MAP.length * 36);
  });

  it('⚠️ covers tiles that are currently in sight too', () => {
    /*
     * The reason the sheet is built from the MAP and not from the fog: a clear
     * tile becomes remembered the moment the unit watching it walks away.
     * Building only what is hidden now would mean rebuilding then, and
     * rebuilding is the 44.8 ms this design exists to avoid.
     */
    const { added, layer } = build();
    layer.set([], []); // nothing hidden at all
    expect(attr(added[0]!, 'position').count).toBe(MAP.length * 36);
  });

  it('⚠️ changes state without rebuilding geometry', () => {
    const { layer, added, removed } = build();
    const before = added[0]!.geometry;

    layer.set([hex(0, 0)], [hex(1, 0)]);
    layer.set([hex(0, 1)], []);

    expect(removed, 'a rebuild would have replaced the mesh').toHaveLength(0);
    expect(added).toHaveLength(1);
    expect(added[0]!.geometry, 'the same buffers throughout').toBe(before);
  });

  it('marks unseen 2, remembered 1 and everything else 0', () => {
    const { layer, added } = build();
    layer.set([hex(0, 0)], [hex(1, 0)]);
    const mesh = added[0]!;
    expect(targetOf(mesh, hex(0, 0))).toBe(2);
    expect(targetOf(mesh, hex(1, 0))).toBe(1);
    expect(targetOf(mesh, hex(0, 1))).toBe(0);
  });

  it('⚠️ restarts a fade from where it currently is, not from where it began', () => {
    /*
     * A tile caught half uncovered when something changes again must carry on
     * from half, not snap back to fully hidden and start over. That snap is
     * the one thing a fade exists to prevent, and it is easy to write by
     * accident because "from" reads like "the previous state".
     */
    const { layer, added } = build();
    const mesh = added[0]!;

    layer.set([hex(0, 0)], []); // hidden
    layer.set([], []); // start uncovering
    layer.update(0.375); // roughly half of FADE_SECONDS
    layer.set([hex(0, 0)], []); // hidden again, mid-fade

    const from = attr(mesh, 'aFrom').getX(0);
    expect(from, 'should resume from about half, not from 2').toBeGreaterThan(0.5);
    expect(from).toBeLessThan(1.9);
  });

  it('does not touch the buffers when nothing changed', () => {
    /*
     * ⚠️ Checked through `version`, not `needsUpdate`. On a BufferAttribute
     * `needsUpdate` is write-only: setting it bumps `version`, and READING it
     * returns undefined, so the obvious assertion passes against nothing.
     */
    const { layer, added } = build();
    const a = attr(added[0]!, 'aTo');
    layer.set([hex(0, 0)], []);
    const uploaded = a.version;
    layer.set([hex(0, 0)], []);
    expect(a.version, 'an identical fog must not re-upload').toBe(uploaded);
  });

  it('⚠️ decides alpha before sampling any noise', () => {
    /*
     * The cost rule. Every tile has geometry now, so without an early discard
     * the sheet would shade the entire board with three fbm calls per fragment
     * in order to draw nothing at all.
     */
    const main = source.slice(source.indexOf('void main() {', source.indexOf('FRAGMENT')));
    const discard = main.indexOf('discard');
    const firstNoise = main.indexOf('feFbm(');
    expect(discard).toBeGreaterThan(0);
    expect(discard, 'discard must come before the first noise sample')
      .toBeLessThan(firstNoise);
  });

  it('⚠️ displaces the bank upward only', () => {
    /*
     * The rule that lets the sheet roll at all. The lid sits at each hex's own
     * peak so nothing beneath it can be seen; a negative displacement would
     * sink it into the hillside and open a window onto unexplored terrain.
     *
     * A source check, because the displacement happens on the GPU. It is worth
     * having anyway: the clamp is one `max` that reads like a formality and
     * would be the obvious thing to delete while tidying the shader.
     */
    expect(source).toMatch(/world\.y \+= max\(0\.0, vBillow\) \* height/);
    expect(source, 'the height must be ADDED, never mixed towards')
      .not.toMatch(/world\.y = mix\(/);
  });

  it('⚠️ samples its noise on world position, so lids meet without a seam', () => {
    expect(source).toMatch(/feBillow\(world\.xz, uTime\)/);
    expect(source).toMatch(/feFbm\(vWorld\.xz \*/);
    expect(source, 'a vertex-index or uv term would break the seam')
      .not.toMatch(/feBillow\(\s*(uv|position)/);
  });

  it('⚠️ states its colours as linear values, not as hex strings', () => {
    const hexColours = source.match(/new Color\(\s*['"`]#/g) ?? [];
    expect(hexColours, 'fog colours must be setRGB, so they are linear').toEqual([]);
    expect(source).toMatch(/CREST = new Color\(\)\.setRGB\(/);
  });

  it('⚠️ has a crest bright enough to be seen against its own trough', () => {
    /*
     * The flatness, stated as a number rather than as a hex. The old sheet's
     * range was 11 percent of a near-black value; measured, that was a swing
     * of one level in 255. Whatever the colours become, the crest has to be a
     * large multiple of the trough or the billowing is computed and invisible.
     */
    const read = (name: string): number => {
      const m = source.match(new RegExp(`${name} = new Color\\(\\)\\.setRGB\\(([^)]+)\\)`));
      const parts = m![1]!.split(',').map((v) => Number(v.trim()));
      return 0.2126 * parts[0]! + 0.7152 * parts[1]! + 0.0722 * parts[2]!;
    };
    expect(read('CREST') / read('TROUGH')).toBeGreaterThan(5);
  });

  it('advances its own clock, because fog that does not move is a backdrop', () => {
    const { layer, added } = build();
    const material = added[0]!.material as ShaderMaterial;
    expect(material.uniforms.uTime!.value).toBe(0);
    layer.update(0.5);
    layer.update(0.25);
    expect(material.uniforms.uTime!.value).toBeCloseTo(0.75, 6);
  });

  it('⚠️ takes the distance haze, which a raw ShaderMaterial does not get free', () => {
    const { added } = build();
    const material = added[0]!.material as ShaderMaterial;
    expect(material.fog).toBe(true);
    expect(material.uniforms.fogColor).toBeDefined();
    expect(material.uniforms.fogDensity).toBeDefined();
    expect(material.vertexShader).toContain('#include <fog_vertex>');
    expect(material.fragmentShader).toContain('#include <fog_fragment>');
  });

  it('⚠️ grows the bounding sphere by the height the bank rolls', () => {
    const { added } = build();
    const sphere = added[0]!.geometry.boundingSphere;
    expect(sphere).not.toBeNull();

    const flat = added[0]!.geometry.clone();
    flat.computeBoundingSphere();
    expect(sphere!.radius).toBeGreaterThan(flat.boundingSphere!.radius);
    flat.dispose();
  });

  it('replaces the sheet when the map changes, and only then', () => {
    const { layer, added, removed } = build();
    expect(removed).toHaveLength(0);
    layer.setMap([hex(9, 9)], flatTerrain());
    expect(removed, 'a new map is the one time a rebuild is right').toHaveLength(1);
    expect(added).toHaveLength(2);
  });

  it('releases the mesh when disposed', () => {
    const { layer, removed } = build();
    expect(layer.meshes).toHaveLength(1);
    layer.dispose();
    expect(layer.meshes).toHaveLength(0);
    expect(removed).toHaveLength(1);
  });
});
