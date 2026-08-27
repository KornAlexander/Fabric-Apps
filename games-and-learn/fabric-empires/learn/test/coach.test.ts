/**
 * The study coach.
 *
 * ⚠️ **These test advice, not a model.** The ranking is deliberately
 * deterministic so that both editions can give it, so it can be argued with,
 * and so the connected edition's chat has something to be grounded in. That
 * means the interesting failures are all arithmetic: telling somebody to spend
 * their last evening on the wrong branch, or calling a decaying topic finished.
 */

import { describe, expect, it } from 'vitest';
import {
  buildLibraryModel,
  buildProgressDigest,
  digestAsPrompt,
  COACH_SYSTEM_PROMPT,
  DP600_QUESTIONS,
  DP600_TOPIC_GRAPH,
  type MasteryRecord,
} from '../src/index.js';

const NOW = Date.UTC(2026, 7, 22);
const DAY = 86_400_000;

/** A record at a given band. `masteryBand` reads repetitions and interval. */
function record(band: 'learning' | 'familiar' | 'strong'): MasteryRecord {
  const base = {
    learning: { repetitions: 1, intervalDays: 1 },
    familiar: { repetitions: 3, intervalDays: 6 },
    strong: { repetitions: 5, intervalDays: 30 },
  }[band];
  return {
    topicId: 'x',
    repetitions: base.repetitions,
    easiness: 2.5,
    intervalDays: base.intervalDays,
    lastReviewed: NOW - base.intervalDays * DAY,
    reviews: base.repetitions,
    lapses: 0,
  };
}

/** A library model where the named topics have the given band. */
function modelWith(bands: Record<string, MasteryRecord>, due: string[] = []) {
  const records = new Map<string, MasteryRecord | undefined>();
  for (const node of DP600_TOPIC_GRAPH.nodes) records.set(node.id, bands[node.id]);
  return buildLibraryModel({
    records,
    researched: new Set(),
    questions: DP600_QUESTIONS,
    due: new Set(due),
  });
}

describe('the digest', () => {
  it('describes an untouched learner honestly', () => {
    const digest = buildProgressDigest(modelWith({}));
    expect(digest.examRetained).toBe(0);
    expect(digest.bands.unseen).toBe(digest.totalSkills);
    expect(digest.headline).toContain('0%');
  });

  it('covers every branch of the outline', () => {
    const digest = buildProgressDigest(modelWith({}));
    expect(digest.branches).toHaveLength(DP600_TOPIC_GRAPH.nodes.length > 0 ? 3 : 0);
    const total = digest.branches.reduce((n, b) => n + b.examShare, 0);
    // The published weights are ranges whose midpoints should account for the
    // whole paper, give or take rounding in the outline.
    expect(total).toBeGreaterThan(0.9);
    expect(total).toBeLessThan(1.1);
  });

  it('offers something to do, and not too much of it', () => {
    const digest = buildProgressDigest(modelWith({}));
    expect(digest.next.length).toBeGreaterThan(0);
    expect(digest.next.length).toBeLessThanOrEqual(6);
  });

  it('gives every suggestion a reason a learner can argue with', () => {
    for (const item of buildProgressDigest(modelWith({})).next) {
      expect(item.reason.length).toBeGreaterThan(10);
      expect(item.reason).toMatch(/exam|Due|Never|Familiar|Solid/);
    }
  });
});

describe('⚠️ what it tells you to study', () => {
  it('weights by the exam, not by the number of skills', () => {
    /*
     * The failure this prevents: a coach that counts skills sends somebody to
     * whichever branch has the most rows in it. The published weighting is the
     * whole reason one gap matters more than another, and it is the difference
     * between a useful last evening and a wasted one.
     */
    const digest = buildProgressDigest(modelWith({}));
    const heaviest = [...digest.branches].sort((a, b) => b.examShare - a.examShare)[0]!;
    // With nothing learned, the top suggestions should come from the branch
    // that is worth the most.
    expect(digest.next[0]!.branchId).toBe(heaviest.id);
  });

  it('⚠️ puts a decaying topic above an equally weak one that is not due', () => {
    /*
     * Recovering something that is slipping is cheaper than learning something
     * new, because the work is already done and is what is being lost.
     *
     * ⚠️ Both topics must be in the SAME branch. The first version of this test
     * put the due one in a branch worth 28 percent of the exam and the other in
     * one worth 48, and the heavier branch won on weight alone: correct
     * behaviour, and a test that proved nothing about being due.
     */
    const sameBranch = DP600_TOPIC_GRAPH.nodes.filter(
      (n) => n.cluster === DP600_TOPIC_GRAPH.nodes[0]!.cluster,
    );
    expect(sameBranch.length, 'need two topics in one cluster').toBeGreaterThan(1);
    const [a, b] = [sameBranch[0]!.id, sameBranch[1]!.id];

    const digest = buildProgressDigest(
      modelWith({ [a]: record('learning'), [b]: record('learning') }, [a]),
      60,
    );
    const rankA = digest.next.findIndex((x) => x.topicId === a);
    const rankB = digest.next.findIndex((x) => x.topicId === b);
    expect(rankA).toBeGreaterThanOrEqual(0);
    expect(rankB).toBeGreaterThanOrEqual(0);
    expect(rankA, 'the due one should come first').toBeLessThan(rankB);
  });

  it('stops recommending something once it is solid', () => {
    const first = DP600_TOPIC_GRAPH.nodes[0]!.id;
    const before = buildProgressDigest(modelWith({}));
    const after = buildProgressDigest(modelWith({ [first]: record('strong') }));

    const wasSuggested = before.next.some((x) => x.topicId === first);
    const stillSuggested = after.next.some((x) => x.topicId === first);
    if (wasSuggested) expect(stillSuggested).toBe(false);
  });

  it('⚠️ never says a topic is finished', () => {
    /*
     * Spaced repetition decays. A coach that reports a subject as done is
     * teaching the wrong lesson about how memory works, which matters more
     * here than in most places because the game IS the lesson.
     */
    const every = Object.fromEntries(
      DP600_TOPIC_GRAPH.nodes.map((n) => [n.id, record('strong')]),
    );
    const digest = buildProgressDigest(modelWith(every));
    for (const item of digest.next) expect(item.priority).toBeGreaterThan(0);
  });

  it('names the branch with the most exam weight still missing', () => {
    const digest = buildProgressDigest(modelWith({}));
    expect(digest.weakestBranch).toBeDefined();
    const worst = [...digest.branches].sort((a, b) => b.atRisk - a.atRisk)[0]!;
    expect(digest.weakestBranch!.id).toBe(worst.id);
  });
});

describe('⚠️ what leaves the machine', () => {
  const digest = buildProgressDigest(modelWith({}));
  const prompt = digestAsPrompt(digest);

  it('carries the numbers a coach needs', () => {
    expect(prompt).toContain('Exam retained');
    expect(prompt).toContain('By exam area:');
    expect(prompt).toContain('Highest value to study next');
  });

  it('carries no question text, no answers and no ciphertext', () => {
    /*
     * The digest is aggregates and published outline labels. If it ever grows
     * a stem or an answer it becomes a thing that has to be explained to
     * whoever is deciding whether to turn the connected edition on.
     *
     * ⚠️ Stems and ciphers only. Testing answer OPTIONS does not work and the
     * reason is worth keeping: some options are phrased exactly like the
     * outline bullet they were written from, so "Real-Time hub" appears in the
     * digest as a published skill label and in a question as a distractor.
     * That is an overlap in the source material, not a leak, and a test that
     * cannot tell them apart would have to be weakened until it caught nothing.
     */
    for (const question of DP600_QUESTIONS) {
      expect(prompt).not.toContain(question.stem);
      expect(prompt).not.toContain(question.answerHash);
      expect(prompt).not.toContain(question.explanationCipher);
    }
  });

  it('says nothing the outline does not already say in public', () => {
    // Every named thing in the ranking is a published exam skill label.
    const labels = new Set(DP600_TOPIC_GRAPH.nodes.map((n) => n.label));
    const named = digest.next.map((x) => x.label);
    for (const label of named) expect(labels.has(label), label).toBe(true);
  });

  it('is prose, so a person can read exactly what was sent', () => {
    expect(prompt.trim().startsWith('{')).toBe(false);
    expect(prompt.split('\n').length).toBeGreaterThan(5);
  });
});

describe('the instructions the model is given', () => {
  it('tells it not to invent progress', () => {
    expect(COACH_SYSTEM_PROMPT).toMatch(/Do not invent/i);
  });

  it('⚠️ forbids it from claiming the learner is ready', () => {
    /*
     * The one thing this system must never do (D205, in a new place). A model
     * telling somebody they are ready to sit DP-600 would be acted on, and
     * the readiness figure is the only thing entitled to make that claim.
     */
    expect(COACH_SYSTEM_PROMPT).toMatch(/Never claim the learner is ready/i);
  });

  it('tells it to keep the ranking it was given', () => {
    expect(COACH_SYSTEM_PROMPT).toMatch(/Keep the given ranking/i);
  });

  it('tells it to answer in the learner\'s language', () => {
    // The interface is bilingual; a coach that only answers in English is not.
    expect(COACH_SYSTEM_PROMPT).toMatch(/language the learner writes in/i);
  });
});
