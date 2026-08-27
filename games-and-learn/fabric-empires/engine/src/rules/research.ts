/**
 * Research.
 *
 * The tech tree is supplied by the challenge provider as an opaque
 * `TopicGraph`, so this file never learns what a topic is about (D35).
 *
 * Completing a node is deliberately a two-step affair: the turn pipeline
 * reports a node as READY, the app presents a challenge, and the result is fed
 * back through `completeResearch`. That keeps every async concern out of the
 * engine, and it means a failed challenge is a delay rather than a wall, which
 * is the intended feel: you keep the invested Compute and try again.
 */

import { availableTopics, type TopicGraph, type TopicNode } from '../challenge/index.js';
import { bindTopicToCity } from './review.js';
import type { GameState } from '../state/index.js';

/** Compute required per unit of topic weight. */
export const COMPUTE_PER_WEIGHT = 6;

export interface ResearchState {
  /** Completed topic ids. */
  readonly known: readonly string[];
  /** Topic currently being researched, if any. */
  readonly current: string | undefined;
  /** Compute invested into `current`. */
  readonly progress: number;
}

export const EMPTY_RESEARCH: ResearchState = Object.freeze({
  known: Object.freeze([]),
  current: undefined,
  progress: 0,
});

export function researchCost(node: TopicNode): number {
  return node.weight * COMPUTE_PER_WEIGHT;
}

export function topicById(
  graph: TopicGraph,
  topicId: string,
): TopicNode | undefined {
  return graph.nodes.find((node) => node.id === topicId);
}

export function knownSet(state: GameState): Set<string> {
  return new Set(state.research.known);
}

/** Topics whose prerequisites are met and which are not already known. */
export function researchable(state: GameState): TopicNode[] {
  return availableTopics(state.topics, knownSet(state));
}

export function isResearched(state: GameState, topicId: string): boolean {
  return state.research.known.includes(topicId);
}

export type ResearchResult =
  | { readonly ok: true; readonly state: GameState }
  | { readonly ok: false; readonly reason: string };

/**
 * Begin researching a topic.
 *
 * Switching away from an unfinished topic forfeits its progress, which is the
 * cost of changing your mind and the reason the choice matters.
 */
export function startResearch(state: GameState, topicId: string): ResearchResult {
  const node = topicById(state.topics, topicId);
  if (!node) return { ok: false, reason: 'No such topic' };
  if (isResearched(state, topicId)) {
    return { ok: false, reason: 'Already researched' };
  }

  const known = knownSet(state);
  const missing = node.requires.filter((id) => !known.has(id));
  if (missing.length > 0) {
    return { ok: false, reason: 'Prerequisites not met' };
  }
  if (state.research.current === topicId) {
    return { ok: false, reason: 'Already researching this' };
  }

  return {
    ok: true,
    state: {
      ...state,
      research: { ...state.research, current: topicId, progress: 0 },
    },
  };
}

export interface ResearchTick {
  readonly state: GameState;
  /** Compute moved from the treasury into research this turn. */
  readonly spent: number;
  /** Set when the topic is fully funded and awaiting its challenge. */
  readonly readyTopicId: string | undefined;
}

/**
 * Spend banked Compute on the current topic.
 *
 * Compute lands in the treasury first and is drained from it here, so the
 * player can watch the cost being paid rather than having income silently
 * diverted.
 *
 * ⚠️ **This used to add that "banking Compute while undecided is a legitimate
 * strategy", and that is no longer true.** Something is always selected now
 * (see `autoSelectResearch`), so Compute no longer sits idle by default. It
 * still banks whenever the tree is finished, and production still takes its
 * capped slice first, but "study nothing and save up" has stopped being a
 * position a player can hold by doing nothing. Holding it now means choosing
 * to, and there is no way to express that choice: see section 44.
 */
export function fundResearch(state: GameState, factionId: string): ResearchTick {
  const current = state.research.current;
  if (!current) return { state, spent: 0, readyTopicId: undefined };

  const node = topicById(state.topics, current);
  if (!node) return { state, spent: 0, readyTopicId: undefined };

  const cost = researchCost(node);
  const remaining = cost - state.research.progress;
  if (remaining <= 0) {
    return { state, spent: 0, readyTopicId: current };
  }

  const faction = state.factions.get(factionId);
  if (!faction) return { state, spent: 0, readyTopicId: undefined };

  const spent = Math.min(faction.resources.compute, remaining);
  if (spent <= 0) return { state, spent: 0, readyTopicId: undefined };

  const factions = new Map(state.factions);
  factions.set(factionId, {
    ...faction,
    resources: { ...faction.resources, compute: faction.resources.compute - spent },
  });

  const progress = state.research.progress + spent;

  return {
    state: {
      ...state,
      factions,
      research: { ...state.research, progress },
    },
    spent,
    readyTopicId: progress >= cost ? current : undefined,
  };
}

/** Whether the current topic is fully funded and awaiting its challenge. */
export function researchReady(state: GameState): string | undefined {
  const current = state.research.current;
  if (!current) return undefined;
  const node = topicById(state.topics, current);
  if (!node) return undefined;
  return state.research.progress >= researchCost(node) ? current : undefined;
}

/**
 * Choose something to study when nothing is selected.
 *
 * ⚠️ **Idle research was the default state, not an edge case.**
 * `completeResearch` clears `current`, so the moment a topic finished the
 * empire stopped learning until somebody noticed and picked the next one, and
 * a new game began idle as well. Compute went on arriving and simply banked.
 * Nothing was broken and nothing was logged; the tech tree just quietly
 * stopped moving, which is the worst possible failure for a study tool whose
 * entire premise is that the questions keep coming.
 *
 * ⚠️ **The choice is deliberately dull, because the engine is not allowed to
 * be clever here** (D35). It may not know that topics are exam objectives, so
 * it cannot rank them by exam weight, by how weak the learner is on them, or
 * by anything else that would make this a good study recommendation. A
 * `TopicNode`'s `weight` is a cost, not an importance: 2 for a gateway and 1
 * for a skill.
 *
 * So it takes the **first researchable topic in graph order**, which is the
 * order the challenge provider supplied, which for a certification is the
 * published order of its own outline. That is neutral, deterministic, and a
 * perfectly reasonable path through a syllabus. Anything better belongs to the
 * learning layer, which may call `startResearch` whenever it likes.
 *
 * Returns the same state object when there is nothing to do, so callers can
 * use identity to tell whether a choice was made.
 */
export function autoSelectResearch(state: GameState): GameState {
  if (state.research.current) return state;
  const next = researchable(state)[0];
  if (!next) return state;
  return {
    ...state,
    // ⚠️ Progress is zeroed rather than preserved. It is already zero on every
    // path that reaches here, and carrying a stale figure into a topic nobody
    // chose would be a quiet way to make the next cost wrong.
    research: { ...state.research, current: next.id, progress: 0 },
  };
}

/**
 * Resolve a funded topic with the outcome of its challenge.
 *
 * A non-negative score completes it. A negative score leaves the topic funded
 * and retryable next turn: the player loses time, not the investment. A wall
 * here would mean a player who does not yet know something can never learn it,
 * which is precisely backwards for a study tool.
 */
export function completeResearch(
  state: GameState,
  score: number,
): ResearchResult {
  const ready = researchReady(state);
  if (!ready) return { ok: false, reason: 'Nothing is ready to complete' };

  if (score < 0) {
    return { ok: true, state };
  }

  // A learned topic becomes a building somewhere, and that is what makes the
  // city responsible for reviewing it later. Binding here rather than in the
  // app means a topic can never be marked known without something in the
  // world holding it.
  const withTopic: GameState = {
    ...state,
    research: {
      known: [...state.research.known, ready],
      current: undefined,
      progress: 0,
    },
  };

  /*
   * Straight on to the next one.
   *
   * ⚠️ This is the call that matters most. Finishing a topic used to leave
   * the empire studying nothing, so the natural rhythm of the game was
   * learn, idle, learn, idle, and the idle half was invisible.
   */
  return { ok: true, state: autoSelectResearch(bindTopicToCity(withTopic, ready)) };
}

/** Fraction of the whole tree completed, for progress display. */
export function researchProgress(state: GameState): number {
  if (state.topics.nodes.length === 0) return 0;
  return state.research.known.length / state.topics.nodes.length;
}

/** Completed nodes per cluster, for a branch-level readiness display. */
export function clusterProgress(state: GameState): Map<string, { known: number; total: number }> {
  const out = new Map<string, { known: number; total: number }>();
  const known = knownSet(state);
  for (const node of state.topics.nodes) {
    const entry = out.get(node.cluster) ?? { known: 0, total: 0 };
    entry.total += 1;
    if (known.has(node.id)) entry.known += 1;
    out.set(node.cluster, entry);
  }
  return out;
}
