/**
 * Choosing something to study when nobody chose.
 *
 * ⚠️ **Idle research was the default state, not an edge case.** A new game
 * began studying nothing, and `completeResearch` cleared the current topic, so
 * the rhythm of every game was learn, idle, learn, idle. Compute went on
 * arriving and simply banked. Nothing threw, nothing logged, and the tech tree
 * quietly stopped moving, which for a study tool whose premise is that the
 * questions keep coming is the worst failure available.
 */

import { describe, it, expect } from 'vitest';
import {
  PLAYER_FACTION_ID,
  autoSelectResearch,
  completeResearch,
  createGameState,
  endTurn,
  researchCost,
  researchable,
  startResearch,
  topicById,
  type GameState,
  type ResearchResult,
  type TopicGraph,
} from '../src/index.js';

/**
 * Take the state out of a research action, or fail with the engine's reason.
 *
 * ⚠️ `ResearchResult` is a discriminated union, so `result.state!` does not
 * type-check: the failure branch has no `state` at all.
 */
function done(result: ResearchResult): GameState {
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

/** A small tree with an obvious order, so "first available" is checkable. */
const TREE: TopicGraph = {
  nodes: [
    { id: 'alpha', label: 'Alpha', cluster: 'a', requires: [], weight: 1 },
    { id: 'beta', label: 'Beta', cluster: 'a', requires: ['alpha'], weight: 1 },
    { id: 'gamma', label: 'Gamma', cluster: 'b', requires: [], weight: 2 },
  ],
};

const fresh = (topics: TopicGraph = TREE): GameState =>
  createGameState('FABRIC', { topics });

/** Give the player enough Compute that funding is never the limit. */
function rich(state: GameState, compute = 5_000): GameState {
  const factions = new Map(state.factions);
  const me = factions.get(PLAYER_FACTION_ID)!;
  factions.set(PLAYER_FACTION_ID, {
    ...me,
    resources: { ...me.resources, compute },
  });
  return { ...state, factions };
}

describe('a new empire', () => {
  it('⚠️ is already studying something', () => {
    // The whole point. Before this, turn one researched nothing.
    expect(fresh().research.current).toBe('alpha');
  });

  it('starts at zero progress, so the choice is free to change', () => {
    const state = fresh();
    expect(state.research.progress).toBe(0);
    const moved = startResearch(state, 'gamma');
    expect(moved.ok).toBe(true);
    expect(done(moved).research.current).toBe('gamma');
  });

  it('takes the first topic in the order the provider supplied', () => {
    // Graph order is the curriculum's own order, which for a certification is
    // the published order of its outline. The engine may not know that, and
    // does not need to.
    expect(fresh().research.current).toBe(researchable(fresh())[0]!.id);
  });
});

describe('autoSelectResearch', () => {
  it('leaves an existing choice alone', () => {
    const state = done(startResearch(fresh(), 'gamma'));
    expect(autoSelectResearch(state).research.current).toBe('gamma');
  });

  it('⚠️ returns the same object when there is nothing to do', () => {
    // Callers use identity to tell whether a choice was made, including the
    // turn pipeline, which decides whether to fund on that basis.
    const state = fresh();
    expect(autoSelectResearch(state)).toBe(state);
  });

  it('picks something when the current topic has been cleared', () => {
    const state = fresh();
    const idle: GameState = {
      ...state,
      research: { ...state.research, current: undefined, progress: 0 },
    };
    expect(autoSelectResearch(idle).research.current).toBe('alpha');
  });

  it('respects prerequisites', () => {
    const state = fresh();
    const idle: GameState = {
      ...state,
      research: { known: [], current: undefined, progress: 0 },
    };
    // `beta` needs `alpha`, so it must not be chosen first.
    expect(autoSelectResearch(idle).research.current).not.toBe('beta');
  });

  it('does nothing when the whole tree is known, rather than throwing', () => {
    const state = fresh();
    const done: GameState = {
      ...state,
      research: { known: ['alpha', 'beta', 'gamma'], current: undefined, progress: 0 },
    };
    expect(autoSelectResearch(done)).toBe(done);
    expect(autoSelectResearch(done).research.current).toBeUndefined();
  });
});

describe('⚠️ finishing a topic', () => {
  /** Fund the current topic to completion and answer its challenge. */
  function learnCurrent(state: GameState): GameState {
    const current = state.research.current!;
    const cost = researchCost(topicById(state.topics, current)!);
    const funded: GameState = { ...state, research: { ...state.research, progress: cost } };
    return done(completeResearch(funded, 1));
  }

  it('immediately begins the next one', () => {
    // The rhythm this exists to fix: learn, idle, learn, idle.
    const after = learnCurrent(fresh());
    expect(after.research.known).toContain('alpha');
    expect(after.research.current).toBeDefined();
    expect(after.research.current).not.toBe('alpha');
  });

  it('keeps going all the way to the end of the tree', () => {
    let state = fresh();
    const learned: string[] = [];
    for (let i = 0; i < TREE.nodes.length; i += 1) {
      learned.push(state.research.current!);
      state = learnCurrent(state);
    }
    expect([...learned].sort()).toEqual(['alpha', 'beta', 'gamma']);
    // Nothing left, so nothing selected, and that is correct rather than a gap.
    expect(state.research.current).toBeUndefined();
  });

  it('⚠️ a wrong answer does not lose the topic or the investment', () => {
    // Pre-existing rule, re-checked because auto-select now runs on the same
    // path: a failed challenge is a delay, never a wall.
    const state = fresh();
    const cost = researchCost(topicById(state.topics, 'alpha')!);
    const funded: GameState = { ...state, research: { ...state.research, progress: cost } };
    const failed = completeResearch(funded, -1);
    expect(failed.ok).toBe(true);
    expect(done(failed).research.current).toBe('alpha');
    expect(done(failed).research.progress).toBe(cost);
  });
});

describe('the turn pipeline', () => {
  it('reports nothing when the player had already chosen', () => {
    const { report } = endTurn(rich(fresh()), {});
    expect(report.researchAutoSelected).toBeUndefined();
    expect(report.researchSpent).toBeGreaterThan(0);
  });

  it('⚠️ picks up an idle save and says that it did', () => {
    const state = rich(fresh());
    const idle: GameState = {
      ...state,
      research: { ...state.research, current: undefined, progress: 0 },
    };
    const { state: next, report } = endTurn(idle, {});
    expect(report.researchAutoSelected).toBe('alpha');
    expect(next.research.current).toBe('alpha');
  });

  it('⚠️ does not spend Compute on the turn it chooses', () => {
    /*
     * Switching topics forfeits progress, so funding something the player
     * never picked in the same breath as picking it would charge them for a
     * decision they had no chance to see. They get a full turn to change it
     * while progress is still zero.
     */
    const state = rich(fresh());
    const idle: GameState = {
      ...state,
      research: { ...state.research, current: undefined, progress: 0 },
    };
    const { state: next, report } = endTurn(idle, {});
    expect(report.researchSpent).toBe(0);
    expect(next.research.progress).toBe(0);

    // And from the next turn it funds normally.
    const after = endTurn(next, {});
    expect(after.report.researchSpent).toBeGreaterThan(0);
  });

  it('never stalls, however many turns nobody touches it', () => {
    // The end state a neglectful player should reach: everything learned,
    // rather than a treasury full of Compute and an untouched tree.
    let state = rich(fresh(), 50_000);
    for (let turn = 0; turn < 30; turn += 1) {
      const { state: next, report } = endTurn(state, {});
      state = next;
      // Stand in for the app: answer whatever became ready.
      if (report.researchReadyTopicId) {
        const answered = completeResearch(state, 1);
        if (answered.ok) state = answered.state;
      }
    }
    expect([...state.research.known].sort()).toEqual(['alpha', 'beta', 'gamma']);
  });
});
