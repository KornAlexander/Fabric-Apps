import {
  BufferGeometry,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  type IUniform,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { hexPatch, type Terrain } from './terrain.js';
import type { Hex } from '@fabric-empires/engine';

/**
 * Corruption: the enemy advance, visible on the ground.
 *
 * ⚠️ **This set was already being computed and nothing was drawing it.**
 * `refreshCorruption` has been maintaining a list of corrupted hexes for a
 * long time and the result was assigned to a variable that nothing ever read,
 * so D56 existed as bookkeeping and never as a picture. A border colour tells
 * you who owns a tile; this is supposed to tell you that something is *wrong*
 * with it.
 *
 * The effect is deliberately the one surreal thing in a realistic scene. The
 * terrain, water and light all aim at plausibility; corrupted ground does not
 * belong to that world at all. It tears, it scans, and its hues clash with
 * everything around them, because the fiction is that these are places where
 * the data has gone bad, not places that are merely hostile.
 */

const VERTEX = `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/*
 * Everything below is a function of world position and time, with no texture
 * and no attribute beyond position. That keeps the patch geometry a plain
 * merged mesh, and it means the pattern does not swim when the camera moves,
 * which a screen-space effect would.
 */
const FRAGMENT = `
precision highp float;
uniform float uTime;
uniform float uStrength;
varying vec3 vWorld;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  // Scanlines run along world Z so they line up across neighbouring hexes
  // rather than restarting at every tile edge.
  float band = vWorld.z * 9.0 + uTime * 0.9;
  float scan = smoothstep(0.35, 0.95, abs(fract(band) * 2.0 - 1.0));

  // The tear: a slow horizontal displacement that jumps rather than slides,
  // so it reads as a broken signal instead of a wave.
  float row = floor(vWorld.z * 3.0 + uTime * 0.35);
  float tear = step(0.72, hash(vec2(row, floor(uTime * 1.7))));
  float offset = tear * (hash(vec2(row, 3.0)) - 0.5) * 0.9;

  float x = vWorld.x + offset;
  float stripe = fract(x * 0.9 + uTime * 0.12);

  // Clashing hues on purpose: a sour green against a hot magenta is a pair
  // the rest of the palette never uses, so corrupted ground cannot be
  // mistaken for a lighting change or a shadow.
  vec3 sour = vec3(0.44, 0.95, 0.36);
  vec3 hot = vec3(0.95, 0.20, 0.72);
  vec3 tint = mix(sour, hot, smoothstep(0.35, 0.65, stripe));

  /*
   * ⚠️ **The void is what makes this readable.** The first version was purely
   * additive, so on sunlit sand it could only brighten and the whole effect
   * washed out to a faint pink haze: present in the scene graph, invisible on
   * screen. Corrupted ground now goes almost black between the scanlines and
   * only the lines themselves glow, which is what reads as a broken signal
   * rather than as coloured terrain.
   */
  vec3 voidColour = vec3(0.02, 0.015, 0.03);
  vec3 colour = mix(voidColour, tint, scan * 0.85 + tear * 0.35);

  float pulse = 0.82 + 0.18 * sin(uTime * 1.6 + vWorld.x * 0.4);
  float alpha = clamp((0.62 + scan * 0.3 + tear * 0.2) * pulse, 0.0, 0.95) * uStrength;

  gl_FragColor = vec4(colour, alpha);
}
`;

export interface CorruptionLayer {
  /** Rebuild for a new set of hexes. Cheap enough to call on any state change. */
  set(hexes: readonly Hex[], terrain: Terrain): void;
  /** Advance the animation. */
  update(deltaSeconds: number): void;
  readonly mesh: Mesh | undefined;
  readonly count: number;
  dispose(): void;
}

export function createCorruption(onMesh: (mesh: Mesh | undefined) => void): CorruptionLayer {
  const uniforms: Record<string, IUniform> = {
    uTime: { value: 0 },
    uStrength: { value: 1 },
  };

  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
  });

  let mesh: Mesh | undefined;
  let geometry: BufferGeometry | undefined;
  let count = 0;

  function clear(): void {
    if (mesh) onMesh(undefined);
    mesh = undefined;
    geometry?.dispose();
    geometry = undefined;
    count = 0;
  }

  return {
    set(hexes, terrain) {
      clear();
      if (hexes.length === 0) return;

      // Lifted slightly so it sits on the ground rather than fighting it for
      // the same depth, which on a displaced surface flickers badly.
      const patches = hexes.map((hex) => hexPatch(hex, terrain, 0.035));
      const merged = mergeGeometries(patches, false);
      for (const patch of patches) patch.dispose();
      if (!merged) return;

      geometry = merged;
      mesh = new Mesh(merged, material);
      mesh.renderOrder = 2;
      // Corrupted ground is not a thing that casts or catches light.
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      count = hexes.length;
      onMesh(mesh);
    },

    update(delta) {
      const time = uniforms.uTime;
      if (time) time.value = (time.value as number) + delta;
    },

    get mesh() {
      return mesh;
    },

    get count() {
      return count;
    },

    dispose() {
      clear();
      material.dispose();
    },
  };
}
