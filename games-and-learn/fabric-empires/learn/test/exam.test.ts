import { describe, expect, it } from 'vitest';
import { DP600_QUESTIONS } from '../src/bank.js';
import { DP600_OUTLINE } from '../src/outline.js';
import {
  PROCTOR_THRESHOLD,
  SIEGE_LENGTH,
  SIEGE_PASS_MARK,
  buildSiege,
  proctorReady,
  scoreSiege,
} from '../src/exam.js';
import type { LibraryModel } from '../src/library.js';

/**
 * The Proctor.
 *
 * ⚠️ The assertions worth having are about the *shape* of the paper. A siege
 * that returns forty questions is easy; a siege that returns forty questions
 * in the exam's published proportions is the thing that makes a pass mean
 * anything, and an even three-way split would satisfy every naive test while
 * telling the player they were ready for a different exam.
 */

const model = (examRetained: number): LibraryModel =>
  ({ examRetained }) as unknown as LibraryModel;

describe('summoning', () => {
  it('waits until the player has genuinely studied', () => {
    expect(proctorReady(model(0))).toBe(false);
    expect(proctorReady(model(0.5))).toBe(false);
    expect(proctorReady(model(PROCTOR_THRESHOLD - 0.01))).toBe(false);
  });

  it('calls at the threshold', () => {
    expect(proctorReady(model(PROCTOR_THRESHOLD))).toBe(true);
    expect(proctorReady(model(1))).toBe(true);
  });

  it('invites before the pass mark is a certainty', () => {
    // The siege has to be a real test rather than a lap of honour.
    expect(PROCTOR_THRESHOLD).toBeGreaterThan(SIEGE_PASS_MARK);
    expect(PROCTOR_THRESHOLD).toBeLessThan(1);
  });
});

describe('the paper', () => {
  it('is the full length', () => {
    expect(buildSiege(DP600_QUESTIONS, 'FABRIC')).toHaveLength(SIEGE_LENGTH);
  });

  it('never repeats a question', () => {
    const paper = buildSiege(DP600_QUESTIONS, 'FABRIC');
    expect(new Set(paper.map((p) => p.question.id)).size).toBe(SIEGE_LENGTH);
  });

  it('numbers itself for the player', () => {
    const paper = buildSiege(DP600_QUESTIONS, 'FABRIC');
    expect(paper.map((p) => p.position)).toEqual(
      Array.from({ length: SIEGE_LENGTH }, (_, i) => i + 1),
    );
  });

  it('follows the published branch weights, not an even split', () => {
    const paper = buildSiege(DP600_QUESTIONS, 'FABRIC');
    const counts = new Map<string, number>();
    for (const entry of paper) {
      counts.set(entry.question.branch, (counts.get(entry.question.branch) ?? 0) + 1);
    }

    const weightTotal = DP600_OUTLINE.branches.reduce(
      (sum, b) => sum + (b.weightMin + b.weightMax) / 2,
      0,
    );

    for (const branch of DP600_OUTLINE.branches) {
      const share = (branch.weightMin + branch.weightMax) / 2 / weightTotal;
      const expected = SIEGE_LENGTH * share;
      const actual = counts.get(branch.id) ?? 0;
      // Within two questions of the published proportion.
      expect(Math.abs(actual - expected), `${branch.id}: ${actual} vs ${expected}`).toBeLessThan(2);
    }

    // And the heaviest branch really is the heaviest, which an even split
    // would fail while every other assertion here passed.
    const b = counts.get('B') ?? 0;
    expect(b).toBeGreaterThan(counts.get('A') ?? 0);
    expect(b).toBeGreaterThan(counts.get('C') ?? 0);
  });

  it('covers every branch', () => {
    const paper = buildSiege(DP600_QUESTIONS, 'FABRIC');
    const branches = new Set(paper.map((p) => p.question.branch));
    expect(branches.size).toBe(DP600_OUTLINE.branches.length);
  });

  it('is the same paper for the same seed, and a different one otherwise', () => {
    const a = buildSiege(DP600_QUESTIONS, 'FABRIC').map((p) => p.question.id);
    const b = buildSiege(DP600_QUESTIONS, 'FABRIC').map((p) => p.question.id);
    const c = buildSiege(DP600_QUESTIONS, 'CONTOSO').map((p) => p.question.id);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('still fills the paper when the bank is thin', () => {
    /*
     * A short pool used to be able to produce a 38-question exam calling
     * itself 40. The length is quoted to the player, so a paper that silently
     * shrinks makes the same score mean different things on different runs.
     */
    const thin = DP600_QUESTIONS.slice(0, SIEGE_LENGTH + 2);
    expect(buildSiege(thin, 'FABRIC')).toHaveLength(SIEGE_LENGTH);
  });

  it('cannot ask for more than the bank holds', () => {
    const tiny = DP600_QUESTIONS.slice(0, 5);
    expect(buildSiege(tiny, 'FABRIC')).toHaveLength(5);
  });
});

describe('marking', () => {
  const paper = buildSiege(DP600_QUESTIONS, 'FABRIC');
  const idsOf = (n: number) => new Set(paper.slice(0, n).map((p) => p.question.id));

  it('passes at the published mark and fails below it', () => {
    const needed = Math.ceil(SIEGE_LENGTH * SIEGE_PASS_MARK);
    expect(scoreSiege(paper, idsOf(needed)).passed).toBe(true);
    expect(scoreSiege(paper, idsOf(needed - 1)).passed).toBe(false);
  });

  it('reports the score honestly', () => {
    const result = scoreSiege(paper, idsOf(30));
    expect(result.asked).toBe(SIEGE_LENGTH);
    expect(result.correct).toBe(30);
    expect(result.share).toBeCloseTo(30 / SIEGE_LENGTH, 5);
  });

  it('breaks the result down by branch', () => {
    const result = scoreSiege(paper, idsOf(SIEGE_LENGTH));
    let asked = 0;
    for (const [, tally] of result.byBranch) {
      expect(tally.correct).toBe(tally.asked);
      asked += tally.asked;
    }
    expect(asked).toBe(SIEGE_LENGTH);
  });

  it('gives nothing away for an empty sheet', () => {
    const result = scoreSiege(paper, new Set());
    expect(result.correct).toBe(0);
    expect(result.share).toBe(0);
    expect(result.passed).toBe(false);
  });
});
