/**
 * The presets offered on the setup screen.
 *
 * ⚠️ **A preset is a promise.** "Many small islands" has to be many small
 * islands, and every shape has to leave seven reachable factions, because each
 * faction carries one cluster of the exam: a world shape that quietly strands
 * two of them is a world shape that quietly removes two branches of DP-600
 * from the game. Neither of those failures throws, and neither shows up in any
 * other test.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  ANTAGONISTS,
  DEFAULT_WORLD_CHOICE,
  PACES,
  RIVAL_COUNTS,
  ROUGHNESS_LEVELS,
  WORLD_SHAPES,
  WORLD_SIZES,
  chooseAntagonistCamps,
  chooseStartPosition,
  createGameState,
  generateMap,
  hexKey,
  hexNeighbours,
  isPassableByLand,
  paceScale,
  rosterFor,
  worldOptions,
  type GameMap,
  type WorldChoice,
} from '../src/index.js';

/*
 * ⚠️ **Raised deliberately, and not to make a failing test pass.**
 *
 * These tests generate whole worlds: every shape crossed with every size, and
 * for two of them a real game started on each combination. That is seconds of
 * honest work, against vitest's default budget of five.
 *
 * The result was a test that passed on an idle machine and failed on a busy
 * one, and which failed on a DIFFERENT pair of cases each run because it is a
 * timeout rather than a fault. It cost two false diagnoses in one afternoon:
 * twice, an unrelated change appeared to have broken world generation, and
 * twice the truth was that the suite was simply loaded. Measured, the file
 * takes about 9.8 s alone and about 28 s while the rest of the suite runs.
 *
 * The timeout is not the property under test. What these tests assert is that
 * every preset leaves seven reachable factions, and that assertion is
 * deterministic. A clock is the wrong thing to be measuring here, so it is
 * given enough room to stop measuring it.
 */
vi.setConfig({ testTimeout: 45_000 });

/** A full choice from a partial one, so tests only name what they care about. */
const choice = (partial: Partial<WorldChoice>): WorldChoice => ({
  ...DEFAULT_WORLD_CHOICE,
  ...partial,
});

const SEEDS = ['FABRIC', 'DP600', 'HORDE', 'CONTOSO'];

function landmasses(map: GameMap): number[] {
  const land = new Set<string>();
  for (const tile of map.tiles.values()) {
    if (tile.terrain !== 'onelake') land.add(hexKey(tile.hex));
  }
  const seen = new Set<string>();
  const sizes: number[] = [];
  for (const key of land) {
    if (seen.has(key)) continue;
    let size = 0;
    const stack = [key];
    seen.add(key);
    while (stack.length > 0) {
      const current = stack.pop()!;
      size += 1;
      for (const n of hexNeighbours(map.tiles.get(current)!.hex)) {
        const nk = hexKey(n);
        if (land.has(nk) && !seen.has(nk)) {
          seen.add(nk);
          stack.push(nk);
        }
      }
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}

const everyCombination = WORLD_SHAPES.flatMap((shape) =>
  ROUGHNESS_LEVELS.flatMap((rough) =>
    SEEDS.map((seed) => ({ shape, rough, seed })),
  ),
);

describe('world presets', () => {
  it('leaves every faction reachable on land, on every combination', () => {
    for (const { shape, rough, seed } of everyCombination) {
      const map = generateMap(seed, worldOptions(choice({ shape: shape.id, roughness: rough.id })));
      const camps = chooseAntagonistCamps(map, chooseStartPosition(map), ANTAGONISTS.length);
      const label = `${shape.id}/${rough.id}/${seed}`;

      // All seven, or a branch of the exam has no village to take.
      expect(camps, `${label} camp count`).toHaveLength(ANTAGONISTS.length);
      for (const camp of camps) {
        expect(map.mainland.has(hexKey(camp)), `${label} camp off the home island`).toBe(true);
      }
    }
  });

  it('starts a real game on every combination', () => {
    for (const { shape, rough, seed } of everyCombination) {
      const state = createGameState(seed, {
        map: worldOptions(choice({ shape: shape.id, roughness: rough.id })),
      });
      const label = `${shape.id}/${rough.id}/${seed}`;
      expect([...state.factions.keys()], label).toHaveLength(ANTAGONISTS.length + 1);
      expect([...state.cities.values()], label).toHaveLength(ANTAGONISTS.length);
    }
  });

  it('gives each shape the number of landmasses its label claims', () => {
    for (const seed of SEEDS) {
      const count = (id: 'continent' | 'islands' | 'archipelago') => {
        const shape = WORLD_SHAPES.find((s) => s.id === id)!;
        const map = generateMap(seed, worldOptions(choice({ shape: id, roughness: 'rolling' })));
        const min = shape.map.minIslandSize ?? 6;
        return landmasses(map).filter((s) => s >= min).length;
      };

      expect(count('continent'), `${seed} continent`).toBe(1);
      expect(count('islands'), `${seed} islands`).toBeGreaterThan(1);
      expect(count('archipelago'), `${seed} archipelago`).toBeGreaterThan(4);
      // The labels have to stay in the right order relative to each other.
      expect(count('archipelago'), `${seed} ordering`).toBeGreaterThan(count('islands'));
    }
  });

  it('leaves a home island worth playing on, even at its smallest', () => {
    /*
     * ⚠️ Every faction shares the player's landmass, so it has to hold the
     * player and seven camps. The first version of the archipelago preset left
     * a 99-tile home island and villages two hexes apart, which is why the home
     * island now gets a larger reach than the rest.
     */
    for (const seed of SEEDS) {
      for (const shape of WORLD_SHAPES) {
        const map = generateMap(seed, worldOptions(choice({ shape: shape.id, roughness: 'rugged' })));
        expect(map.mainland.size, `${seed}/${shape.id} home island`).toBeGreaterThan(150);
      }
    }
  });

  it('makes roughness mean something, and the same thing on every seed', () => {
    const impassableShare = (id: 'gentle' | 'rolling' | 'rugged', seed: string) => {
      const map = generateMap(seed, worldOptions(choice({ shape: 'continent', roughness: id })));
      let land = 0;
      let blocked = 0;
      for (const tile of map.tiles.values()) {
        if (tile.terrain === 'onelake') continue;
        land += 1;
        if (!isPassableByLand(tile.terrain)) blocked += 1;
      }
      return blocked / land;
    };

    for (const seed of SEEDS) {
      const gentle = impassableShare('gentle', seed);
      const rolling = impassableShare('rolling', seed);
      const rugged = impassableShare('rugged', seed);
      expect(gentle, seed).toBeLessThan(rolling);
      expect(rolling, seed).toBeLessThan(rugged);
    }

    // Composition is a quantile, so the same setting gives the same share on
    // every seed. That is the guarantee that makes a named preset meaningful
    // rather than a suggestion.
    const shares = SEEDS.map((s) => impassableShare('rugged', s));
    for (const share of shares) {
      expect(share).toBeCloseTo(shares[0]!, 3);
    }
  });

  it('is deterministic: the same choices and seed give the same world', () => {
    const options = worldOptions(choice({ shape: 'archipelago', roughness: 'rugged' }));
    expect(landmasses(generateMap('FABRIC', options))).toEqual(
      landmasses(generateMap('FABRIC', options)),
    );
  });
});

describe('how many rivals, and which', () => {
  it('gives exactly the number asked for', () => {
    for (const count of RIVAL_COUNTS) {
      const ids = rosterFor(ANTAGONISTS, 'everything', count);
      expect(ids, `count ${count}`).toHaveLength(count);
      expect(new Set(ids).size, `count ${count} duplicates`).toBe(count);
    }
  });

  it('draws from the chosen branch first', () => {
    for (const focus of ['A', 'B', 'C'] as const) {
      const ids = rosterFor(ANTAGONISTS, focus, 3);
      const clusters = ids.map(
        (id) => ANTAGONISTS.find((a) => a.id === id)!.topicCluster,
      );
      // Everything that branch has, before anything it does not.
      const available = ANTAGONISTS.filter((a) =>
        a.topicCluster.startsWith(focus),
      ).length;
      const leading = clusters.slice(0, Math.min(available, 3));
      for (const cluster of leading) {
        expect(cluster.startsWith(focus), `${focus} -> ${clusters.join(',')}`).toBe(true);
      }
    }
  });

  it('still fills the roster when a branch has fewer clusters than asked for', () => {
    // Branch A has two clusters, so asking for five must borrow three others
    // rather than quietly returning two: fewer factions is fewer villages, and
    // fewer villages is a shorter game than the player chose.
    const ids = rosterFor(ANTAGONISTS, 'A', 5);
    expect(ids).toHaveLength(5);
  });

  it('never returns an empty roster', () => {
    // A game with no rivals has no Conquest ending and nobody to test you.
    expect(rosterFor(ANTAGONISTS, 'everything', 0).length).toBeGreaterThan(0);
    expect(rosterFor(ANTAGONISTS, 'everything', -3).length).toBeGreaterThan(0);
  });

  it('caps at the number of factions that exist', () => {
    expect(rosterFor(ANTAGONISTS, 'everything', 99)).toHaveLength(ANTAGONISTS.length);
  });

  it('actually builds a game with that many rivals and villages', () => {
    for (const count of RIVAL_COUNTS) {
      const state = createGameState('FABRIC', {
        antagonistIds: rosterFor(ANTAGONISTS, 'everything', count),
      });
      expect([...state.factions.keys()], `count ${count}`).toHaveLength(count + 1);
      expect([...state.cities.values()], `count ${count}`).toHaveLength(count);
    }
  });

  it('ignores an unknown id rather than throwing', () => {
    const state = createGameState('FABRIC', {
      antagonistIds: ['silo-horde', 'no-such-faction'],
    });
    expect([...state.factions.keys()]).toHaveLength(2);
  });

  it('falls back to the full roster if every id is unknown', () => {
    // Better a normal game than an empty one when a stale choice is loaded.
    const state = createGameState('FABRIC', { antagonistIds: ['nonsense'] });
    expect([...state.factions.keys()]).toHaveLength(ANTAGONISTS.length + 1);
  });
});

describe('pace', () => {
  it('is ordered, and standard is exactly the current timings', () => {
    expect(paceScale('relaxed')).toBeGreaterThan(paceScale('standard'));
    expect(paceScale('standard')).toBe(1);
    expect(paceScale('exam')).toBeLessThan(paceScale('standard'));
  });

  it('never returns zero or a negative, whatever it is handed', () => {
    // A zero would make every question expire on arrival.
    for (const pace of PACES) expect(pace.timeScale).toBeGreaterThan(0);
  });
});

describe('world size', () => {
  it('is ordered, and each one is a real hexagon of that radius', () => {
    const sizes = WORLD_SIZES.map((s) => {
      const radius = s.map.radius!;
      return { id: s.id, radius, tiles: 1 + 3 * radius * (radius + 1) };
    });
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]!.tiles, sizes[i]!.id).toBeGreaterThan(sizes[i - 1]!.tiles);
    }
    // And the generator agrees with the arithmetic.
    for (const size of sizes) {
      const map = generateMap('FABRIC', { radius: size.radius });
      expect(map.tiles.size, size.id).toBe(size.tiles);
    }
  });

  it('leaves every faction reachable at every size', () => {
    for (const size of WORLD_SIZES) {
      for (const shape of WORLD_SHAPES) {
        const map = generateMap('FABRIC', worldOptions(choice({ shape: shape.id, size: size.id })));
        const camps = chooseAntagonistCamps(map, chooseStartPosition(map), ANTAGONISTS.length);
        expect(camps, `${size.id}/${shape.id}`).toHaveLength(ANTAGONISTS.length);
      }
    }
  });
});
