/**
 * Seeded procedural map generation.
 *
 * Contract: the same seed and options always produce an identical map. That is
 * what makes a shared seed meaningful (D06, D39) and what the golden fixture
 * test protects. Nothing in here may read Math.random or the clock.
 */

import {
  hexDistance,
  hexKey,
  hexNeighbours,
  hexSpiral,
  type Hex,
} from '../hex/index.js';
import { createRng } from '../rng/index.js';
import { createNoise2D, fbm, type FbmOptions } from './noise.js';
import { isPassableByLand, type TerrainId } from './terrain.js';

export interface MapTile {
  readonly hex: Hex;
  readonly terrain: TerrainId;
  readonly river: boolean;
  /**
   * The neighbour this tile's river drains into, if any.
   *
   * Stored rather than derived: reconstructing courses from "which neighbours
   * are also rivers" draws a closed triangle wherever three river tiles touch,
   * because adjacency is symmetric and flow is not. It is also the data a
   * movement bonus along a river will need.
   */
  readonly flowTo: Hex | undefined;
  /** Normalised 0..1, retained for city siting and AI heuristics. */
  readonly elevation: number;
  readonly moisture: number;
}

export interface GameMap {
  readonly seed: string;
  readonly radius: number;
  readonly tiles: ReadonlyMap<string, MapTile>;
  /** Land tiles reachable on foot from one another, largest component only. */
  readonly landmassSize: number;
  /** Keys of that component, so callers can test membership in O(1). */
  readonly mainland: ReadonlySet<string>;
}

export interface MapOptions {
  /** Hex radius of the map. 25 gives 1951 tiles, the target size. */
  readonly radius: number;
  /** Exact share of tiles that become land. Quantiles hit this precisely. */
  readonly landFraction: number;
  /** Share of land that becomes impassable peaks. */
  readonly peaksFraction: number;
  /** Share of land that becomes highlands. Quarries are carved out of these. */
  readonly highlandsFraction: number;
  /** Chance a highland tile is a quarry instead. */
  readonly quarryChance: number;
  /** Share of land that becomes frontier wastes. */
  readonly wastesFraction: number;
  /** Share of the remaining lowland that becomes swamp. */
  readonly swampFraction: number;
  /** Chance a lowland tile hides a geothermal vent. */
  readonly ventChance: number;
  readonly elevation: FbmOptions;
  readonly moisture: FbmOptions;
  /** Coarse field that breaks the wastes into patches. */
  readonly corruption: FbmOptions;
  /** How hard the map edge is pushed under water, shaping one continent. */
  readonly edgeFalloff: number;
  readonly riverCount: number;
  /** Islands smaller than this are sunk, to remove one-tile speckle. */
  readonly minIslandSize: number;
  /**
   * How many separate landmasses to aim for.
   *
   * 1 reproduces the original single continent exactly, mask and all, which is
   * what the golden digests are pinned against.
   */
  readonly islands: number;
  /**
   * Blur passes over the elevation field before land and water are split.
   *
   * ⚠️ **This is what stops the coast being shredded.** Raw fbm has detail at
   * every scale, including the scale of a single hex, so thresholding it puts
   * that detail straight into the coastline: measured at radius 45, the main
   * continent had a perimeter **3.3 to 4.2 times** that of a circle of the same
   * area. The bulk was compact (slenderness 1.27 against a disc's 1.13) but the
   * edges were fringed into one-tile spits and threads, and close up that reads
   * as a map made of long narrow islands.
   *
   * Blurring before the split, rather than tidying the coastline afterwards,
   * keeps the land fraction EXACT: the quantile is taken on the smoothed field,
   * so the same number of tiles are land either way. It also leaves rivers
   * flowing downhill on the same field the coast was cut from.
   */
  readonly coastSmoothing: number;
}

export const DEFAULT_MAP_OPTIONS: MapOptions = Object.freeze({
  /*
   * ⚠️ Raised from 25. That is 3.2 times the tiles and roughly twice the
   * width: about 6,200 hexes and 156 world units across, against 1,950 and 87.
   *
   * Two things had to move with it or a bigger map would have been a worse
   * one. The aggro leash is now proportional to the map radius, or the far
   * camps would sit 45 hexes out and take 121 turns to be noticed. Erosion
   * droplets now scale with grid area, or each cell gets a third of the rain,
   * the valleys stop cutting, and the larger world comes out visibly blander
   * than the small one it replaced.
   */
  radius: 45,
  landFraction: 0.45,
  peaksFraction: 0.05,
  highlandsFraction: 0.22,
  quarryChance: 0.12,
  wastesFraction: 0.09,
  swampFraction: 0.14,
  ventChance: 0.03,
  elevation: Object.freeze({
    octaves: 5,
    frequency: 0.055,
    persistence: 0.5,
    lacunarity: 2,
  }),
  moisture: Object.freeze({
    octaves: 3,
    frequency: 0.09,
    persistence: 0.5,
    lacunarity: 2,
  }),
  corruption: Object.freeze({
    octaves: 2,
    frequency: 0.045,
    persistence: 0.5,
    lacunarity: 2,
  }),
  edgeFalloff: 1.9,
  riverCount: 14,
  minIslandSize: 6,
  /*
   * Five, measured. Ships and multiple islands were a Tier 0 cut, reinstated
   * on request, and the sweep in the archipelago work showed no combination of
   * noise settings would produce more than one landmass on its own.
   */
  /*
   * ⚠️ **One, until ships exist.** Archipelago generation works and is
   * tested, but shipping it as the default breaks the game: land units cannot
   * cross water, so factions placed on other islands can never reach the
   * player. Turning it on cost three AI tests and the defeat test, all of them
   * correctly reporting that nothing ever arrives.
   *
   * The capability lands now; the default flips in the naval phase (23).
   */
  islands: 1,
  /*
   * Six passes, measured. The coastline was fringed into one-tile spits: a
   * perimeter 4.17 times a circle of the same area, against a floor of 2.11
   * for this metric on a hex grid. Six passes brings that to 2.66, lifts the
   * thinnest part of the main continent from 15 hexes to 25, and removes the
   * detached scraps entirely, while still leaving the coast a shape rather
   * than a disc. Reducing the noise octaves instead made it WORSE (3.5 to 3.8),
   * because fewer octaves let the low frequencies meander into broad lobes.
   */
  coastSmoothing: 6,
});

/**
 * Axial coordinates are skewed, so sampling noise directly at (q, r) stretches
 * every feature along one diagonal. Converting to the pointy-top pixel frame
 * first keeps blobs round.
 */
function noiseCoords(h: Hex): { nx: number; ny: number } {
  const SQRT3 = Math.sqrt(3);
  return {
    nx: SQRT3 * h.q + (SQRT3 / 2) * h.r,
    ny: 1.5 * h.r,
  };
}

/**
 * Push elevation down towards the rim so the continent has a coast rather than
 * running off the edge of the world. Squared distance gives a flat interior and
 * a fast drop near the border.
 */
function edgeFactor(h: Hex, radius: number, falloff: number): number {
  const d = hexDistance({ q: 0, r: 0 }, h) / radius;
  return Math.max(0, 1 - Math.pow(d, falloff));
}

/**
 * Where the islands sit.
 *
 * ⚠️ **Turning up the noise frequency does not make an archipelago.** That was
 * measured across frequency, land fraction and falloff, and every combination
 * still produced one continent holding 97 to 100 percent of the land. The
 * reason is that fbm is dominated by its lowest octave, which spans the whole
 * map, and `edgeFactor` then adds a single radial hill centred on the origin.
 * Between them, the top slice of elevation is always "the middle of the map".
 *
 * So the shape has to come from the mask rather than from the noise: several
 * centres, each with its own falloff, and the land factor is whichever centre
 * is nearest. One centre at the origin reproduces the old behaviour exactly,
 * which is why the golden digests still hold.
 */
/**
 * An island: where its centre is, and how far its land reaches.
 *
 * Reach is per island rather than one number for all of them, because the home
 * island is deliberately bigger than the rest. See `islandPlan`.
 */
interface IslandCentre {
  readonly hex: Hex;
  readonly reach: number;
}

/**
 * ⚠️ **How big the home island is, relative to the lesser isles.**
 *
 * Doubling the reach makes it about four times the area. Measured on the first
 * version of the archipelago preset, an even scatter of eight islands left a
 * home island of **99 tiles** to hold the player and seven antagonist camps,
 * which is not a map, it is a scrum: villages ended up two hexes apart and the
 * opening was unsurvivable. Every faction has to be reachable by land (see
 * `chooseAntagonistCamps`), so the island they all share has to be a real
 * place.
 */
const HOME_ISLAND_BOOST = 2;

/**
 * Where the islands sit and how big each one is.
 *
 * The home island is centred on the origin and the lesser isles ring it, which
 * is also what puts the player in the middle of their own world: the largest
 * landmass becomes `map.mainland`, and `chooseStartPosition` starts the player
 * on that.
 *
 * ⚠️ **The reach is solved from the land fraction, not chosen.** Classification
 * is a quantile, so exactly `landFraction` of all tiles become land whatever
 * the mask says. If the island discs are too small to hold that many, the
 * surplus is taken from the masked-out sea between them and the islands grow
 * together: asking for eight produced two. One home disc of radius `2r` and
 * `n-1` discs of radius `r` cover about `3r^2 * (n + 3)` hexes on a hex grid
 * that holds `3R^2`, so `r = R * sqrt(landFraction / (n + 3))` makes them
 * exactly big enough and the spill disappears.
 */
function islandPlan(
  seed: string,
  radius: number,
  count: number,
  landFraction: number,
): IslandCentre[] {
  if (count <= 1) return [{ hex: { q: 0, r: 0 }, reach: radius }];

  const n = Math.max(2, count);
  const reach = Math.max(2, radius * Math.sqrt(landFraction / (n + 3)));
  const homeReach = reach * HOME_ISLAND_BOOST;

  const centres: IslandCentre[] = [{ hex: { q: 0, r: 0 }, reach: homeReach }];

  const rng = createRng(seed, 'map:islands');
  // Clear of the home island, clear of each other, and inside the rim so every
  // island still gets a coast rather than being cut off by the map edge.
  const fromHome = homeReach + reach * 1.15;
  const apart = reach * 2.15;
  const rim = radius - reach * 0.9;

  for (let attempt = 0; attempt < 4000 && centres.length < n; attempt++) {
    const angle = rng.float(0, Math.PI * 2);
    /*
     * Sampled on the annulus between the home island and the rim, by AREA.
     *
     * ⚠️ Uniform in radius would crowd the isles towards the middle, because
     * an annulus has far more room in its outer rings than its inner ones.
     * Measured on the first archipelago, the isles all sat inside about half
     * the map and the outer third was empty ocean. Interpolating on r squared
     * spreads them evenly over the water instead.
     */
    const distance = Math.sqrt(
      fromHome * fromHome +
        rng.float(0, 1) * Math.max(0, rim * rim - fromHome * fromHome),
    );
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    const q = Math.round((Math.sqrt(3) / 3) * x - y / 3);
    const r = Math.round((2 / 3) * y);
    const candidate = { q, r };
    if (hexDistance({ q: 0, r: 0 }, candidate) > rim) continue;
    if (hexDistance({ q: 0, r: 0 }, candidate) < fromHome) continue;
    if (centres.slice(1).some((c) => hexDistance(c.hex, candidate) < apart)) continue;
    centres.push({ hex: candidate, reach });
  }

  return centres;
}

/** The land mask: distance to the nearest island centre, not to the origin. */
function landFactor(h: Hex, centres: readonly IslandCentre[], falloff: number): number {
  let best = 0;
  for (const centre of centres) {
    const d = hexDistance(centre.hex, h) / centre.reach;
    const factor = Math.max(0, 1 - Math.pow(d, falloff));
    if (factor > best) best = factor;
  }
  return best;
}

/** Group passable land tiles into connected components. */
function findLandmasses(
  terrainOf: ReadonlyMap<string, TerrainId>,
): string[][] {
  const seen = new Set<string>();
  const components: string[][] = [];

  for (const [key, id] of terrainOf) {
    if (seen.has(key) || !isPassableByLand(id)) continue;

    const component: string[] = [];
    const queue: string[] = [key];
    seen.add(key);

    while (queue.length > 0) {
      const current = queue.pop()!;
      component.push(current);
      const [q, r] = current.split(',').map(Number) as [number, number];
      for (const n of hexNeighbours({ q, r })) {
        const nKey = hexKey(n);
        if (seen.has(nKey)) continue;
        const nTerrain = terrainOf.get(nKey);
        if (nTerrain === undefined || !isPassableByLand(nTerrain)) continue;
        seen.add(nKey);
        queue.push(nKey);
      }
    }
    components.push(component);
  }

  return components;
}

export function generateMap(
  seed: string,
  overrides: Partial<MapOptions> = {},
): GameMap {
  const options: MapOptions = { ...DEFAULT_MAP_OPTIONS, ...overrides };
  if (options.radius < 1) {
    throw new Error(`Map radius must be >= 1, got ${options.radius}`);
  }

  const hexes = hexSpiral({ q: 0, r: 0 }, options.radius);
  const elevationNoise = createNoise2D(createRng(seed, 'map:elevation'));

  /*
   * One island keeps the whole map as its reach, which is precisely what
   * `edgeFactor` did. Several islands each get a share of it, or their
   * falloffs overlap and they grow back into a single continent.
   */
  const centres = islandPlan(seed, options.radius, options.islands, options.landFraction);
  const mask = (h: Hex): number =>
    centres.length === 1
      ? edgeFactor(h, options.radius, options.edgeFalloff)
      : landFactor(h, centres, options.edgeFalloff);
  const moistureNoise = createNoise2D(createRng(seed, 'map:moisture'));
  const corruptionNoise = createNoise2D(createRng(seed, 'map:corruption'));

  // Height fields are seed-derived and never change between attempts. Only the
  // sea level moves, which keeps retries cheap and the coastline coherent.
  const field = hexes.map((h) => {
    const { nx, ny } = noiseCoords(h);
    const raw = fbm(elevationNoise, nx, ny, options.elevation);
    const shaped = raw * mask(h);
    return {
      hex: h,
      key: hexKey(h),
      elevation: shaped,
      /**
       * The smoothed copy that decides land, water and terrain zone.
       *
       * Starts equal to `elevation` and is blurred below. Kept separate
       * because the two are different questions: how tall is this ground, and
       * what KIND of ground is it.
       */
      shapeScore: shaped,
      moisture: fbm(moistureNoise, nx, ny, options.moisture),
      corruption: fbm(corruptionNoise, nx, ny, options.corruption),
      edgeDistance: hexDistance({ q: 0, r: 0 }, h) / options.radius,
    };
  });

  // Keyed view of the same records. The river walk probes neighbours tens of
  // thousands of times, and a linear scan there turns generation from
  // milliseconds into seconds.
  const fieldByKey = new Map(field.map((f) => [f.key, f]));

  /*
   * Smooth the field that DECIDES the coastline, and only that field.
   *
   * Self weight 2 against six neighbours at 1: enough to cut hex-scale detail
   * out of the coastline without flattening the continent into a dome. Tiles at
   * the rim simply have fewer neighbours to average with, which is harmless
   * because the edge falloff has already drowned them.
   *
   * ⚠️ **`elevation` itself is left alone.** `rawTileHeight` in the renderer
   * reads it as the interpolant between a terrain profile's base and its full
   * range, so blurring it would have smoothed the coast by flattening every
   * hill on the map: precisely the blandness the erosion-droplet scaling in
   * section 22 was added to avoid. Smoothing the classifier and keeping the
   * relief is the whole reason these are two fields.
   *
   * ⚠️ Done before the quantile, so the land fraction is unaffected. Tidying
   * the coastline after classification would have changed how much land there
   * is and quietly broken the composition guarantees below.
   */
  const SELF_WEIGHT = 2;
  for (let pass = 0; pass < options.coastSmoothing; pass++) {
    const blurred = new Map<string, number>();
    for (const f of field) {
      let sum = f.shapeScore * SELF_WEIGHT;
      let weight = SELF_WEIGHT;
      for (const n of hexNeighbours(f.hex)) {
        const neighbour = fieldByKey.get(hexKey(n));
        if (!neighbour) continue;
        sum += neighbour.shapeScore;
        weight += 1;
      }
      blurred.set(f.key, sum / weight);
    }
    for (const f of field) f.shapeScore = blurred.get(f.key)!;
  }

  /*
   * Classification is by QUANTILE, not by fixed elevation thresholds.
   *
   * Fractal noise concentrates around its midpoint, so constants like
   * "peaks above 0.845" simply never fire: the first version of this generator
   * produced maps of pure plains, with no peaks, highlands, quarries or wastes
   * anywhere. Worse, the wastes rule wanted tiles far from the centre while the
   * edge falloff had already drowned exactly those tiles, so that terrain was
   * unreachable by construction.
   *
   * Ranking tiles against each other guarantees the composition on every seed
   * and makes the land fraction exact rather than something to search for.
   */
  const byElevation = [...field].sort(
    (a, b) => a.shapeScore - b.shapeScore || a.key.localeCompare(b.key),
  );
  const waterCount = Math.round(field.length * (1 - options.landFraction));
  const landTiles = byElevation.slice(waterCount); // ascending elevation

  const terrainOf = new Map<string, TerrainId>();
  for (const f of byElevation.slice(0, waterCount)) {
    terrainOf.set(f.key, 'onelake');
  }

  const featureRng = createRng(seed, 'map:features');

  const peakCount = Math.round(landTiles.length * options.peaksFraction);
  const highlandCount = Math.round(landTiles.length * options.highlandsFraction);
  const peakStart = landTiles.length - peakCount;
  const highlandStart = peakStart - highlandCount;

  for (const f of landTiles.slice(peakStart)) {
    terrainOf.set(f.key, 'semanticPeaks');
  }
  for (const f of landTiles.slice(highlandStart, peakStart)) {
    terrainOf.set(
      f.key,
      featureRng.chance(options.quarryChance) ? 'parquetQuarry' : 'deltaHighlands',
    );
  }

  const lowland = landTiles.slice(0, highlandStart);

  // Wastes are the frontier: far from the heartland, dry, and blighted.
  // Distance alone produced a uniform purple stripe around the entire coast,
  // which looked like a border decoration rather than territory. The coarse
  // corruption field breaks that ring into patches with an interior reach.
  const wasteCount = Math.min(
    lowland.length,
    Math.round(landTiles.length * options.wastesFraction),
  );
  const wasteScore = (f: (typeof field)[number]) =>
    f.edgeDistance * 1.0 + f.corruption * 0.9 - f.moisture * 0.4;
  const wasteRanked = [...lowland].sort(
    (a, b) => wasteScore(b) - wasteScore(a) || a.key.localeCompare(b.key),
  );
  const wasteKeys = new Set(wasteRanked.slice(0, wasteCount).map((f) => f.key));
  for (const key of wasteKeys) terrainOf.set(key, 'ungovernedWastes');

  // Swamp is the wettest of what is left.
  const remaining = lowland.filter((f) => !wasteKeys.has(f.key));
  const swampCount = Math.round(remaining.length * options.swampFraction);
  const swampRanked = [...remaining].sort(
    (a, b) => b.moisture - a.moisture || a.key.localeCompare(b.key),
  );
  const swampKeys = new Set(swampRanked.slice(0, swampCount).map((f) => f.key));
  for (const key of swampKeys) terrainOf.set(key, 'legacySwamp');

  // Everything else is plains, with a rare vent. Iterating in field order
  // rather than in a sorted order keeps the RNG stream stable.
  for (const f of field) {
    if (terrainOf.has(f.key)) continue;
    terrainOf.set(
      f.key,
      featureRng.chance(options.ventChance) ? 'geothermalVent' : 'rawFilePlains',
    );
  }

  // Sink speckle islands. A one-tile island is unreachable clutter that makes
  // pathfinding and the AI look broken for no gameplay benefit.
  const components = findLandmasses(terrainOf);
  components.sort((a, b) => b.length - a.length);
  const mainland = components[0] ?? [];
  const mainlandSet = new Set(mainland);

  for (const component of components.slice(1)) {
    if (component.length >= options.minIslandSize) continue;
    for (const key of component) terrainOf.set(key, 'onelake');
  }

  // Rivers run downhill from high ground until they meet water or stall.
  const rivers = new Set<string>();
  const flowTo = new Map<string, Hex>();
  const riverRng = createRng(seed, 'map:rivers');
  // Sources are the highest passable land. Ranking again rather than using an
  // elevation constant, for the same reason the terrain thresholds are ranked.
  const sources = landTiles
    .slice(Math.floor(landTiles.length * 0.7))
    .filter((f) => {
      const id = terrainOf.get(f.key);
      return id !== undefined && isPassableByLand(id);
    })
    .sort((a, b) => b.elevation - a.elevation || a.key.localeCompare(b.key));

  if (sources.length > 0) {
    const shuffled = riverRng.shuffle(sources.slice(0, Math.max(40, options.riverCount * 4)));
    for (const source of shuffled.slice(0, options.riverCount)) {
      let current = source;
      // The cap stops a pathological flat region looping forever; a river that
      // long would cross the whole map anyway.
      for (let step = 0; step < options.radius * 3; step++) {
        rivers.add(current.key);

        let lowest: (typeof field)[number] | undefined;
        for (const n of hexNeighbours(current.hex)) {
          const candidate = fieldByKey.get(hexKey(n));
          if (candidate === undefined) continue;
          if (lowest === undefined || candidate.elevation < lowest.elevation) {
            lowest = candidate;
          }
        }

        if (lowest === undefined) break;
        if (lowest.elevation >= current.elevation) break; // local minimum

        // Record the link before deciding whether to stop, so a river that
        // reaches the sea is drawn all the way to the coast rather than
        // stopping one tile short.
        flowTo.set(current.key, lowest.hex);

        if (terrainOf.get(lowest.key) === 'onelake') break; // reached the sea
        if (rivers.has(lowest.key)) break; // joined an existing river
        current = lowest;
      }
    }
  }

  const tiles = new Map<string, MapTile>();
  for (const f of field) {
    const id = terrainOf.get(f.key)!;
    const isRiver = rivers.has(f.key) && id !== 'onelake';
    tiles.set(f.key, {
      hex: f.hex,
      terrain: id,
      river: isRiver,
      flowTo: isRiver ? flowTo.get(f.key) : undefined,
      elevation: f.elevation,
      moisture: f.moisture,
    });
  }

  return {
    seed,
    radius: options.radius,
    tiles,
    landmassSize: mainlandSet.size,
    mainland: mainlandSet,
  };
}

/**
 * A stable digest of the gameplay-visible map content.
 *
 * Deliberately excludes elevation and moisture: those are inputs, and a golden
 * test should fail when the map a player sees changes, not when an internal
 * float moves in the last decimal place.
 */
export function mapDigest(map: GameMap): string {
  const keys = [...map.tiles.keys()].sort();
  let hash = 0x811c9dc5;
  for (const key of keys) {
    const tile = map.tiles.get(key)!;
    const line = `${key}:${tile.terrain}:${tile.river ? 1 : 0};`;
    for (let i = 0; i < line.length; i++) {
      hash ^= line.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Terrain counts, used by tests and by the map preview in the UI. */
export function terrainHistogram(map: GameMap): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const tile of map.tiles.values()) {
    counts[tile.terrain] = (counts[tile.terrain] ?? 0) + 1;
  }
  return counts;
}
