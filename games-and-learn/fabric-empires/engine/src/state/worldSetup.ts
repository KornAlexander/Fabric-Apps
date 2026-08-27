/**
 * The choices offered when a game starts.
 *
 * ⚠️ **Presets, not sliders.** Map options interact: land fraction, island
 * count, blur radius and the minimum island size are not independent, and a
 * player who sets seven islands at 45% land does not get seven islands, they
 * get a continent with bays. Naming a handful of combinations that were each
 * measured is more honest than exposing six numbers and hoping.
 *
 * These live in the engine rather than the UI because they are statements
 * about what the generator can actually produce. The app renders them; it does
 * not get to invent new ones.
 */

import type { MapOptions } from '../map/index.js';

export type WorldShapeId = 'continent' | 'islands' | 'archipelago';
export type RoughnessId = 'gentle' | 'rolling' | 'rugged';

export interface WorldShape {
  readonly id: WorldShapeId;
  readonly label: string;
  readonly detail: string;
  readonly map: Partial<MapOptions>;
}

/**
 * ⚠️ Every shape keeps its factions on the player's landmass, because land
 * units cannot cross water (see `chooseAntagonistCamps`). Islands here change
 * where the fighting happens and how much of the world is unclaimed, not who
 * you can reach.
 */
export const WORLD_SHAPES: readonly WorldShape[] = Object.freeze([
  {
    id: 'continent',
    label: 'One great continent',
    detail: 'A single landmass with a long, worked coastline. Nowhere to hide.',
    map: { islands: 1, landFraction: 0.45, coastSmoothing: 6, minIslandSize: 6 },
  },
  {
    id: 'islands',
    label: 'A few large islands',
    detail: 'A broad home island and three lesser lands across the water.',
    map: { islands: 4, landFraction: 0.15, coastSmoothing: 3, minIslandSize: 30 },
  },
  {
    id: 'archipelago',
    label: 'Many small islands',
    detail: 'A crowded home island ringed by scattered isles and a great deal of sea.',
    map: { islands: 8, landFraction: 0.15, coastSmoothing: 1, minIslandSize: 14 },
  },
]);

export interface Roughness {
  readonly id: RoughnessId;
  readonly label: string;
  readonly detail: string;
  readonly map: Partial<MapOptions>;
}

/**
 * How much of the land is high ground.
 *
 * This changes what the map IS, not how it is drawn: peaks are impassable and
 * highlands are slow, so roughness decides where armies can go, where cities
 * can stand, and therefore where the war happens. A purely visual "taller
 * hills" setting would have been a lie dressed as a choice.
 */
export const ROUGHNESS_LEVELS: readonly Roughness[] = Object.freeze([
  {
    id: 'gentle',
    label: 'Gentle',
    detail: 'Broad plains and few mountains. Armies move freely and fronts are wide.',
    map: { peaksFraction: 0.02, highlandsFraction: 0.12, swampFraction: 0.18 },
  },
  {
    id: 'rolling',
    label: 'Rolling',
    detail: 'Hills, river valleys and a spine of mountains. The balanced world.',
    map: { peaksFraction: 0.05, highlandsFraction: 0.22, swampFraction: 0.14 },
  },
  {
    id: 'rugged',
    label: 'Rugged',
    detail: 'High country everywhere. Passes matter, and a held valley is worth an army.',
    map: { peaksFraction: 0.11, highlandsFraction: 0.34, swampFraction: 0.08 },
  },
]);

export interface WorldChoice {
  readonly shape: WorldShapeId;
  readonly roughness: RoughnessId;
  readonly size: WorldSizeId;
  readonly focus: FocusId;
  readonly rivals: number;
  readonly pace: PaceId;
  /**
   * How many people are playing on this screen.
   *
   * ⚠️ Two is CO-OP, not a rival. One empire, and a battle asks both seats at
   * once so a parent and a child can play the same game at their own levels.
   */
  readonly players: 1 | 2;
  /** Course the first seat answers from. This one also builds the world. */
  readonly courseP1: string;
  /** Course the second seat answers from. Questions only. */
  readonly courseP2: string;
}

export const DEFAULT_WORLD_CHOICE: WorldChoice = Object.freeze({
  shape: 'continent',
  roughness: 'rolling',
  size: 'standard',
  focus: 'everything',
  rivals: 7,
  pace: 'standard',
  players: 1,
  courseP1: 'dp600',
  courseP2: 'klasse1',
});

/**
 * Turn a set of choices into map overrides.
 *
 * Order matters: shape is applied first because it owns the land fraction and
 * the island count, then roughness, then size, and none of the three writes a
 * key another one owns.
 */
export function worldOptions(choice: WorldChoice): Partial<MapOptions> {
  const shape =
    WORLD_SHAPES.find((s) => s.id === choice.shape) ?? WORLD_SHAPES[0]!;
  const rough =
    ROUGHNESS_LEVELS.find((r) => r.id === choice.roughness) ?? ROUGHNESS_LEVELS[1]!;
  const size = WORLD_SIZES.find((s) => s.id === choice.size) ?? WORLD_SIZES[1]!;
  return { ...shape.map, ...rough.map, ...size.map };
}

// How big -----------------------------------------------------------------

export type WorldSizeId = 'small' | 'standard' | 'large';

export interface WorldSize {
  readonly id: WorldSizeId;
  readonly label: string;
  readonly detail: string;
  readonly map: Partial<MapOptions>;
}

/**
 * ⚠️ Size is also the loading time. A hex map of radius R holds `1 + 3R(R+1)`
 * tiles, so this is not a linear dial: radius 30 is 2,791 tiles against 6,211
 * at 45 and 9,577 at 56. Section 22 measured 8.1 seconds to playable at the
 * standard size, nearly all of it terrain building, so "small" is the setting
 * for someone who wants to be in a game rather than watching a progress bar.
 */
export const WORLD_SIZES: readonly WorldSize[] = Object.freeze([
  {
    id: 'small',
    label: 'Small',
    detail: 'About 2,800 tiles. Quick to build, and everyone is close.',
    map: { radius: 30, riverCount: 8 },
  },
  {
    id: 'standard',
    label: 'Standard',
    detail: 'About 6,200 tiles. Room to expand before anyone reaches you.',
    map: { radius: 45, riverCount: 14 },
  },
  {
    id: 'large',
    label: 'Large',
    detail: 'About 9,600 tiles. A long war, and a longer wait to begin it.',
    map: { radius: 56, riverCount: 20 },
  },
]);

// What you are revising ---------------------------------------------------

export type FocusId = 'everything' | 'A' | 'B' | 'C';

export interface Focus {
  readonly id: FocusId;
  readonly label: string;
  readonly detail: string;
}

/**
 * Which branch of the exam the rivals are drawn from first.
 *
 * ⚠️ **This narrows who TESTS you, not what you may learn.** The research tree
 * is the whole outline whichever focus is chosen, and the Proctor still sets a
 * paper across every branch in the published proportions. What changes is which
 * clusters come at you in battle, and which clusters capturing a village opens.
 * A candidate who knows they are weak on one branch can make that branch the
 * war, and the setup screen says so rather than implying the rest disappears.
 */
export const FOCUS_OPTIONS: readonly Focus[] = Object.freeze([
  {
    id: 'everything',
    label: 'The whole exam',
    detail: 'Rivals drawn from every branch, nearest first.',
  },
  {
    id: 'A',
    label: 'Maintain and govern',
    detail: 'Security, access control, version control, deployment pipelines.',
  },
  {
    id: 'B',
    label: 'Prepare data',
    detail: 'Connections, ingestion, transformation, and querying.',
  },
  {
    id: 'C',
    label: 'Semantic models',
    detail: 'Model design, storage modes, DAX, and optimisation.',
  },
]);

/** How many rivals a game may have. Each one holds a cluster of the outline. */
export const RIVAL_COUNTS: readonly number[] = Object.freeze([3, 5, 7]);

// How long you get --------------------------------------------------------

export type PaceId = 'relaxed' | 'standard' | 'exam';

export interface Pace {
  readonly id: PaceId;
  readonly label: string;
  readonly detail: string;
  /** Multiplier on every question's time limit. */
  readonly timeScale: number;
}

/**
 * ⚠️ Real, not decorative: `scoreFor` grades on how much of the limit was used
 * as well as on whether the answer was right, so this moves both how long you
 * have to think and how much a fast answer is worth.
 */
export const PACES: readonly Pace[] = Object.freeze([
  {
    id: 'relaxed',
    label: 'Relaxed',
    detail: 'Half as long again to answer. For learning something new.',
    timeScale: 1.5,
  },
  {
    id: 'standard',
    label: 'Standard',
    detail: 'Fourteen seconds to think in battle, plus time to read.',
    timeScale: 1,
  },
  {
    id: 'exam',
    label: 'Exam pace',
    detail: 'A third less time. Closer to sitting the real thing.',
    timeScale: 0.66,
  },
]);

export function paceScale(id: PaceId): number {
  return PACES.find((p) => p.id === id)?.timeScale ?? 1;
}

/**
 * Which antagonists are in this game.
 *
 * Focus decides the ORDER, the count decides how many, and the rest of the
 * roster fills in behind so that picking a focus never means fewer enemies than
 * asked for. Cluster ids begin with their branch letter (`A1`, `B2`), which is
 * the only thing this needs to know about the outline.
 *
 * ⚠️ Always returns at least one, because a game with no rivals has no
 * Conquest ending and nothing to be tested by.
 */
export function rosterFor(
  antagonists: readonly { readonly id: string; readonly topicCluster: string }[],
  focus: FocusId,
  count: number,
): string[] {
  const wanted = Math.max(1, Math.min(count, antagonists.length));
  const preferred =
    focus === 'everything'
      ? []
      : antagonists.filter((a) => a.topicCluster.startsWith(focus));
  const rest = antagonists.filter((a) => !preferred.includes(a));
  return [...preferred, ...rest].slice(0, wanted).map((a) => a.id);
}
