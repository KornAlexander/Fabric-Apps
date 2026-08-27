import { describe, it, expect } from 'vitest';
import { createRng, normaliseSeed, randomSeed } from '../src/rng/index.js';

function take(seed: string, stream: string, n: number): number[] {
  const rng = createRng(seed, stream);
  return Array.from({ length: n }, () => rng.next());
}

describe('determinism', () => {
  it('the same seed and stream produce the same sequence', () => {
    expect(take('ALPHA', 'map', 50)).toEqual(take('ALPHA', 'map', 50));
  });

  it('different streams of one seed are independent', () => {
    expect(take('ALPHA', 'map', 50)).not.toEqual(take('ALPHA', 'combat', 50));
  });

  it('a one-character seed change produces a different sequence', () => {
    expect(take('ALPHA', 'map', 20)).not.toEqual(take('ALPHB', 'map', 20));
    expect(take('ALPHA', 'map', 20)).not.toEqual(take('ALPHAA', 'map', 20));
  });

  it('consuming one stream does not affect another', () => {
    // This is the property that lets us add a combat roll without changing
    // the terrain a player gets from an existing seed.
    const before = take('SEED42', 'map', 10);
    const combat = createRng('SEED42', 'combat');
    for (let i = 0; i < 1000; i++) combat.next();
    expect(take('SEED42', 'map', 10)).toEqual(before);
  });
});

describe('distribution', () => {
  it('next() stays within [0, 1)', () => {
    const rng = createRng('BOUNDS', 'next');
    for (let i = 0; i < 20000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('next() has roughly the right mean', () => {
    const rng = createRng('MEAN', 'next');
    let sum = 0;
    const n = 100000;
    for (let i = 0; i < n; i++) sum += rng.next();
    expect(sum / n).toBeGreaterThan(0.49);
    expect(sum / n).toBeLessThan(0.51);
  });

  it('int() is inclusive at both ends and never exceeds them', () => {
    const rng = createRng('INTS', 'dice');
    const seen = new Set<number>();
    for (let i = 0; i < 20000; i++) {
      const v = rng.int(1, 6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });

  it('int() handles a single-value range and negatives', () => {
    const rng = createRng('EDGE', 'ints');
    for (let i = 0; i < 100; i++) {
      expect(rng.int(5, 5)).toBe(5);
      const v = rng.int(-3, -1);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThanOrEqual(-1);
    }
  });

  it('int() rejects an inverted range instead of silently misbehaving', () => {
    const rng = createRng('EDGE', 'inverted');
    expect(() => rng.int(6, 1)).toThrow();
  });

  it('chance() approximates its probability', () => {
    const rng = createRng('CHANCE', 'coin');
    let hits = 0;
    const n = 50000;
    for (let i = 0; i < n; i++) if (rng.chance(0.3)) hits++;
    expect(hits / n).toBeGreaterThan(0.29);
    expect(hits / n).toBeLessThan(0.31);
  });

  it('chance(0) never fires and chance(1) always does', () => {
    const rng = createRng('CHANCE', 'extremes');
    for (let i = 0; i < 500; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });
});

describe('collections', () => {
  it('pick() only returns members and eventually returns all of them', () => {
    const rng = createRng('PICK', 'items');
    const items = ['a', 'b', 'c', 'd'];
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.pick(items);
      expect(items).toContain(v);
      seen.add(v);
    }
    expect(seen.size).toBe(items.length);
  });

  it('pick() throws on an empty array rather than returning undefined', () => {
    const rng = createRng('PICK', 'empty');
    expect(() => rng.pick([])).toThrow();
  });

  it('shuffle() preserves every element and does not mutate the input', () => {
    const rng = createRng('SHUFFLE', 'deck');
    const original = Array.from({ length: 40 }, (_, i) => i);
    const frozenCopy = [...original];
    const shuffled = rng.shuffle(original);

    expect(original).toEqual(frozenCopy);
    expect(shuffled).toHaveLength(original.length);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(frozenCopy);
  });

  it('shuffle() actually reorders', () => {
    const rng = createRng('SHUFFLE', 'order');
    const original = Array.from({ length: 40 }, (_, i) => i);
    expect(rng.shuffle(original)).not.toEqual(original);
  });

  it('shuffle() is deterministic for a seed', () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    const a = createRng('SAME', 'shuffle').shuffle(items);
    const b = createRng('SAME', 'shuffle').shuffle(items);
    expect(a).toEqual(b);
  });

  it('shuffle() handles empty and single-element arrays', () => {
    const rng = createRng('SHUFFLE', 'tiny');
    expect(rng.shuffle([])).toEqual([]);
    expect(rng.shuffle(['only'])).toEqual(['only']);
  });
});

describe('seed strings', () => {
  it('randomSeed avoids characters players confuse', () => {
    for (let i = 0; i < 200; i++) {
      expect(randomSeed(10)).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    }
  });

  it('normaliseSeed makes casing and punctuation irrelevant', () => {
    expect(normaliseSeed('abc-123')).toBe('ABC123');
    expect(normaliseSeed('  ABC 123  ')).toBe('ABC123');
    expect(normaliseSeed('AbC123')).toBe('ABC123');
  });

  it('normaliseSeed never yields an empty seed', () => {
    expect(normaliseSeed('')).toBe('FABRIC');
    expect(normaliseSeed('---')).toBe('FABRIC');
  });

  it('normalised seeds produce identical maps', () => {
    const a = take(normaliseSeed('fabric-empires'), 'map', 20);
    const b = take(normaliseSeed('FABRICEMPIRES'), 'map', 20);
    expect(a).toEqual(b);
  });
});
