/**
 * The one interface between the engine and any learning layer.
 *
 * The engine must remain a complete strategy game that knows nothing about
 * certifications (D35). It therefore never sees a question, an answer or a
 * subject: it asks for a challenge on an opaque topic and receives a score.
 *
 * `NullChallengeProvider` is what makes that claim checkable. If the game
 * cannot be played through with it, the boundary has leaked.
 */

export type ChallengeKind = 'battle' | 'research' | 'unrest' | 'boss' | 'treasure';
export type ChallengeTier = 1 | 2 | 3;

export interface ChallengeRequest {
  readonly kind: ChallengeKind;
  /** Opaque topic id. The engine never interprets this. */
  readonly topicId: string;
  readonly tier: ChallengeTier;
  readonly timeLimitMs: number;
}

export interface ChallengeOutcome {
  /**
   * -1 (worst) to +1 (best). The engine scales this into a combat or research
   * modifier and never asks what produced it.
   */
  readonly score: number;
  readonly elapsedMs: number;
  /** True when the player closed the challenge without answering. */
  readonly abandoned: boolean;
  /**
   * The topic the question was actually about, when that differs from the one
   * requested.
   *
   * ⚠️ **The engine still never interprets this**; it exists so the learning
   * layer can schedule against the truth. A provider may substitute a question
   * from a neighbouring topic when the requested one has nothing left to ask,
   * and recording that answer against the topic that was *asked for* would
   * credit the player with knowledge they never showed.
   *
   * Absent means "the one you asked for", which is the ordinary case.
   */
  readonly topicId?: string;
}

export interface TopicNode {
  readonly id: string;
  readonly label: string;
  /** Grouping used for tech tree branches and faction themes. */
  readonly cluster: string;
  readonly requires: readonly string[];
  /** Relative research cost. */
  readonly weight: number;
}

export interface TopicGraph {
  readonly nodes: readonly TopicNode[];
}

export interface ChallengeProvider {
  /** Topics available. The engine turns these into its tech tree. */
  topics(): TopicGraph;
  present(request: ChallengeRequest): Promise<ChallengeOutcome>;
  /** Topics due for review. Returning an empty array is always valid. */
  dueTopics(now: number): string[];
}

export const NEUTRAL_OUTCOME: ChallengeOutcome = Object.freeze({
  score: 0,
  elapsedMs: 0,
  abandoned: false,
});

/**
 * Structural checks any provider's graph must pass.
 *
 * Returns the problems rather than throwing, so a content author sees all of
 * them at once instead of fixing one per run.
 */
export function validateTopicGraph(graph: TopicGraph): string[] {
  const problems: string[] = [];
  const byId = new Map<string, TopicNode>();

  for (const node of graph.nodes) {
    if (byId.has(node.id)) problems.push(`Duplicate topic id: ${node.id}`);
    byId.set(node.id, node);
    if (node.weight <= 0) {
      problems.push(`Topic ${node.id} has a non-positive weight`);
    }
  }

  for (const node of graph.nodes) {
    for (const required of node.requires) {
      if (!byId.has(required)) {
        problems.push(`Topic ${node.id} requires unknown topic ${required}`);
      }
    }
  }

  // Depth-first cycle detection. A cycle in the tech tree means a node that
  // can never be researched, which is invisible until someone tries.
  const state = new Map<string, 'visiting' | 'done'>();
  const walk = (id: string, trail: string[]): void => {
    const status = state.get(id);
    if (status === 'done') return;
    if (status === 'visiting') {
      problems.push(`Cycle in topic graph: ${[...trail, id].join(' -> ')}`);
      return;
    }
    state.set(id, 'visiting');
    for (const required of byId.get(id)?.requires ?? []) {
      walk(required, [...trail, id]);
    }
    state.set(id, 'done');
  };
  for (const node of graph.nodes) walk(node.id, []);

  return problems;
}

/** Topics whose prerequisites are all satisfied by `known`. */
export function availableTopics(
  graph: TopicGraph,
  known: ReadonlySet<string>,
): TopicNode[] {
  return graph.nodes.filter(
    (node) =>
      !known.has(node.id) && node.requires.every((id) => known.has(id)),
  );
}

/**
 * A generic tech tree with no subject matter, used by the null provider.
 *
 * Deliberately bland: it exists to prove the engine plays without a learning
 * layer, so anything evocative here would defeat the point.
 */
export const GENERIC_TOPIC_GRAPH: TopicGraph = Object.freeze({
  nodes: Object.freeze([
    { id: 'foundations', label: 'Foundations', cluster: 'a', requires: [], weight: 1 },
    { id: 'survey', label: 'Survey', cluster: 'a', requires: ['foundations'], weight: 1 },
    { id: 'masonry', label: 'Masonry', cluster: 'a', requires: ['foundations'], weight: 2 },
    { id: 'roads', label: 'Roads', cluster: 'a', requires: ['survey'], weight: 2 },
    { id: 'trade', label: 'Trade', cluster: 'b', requires: ['roads'], weight: 3 },
    { id: 'levies', label: 'Levies', cluster: 'b', requires: ['masonry'], weight: 3 },
    { id: 'archery', label: 'Archery', cluster: 'b', requires: ['levies'], weight: 3 },
    { id: 'siegecraft', label: 'Siegecraft', cluster: 'b', requires: ['archery'], weight: 4 },
    { id: 'charter', label: 'Charter', cluster: 'c', requires: ['trade'], weight: 4 },
    { id: 'guilds', label: 'Guilds', cluster: 'c', requires: ['charter'], weight: 5 },
    { id: 'academy', label: 'Academy', cluster: 'c', requires: ['guilds'], weight: 5 },
    { id: 'dominion', label: 'Dominion', cluster: 'c', requires: ['academy', 'siegecraft'], weight: 6 },
  ]),
});

/**
 * Resolves every challenge as neutral, immediately.
 *
 * With this provider the game is a plain 4X: knowledge contributes nothing,
 * and unit strength decides every fight.
 */
export class NullChallengeProvider implements ChallengeProvider {
  topics(): TopicGraph {
    return GENERIC_TOPIC_GRAPH;
  }

  present(_request: ChallengeRequest): Promise<ChallengeOutcome> {
    return Promise.resolve(NEUTRAL_OUTCOME);
  }

  dueTopics(_now: number): string[] {
    return [];
  }
}

/**
 * Returns a fixed sequence of outcomes, for tests and the scripted tutorial.
 * Once the script runs out it falls back to neutral, so a test that under-runs
 * its script fails on an assertion rather than on an exception.
 */
export class ScriptedChallengeProvider implements ChallengeProvider {
  private index = 0;

  constructor(
    private readonly script: readonly ChallengeOutcome[],
    private readonly graph: TopicGraph = GENERIC_TOPIC_GRAPH,
    private readonly due: readonly string[] = [],
  ) {}

  /** Requests seen so far, so a test can assert what the engine asked for. */
  readonly seen: ChallengeRequest[] = [];

  topics(): TopicGraph {
    return this.graph;
  }

  present(request: ChallengeRequest): Promise<ChallengeOutcome> {
    this.seen.push(request);
    const outcome = this.script[this.index] ?? NEUTRAL_OUTCOME;
    this.index += 1;
    return Promise.resolve(outcome);
  }

  dueTopics(_now: number): string[] {
    return [...this.due];
  }

  get remaining(): number {
    return Math.max(0, this.script.length - this.index);
  }
}
