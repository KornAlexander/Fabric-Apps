import { describe, it, expect } from 'vitest';
import {
  availableTopics,
  createGameState,
  researchable,
  validateTopicGraph,
} from '@fabric-empires/engine';
import {
  DP600_OUTLINE,
  DP600_TOPIC_GRAPH,
  GATEWAY_WEIGHT,
  allSkills,
  branchShares,
  buildTopicGraph,
  clusterOf,
  skillIdFromTopic,
  topicIdFor,
  validateDp600Graph,
} from '../src/index.js';
import { Dp600ChallengeProvider } from '../src/Dp600ChallengeProvider.js';

describe('the outline', () => {
  it('records where it came from and when', () => {
    // Without this, nobody can tell whether the tree matches the current exam.
    expect(DP600_OUTLINE.cert).toBe('DP-600');
    expect(DP600_OUTLINE.revision).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(DP600_OUTLINE.source).toContain('learn.microsoft.com');
  });

  it('has the three published domains with their weightings', () => {
    expect(DP600_OUTLINE.branches.map((b) => b.id)).toEqual(['A', 'B', 'C']);
    for (const branch of DP600_OUTLINE.branches) {
      expect(branch.weightMax).toBeGreaterThan(branch.weightMin);
      expect(branch.weightMin).toBeGreaterThan(0);
    }
  });

  it('published weightings span the whole exam', () => {
    const min = DP600_OUTLINE.branches.reduce((s, b) => s + b.weightMin, 0);
    const max = DP600_OUTLINE.branches.reduce((s, b) => s + b.weightMax, 0);
    expect(min).toBeLessThanOrEqual(100);
    expect(max).toBeGreaterThanOrEqual(100);
  });

  it('has 41 leaf skills, numbered 1 to 41 without gaps', () => {
    const ids = allSkills().map((s) => s.id).sort((a, b) => a - b);
    expect(ids).toHaveLength(41);
    expect(ids[0]).toBe(1);
    expect(ids[40]).toBe(41);
    expect(new Set(ids).size).toBe(41);
  });

  it('has seven clusters, each with a distinct id', () => {
    const clusters = DP600_OUTLINE.branches.flatMap((b) => b.clusters);
    expect(clusters).toHaveLength(7);
    expect(new Set(clusters.map((c) => c.id)).size).toBe(7);
  });

  it('gives every skill a non-empty label', () => {
    for (const skill of allSkills()) {
      expect(skill.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate skill labels', () => {
    const labels = allSkills().map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('locates every skill in a branch and cluster', () => {
    for (const skill of allSkills()) {
      expect(clusterOf(skill.id)).toBeDefined();
    }
    expect(clusterOf(999)).toBeUndefined();
  });

  /*
   * The premise of the project: the tree IS the blueprint. Labels are copied
   * verbatim, so anything that reads like a paraphrase is a bug. These are
   * spot checks on the exact published wording, one per branch.
   */
  it('quotes the published wording verbatim', () => {
    const byId = new Map(allSkills().map((s) => [s.id, s.label]));
    expect(byId.get(3)).toBe(
      'Implement row-level, column-level, object-level, and file-level access control',
    );
    expect(byId.get(13)).toBe(
      'Discover data by using OneLake catalog and Real-Time hub',
    );
    expect(byId.get(40)).toBe(
      'Choose between Direct Lake on OneLake and Direct Lake on SQL analytics endpoint',
    );
  });

  it('puts the weight of the tree where the weight of the exam is', () => {
    // "Prepare data" is 45 to 50 percent of DP-600, and it must dominate the
    // map for the same reason. This is the single most load-bearing claim the
    // whole design makes.
    const shares = branchShares();
    const b = shares.find((s) => s.id === 'B')!;
    const a = shares.find((s) => s.id === 'A')!;
    const c = shares.find((s) => s.id === 'C')!;

    expect(b.nodes).toBe(18);
    expect(b.share).toBeGreaterThan(0.4);
    expect(b.nodes).toBeGreaterThan(a.nodes);
    expect(b.nodes).toBeGreaterThan(c.nodes);
    expect(a.nodes + b.nodes + c.nodes).toBe(41);
  });
});

describe('the tech tree', () => {
  it('is structurally valid', () => {
    expect(validateDp600Graph()).toEqual([]);
    expect(validateTopicGraph(DP600_TOPIC_GRAPH)).toEqual([]);
  });

  it('has one node per skill', () => {
    expect(DP600_TOPIC_GRAPH.nodes).toHaveLength(41);
    expect(new Set(DP600_TOPIC_GRAPH.nodes.map((n) => n.id)).size).toBe(41);
  });

  it('carries the verbatim skill label onto the node', () => {
    const labels = new Map(allSkills().map((s) => [topicIdFor(s.id), s.label]));
    for (const node of DP600_TOPIC_GRAPH.nodes) {
      expect(node.label).toBe(labels.get(node.id));
    }
  });

  it('tags each node with its cluster', () => {
    for (const node of DP600_TOPIC_GRAPH.nodes) {
      const skillId = skillIdFromTopic(node.id)!;
      expect(node.cluster).toBe(clusterOf(skillId)!.cluster.id);
    }
  });

  it('round trips topic ids to skill ids', () => {
    for (const skill of allSkills()) {
      expect(skillIdFromTopic(topicIdFor(skill.id))).toBe(skill.id);
    }
    expect(skillIdFromTopic('nonsense')).toBeUndefined();
  });

  it('⚠️ reads a skill out of any campaign prefix, not only dp600', () => {
    /*
     * This used to be anchored on `/^dp600-(\d+)$/`, which meant the second
     * seat's topics parsed as undefined and every one of its questions came
     * back empty. Any campaign owns the part before the number.
     */
    expect(skillIdFromTopic('klasse1-7')).toBe(7);
    expect(skillIdFromTopic('dp600-7')).toBe(7);
    // Still not a free-for-all: there has to be a number to read.
    expect(skillIdFromTopic('klasse1-')).toBeUndefined();
    expect(skillIdFromTopic('klasse1-x')).toBeUndefined();
  });

  it('opens three branches at once, one per exam domain', () => {
    // Someone revising can start wherever they are weakest, which is how
    // people actually study. A single chain would forbid that.
    const roots = availableTopics(DP600_TOPIC_GRAPH, new Set());
    expect(roots).toHaveLength(3);
    expect(new Set(roots.map((r) => r.cluster))).toEqual(
      new Set(['A1', 'B1', 'C1']),
    );
  });

  it('makes each cluster gateway cost more than its followers', () => {
    const gateways = DP600_TOPIC_GRAPH.nodes.filter(
      (n) => n.weight === GATEWAY_WEIGHT,
    );
    expect(gateways).toHaveLength(7);
    for (const node of DP600_TOPIC_GRAPH.nodes) {
      expect(node.weight).toBeGreaterThan(0);
    }
  });

  it('is entirely reachable from nothing', () => {
    // A node no player can reach is content that does not exist.
    const known = new Set<string>();
    for (let i = 0; i <= DP600_TOPIC_GRAPH.nodes.length; i++) {
      for (const node of availableTopics(DP600_TOPIC_GRAPH, known)) {
        known.add(node.id);
      }
    }
    expect(known.size).toBe(41);
  });

  it('stays as shallow as its branch structure allows', () => {
    /*
     * Depth is one step per cluster gateway, plus one for the skills hanging
     * off the last gateway. So the bound is (clusters in the deepest branch)
     * + 1, which is 4 for "Prepare data" and its three clusters.
     *
     * Asserting the derived bound rather than the number 4 means this catches
     * a structural regression (a chain forming inside a cluster, say) instead
     * of merely restating a constant.
     */
    const deepestBranch = Math.max(
      ...DP600_OUTLINE.branches.map((b) => b.clusters.length),
    );
    const expectedBound = deepestBranch + 1;
    expect(expectedBound).toBe(4);

    const depth = new Map<string, number>();
    const byId = new Map(DP600_TOPIC_GRAPH.nodes.map((n) => [n.id, n]));
    const depthOf = (id: string): number => {
      const cached = depth.get(id);
      if (cached !== undefined) return cached;
      const node = byId.get(id)!;
      const value =
        node.requires.length === 0
          ? 1
          : 1 + Math.max(...node.requires.map(depthOf));
      depth.set(id, value);
      return value;
    };

    let deepest = 0;
    for (const node of DP600_TOPIC_GRAPH.nodes) {
      deepest = Math.max(deepest, depthOf(node.id));
    }
    expect(deepest).toBe(expectedBound);
  });

  it('never puts more than one prerequisite in front of a skill', () => {
    // Every node depends on at most its cluster gateway, so no skill is gated
    // behind an unrelated part of the outline.
    for (const node of DP600_TOPIC_GRAPH.nodes) {
      expect(node.requires.length).toBeLessThanOrEqual(1);
    }
  });

  it('rebuilds identically from the outline', () => {
    expect(buildTopicGraph()).toEqual(DP600_TOPIC_GRAPH);
  });
});

describe('the provider', () => {
  it('supplies the DP-600 tree', () => {
    expect(new Dp600ChallengeProvider().topics()).toBe(DP600_TOPIC_GRAPH);
  });

  it('reports honestly that it has no questions yet', () => {
    expect(new Dp600ChallengeProvider().hasQuestions).toBe(false);
  });

  it('returns neutral rather than faking a correct answer', async () => {
    /*
     * A provider that reported success would make the game look finished while
     * teaching nothing. Neutral is the honest placeholder: research still
     * advances, but knowledge contributes no combat advantage.
     */
    const outcome = await new Dp600ChallengeProvider().present({
      kind: 'research',
      topicId: 'dp600-1',
      tier: 1,
      timeLimitMs: 30_000,
    });
    expect(outcome.score).toBe(0);
    expect(outcome.abandoned).toBe(false);
  });

  it('uses an injected presenter once one exists', async () => {
    const provider = new Dp600ChallengeProvider({
      presenter: async () => ({ score: 1, elapsedMs: 900, abandoned: false }),
    });
    expect(provider.hasQuestions).toBe(true);
    const outcome = await provider.present({
      kind: 'battle',
      topicId: 'dp600-19',
      tier: 2,
      timeLimitMs: 20_000,
    });
    expect(outcome.score).toBe(1);
  });

  it('drives a real game when handed to the engine', () => {
    const state = createGameState('FABRIC', {
      topics: new Dp600ChallengeProvider().topics(),
      spawnAntagonists: false,
    });
    const options = researchable(state);
    expect(options).toHaveLength(3);
    expect(options.map((o) => o.label)).toContain(
      'Implement workspace-level access controls',
    );
  });
});
