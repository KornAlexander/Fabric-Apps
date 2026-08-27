import { describe, expect, it } from 'vitest';
import type { ChallengeRequest } from '@fabric-empires/engine';
import {
  DP600_QUESTIONS,
  LABOURED_SHARE,
  candidateAnswers,
  checkAnswer,
  createQuestionPresenter,
  readingAllowanceMs,
  selectQuestion,
  shouldReask,
  type Question,
  type QuestionAnswer,
  type QuestionPrompt,
} from '../src/index.js';

/*
  Not asking the same question twice.

  The complaint: the same question kept coming back after it had been answered
  correctly. With exactly three questions per skill and a soft "prefer
  something else" rule that gives up as soon as the skill runs dry, a player
  who answered well saw the same item again within the same session.

  The rule now: a question comes back only if it was got wrong, abandoned, or
  nearly ran the clock out. Everything else is retired for the session.
*/

const BATTLE_THINK_MS = 14_000;

/**
 * The genuinely correct answer for a question.
 *
 * ⚠️ Found by checking candidates against the stored hash, not by reading an
 * index off the question. The bank ships the answer only as a hash, so an
 * earlier version of this harness answered with `options[0]` and was correct
 * by luck about a quarter of the time. Every "answered correctly" assertion
 * below was therefore testing something else entirely.
 */
async function rightAnswerFor(question: Question): Promise<string> {
  for (const candidate of candidateAnswers(question)) {
    const value = Array.isArray(candidate) ? candidate : candidate;
    if (await checkAnswer(question.id, value, question.answerHash)) {
      return value as string;
    }
  }
  throw new Error(`no candidate matched the hash for ${question.id}`);
}

/** Drive the presenter with a scripted answer and a controlled clock. */
function harness(options: {
  readonly correct: boolean;
  readonly thinkingMs: number;
  readonly abandoned?: boolean;
  readonly asked?: Set<string>;
  readonly retired?: Set<string>;
  readonly questions?: readonly Question[];
}) {
  const seen: Question[] = [];
  const present = createQuestionPresenter(
    {
      async ask(prompt: QuestionPrompt): Promise<QuestionAnswer> {
        seen.push(prompt.question);
        const reading = readingAllowanceMs(prompt.question);
        if (options.abandoned) {
          return { answer: undefined, elapsedMs: reading + options.thinkingMs, abandoned: true };
        }
        return {
          answer: options.correct
            ? await rightAnswerFor(prompt.question)
            : '__definitely wrong__',
          elapsedMs: reading + options.thinkingMs,
          abandoned: false,
        };
      },
      async reveal() {},
    },
    {
      asked: options.asked ?? new Set<string>(),
      retired: options.retired ?? new Set<string>(),
      ...(options.questions ? { questions: options.questions } : {}),
      random: () => 0,
    },
  );
  return { present, seen };
}

const request = (topicId: string): ChallengeRequest => ({
  kind: 'battle',
  topicId,
  tier: 1,
  timeLimitMs: BATTLE_THINK_MS,
});

describe('what earns a question a second showing', () => {
  it('a prompt correct answer does not', () => {
    expect(shouldReask(true, 3_000, BATTLE_THINK_MS, false)).toBe(false);
  });

  it('a wrong answer does, however fast', () => {
    expect(shouldReask(false, 500, BATTLE_THINK_MS, false)).toBe(true);
  });

  it('abandoning does', () => {
    expect(shouldReask(false, 0, BATTLE_THINK_MS, true)).toBe(true);
  });

  it('⚠️ a correct answer that nearly ran out of clock does', () => {
    const laboured = BATTLE_THINK_MS * LABOURED_SHARE + 1;
    expect(shouldReask(true, laboured, BATTLE_THINK_MS, false)).toBe(true);
  });

  it('⚠️ but merely being unhurried does not', () => {
    /*
     * The line is NOT the fast/slow scoring boundary at half the budget.
     * Reusing that would send a comfortable eight-second answer back round
     * again, when eight seconds on a four-option question is just thinking.
     */
    const unhurried = BATTLE_THINK_MS * 0.6;
    expect(shouldReask(true, unhurried, BATTLE_THINK_MS, false)).toBe(false);
    expect(LABOURED_SHARE).toBeGreaterThan(0.5);
  });
});

describe('across a session', () => {
  it('⚠️ never repeats a question answered correctly and promptly', async () => {
    const retired = new Set<string>();
    const asked = new Set<string>();
    const ids: string[] = [];

    // Six attempts at a topic that only has three questions. Without
    // retirement the fourth would repeat one of the first three.
    for (let i = 0; i < 6; i += 1) {
      const { present, seen } = harness({ correct: true, thinkingMs: 2_000, asked, retired });
      await present(request('dp600-12'));
      ids.push(seen[0]!.id);
    }

    const repeatedWithinFirstThree = new Set(ids.slice(0, 3)).size !== 3;
    expect(repeatedWithinFirstThree).toBe(false);
    // Nothing from the first three ever came back.
    for (const later of ids.slice(3)) expect(ids.slice(0, 3)).not.toContain(later);
  });

  it('⚠️ does bring back the one that was answered wrong', async () => {
    const retired = new Set<string>();
    const asked = new Set<string>();

    const first = harness({ correct: false, thinkingMs: 2_000, asked, retired });
    await first.present(request('dp600-12'));
    const missed = first.seen[0]!.id;

    expect(retired.has(missed)).toBe(false);
    // ⚠️ And it is a candidate straight away, not last of the three: a wrong
    // answer is removed from the soft-avoid set as well as kept out of the
    // retired one, or the two rules would pull against each other.
    expect(asked.has(missed)).toBe(false);
  });

  it('retires nothing when the answer was laboured, even though it was right', async () => {
    const retired = new Set<string>();
    const { present, seen } = harness({
      correct: true,
      thinkingMs: BATTLE_THINK_MS * 0.95,
      retired,
    });
    await present(request('dp600-12'));
    expect(retired.has(seen[0]!.id)).toBe(false);
  });
});

describe('when a topic has nothing left', () => {
  it('⚠️ borrows a question rather than asking none at all', () => {
    const all = DP600_QUESTIONS.filter((q) => q.skillId === 12).map((q) => q.id);
    const retired = new Set(all);

    const borrowed = selectQuestion('dp600-12', { retired, borrowWhenExhausted: true });
    expect(borrowed).toBeDefined();
    expect(borrowed!.skillId).not.toBe(12);
  });

  it('returns nothing when borrowing is not allowed', () => {
    const all = DP600_QUESTIONS.filter((q) => q.skillId === 12).map((q) => q.id);
    expect(selectQuestion('dp600-12', { retired: new Set(all) })).toBeUndefined();
  });

  it('⚠️ reports the topic it actually asked about, not the one requested', async () => {
    /*
     * The whole reason `ChallengeOutcome.topicId` exists. Recording a borrowed
     * question against the requested topic would tell the scheduler the player
     * knows something they were never asked, and push its review further out.
     */
    const all = DP600_QUESTIONS.filter((q) => q.skillId === 12).map((q) => q.id);
    const retired = new Set(all);
    const { present, seen } = harness({ correct: true, thinkingMs: 2_000, retired });

    const outcome = await present(request('dp600-12'));
    expect(seen[0]!.skillId).not.toBe(12);
    expect(outcome.topicId).toBe(`dp600-${seen[0]!.skillId}`);
    expect(outcome.topicId).not.toBe('dp600-12');
  });

  it('prefers a neighbour in the same cluster before reaching across the exam', () => {
    const all = DP600_QUESTIONS.filter((q) => q.skillId === 12).map((q) => q.id);
    const borrowed = selectQuestion('dp600-12', {
      retired: new Set(all),
      borrowWhenExhausted: true,
      random: () => 0,
    });
    // Skill 12 sits in cluster B1; a neighbour is nearer than a random skill
    // from the far end of the outline.
    expect(borrowed).toBeDefined();
    expect(Math.abs(borrowed!.skillId - 12)).toBeLessThan(20);
  });
});
