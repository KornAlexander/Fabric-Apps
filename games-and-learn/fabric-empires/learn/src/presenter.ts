/**
 * Turning a question into a ChallengeOutcome.
 *
 * The presenter owns everything the engine must not see: the question, the
 * answer, the explanation and the scoring curve. It hands back a single number
 * in -1..+1 (D35).
 *
 * The UI is injected, so the whole loop is testable headlessly. A test drives
 * it with a scripted answerer and asserts the score, which is not something a
 * DOM-bound implementation would allow.
 */

import type {
  ChallengeOutcome,
  ChallengeRequest,
} from '@fabric-empires/engine';
import { checkAnswer, decryptExplanation } from './crypto.js';
import { selectQuestion, type SelectOptions } from './bank.js';
import { topicIdFor } from './outline.js';
import { candidateAnswers, type Question } from './questions.js';

/**
 * The campaign prefix of a topic id, so a borrowed question is reported under
 * the same curriculum it was asked in.
 *
 * ⚠️ Topic ids are `<campaign>-<number>` and the campaign is no longer always
 * `dp600`; hard-coding it here is exactly the bug `skillIdFromTopic` already
 * carries a warning about, seen from the writing side.
 */
function campaignOf(topicId: string): string {
  const match = /^(.*)-\d+$/.exec(topicId);
  return match?.[1] ?? 'dp600';
}

/**
 * Recover the correct answer by testing every candidate against the stored
 * hash.
 *
 * ⚠️ This is the brute force the plan already described as trivial, performed
 * by the app itself. It means the answer obfuscation is decorative for a
 * multiple-choice item, and that is a deliberate trade: telling a learner
 * nothing at the exact moment they are most receptive is a worse failure than
 * a determined player recovering an answer they could have recovered anyway.
 *
 * The hashing still earns its place: the shipped JSON is not a readable answer
 * key, which was always the only claim worth making.
 */
export async function revealCorrectAnswer(
  question: Question,
): Promise<string | string[] | undefined> {
  for (const candidate of candidateAnswers(question)) {
    if (await checkAnswer(question.id, candidate, question.answerHash)) {
      return candidate;
    }
  }
  return undefined;
}

export interface QuestionPrompt {
  readonly question: Question;
  readonly request: ChallengeRequest;
}

export interface QuestionAnswer {
  /**
   * What the player chose. Explicitly allows undefined as well as being
   * optional, so a caller can pass `{ answer: undefined }` to mean "no answer"
   * without fighting exactOptionalPropertyTypes.
   */
  readonly answer?: string | readonly string[] | undefined;
  readonly elapsedMs: number;
  readonly abandoned: boolean;
}

export interface QuestionResult {
  readonly question: Question;
  readonly correct: boolean;
  readonly given: string | readonly string[] | undefined;
  /**
   * The right answer, so a learner who missed is corrected rather than left
   * guessing. Present whether they were right or wrong.
   */
  readonly correctAnswer: string | string[] | undefined;
  readonly explanation: string | undefined;
  readonly score: number;
  readonly elapsedMs: number;
}

export interface QuestionUi {
  ask(prompt: QuestionPrompt): Promise<QuestionAnswer>;
  reveal(result: QuestionResult): Promise<void>;
}

/**
 * Score curve, from the plan.
 *
 * Speed is a bonus and never an extra penalty: a slow correct answer still
 * scores well, because taking time to think is not a mistake.
 *
 * ⚠️ **`elapsedMs` here is THINKING time, not wall-clock time.** Reading the
 * question is granted separately and free. See `readingAllowanceMs` for why
 * that distinction turned out to be load-bearing rather than fussy.
 */
export const SCORE_CORRECT_FAST = 1;
export const SCORE_CORRECT = 0.6;
export const SCORE_TIMEOUT = -0.6;
export const SCORE_WRONG = -1;

/**
 * The share of the thinking budget past which an answer counts as laboured.
 *
 * ⚠️ **Not the same line as the fast/slow scoring boundary, deliberately.**
 * Scoring splits at half the budget, and reusing that here would send a
 * comfortable eight-second answer back round again: at the default pace the
 * budget is fourteen seconds, so half of it is barely a pause for thought.
 * This is about whether the player nearly ran out of clock, which is evidence
 * they were reconstructing the answer rather than recalling it, and that is
 * the only kind of slowness worth re-testing.
 *
 * A correct answer inside this still scores 0.6 rather than 1. Being unhurried
 * costs a little; it does not cost you the question twice.
 */
export const LABOURED_SHARE = 0.8;

/**
 * Whether this attempt earns the question a second showing.
 *
 * The rule the player asked for: a question comes back only if it was got
 * wrong, abandoned, or nearly ran the clock out. Anything answered correctly
 * and in reasonable time is done with for the session.
 */
export function shouldReask(
  correct: boolean,
  thinkingMs: number,
  timeLimitMs: number,
  abandoned: boolean,
): boolean {
  if (abandoned || !correct) return true;
  return thinkingMs > timeLimitMs * LABOURED_SHARE;
}

export function scoreFor(
  correct: boolean,
  elapsedMs: number,
  timeLimitMs: number,
  abandoned: boolean,
): number {
  if (abandoned) return SCORE_TIMEOUT;
  if (!correct) return SCORE_WRONG;
  return elapsedMs <= timeLimitMs / 2 ? SCORE_CORRECT_FAST : SCORE_CORRECT;
}

/**
 * Careful reading speed for technical prose, in words per minute.
 *
 * 200 is the low end of adult silent reading and the right end for this. Every
 * question here is deliberately about a distinction the reader is unsure of,
 * which is the slowest kind of reading there is, and a good share of the
 * people using this are reading in a second language.
 */
export const READING_WPM = 200;

/** Seconds granted on top of the thinking budget, just to read the thing. */
export function readingAllowanceMs(question: Question): number {
  const text = [question.stem, ...(question.options ?? [])].join(' ');
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.round((words / READING_WPM) * 60_000);
}

/**
 * The clock a player actually sees: reading time plus thinking time.
 *
 * ⚠️ **This is the fix for a measured, serious bug.** The time limit used to
 * be a flat 20 seconds covering reading AND answering, and the top score
 * needed an answer inside half of it. Measured against the real bank at the
 * default pace, that meant **only 54 percent of DP-600 questions could be
 * answered at all**, and **only 3 percent could earn the fast bonus**. The
 * median question needs 19.6 seconds simply to read and choose.
 *
 * The visible symptom was in combat: the fast bonus is worth 1.0 against 0.6,
 * which is the difference between an enemy dying to one blow and surviving to
 * be hit again. Players answering correctly watched enemies shrug it off and
 * had no way to know the clock was the reason.
 *
 * The deeper problem is that a shared flat clock grades **reading speed**, and
 * this is a study tool, not a typing test. A long question about Direct Lake
 * and a four-word sum for a six-year-old cannot share a stopwatch.
 */
export function questionClockMs(question: Question, thinkingMs: number): number {
  return readingAllowanceMs(question) + thinkingMs;
}

export interface PresenterOptions extends SelectOptions {
  /** Questions already asked, so a session repeats itself as little as possible. */
  readonly asked?: Set<string>;
  /**
   * Questions answered correctly and promptly, which will not be asked again.
   *
   * ⚠️ Session-scoped on purpose, and NOT persisted alongside mastery. A
   * question retired for good would mean a topic answered right once is never
   * tested again, which is the opposite of what spaced repetition is for. The
   * set dies with the page; the SM-2 schedule is what carries knowledge
   * between sittings.
   */
  readonly retired?: Set<string>;
  /**
   * The pool to draw from. Defaults to the whole bank.
   *
   * Exists so the empty-bank path stays testable now that every skill in the
   * outline has questions. It also gives a future exam mode somewhere to pass
   * a restricted set without the presenter needing to know why.
   */
  readonly questions?: readonly Question[];
  /**
   * Called once per answered question, with what happened.
   *
   * ⚠️ **This layer does not know, and must not know, where the record goes.**
   * The same separation D35 draws between the engine and certifications is
   * drawn again here: `learn` teaches and schedules, and if it also held a
   * database client then asking a question would depend on a network being
   * present. The callback is synchronous and its return value is ignored, so
   * a recorder cannot slow an answer down or fail one.
   *
   * ⚠️ It fires whether the answer was right, wrong or abandoned. A stats
   * table that only saw correct answers would be a very flattering and
   * completely useless record of learning.
   */
  readonly onAttempt?: (attempt: AttemptRecord) => void;
}

/**
 * One answered question, as the learning layer sees it.
 *
 * Deliberately free of ids that only mean something to a host application: no
 * user, no game, no session. Whoever consumes this knows those; the presenter
 * does not.
 */
export interface AttemptRecord {
  readonly questionId: string;
  /** The topic actually ASKED, which is not always the one requested. */
  readonly topicId: string;
  /** Why the question was asked: battle, research, settle, exam. */
  readonly kind: string;
  readonly tier: string;
  readonly correct: boolean;
  readonly abandoned: boolean;
  /** Thinking time only. Reading time is granted free, see `readingAllowanceMs`. */
  readonly thinkingMs: number;
  readonly score: number;
}

/**
 * Build a presenter around a UI.
 *
 * When the topic has no question yet, it resolves neutral without troubling
 * the player. That is the honest behaviour for a bank still being written: the
 * game continues, and knowledge simply contributes nothing on that topic.
 */
export function createQuestionPresenter(
  ui: QuestionUi,
  options: PresenterOptions = {},
): (request: ChallengeRequest) => Promise<ChallengeOutcome> {
  const asked = options.asked ?? new Set<string>();
  const retired = options.retired ?? new Set<string>();
  const { questions: pool, ...selectOptions } = options;

  return async function present(
    request: ChallengeRequest,
  ): Promise<ChallengeOutcome> {
    const question = selectQuestion(
      request.topicId,
      {
        tier: request.tier,
        exclude: asked,
        retired,
        borrowWhenExhausted: true,
        ...selectOptions,
      },
      pool,
    );

    if (!question) {
      return { score: 0, elapsedMs: 0, abandoned: false };
    }
    asked.add(question.id);

    /*
     * ⚠️ **The topic the question is really about, which is not always the
     * one that was requested.**
     *
     * When a skill's three questions are all retired, `selectQuestion` borrows
     * from a neighbour so the fight still has a question in it. Reporting that
     * result against `request.topicId` would credit the player with knowing a
     * topic they were never asked about, and quietly push its review further
     * out. The scheduler is only as good as the honesty of what it is told.
     */
    const askedTopicId = topicIdFor(question.skillId, campaignOf(request.topicId));

    /*
     * The clock the player sees is reading time plus thinking time, and only
     * the thinking half is graded. Somebody who reads slowly and answers
     * instantly should score the same as somebody who reads quickly and
     * answers instantly, because the thing being measured is whether they
     * know it.
     */
    const reading = readingAllowanceMs(question);
    const clockMs = reading + request.timeLimitMs;

    const given = await ui.ask({
      question,
      request: { ...request, timeLimitMs: clockMs },
    });
    const answered = given.answer;

    const correct =
      !given.abandoned &&
      answered !== undefined &&
      (Array.isArray(answered) ? answered.length > 0 : String(answered).length > 0) &&
      (await checkAnswer(question.id, answered, question.answerHash));

    const thinkingMs = Math.max(0, given.elapsedMs - reading);
    const score = scoreFor(correct, thinkingMs, request.timeLimitMs, given.abandoned);

    /*
     * Tell whoever is listening, and never let it matter if they throw.
     *
     * ⚠️ The try/catch is not defensive padding. Without it, a recorder that
     * failed (an expired token, an offline tab) would take the exception out
     * through `present`, and the caller of `present` is a BATTLE: the player
     * would lose the fight because a statistics write failed. Answering a
     * question must not depend on anything but the answer.
     */
    try {
      options.onAttempt?.({
        questionId: question.id,
        topicId: askedTopicId,
        kind: String(request.kind),
        tier: String(request.tier),
        correct,
        abandoned: given.abandoned,
        thinkingMs,
        score,
      });
    } catch {
      // Recording is never worth a turn.
    }

    /*
     * Retire it, or leave it in play.
     *
     * ⚠️ Recorded AFTER the answer, unlike `asked`, which is added before the
     * question is even shown. `asked` only has to stop the same question
     * appearing twice in a row; this has to know how it went.
     */
    if (!shouldReask(correct, thinkingMs, request.timeLimitMs, given.abandoned)) {
      retired.add(question.id);
    } else {
      /*
       * A question that must come back is taken OUT of the soft-avoid set.
       *
       * Otherwise the two rules fight: this one says "ask it again", and
       * `asked` says "prefer anything else", so with three questions per skill
       * the wrong answer would be the last of the three to reappear rather
       * than a candidate straight away.
       */
      asked.delete(question.id);
    }

    // Teach on the way out, whatever happened. A learner who was wrong sees
    // the right answer and the reasoning; the spaced repetition system will
    // bring the item back regardless.
    const correctAnswer = correct
      ? (answered as string | string[])
      : await revealCorrectAnswer(question);

    const explanation =
      correctAnswer === undefined
        ? undefined
        : await decryptExplanation(
            question.id,
            correctAnswer,
            question.explanationCipher,
          );

    await ui.reveal({
      question,
      correct,
      given: answered,
      correctAnswer,
      explanation,
      score,
      elapsedMs: given.elapsedMs,
    });

    return {
      score,
      elapsedMs: given.elapsedMs,
      abandoned: given.abandoned,
      topicId: askedTopicId,
    };
  };
}
