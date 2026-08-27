/**
 * Fog of war: one sheet, whose tiles change state without rebuilding anything.
 *
 * ⚠️ **One mesh for the whole map, built once.** Unexplored ground is most of
 * the map, about 6,000 hexes on a standard world, and six thousand meshes
 * would be six thousand draw calls for what is visually a single sheet.
 *
 * ⚠️ **And rebuilt on a map change, never on a fog change.** It used to merge
 * fresh geometry every time the fog moved, which measured **44.8 ms median**
 * at full map size, plus a complete re-upload of 223,000 vertices. That was
 * affordable while the fog only changed when a turn ended. It stopped being
 * affordable the moment the fog had to keep up with a unit walking, which is
 * six changes in a second and a half: six 45 ms stalls, one per step.
 *
 * So the geometry is now constant and every tile carries its own state as a
 * vertex attribute. Changing the fog writes three floats per vertex of the
 * tiles that actually changed, which is work proportional to what moved rather
 * than to the size of the map.
 *
 * The three states, as a single number so they can be interpolated:
 *
 *   2  **unseen**      never visited; opaque, and nothing is drawn through it
 *   1  **remembered**  seen before, not watched now; translucent and cool
 *   0  **clear**       currently in sight; not drawn at all
 *
 * ⚠️ Because it is one number, "this tile is being uncovered" is just a slide
 * from 2 to 0, and the shader does it over `FADE_SECONDS` for free. That is
 * what makes ground uncover rather than pop, and it is the reason the states
 * are a float rather than an enum.
 */

import {
  BufferAttribute,
  Color,
  Mesh,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  type BufferGeometry,
  type IUniform,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hexLid, type Terrain } from './terrain.js';
import { hexKey, type Hex } from '@fabric-empires/engine';

export interface FogLayer {
  /**
   * Build the sheet for this map. Expensive, and done once per map.
   *
   * Every tile gets geometry, including the ones currently in sight: a tile
   * that is clear now becomes remembered the moment the unit watching it walks
   * away, and finding out then would mean rebuilding then.
   */
  setMap(hexes: readonly Hex[], terrain: Terrain): void;
  /** Change what is hidden. Attribute writes only; no geometry is touched. */
  set(unseen: readonly Hex[], remembered: readonly Hex[]): void;
  /** Advance the drift and the uncovering fades. */
  update(deltaSeconds: number): void;
  readonly meshes: readonly Mesh[];
  dispose(): void;
}

/**
 * The shared noise, and the one rule that keeps the sheet seamless.
 *
 * ⚠️ **Sampled on world XZ, never on anything per-hex.** Two neighbouring lids
 * own separate copies of the vertices along the edge they share, so any value
 * derived from a hex id, a local coordinate or a vertex index would differ
 * across that seam and draw a line down it. World position is identical for
 * both copies by construction, which is the same argument that fixed the lid
 * heights in section 78.8, and it holds for colour and for displacement too.
 */
const NOISE = `
float feHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float feNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(feHash(i), feHash(i + vec2(1.0, 0.0)), u.x),
             mix(feHash(i + vec2(0.0, 1.0)), feHash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float feFbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * feNoise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

// The bank: two drifts crossing at different speeds and directions, which is
// how you get something that curls without simulating anything.
float feBillow(vec2 world, float time) {
  float slow = feFbm(world * 0.075 + vec2(time * 0.010, time * 0.006));
  float fast = feFbm(world * 0.190 - vec2(time * 0.021, time * 0.005));
  return clamp(slow * 0.70 + fast * 0.30, 0.0, 1.0);
}
`;

/**
 * ⚠️ **Displacement is upward only, and that is a correctness rule, not taste.**
 *
 * A rolling top is the strongest single cue that this is weather rather than a
 * lid, and it is nearly free: the same noise the colour uses, added to Y. But
 * the lid sits at the hex's own peak precisely so nothing beneath it can be
 * seen, so a downward displacement would sink it into the hillside and open a
 * window onto unexplored ground. `max(0.0, ...)` is the whole guard, and the
 * height is added rather than mixed so the floor can never rise.
 *
 * The state slide also happens here, once per vertex rather than once per
 * fragment, and is handed to the fragment shader as a varying.
 */
const VERTEX = `
#include <common>
#include <fog_pars_vertex>

uniform float uTime;
uniform float uFade;
uniform float uBillowUnseen;
uniform float uBillowRemembered;

attribute float aFrom;
attribute float aTo;
attribute float aChanged;

varying vec3 vWorld;
varying float vBillow;
varying float vLit;
varying float vDeep;

${NOISE}

void main() {
  // Where this tile is between its old state and its new one.
  float k = clamp((uTime - aChanged) / uFade, 0.0, 1.0);
  float state = mix(aFrom, aTo, k);

  // Split once, so both shaders agree about what the number means.
  vLit = clamp(state, 0.0, 1.0);          // 0 clear, 1 remembered or deeper
  vDeep = clamp(state - 1.0, 0.0, 1.0);   // 0 remembered, 1 unseen

  vec4 world = modelMatrix * vec4(position, 1.0);

  // Clear ground is not drawn, so it is not worth four octaves of noise.
  if (vLit > 0.001) {
    vBillow = feBillow(world.xz, uTime);
    float height = mix(uBillowRemembered, uBillowUnseen, vDeep) * vLit;
    world.y += max(0.0, vBillow) * height;
  } else {
    vBillow = 0.0;
  }

  vWorld = world.xyz;

  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;

  #include <fog_vertex>
}
`;

/**
 * ⚠️ **Colours here are LINEAR, and that is why the old ones were invisible.**
 *
 * The sheet was authored as the hex `#171f29` and read back off the screen at
 * rgb(9, 13, 19). Nothing was broken: an unlit material emits its colour into
 * a pipeline with ACES filmic tone mapping at exposure 0.78, and that curve
 * crushes darks hard. Choosing a fog colour in a hex editor is choosing it in
 * a space nobody ever sees it in.
 *
 * The same arithmetic explains the flatness. The old mottling multiplied that
 * colour by 1 ± 0.11, and eleven percent of a value landing near 13/255 is a
 * swing of one unit, under the quantisation of the framebuffer. The variation
 * was real, recomputed for every vertex, and mathematically incapable of being
 * seen. A brightness range only exists where there is brightness to range over.
 */
const FRAGMENT = `
#include <common>
#include <fog_pars_fragment>

uniform float uTime;
uniform vec3 uTrough;
uniform vec3 uCrest;
uniform float uRememberedAlpha;

varying vec3 vWorld;
varying float vBillow;
varying float vLit;
varying float vDeep;

${NOISE}

void main() {
  /*
   * ⚠️ Alpha first, and discard before any noise is sampled.
   *
   * Every tile on the map now has geometry, including the ones in plain sight,
   * so without this the sheet would shade the whole board with three fbm calls
   * per fragment to draw nothing. Deciding early keeps the cost proportional
   * to the fog actually on screen, which is what it was before.
   */
  float alpha = mix(uRememberedAlpha, 1.0, vDeep) * vLit;
  if (alpha < 0.004) discard;

  /*
   * The vertex carries the shape of the bank; this adds detail finer than
   * thirteen vertices per hex could ever hold. Fog is lit by light bouncing
   * around inside it, so the thick parts are the BRIGHT parts: crest and
   * height come from the same number, which is what stops the shading
   * contradicting the silhouette.
   */
  float detail = feFbm(vWorld.xz * 0.52 + vec2(uTime * 0.014, -uTime * 0.011));
  float density = clamp(vBillow * 0.78 + detail * 0.22, 0.0, 1.0);

  /*
   * ⚠️ **A third octave that only exists near the camera.**
   *
   * Everything above is sized for looking at the map: features every few
   * hexes. Zoomed right in, the visible ground is a couple of world units
   * across, the low frequencies are all but constant over it, and the sheet
   * goes back to being a flat pane, which is most of what was wrong with it
   * before.
   *
   * Simply adding a high frequency everywhere is the wrong fix: at map zoom it
   * lands well under a pixel per feature and crawls. Weighting it by distance
   * gives detail exactly where there is screen area to show it, and none where
   * it would alias.
   *
   * NOTE: no backticks anywhere in this file's GLSL. These shaders live in
   * template literals, so a backtick in a comment ends the string and the
   * error surfaces as a TypeScript syntax error a hundred lines away.
   *
   * cameraPosition is one of the uniforms three provides to every shader, so
   * this costs nothing to obtain.
   */
  float closeness = 1.0 - smoothstep(6.0, 34.0, distance(vWorld, cameraPosition));
  if (closeness > 0.0) {
    float fine = feFbm(vWorld.xz * 2.30 + vec2(uTime * 0.030, uTime * 0.017));
    density = clamp(density + (fine - 0.5) * 0.42 * closeness, 0.0, 1.0);
  }

  density = smoothstep(0.18, 0.88, density);

  vec3 colour = mix(uTrough, uCrest, density);
  gl_FragColor = vec4(colour, alpha);

  #include <fog_fragment>
}
`;

/** Never visited. */
const UNSEEN = 2;
/** Seen before, not watched now. */
const REMEMBERED = 1;
/** In sight, so not drawn. */
const CLEAR = 0;

/**
 * How long a tile takes to change state, in seconds.
 *
 * ⚠️ This is the "uncover slowly" the whole rewrite is for. Ground used to
 * appear the instant a turn ended; now a tile the unit has just walked into
 * view slides open while the unit is still walking. Long enough to read as
 * fog thinning, short enough that a scout does not outrun its own reveal.
 */
const FADE_SECONDS = 0.75;

export function createFog(
  onChange: (added: readonly Mesh[], removed: readonly Mesh[]) => void,
): FogLayer {
  /*
   * Clear of the ground, not hugging it.
   *
   * ⚠️ `hexLid` follows the surface around its rim and rides the hex's own
   * peak at the centre, so this is only a margin against sampling error, and
   * it wants to stay small: every unit of lift is a lip standing above the
   * visible ground wherever fog meets explored terrain.
   */
  const LIFT = 0.12;

  /**
   * How far each lid's rim hangs below itself. Zero, now.
   *
   * ⚠️ **This was 4, and the cure had become the disease.**
   *
   * Lids used to be flat plates at each hex's own peak, so neighbours whose
   * peaks differed left an open vertical slot along their shared edge, and a
   * deep skirt was the way to close it. On steep ground that showed: a four
   * unit wall between two plates at different heights is not hidden, it IS
   * the picture, and unexplored mountains read as a flight of dark slate
   * steps with one thick band per tile boundary.
   *
   * `hexLid` now samples its rim at the corner and edge-midpoint positions two
   * neighbours share, so both compute the same heights and the lids simply
   * join. There is no slot left to close.
   *
   * ⚠️ Which makes a skirt worse than useless. Measured at 0.5 it still cost
   * **147,600 of the fog's 221,400 triangles**, every one of them hanging
   * below the neighbouring lid's own surface and therefore buried by the
   * depth test. Two thirds of the layer, drawing nothing.
   */
  const SKIRT = 0;

  /**
   * How high the bank rolls above the ground it covers, in world units.
   *
   * A hex is about 1.73 units across, so this is a swell of roughly two thirds
   * of a tile: enough to give the sheet a horizon and a silhouette, small
   * enough that it never reads as terrain of its own.
   *
   * ⚠️ **Remembered ground gets almost none of it.** That layer is a veil over
   * ground the player has actually walked, and lifting a veil clear of its own
   * hillside makes it look like a separate object floating above the map.
   */
  const UNSEEN_BILLOW = 1.15;
  const REMEMBERED_BILLOW = 0.14;
  const REMEMBERED_ALPHA = 0.58;

  /*
   * Linear, and tuned against measured screenshots rather than picked by eye.
   * See the note on FRAGMENT for why these are not hex strings.
   *
   * Read back off the deployed build, near fog against the land beside it:
   *
   * | version | fog luminance | fog variation (sd) |
   * | --- | --- | --- |
   * | the flat plate | 12 | 2.1 |
   * | first pass | 43 | 4.1 |
   * | wider trough-to-crest | 48 | 7.1 |
   * | **shipped** | **55** | **10.1** |
   *
   * Sunlit land measures 121 throughout, so the island keeps better than
   * twice the fog's brightness and three times its local contrast.
   */
  const TROUGH = new Color().setRGB(0.014, 0.019, 0.028);
  const CREST = new Color().setRGB(0.235, 0.278, 0.340);

  /*
   * ⚠️ A raw `ShaderMaterial` gets no distance haze for free. `UniformsLib.fog`
   * plus `fog: true` is what makes the renderer keep `fogColor` and
   * `fogDensity` up to date, and the two chunks in the shaders are what use
   * them. Measured, that haze is what lifted the far fog from rgb(9,13,19) to
   * rgb(38,43,48), which is why the old fog only ever looked like fog when it
   * was a long way off.
   */
  const uniforms: Record<string, IUniform> = UniformsUtils.merge([
    UniformsLib.fog,
    {
      uTime: { value: 0 },
      uFade: { value: FADE_SECONDS },
      uTrough: { value: new Color() },
      uCrest: { value: new Color() },
      uBillowUnseen: { value: UNSEEN_BILLOW },
      uBillowRemembered: { value: REMEMBERED_BILLOW },
      uRememberedAlpha: { value: REMEMBERED_ALPHA },
    },
  ]);
  (uniforms.uTrough!.value as Color).copy(TROUGH);
  (uniforms.uCrest!.value as Color).copy(CREST);

  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: true,
    fog: true,
  });

  let mesh: Mesh | undefined;
  let geometry: BufferGeometry | undefined;
  /** Where each hex's vertices live in the merged buffer. */
  const spans = new Map<string, { start: number; count: number }>();
  let aFrom: BufferAttribute | undefined;
  let aTo: BufferAttribute | undefined;
  let aChanged: BufferAttribute | undefined;
  let time = 0;

  function teardown(): void {
    if (!mesh) return;
    const removed = [mesh];
    mesh = undefined;
    geometry?.dispose();
    geometry = undefined;
    spans.clear();
    aFrom = aTo = aChanged = undefined;
    onChange([], removed);
  }

  return {
    setMap(hexes, terrain) {
      teardown();
      if (hexes.length === 0) return;

      const patches = hexes.map((h) => hexLid(h, terrain, LIFT, SKIRT));
      let cursor = 0;
      hexes.forEach((h, i) => {
        const count = patches[i]!.getAttribute('position').count;
        spans.set(hexKey(h), { start: cursor, count });
        cursor += count;
      });

      const merged = mergeGeometries(patches, false);
      for (const patch of patches) patch.dispose();
      if (!merged) return;
      geometry = merged;

      const total = merged.getAttribute('position').count;
      /*
       * Everything starts unseen and already settled, so the first `set` does
       * not fade the entire map in from nothing on the frame a game loads.
       */
      aFrom = new BufferAttribute(new Float32Array(total).fill(UNSEEN), 1);
      aTo = new BufferAttribute(new Float32Array(total).fill(UNSEEN), 1);
      aChanged = new BufferAttribute(new Float32Array(total).fill(-FADE_SECONDS * 4), 1);
      merged.setAttribute('aFrom', aFrom);
      merged.setAttribute('aTo', aTo);
      merged.setAttribute('aChanged', aChanged);

      mesh = new Mesh(merged, material);
      // Above the corruption layer (2) and the grid, below nothing.
      mesh.renderOrder = 4;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      /*
       * ⚠️ The bank rolls above the lid, so the drawn surface is taller than
       * the geometry claims. Three culls against the bounding sphere and would
       * pop the whole sheet out of view at grazing angles.
       */
      merged.computeBoundingSphere();
      if (merged.boundingSphere) merged.boundingSphere.radius += UNSEEN_BILLOW;

      onChange([mesh], []);
    },

    set(unseen, remembered) {
      if (!aFrom || !aTo || !aChanged) return;

      const wanted = new Map<string, number>();
      for (const h of unseen) wanted.set(hexKey(h), UNSEEN);
      for (const h of remembered) wanted.set(hexKey(h), REMEMBERED);

      const from = aFrom.array as Float32Array;
      const to = aTo.array as Float32Array;
      const changed = aChanged.array as Float32Array;

      let touched = false;
      for (const [key, span] of spans) {
        const target = wanted.get(key) ?? CLEAR;
        const first = span.start;
        if (to[first] === target) continue;

        /*
         * ⚠️ The slide restarts from where it currently IS, not from the state
         * it was heading for. A tile that is half uncovered when something
         * changes again would otherwise jump back to fully hidden and start
         * over, which is the one thing a fade is supposed to prevent.
         */
        const k = Math.min(1, Math.max(0, (time - changed[first]!) / FADE_SECONDS));
        const current = from[first]! + (to[first]! - from[first]!) * k;

        for (let i = first; i < first + span.count; i += 1) {
          from[i] = current;
          to[i] = target;
          changed[i] = time;
        }
        touched = true;
      }

      if (!touched) return;
      aFrom.needsUpdate = true;
      aTo.needsUpdate = true;
      aChanged.needsUpdate = true;
    },

    update(deltaSeconds) {
      time += deltaSeconds;
      material.uniforms.uTime!.value = time;
    },

    get meshes() {
      return mesh ? [mesh] : [];
    },

    dispose() {
      teardown();
      material.dispose();
    },
  };
}
