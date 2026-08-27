/**
 * Seeded pseudo-random number generation.
 *
 * Every map, every enemy decision and every combat roll must be reproducible
 * from a seed string, because a shared seed is how players compare runs
 * (D06, D39) and how the golden map test stays meaningful.
 *
 * Streams matter: map generation and combat each take their own stream from
 * the same seed, so adding a combat roll cannot shift the terrain a player
 * gets from a given seed.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
  /** A uniformly chosen element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /** A new array, Fisher-Yates shuffled. The input is not mutated. */
  shuffle<T>(items: readonly T[]): T[];
}

/**
 * cyrb128: string to four 32-bit seed values.
 * Cheap, well-distributed, and produces very different states for seeds that
 * differ by one character, which matters because players type seeds by hand.
 */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

/** mulberry32: 32-bit state, fast, good enough for a game. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(next: () => number): Rng {
  return {
    next,
    int(min: number, max: number): number {
      if (max < min) throw new Error(`int(${min}, ${max}): max must be >= min`);
      return min + Math.floor(next() * (max - min + 1));
    },
    float(min: number, max: number): number {
      return min + next() * (max - min);
    },
    chance(p: number): boolean {
      return next() < p;
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('pick() on an empty array');
      return items[Math.floor(next() * items.length)]!;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const a = out[i]!;
        const b = out[j]!;
        out[i] = b;
        out[j] = a;
      }
      return out;
    },
  };
}

/**
 * Create a generator for one named stream of a seed.
 *
 * The stream name is folded into the seed, so `createRng('alpha', 'map')` and
 * `createRng('alpha', 'combat')` are independent sequences that both depend on
 * the whole seed.
 */
export function createRng(seed: string, stream = 'default'): Rng {
  const [a, b, c, d] = cyrb128(`${seed}::${stream}`);
  // Fold all four hash words into the single 32-bit mulberry state so that a
  // one-character seed change cannot collide on the low word alone.
  const state = (a ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791) ^ Math.imul(d, 4256249)) >>> 0;
  return makeRng(mulberry32(state));
}

const SEED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * A readable seed a player can type or paste into Discord.
 * Ambiguous characters (I, O, 0, 1) are excluded on purpose.
 */
export function randomSeed(length = 8): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(Math.random() * SEED_ALPHABET.length);
    out += SEED_ALPHABET[idx]!;
  }
  return out;
}

/** Normalise user input so `abc-123` and `ABC123` are the same seed. */
export function normaliseSeed(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.length > 0 ? cleaned : 'FABRIC';
}
