import { describe, it, expect } from 'vitest';
import {
  DP600_OUTLINE,
  DP600_QUESTIONS,
  buildLibraryModel,
  newRecord,
  reviewMastery,
  summarise,
  topicIdFor,
  type LibraryInput,
  type MasteryRecord,
} from '../src/index.js';

/** A record that has been passed `times` times in a row, from a fixed clock. */
function passed(topicId: string, times: number): MasteryRecord {
  let record = newRecord(topicId);
  let now = 1_000_000;
  for (let i = 0; i < times; i++) {
    record = reviewMastery(record, 5, now);
    now += record.intervalDays * 86_400_000;
  }
  return record;
}

function input(overrides: Partial<LibraryInput> = {}): LibraryInput {
  return {
    records: new Map(),
    researched: new Set(),
    questions: DP600_QUESTIONS,
    due: new Set(),
    ...overrides,
  };
}

describe('the library model', () => {
  it('covers the whole outline, so nothing can quietly go missing', () => {
    const model = buildLibraryModel(input());
    expect(model.totalSkills).toBe(41);
    expect(model.branches).toHaveLength(3);
    const clusters = model.branches.flatMap((b) => b.clusters);
    expect(clusters).toHaveLength(7);
    expect(clusters.flatMap((c) => c.skills)).toHaveLength(41);
  });

  it('keeps the outline order, which is the order worth studying in', () => {
    const model = buildLibraryModel(input());
    const ids = model.branches.flatMap((b) => b.clusters.flatMap((c) => c.skills.map((s) => s.skillId)));
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('reports an untouched player as knowing nothing, without flattering them', () => {
    const model = buildLibraryModel(input());
    expect(model.bands.unseen).toBe(41);
    expect(model.bands.strong).toBe(0);
    expect(model.examRetained).toBe(0);
    expect(model.examSeen).toBe(0);
    expect(summarise(model)).toContain('Nothing studied yet');
  });

  it('counts exam weight, not skills, because branch B is worth far more than its share', () => {
    /*
     * The whole reason this metric exists. Branch B is 18 of 41 skills, which
     * is 44 percent by count, but 45 to 50 percent of the exam. Retaining all
     * of one branch and none of the others must therefore produce that
     * branch's weight, not its share of the skill list.
     *
     * The expected value is not simply 47.5 percent, and the first version of
     * this test said it was. The published ranges are 25-30, 45-50 and 25-30,
     * whose midpoints sum to 102.5 rather than 100, so the model normalises
     * by the published total. That keeps the branch shares summing to exactly
     * one, which is what lets "retaining all of everything" report 100
     * percent instead of 102.5. Dividing by a hard-coded 100 would have been
     * the obvious reading and would have been wrong.
     */
    const branchB = DP600_OUTLINE.branches.find((b) => b.id === 'B')!;
    const midpoint = (branch: (typeof DP600_OUTLINE.branches)[number]) =>
      (branch.weightMin + branch.weightMax) / 2;
    const publishedTotal = DP600_OUTLINE.branches.reduce((sum, b) => sum + midpoint(b), 0);
    expect(publishedTotal).toBeGreaterThan(100);

    const records = new Map<string, MasteryRecord>();
    for (const cluster of branchB.clusters) {
      for (const skill of cluster.skills) {
        records.set(topicIdFor(skill.id), passed(topicIdFor(skill.id), 2));
      }
    }

    const model = buildLibraryModel(input({ records }));
    expect(model.examRetained).toBeCloseTo(midpoint(branchB) / publishedTotal, 5);

    // And it is not the same as the skill-count share, or the metric would
    // be pointless.
    expect(model.examRetained).not.toBeCloseTo(18 / 41, 3);
  });

  it('does not let a single answer count as retention', () => {
    // One pass is "learning": seen, not retained. Reporting it as retained
    // would tell a learner they are ready when they have answered once.
    const topicId = topicIdFor(12);
    const records = new Map([[topicId, passed(topicId, 1)]]);
    const model = buildLibraryModel(input({ records }));

    expect(model.bands.learning).toBe(1);
    expect(model.bands.familiar).toBe(0);
    expect(model.examRetained).toBe(0);
    expect(model.examSeen).toBeGreaterThan(0);
  });

  it('separates what was researched from what is retained', () => {
    /*
     * Unlocking a tech node means one question was answered. A player who
     * unlocked ten nodes an hour ago and remembers none of them should see
     * ten researched and nothing retained, not a single blended score.
     */
    const researched = new Set([topicIdFor(12), topicIdFor(13)]);
    const model = buildLibraryModel(input({ researched }));
    expect(model.researched).toBe(2);
    expect(model.bands.unseen).toBe(41);
    expect(model.examRetained).toBe(0);
  });

  it('flags what is due right now', () => {
    const due = new Set([topicIdFor(1), topicIdFor(30)]);
    const model = buildLibraryModel(input({ due }));
    expect(model.dueNow).toBe(2);
    const flagged = model.branches
      .flatMap((b) => b.clusters.flatMap((c) => c.skills))
      .filter((s) => s.due)
      .map((s) => s.skillId);
    expect(flagged).toEqual([1, 30]);
  });

  it('carries lapses through, so the screen can admit a topic keeps being forgotten', () => {
    const topicId = topicIdFor(20);
    let record = passed(topicId, 3);
    record = reviewMastery(record, 1, 2_000_000);
    const model = buildLibraryModel(input({ records: new Map([[topicId, record]]) }));
    const entry = model.branches
      .flatMap((b) => b.clusters.flatMap((c) => c.skills))
      .find((s) => s.skillId === 20)!;

    expect(entry.lapses).toBe(1);
    expect(entry.reviews).toBe(4);
    expect(entry.band).toBe('learning');
  });

  it('offers real documentation links for every skill', () => {
    // The bank covers all 41 skills, so every row should be able to send the
    // learner somewhere. An empty list here means a question lost its source.
    const model = buildLibraryModel(input());
    for (const skill of model.branches.flatMap((b) => b.clusters.flatMap((c) => c.skills))) {
      expect(skill.questionCount, `skill ${skill.skillId} has no questions`).toBeGreaterThan(0);
      expect(skill.links.length, `skill ${skill.skillId} has no links`).toBeGreaterThan(0);
      for (const link of skill.links) expect(link).toContain('learn.microsoft.com');
    }
  });

  it('deduplicates links and caps them, so one row cannot become a wall', () => {
    const model = buildLibraryModel(input({ maxLinks: 2 }));
    for (const skill of model.branches.flatMap((b) => b.clusters.flatMap((c) => c.skills))) {
      expect(skill.links.length).toBeLessThanOrEqual(2);
      expect(new Set(skill.links).size).toBe(skill.links.length);
    }
  });

  it('reports per branch as well as overall', () => {
    const topicId = topicIdFor(1);
    const model = buildLibraryModel(input({ records: new Map([[topicId, passed(topicId, 2)]]) }));
    const branchA = model.branches.find((b) => b.id === 'A')!;
    expect(branchA.bands.familiar).toBe(1);
    expect(branchA.retained).toBeCloseTo(1 / 11, 5);
    expect(model.branches.find((b) => b.id === 'B')!.retained).toBe(0);
  });

  it('names what is still unseen rather than only what was achieved', () => {
    const topicId = topicIdFor(1);
    const model = buildLibraryModel(input({ records: new Map([[topicId, passed(topicId, 2)]]) }));
    const line = summarise(model);
    expect(line).toContain('40 of 41 skills still unseen');
    expect(line).toMatch(/Retaining about \d+ percent/);
  });

  it('never reports more than the whole exam, however hard the player studies', () => {
    const records = new Map<string, MasteryRecord>();
    for (const branch of DP600_OUTLINE.branches) {
      for (const cluster of branch.clusters) {
        for (const skill of cluster.skills) {
          records.set(topicIdFor(skill.id), passed(topicIdFor(skill.id), 6));
        }
      }
    }
    const model = buildLibraryModel(input({ records }));
    expect(model.examRetained).toBeCloseTo(1, 5);
    expect(model.bands.strong).toBe(41);
    expect(summarise(model)).toContain('every skill has been seen at least once');
  });
});
