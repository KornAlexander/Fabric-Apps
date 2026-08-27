/**
 * The clock.
 *
 * ⚠️ **These tests exist because a real, serious bug shipped and the whole
 * suite stayed green through it.** The time limit was a flat 20 seconds
 * covering reading AND answering, and the top score required an answer inside
 * half of it. Measured against the real bank at the default pace that meant
 * only 54 percent of DP-600 questions could be answered at all, and only 3
 * percent could earn the fast bonus.
 *
 * It surfaced as a combat complaint: "enemies don't die on the first fight".
 * They did not, because the fast bonus is worth 1.0 against 0.6, which is the
 * difference between 100 damage and 77 against 100 hit points. Players
 * answering correctly watched enemies shrug it off with no way to know that a
 * stopwatch was the reason.
 *
 * Every assertion below is about the bank as it really is, not a fixture,
 * because the failure was a mismatch between the clock and the content and a
 * fixture would have agreed with whatever the clock said.
 */

import { describe, expect, it } from 'vitest';
import {
  DP600_QUESTIONS,
  KLASSE1_QUESTIONS,
  READING_WPM,
  SCORE_CORRECT,
  SCORE_CORRECT_FAST,
  questionClockMs,
  readingAllowanceMs,
  scoreFor,
  type Question,
} from '../src/index.js';

/** The thinking budget a battle gives, at the default pace. */
const BATTLE_THINK_MS = 14_000;

const wordsIn = (q: Question): number =>
  [q.stem, ...(q.options ?? [])]
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

/**
 * How long a real person needs: reading at the same speed the code assumes,
 * then three seconds to commit to one of four options.
 */
const knowsItMs = (q: Question): number => (wordsIn(q) / READING_WPM) * 60_000 + 3_000;

describe('reading time is granted, not charged', () => {
  it('scales with the question rather than being one number for all of them', () => {
    const longest = DP600_QUESTIONS.reduce((a, b) => (wordsIn(a) > wordsIn(b) ? a : b));
    const shortest = KLASSE1_QUESTIONS.reduce((a, b) => (wordsIn(a) < wordsIn(b) ? a : b));
    expect(readingAllowanceMs(longest)).toBeGreaterThan(readingAllowanceMs(shortest) * 3);
  });

  it('gives a six-year-old less reading time than a DP-600 candidate', () => {
    // Not a kindness, an accuracy: "3 + 4 = ?" does not take fifteen seconds
    // to read, and pretending it does would make the fast bonus meaningless
    // for the seat that is supposed to be able to earn it.
    const sums = KLASSE1_QUESTIONS.map(readingAllowanceMs);
    const exam = DP600_QUESTIONS.map(readingAllowanceMs);
    expect(Math.max(...sums)).toBeLessThan(Math.min(...exam));
  });

  it('never returns nothing, even for a one word question', () => {
    expect(readingAllowanceMs({ stem: 'Why?', options: [] } as unknown as Question))
      .toBeGreaterThan(0);
  });
});

describe('⚠️ every question can actually be answered', () => {
  /*
   * The assertion that would have caught the bug. It is deliberately about
   * 100 percent of the bank and not a median: a question nobody can finish is
   * not a hard question, it is a broken one, and the old flat clock broke
   * nearly half of them.
   */
  for (const [name, bank] of [
    ['DP-600', DP600_QUESTIONS],
    ['Klasse 1', KLASSE1_QUESTIONS],
  ] as const) {
    it(`${name}: someone who knows the answer beats the clock, on every question`, () => {
      const failures = bank.filter(
        (q) => knowsItMs(q) > questionClockMs(q, BATTLE_THINK_MS),
      );
      expect(
        failures.map((q) => q.id),
        `${failures.length} of ${bank.length} cannot be finished in time`,
      ).toEqual([]);
    });

    it(`${name}: someone who knows the answer earns the fast bonus, on every question`, () => {
      const slow = bank.filter((q) => {
        const thinking = Math.max(0, knowsItMs(q) - readingAllowanceMs(q));
        return scoreFor(true, thinking, BATTLE_THINK_MS, false) !== SCORE_CORRECT_FAST;
      });
      expect(
        slow.map((q) => q.id),
        `${slow.length} of ${bank.length} cannot earn the fast bonus even when known`,
      ).toEqual([]);
    });
  }
});

describe('⚠️ the clock grades hesitation, not literacy', () => {
  it('scores a slow reader who knows it the same as a fast reader who knows it', () => {
    /*
     * The principle the fix is built on. A good share of the people using this
     * are reading in a second language, and a study aid that quietly marks
     * them down for it is measuring the wrong thing.
     */
    const long = DP600_QUESTIONS.reduce((a, b) => (wordsIn(a) > wordsIn(b) ? a : b));
    const short = DP600_QUESTIONS.reduce((a, b) => (wordsIn(a) < wordsIn(b) ? a : b));

    const scoreWhenKnown = (q: Question): number =>
      scoreFor(
        true,
        Math.max(0, knowsItMs(q) - readingAllowanceMs(q)),
        BATTLE_THINK_MS,
        false,
      );

    expect(scoreWhenKnown(long)).toBe(scoreWhenKnown(short));
    expect(scoreWhenKnown(long)).toBe(SCORE_CORRECT_FAST);
  });

  it('still marks down real hesitation', () => {
    // The bonus has to mean something, or it is not a bonus. Dithering for
    // most of the thinking budget after reading is what it costs.
    const q = DP600_QUESTIONS[0]!;
    const dithered = BATTLE_THINK_MS * 0.9;
    expect(scoreFor(true, dithered, BATTLE_THINK_MS, false)).toBe(SCORE_CORRECT);
  });

  it('never punishes slowness twice', () => {
    // From the original design note: speed is a bonus, never an extra penalty.
    // A slow correct answer must still be clearly better than a wrong one.
    expect(SCORE_CORRECT).toBeGreaterThan(0);
    expect(scoreFor(true, 999_999, BATTLE_THINK_MS, false)).toBe(SCORE_CORRECT);
  });
});
