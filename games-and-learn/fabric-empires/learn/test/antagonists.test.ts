/**
 * The join between the engine's factions and the DP-600 outline.
 *
 * ⚠️ **This file exists because the failure is silent.** Each antagonist
 * quizzes on a `topicCluster` string, and capturing its village grants a topic
 * from that cluster. Both sides use plain strings and neither validates the
 * other, so a renamed cluster id, or an eighth faction added without a matching
 * branch, would not throw, would not fail a type check and would not fail any
 * existing test. It would simply mean conquest teaches you nothing and the
 * question modal never quizzes on that branch, which looks like a balance
 * problem rather than a broken reference.
 */

import { describe, it, expect } from 'vitest';
import { ANTAGONISTS } from '@fabric-empires/engine';
import { buildTopicGraph, DP600_OUTLINE } from '../src/index.js';

const outlineClusters = new Set(
  DP600_OUTLINE.branches.flatMap((branch) => branch.clusters.map((c) => c.id)),
);

describe('antagonists and the outline agree on cluster ids', () => {
  it('gives every antagonist a cluster the outline actually has', () => {
    for (const antagonist of ANTAGONISTS) {
      expect(
        outlineClusters.has(antagonist.topicCluster),
        `${antagonist.label} quizzes on "${antagonist.topicCluster}", which the outline does not define`,
      ).toBe(true);
    }
  });

  it('leaves no cluster without a faction to hold it', () => {
    // Otherwise a branch of the exam has no village to take, and the breadth
    // that capturing is supposed to force would quietly have a hole in it.
    const held = new Set(ANTAGONISTS.map((a) => a.topicCluster));
    for (const cluster of outlineClusters) {
      expect(held.has(cluster), `no faction holds cluster ${cluster}`).toBe(true);
    }
  });

  it('gives no two factions the same cluster', () => {
    const held = ANTAGONISTS.map((a) => a.topicCluster);
    expect(new Set(held).size).toBe(held.length);
  });

  it('has at least one grantable topic in every faction\u2019s cluster', () => {
    // The spoils rule can only grant a node that exists. An empty cluster
    // would make capturing that faction's village a purely military act.
    const graph = buildTopicGraph(DP600_OUTLINE);
    for (const antagonist of ANTAGONISTS) {
      const inCluster = graph.nodes.filter((n) => n.cluster === antagonist.topicCluster);
      expect(inCluster.length, `${antagonist.topicCluster} has no topics`).toBeGreaterThan(0);
    }
  });
});
