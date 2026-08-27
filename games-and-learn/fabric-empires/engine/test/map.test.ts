import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAP_OPTIONS,
  generateMap,
  isPassableByLand,
  mapDigest,
  terrainHistogram,
  terrain,
  tileYields,
  TERRAIN_IDS,
  RESOURCE_IDS,
  type GameMap,
} from '../src/map/index.js';
import { hexDistance, hexKey, hexNeighbours } from '../src/hex/index.js';

const ORIGIN = { q: 0, r: 0 };

function landTiles(map: GameMap) {
  return [...map.tiles.values()].filter((t) => t.terrain !== 'onelake');
}

describe('determinism', () => {
  it('the same seed produces an identical map', () => {
    const a = generateMap('FABRIC');
    const b = generateMap('FABRIC');
    expect(mapDigest(a)).toBe(mapDigest(b));
    for (const [key, tile] of a.tiles) {
      expect(b.tiles.get(key)).toEqual(tile);
    }
  });

  /*
   * Golden digests. These pin the map a shared seed produces.
   *
   * If a change to the generator or the noise breaks these, that is the test
   * doing its job: every previously shared seed now yields a different world.
   * Update the constants deliberately, never reflexively.
   *
   * ⚠️ **Pinned at an explicit radius, not the default.** They used to call
   * `generateMap(seed)` and so mixed two separate things: whether the
   * generator still behaves identically, and how big a new game happens to
   * be. Raising the default map size then broke a test about determinism,
   * which says nothing useful. Held at 25, these digests are unchanged across
   * that resize, which is exactly the evidence wanted: the world got bigger
   * and the generator did not move.
   */
  const GOLDEN = { radius: 25, islands: 1, landFraction: 0.45 } as const;

  /*
   * ⚠️ **Two sets, deliberately.**
   *
   * Coast smoothing changed what the default generator produces, so the
   * digests below it had to move. Freezing a second set at `coastSmoothing: 0`
   * keeps the original evidence intact: these three hashes are the ones this
   * file has always asserted, and they still hold, which proves the noise, the
   * mask and the quantile classification were not touched. Only a new stage was
   * added in front of them.
   *
   * Without the second set, "the digests changed because I meant them to" and
   * "the digests changed because I broke something" would look identical.
   */
  it('matches the golden digests with smoothing off, exactly as before', () => {
    const raw = { ...GOLDEN, coastSmoothing: 0 } as const;
    expect(mapDigest(generateMap('FABRIC', raw))).toBe('43c60ea9');
    expect(mapDigest(generateMap('ALPHA', raw))).toBe('33bc72b1');
    expect(mapDigest(generateMap('DP600', raw))).toBe('12c5f509');
  });

  it('matches the golden digests', () => {
    expect(mapDigest(generateMap('FABRIC', GOLDEN))).toBe('3b00e3da');
    expect(mapDigest(generateMap('ALPHA', GOLDEN))).toBe('3eb41ad3');
    expect(mapDigest(generateMap('DP600', GOLDEN))).toBe('12dc97fe');
  });

  it('different seeds produce different maps', () => {
    const digests = ['FABRIC', 'ALPHA', 'DP600', 'SEED1', 'SEED2'].map((s) =>
      mapDigest(generateMap(s)),
    );
    expect(new Set(digests).size).toBe(digests.length);
  });

  it('the digest ignores tile insertion order', () => {
    const map = generateMap('FABRIC');
    const reversed: GameMap = {
      ...map,
      tiles: new Map([...map.tiles.entries()].reverse()),
    };
    expect(mapDigest(reversed)).toBe(mapDigest(map));
  });
});

describe('shape', () => {
  it('is a hexagon of the requested radius', () => {
    for (const radius of [3, 10, 25]) {
      const map = generateMap('SHAPE', { radius });
      expect(map.tiles.size).toBe(1 + 3 * radius * (radius + 1));
      for (const tile of map.tiles.values()) {
        expect(hexDistance(ORIGIN, tile.hex)).toBeLessThanOrEqual(radius);
      }
    }
  });

  it('the default radius gives the intended world size', () => {
    // 45 rings: 3 * 45 * 46 + 1. Raised from 25 (1,951) so the map is about
    // 3.2 times the area and twice the width.
    expect(generateMap('SIZE').tiles.size).toBe(6211);
    expect(generateMap('SIZE').radius).toBe(45);
  });

  it('every tile key matches its own hex', () => {
    const map = generateMap('KEYS', { radius: 8 });
    for (const [key, tile] of map.tiles) {
      expect(key).toBe(hexKey(tile.hex));
    }
  });

  it('rejects a degenerate radius', () => {
    expect(() => generateMap('BAD', { radius: 0 })).toThrow();
  });
});

describe('composition', () => {
  it('hits the requested land fraction exactly, on every seed', () => {
    // This is the payoff of quantile classification. A threshold-based
    // generator drifts wildly between seeds; this one cannot.
    for (const seed of ['FABRIC', 'ALPHA', 'DP600', 'ZZZ', 'Q7']) {
      const map = generateMap(seed);
      const land = landTiles(map).length;
      expect(land / map.tiles.size).toBeCloseTo(
        DEFAULT_MAP_OPTIONS.landFraction,
        2,
      );
    }
  });

  it('honours a land fraction override', () => {
    for (const landFraction of [0.25, 0.6, 0.8]) {
      const map = generateMap('OVERRIDE', { landFraction });
      const land = landTiles(map).length;
      expect(land / map.tiles.size).toBeCloseTo(landFraction, 2);
    }
  });

  it('produces every terrain type, which the first generator did not', () => {
    // The original threshold-based version silently emitted only plains,
    // swamp and water. Peaks, highlands, quarries and wastes were unreachable.
    const map = generateMap('FABRIC');
    const hist = terrainHistogram(map);
    for (const id of TERRAIN_IDS) {
      expect(hist[id] ?? 0).toBeGreaterThan(0);
    }
  });

  it('produces every terrain type across many seeds, not just a lucky one', () => {
    for (const seed of ['ALPHA', 'DP600', 'BRAVO', 'DELTA', 'ECHO']) {
      const hist = terrainHistogram(generateMap(seed));
      for (const id of TERRAIN_IDS) {
        expect(hist[id] ?? 0, `${id} missing for seed ${seed}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps peaks, highlands, wastes and swamp at their configured shares', () => {
    const map = generateMap('FABRIC');
    const hist = terrainHistogram(map);
    const land = landTiles(map).length;

    expect((hist['semanticPeaks'] ?? 0) / land).toBeCloseTo(
      DEFAULT_MAP_OPTIONS.peaksFraction,
      2,
    );
    // Quarries are carved out of the highland band, so the two sum to it.
    const highlandBand =
      (hist['deltaHighlands'] ?? 0) + (hist['parquetQuarry'] ?? 0);
    expect(highlandBand / land).toBeCloseTo(
      DEFAULT_MAP_OPTIONS.highlandsFraction,
      2,
    );
    expect((hist['ungovernedWastes'] ?? 0) / land).toBeCloseTo(
      DEFAULT_MAP_OPTIONS.wastesFraction,
      2,
    );
  });

  it('keeps the scarce resource scarce', () => {
    const map = generateMap('FABRIC');
    const vents = terrainHistogram(map)['geothermalVent'] ?? 0;
    const land = landTiles(map).length;
    expect(vents / land).toBeLessThan(0.05);
    expect(vents).toBeGreaterThan(0);
  });
});

describe('geography', () => {
  it('puts the wastes on the frontier, not in the heartland', () => {
    const map = generateMap('FABRIC');
    const wastes = [...map.tiles.values()].filter(
      (t) => t.terrain === 'ungovernedWastes',
    );
    const meanWasteDistance =
      wastes.reduce((sum, t) => sum + hexDistance(ORIGIN, t.hex), 0) /
      wastes.length;
    const meanLandDistance =
      landTiles(map).reduce((sum, t) => sum + hexDistance(ORIGIN, t.hex), 0) /
      landTiles(map).length;
    expect(meanWasteDistance).toBeGreaterThan(meanLandDistance);
  });

  it('leaves one dominant landmass rather than an archipelago', () => {
    for (const seed of ['FABRIC', 'ALPHA', 'DP600']) {
      const map = generateMap(seed);
      const land = landTiles(map).length;
      // Peaks are impassable so they are excluded from the walkable landmass,
      // which is why this is a share rather than an equality.
      expect(map.landmassSize / land).toBeGreaterThan(0.85);
    }
  });

  it('sinks speckle islands', () => {
    const map = generateMap('FABRIC');
    const seen = new Set<string>();
    const sizes: number[] = [];

    for (const [key, tile] of map.tiles) {
      if (seen.has(key) || !isPassableByLand(tile.terrain)) continue;
      let size = 0;
      const queue = [key];
      seen.add(key);
      while (queue.length > 0) {
        const current = queue.pop()!;
        size++;
        const t = map.tiles.get(current)!;
        for (const n of hexNeighbours(t.hex)) {
          const nKey = hexKey(n);
          if (seen.has(nKey)) continue;
          const nTile = map.tiles.get(nKey);
          if (!nTile || !isPassableByLand(nTile.terrain)) continue;
          seen.add(nKey);
          queue.push(nKey);
        }
      }
      sizes.push(size);
    }

    for (const size of sizes) {
      expect(size).toBeGreaterThanOrEqual(DEFAULT_MAP_OPTIONS.minIslandSize);
    }
  });

  /*
   * Coastline quality.
   *
   * ⚠️ The complaint was that the map looked like long narrow islands, and the
   * first metric tried said everything was fine: the main continent scored 1.27
   * for slenderness against a disc's 1.13. It was fine, in the BULK. The damage
   * was all at the edge, where the coast was fringed into one-tile spits, and
   * an average over 2,800 tiles cannot see a fringe.
   *
   * So the thing pinned here is the coast itself: perimeter against the
   * perimeter of a circle of the same area. Counting an exposed hex edge per
   * missing land neighbour, an ideal blob on this grid scores about 2.1, so the
   * floor is not 1.0. Before smoothing this ran 3.3 to 4.2; it now runs 2.3 to
   * 2.7. The bound is 3.0, which is comfortably below where it was and well
   * above where it is.
   */
  it('does not fringe the coastline into spits and threads', () => {
    for (const seed of ['FABRIC', 'ALPHA', 'DP600', 'HORDE']) {
      const map = generateMap(seed);
      const land = new Set(landTiles(map).map((t) => hexKey(t.hex)));

      let perimeter = 0;
      let spindly = 0;
      for (const key of land) {
        const tile = map.tiles.get(key)!;
        const neighbours = hexNeighbours(tile.hex).filter((n) =>
          land.has(hexKey(n)),
        ).length;
        perimeter += 6 - neighbours;
        if (neighbours <= 2) spindly += 1;
      }

      const roughness = perimeter / (2 * Math.sqrt(Math.PI * land.size));
      expect(roughness, `${seed} coastline roughness`).toBeLessThan(3);
      // Spits and threads: tiles with almost no land around them.
      expect(spindly / land.size, `${seed} spindly share`).toBeLessThan(0.004);
    }
  });

  it('keeps elevation and moisture normalised', () => {
    for (const tile of generateMap('FABRIC').tiles.values()) {
      expect(tile.elevation).toBeGreaterThanOrEqual(0);
      expect(tile.elevation).toBeLessThanOrEqual(1);
      expect(tile.moisture).toBeGreaterThanOrEqual(0);
      expect(tile.moisture).toBeLessThanOrEqual(1);
    }
  });

  it('drowns the map rim, so the continent has a coast', () => {
    const map = generateMap('FABRIC');
    const radius = map.radius;
    for (const tile of map.tiles.values()) {
      if (hexDistance(ORIGIN, tile.hex) === radius) {
        expect(tile.terrain).toBe('onelake');
      }
    }
  });
});

describe('rivers', () => {
  it('exist', () => {
    for (const seed of ['FABRIC', 'ALPHA', 'DP600']) {
      const map = generateMap(seed);
      const rivers = [...map.tiles.values()].filter((t) => t.river);
      expect(rivers.length).toBeGreaterThan(0);
    }
  });

  it('never run across open water', () => {
    for (const tile of generateMap('FABRIC').tiles.values()) {
      if (tile.river) expect(tile.terrain).not.toBe('onelake');
    }
  });

  it('form connected courses rather than isolated specks', () => {
    const map = generateMap('FABRIC');
    for (const tile of map.tiles.values()) {
      if (!tile.river) continue;
      const touchesRiverOrSea = hexNeighbours(tile.hex).some((n) => {
        const neighbour = map.tiles.get(hexKey(n));
        return (
          neighbour !== undefined &&
          (neighbour.river || neighbour.terrain === 'onelake')
        );
      });
      expect(touchesRiverOrSea).toBe(true);
    }
  });

  it('start high and end low', () => {
    const map = generateMap('FABRIC');
    const rivers = [...map.tiles.values()].filter((t) => t.river);
    const land = landTiles(map);
    const meanRiverElevation =
      rivers.reduce((s, t) => s + t.elevation, 0) / rivers.length;
    const meanLandElevation =
      land.reduce((s, t) => s + t.elevation, 0) / land.length;
    // Rivers are carved from high ground downwards, so on average they sit
    // above the mean land tile even though they end at the coast.
    expect(meanRiverElevation).toBeGreaterThan(meanLandElevation);
  });

  it('always flow downhill', () => {
    for (const seed of ['FABRIC', 'ALPHA', 'DP600']) {
      const map = generateMap(seed);
      for (const tile of map.tiles.values()) {
        if (!tile.flowTo) continue;
        const downstream = map.tiles.get(hexKey(tile.flowTo));
        expect(downstream).toBeDefined();
        expect(downstream!.elevation).toBeLessThan(tile.elevation);
      }
    }
  });

  it('drain into an adjacent tile, never a distant one', () => {
    // The renderer draws a straight line along this link, so a non-adjacent
    // target would paint a river streaking across the map.
    const map = generateMap('FABRIC');
    for (const tile of map.tiles.values()) {
      if (!tile.flowTo) continue;
      expect(hexDistance(tile.hex, tile.flowTo)).toBe(1);
    }
  });

  it('only carry a downstream link on river tiles', () => {
    for (const tile of generateMap('FABRIC').tiles.values()) {
      if (!tile.river) expect(tile.flowTo).toBeUndefined();
    }
  });

  it('never loop back on themselves', () => {
    // Following the links from any river tile must terminate, not cycle.
    const map = generateMap('FABRIC');
    for (const start of map.tiles.values()) {
      if (!start.river) continue;
      const seen = new Set<string>();
      let current = start;
      while (current.flowTo) {
        const key = hexKey(current.hex);
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        const next = map.tiles.get(hexKey(current.flowTo));
        if (!next) break;
        current = next;
      }
    }
  });

  it('mostly reach the sea or merge, rather than stranding inland', () => {
    const map = generateMap('FABRIC');
    const rivers = [...map.tiles.values()].filter((t) => t.river);
    const withOutflow = rivers.filter((t) => t.flowTo !== undefined);
    expect(withOutflow.length / rivers.length).toBeGreaterThan(0.8);
  });
});

describe('terrain table', () => {
  it('describes every terrain id exactly once', () => {
    expect(new Set(TERRAIN_IDS).size).toBe(TERRAIN_IDS.length);
    for (const id of TERRAIN_IDS) {
      expect(terrain(id).id).toBe(id);
      expect(terrain(id).label.length).toBeGreaterThan(0);
    }
  });

  it('never gives a negative yield', () => {
    for (const id of TERRAIN_IDS) {
      for (const resource of RESOURCE_IDS) {
        expect(terrain(id).yields[resource]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('marks peaks impassable and water non-settleable', () => {
    expect(isPassableByLand('semanticPeaks')).toBe(false);
    expect(isPassableByLand('onelake')).toBe(false);
    expect(isPassableByLand('rawFilePlains')).toBe(true);
    expect(terrain('onelake').water).toBe(true);
    expect(terrain('onelake').settleable).toBe(false);
    expect(terrain('semanticPeaks').settleable).toBe(false);
  });

  it('gives every passable terrain a positive finite move cost', () => {
    for (const id of TERRAIN_IDS) {
      if (!isPassableByLand(id) && !terrain(id).water) continue;
      expect(terrain(id).moveCost).toBeGreaterThan(0);
      expect(Number.isFinite(terrain(id).moveCost)).toBe(true);
    }
  });

  it('adds the river bonus without mutating the base yields', () => {
    const dry = tileYields('rawFilePlains', false);
    const wet = tileYields('rawFilePlains', true);
    expect(wet.data).toBe(dry.data + 1);
    expect(wet.compute).toBe(dry.compute);
    // The table itself must be untouched by the call above.
    expect(terrain('rawFilePlains').yields.data).toBe(2);
  });
});

describe('performance', () => {
  it('generates a full-size map fast enough to feel instant', () => {
    const started = performance.now();
    generateMap('PERF');
    const elapsed = performance.now() - started;
    // Generous ceiling: the observed time is a few milliseconds, so this only
    // fires if something reintroduces an accidental quadratic scan.
    expect(elapsed).toBeLessThan(500);
  });
});
