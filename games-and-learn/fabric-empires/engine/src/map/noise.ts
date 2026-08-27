/**
 * Seeded gradient noise, used for elevation and moisture.
 *
 * This is classic 2D Perlin with a permutation table drawn from the engine RNG,
 * so a seed fully determines the terrain. It is deliberately hand-rolled rather
 * than pulled from a dependency: the map must stay reproducible across package
 * upgrades, and a golden fixture test is worthless if a patch release of a
 * noise library can silently change every map anyone ever shared.
 */

import type { Rng } from '../rng/index.js';

export interface Noise2D {
  /** Raw noise in roughly [-1, 1]. */
  (x: number, y: number): number;
}

const GRAD_2D: readonly (readonly [number, number])[] = Object.freeze([
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]);

function fade(t: number): number {
  // 6t^5 - 15t^4 + 10t^3, the standard quintic ease with zero first and
  // second derivatives at the ends, which is what stops visible grid seams.
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function createNoise2D(rng: Rng): Noise2D {
  const base = rng.shuffle(Array.from({ length: 256 }, (_, i) => i));
  // Doubled so index wrapping never needs a modulo in the hot path.
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255]!;

  function grad(hash: number, x: number, y: number): number {
    const g = GRAD_2D[hash & 7]!;
    return g[0] * x + g[1] * y;
  }

  return function noise(x: number, y: number): number {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const u = fade(xf);
    const v = fade(yf);

    const aa = perm[perm[xi]! + yi]!;
    const ab = perm[perm[xi]! + yi + 1]!;
    const ba = perm[perm[xi + 1]! + yi]!;
    const bb = perm[perm[xi + 1]! + yi + 1]!;

    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
  };
}

export interface FbmOptions {
  readonly octaves: number;
  readonly frequency: number;
  readonly persistence: number;
  readonly lacunarity: number;
}

/**
 * Fractal Brownian motion over a noise function, normalised to [0, 1].
 *
 * Normalising by the summed amplitude rather than clamping matters: a clamp
 * would flatten the extremes, and the extremes are where peaks and deep water
 * come from.
 */
export function fbm(
  noise: Noise2D,
  x: number,
  y: number,
  options: FbmOptions,
): number {
  let amplitude = 1;
  let frequency = options.frequency;
  let sum = 0;
  let maxAmplitude = 0;

  for (let i = 0; i < options.octaves; i++) {
    sum += noise(x * frequency, y * frequency) * amplitude;
    maxAmplitude += amplitude;
    amplitude *= options.persistence;
    frequency *= options.lacunarity;
  }

  // sum is in [-maxAmplitude, maxAmplitude]; map to [0, 1].
  return (sum / maxAmplitude + 1) / 2;
}
