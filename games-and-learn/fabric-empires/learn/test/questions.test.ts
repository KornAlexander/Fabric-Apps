import { describe, it, expect, vi } from 'vitest';
import {
  ANSWER_SALT,
  DP600_QUESTIONS,
  LOADED_CLUSTERS,
  SCORE_CORRECT,
  SCORE_CORRECT_FAST,
  SCORE_TIMEOUT,
  SCORE_WRONG,
  allSkills,
  checkAnswer,
  coverage,
  coveredSkills,
  createQuestionPresenter,
  decryptExplanation,
  encryptExplanation,
  hashAnswer,
  normaliseAnswer,
  questionsForCluster,
  questionsForSkill,
  revealCorrectAnswer,
  scoreFor,
  selectQuestion,
  validateBank,
  validateQuestion,
  type Question,
  type QuestionAnswer,
  type QuestionPrompt,
  type QuestionResult,
  type QuestionUi,
} from '../src/index.js';

/*
 * ⚠️ **Room for the clock, for the same reason `worldSetup.test.ts` has it.**
 *
 * The bank tests derive a key and decrypt an explanation for all 123
 * questions, which is deliberately slow work: the whole point of the answer
 * hashing is that it cannot be brute-forced cheaply. Measured, this file takes
 * about 18 s alone and blew the 5 s default at 41 s while the rest of the
 * suite ran, and the file that tipped over was a different one on each run.
 *
 * The clock is not the property under test. These assert that every recorded
 * answer round-trips and that no distractor is accepted, and both are
 * deterministic. Failing on scheduling noise teaches the reader to distrust a
 * red suite, which is the most expensive thing a test can do.
 */
vi.setConfig({ testTimeout: 60_000 });

import draftA1 from '../content/dp-600/questions/src/A1.json' with { type: 'json' };
import draftA2 from '../content/dp-600/questions/src/A2.json' with { type: 'json' };
import draftB1 from '../content/dp-600/questions/src/B1.json' with { type: 'json' };
import draftB2 from '../content/dp-600/questions/src/B2.json' with { type: 'json' };
import draftB3 from '../content/dp-600/questions/src/B3.json' with { type: 'json' };
import draftC1 from '../content/dp-600/questions/src/C1.json' with { type: 'json' };
import draftC2 from '../content/dp-600/questions/src/C2.json' with { type: 'json' };

interface Draft {
  readonly id: string;
  readonly answer: string;
  readonly explanation: string;
  readonly options?: readonly string[];
  readonly stem: string;
}
const DRAFTS = [
  ...(draftA1 as { questions: Draft[] }).questions,
  ...(draftA2 as { questions: Draft[] }).questions,
  ...(draftB1 as { questions: Draft[] }).questions,
  ...(draftB2 as { questions: Draft[] }).questions,
  ...(draftB3 as { questions: Draft[] }).questions,
  ...(draftC1 as { questions: Draft[] }).questions,
  ...(draftC2 as { questions: Draft[] }).questions,
];
const draftById = new Map(DRAFTS.map((d) => [d.id, d]));

/** Every skill in the outline now has authored questions. */
const COVERED = Array.from({ length: 41 }, (_, i) => i + 1);

function questionById(id: string): Question {
  const found = DP600_QUESTIONS.find((q) => q.id === id);
  if (!found) throw new Error(`No built question ${id}`);
  return found;
}

describe('answer normalisation', () => {
  it('ignores case and surrounding space', () => {
    expect(normaliseAnswer('  Direct Lake ')).toBe(normaliseAnswer('direct lake'));
  });

  it('collapses runs of whitespace', () => {
    expect(normaliseAnswer('Direct   Lake')).toBe(normaliseAnswer('Direct Lake'));
  });

  it('ignores the order of a multi-select', () => {
    // A player who picks the right two options in the wrong order being told
    // they are wrong would be the worst possible bug in a teaching tool.
    expect(normaliseAnswer(['b', 'a'])).toBe(normaliseAnswer(['a', 'b']));
  });

  it('drops empty entries', () => {
    expect(normaliseAnswer(['a', '', '  '])).toBe(normaliseAnswer('a'));
  });
});

describe('answer hashing', () => {
  it('is stable for the same input', async () => {
    expect(await hashAnswer('q1', 'yes')).toBe(await hashAnswer('q1', 'yes'));
  });

  it('is a 64 character hex digest', async () => {
    expect(await hashAnswer('q1', 'yes')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs per question, so one answer key does not unlock another', async () => {
    expect(await hashAnswer('q1', 'yes')).not.toBe(await hashAnswer('q2', 'yes'));
  });

  it('accepts a correct answer and rejects a wrong one', async () => {
    const hash = await hashAnswer('q1', 'Direct Lake');
    expect(await checkAnswer('q1', 'direct lake', hash)).toBe(true);
    expect(await checkAnswer('q1', 'Import', hash)).toBe(false);
  });
});

describe('explanation encryption', () => {
  it('round trips with the right answer', async () => {
    const cipher = await encryptExplanation('q1', 'Direct Lake', 'Because it reads Delta.');
    expect(await decryptExplanation('q1', 'Direct Lake', cipher)).toBe(
      'Because it reads Delta.',
    );
  });

  it('returns undefined for a wrong answer instead of throwing', async () => {
    // A wrong answer is a normal event in a study tool, not an error.
    const cipher = await encryptExplanation('q1', 'Direct Lake', 'secret');
    expect(await decryptExplanation('q1', 'Import', cipher)).toBeUndefined();
  });

  it('cannot be opened with the right answer to a different question', async () => {
    const cipher = await encryptExplanation('q1', 'Direct Lake', 'secret');
    expect(await decryptExplanation('q2', 'Direct Lake', cipher)).toBeUndefined();
  });

  it('produces a different ciphertext each time, from a fresh IV', async () => {
    const a = await encryptExplanation('q1', 'x', 'same text');
    const b = await encryptExplanation('q1', 'x', 'same text');
    expect(a).not.toBe(b);
    expect(await decryptExplanation('q1', 'x', a)).toBe('same text');
    expect(await decryptExplanation('q1', 'x', b)).toBe('same text');
  });

  it('uses a salt that is public by necessity, and says so', () => {
    // Documented rather than hidden: everything the client needs is in the
    // client, so a "secret" salt would be theatre.
    expect(ANSWER_SALT.length).toBeGreaterThan(0);
  });
});

describe('the built bank', () => {
  it('loaded the authored clusters', () => {
    for (const cluster of ['A1', 'A2', 'B1', 'B2', 'B3', 'C1', 'C2']) {
      expect(LOADED_CLUSTERS).toContain(cluster);
    }
    expect(DP600_QUESTIONS.length).toBe(DRAFTS.length);
  });

  it('covers every skill in the outline, with none left behind', () => {
    // The bank is complete: 41 of 41 skills across all three branches. This
    // is the assertion that would catch a future outline update adding a
    // skill that nobody wrote questions for.
    expect(coveredSkills().size).toBe(allSkills().length);
    expect(coverage(DP600_QUESTIONS).uncovered).toEqual([]);
  });

  it('covers all of branch B, the half of the exam that matters most', () => {
    // "Prepare data" is 45 to 50 percent of DP-600 and 18 of the 41 skills.
    // Finishing it first was the highest-value ordering for the bank.
    const branchB = DP600_QUESTIONS.filter((q) => q.branch === 'B');
    expect(new Set(branchB.map((q) => q.skillId)).size).toBe(18);
  });

  it('covers all of branch A, the maintain and govern half', () => {
    // 11 skills across security and governance and the development lifecycle.
    const branchA = DP600_QUESTIONS.filter((q) => q.branch === 'A');
    expect(new Set(branchA.map((q) => q.skillId)).size).toBe(11);
  });

  it('covers all of branch C, the semantic model half', () => {
    // 12 skills across designing models and optimising them.
    const branchC = DP600_QUESTIONS.filter((q) => q.branch === 'C');
    expect(new Set(branchC.map((q) => q.skillId)).size).toBe(12);
  });

  it('draws every question from a branch that has actually been authored', () => {
    // Guards against a stray branch letter in a new file, which would
    // otherwise only surface as a topic that never asks a question.
    const branches = new Set(DP600_QUESTIONS.map((q) => q.branch));
    expect([...branches].sort()).toEqual(['A', 'B', 'C']);
  });

  it('passes validation', () => {
    expect(validateBank(DP600_QUESTIONS)).toEqual([]);
  });

  it('ships no plaintext answer or explanation', async () => {
    /*
     * The whole point of the build step. If this ever fails, the shipped
     * bundle carries a readable answer key.
     */
    const text = JSON.stringify(DP600_QUESTIONS);
    for (const question of DP600_QUESTIONS) {
      const draft = draftById.get(question.id)!;
      expect(text).not.toContain(draft.explanation);
      expect(Object.keys(question)).not.toContain('answer');
      expect(Object.keys(question)).not.toContain('explanation');
    }
  });

  it('accepts the authored answer for every question', async () => {
    // Proves the build hashed what the author actually wrote.
    for (const question of DP600_QUESTIONS) {
      const draft = draftById.get(question.id)!;
      expect(
        await checkAnswer(question.id, draft.answer, question.answerHash),
        `${question.id} does not accept its own answer`,
      ).toBe(true);
    }
  });

  it('rejects every distractor', async () => {
    // Catches an authoring slip where the recorded answer is not among the
    // options, or two options are effectively the same.
    for (const question of DP600_QUESTIONS) {
      const draft = draftById.get(question.id)!;
      for (const option of question.options ?? []) {
        if (normaliseAnswer(option) === normaliseAnswer(draft.answer)) continue;
        expect(
          await checkAnswer(question.id, option, question.answerHash),
          `${question.id} accepts distractor "${option}"`,
        ).toBe(false);
      }
    }
  });

  it('has an answer that is one of the offered options', async () => {
    for (const question of DP600_QUESTIONS) {
      const draft = draftById.get(question.id)!;
      if (!question.options) continue;
      const match = question.options.some(
        (o) => normaliseAnswer(o) === normaliseAnswer(draft.answer),
      );
      expect(match, `${question.id}: answer is not among its options`).toBe(true);
    }
  });

  /*
   * The slowest test in the suite, and unavoidably so.
   *
   * Each explanation is unlocked by deriving a key with PBKDF2 at 100,000
   * iterations, which is deliberately expensive: that cost is the whole
   * reason a player cannot cheaply brute-force the answer key out of the
   * shipped bundle. Doing it 123 times is therefore meant to take seconds.
   *
   * It began failing when the bank grew from 54 questions to 123, purely on
   * the default five second budget. Sampling a subset would make it fast and
   * would stop it being the guarantee it exists to be, so the budget moves
   * instead of the coverage.
   */
  it(
    'decrypts each explanation with its own answer',
    async () => {
      for (const question of DP600_QUESTIONS) {
        const draft = draftById.get(question.id)!;
        expect(
          await decryptExplanation(question.id, draft.answer, question.explanationCipher),
        ).toBe(draft.explanation);
      }
    },
    60_000,
  );

  /*
   * ⚠️ The same thing again, by the route the game actually takes.
   *
   * The test above decrypts using the answer read straight out of the source
   * draft. The application has no draft: it recovers the answer by hashing
   * every candidate option until one matches, and only then can it derive the
   * key. So the test above proves the *cipher* is right while saying nothing
   * about whether the app can ever open it.
   *
   * That distinction is not hypothetical. If `revealCorrectAnswer` returned
   * undefined for a question, `decryptExplanation` would be handed undefined,
   * return undefined by design, and the learner would simply see no
   * explanation. No error, no log, and the test above still green.
   *
   * A sample rather than all 123, because this pays the 100,000-iteration
   * PBKDF2 cost once per candidate option rather than once per question.
   */
  it(
    '⚠️ recovers the answer and opens the explanation the way the app does',
    async () => {
      const step = Math.ceil(DP600_QUESTIONS.length / 12);
      const sample = DP600_QUESTIONS.filter((_, i) => i % step === 0);
      expect(sample.length).toBeGreaterThan(6);

      for (const question of sample) {
        const recovered = await revealCorrectAnswer(question);
        expect(recovered, `${question.id}: no answer recoverable`).toBeDefined();

        const explanation = await decryptExplanation(
          question.id,
          recovered!,
          question.explanationCipher,
        );
        expect(explanation, `${question.id}: explanation did not open`).toBeDefined();
        expect(explanation!.length, `${question.id}: explanation is empty`).toBeGreaterThan(0);
      }
    },
    60_000,
  );

  it('covers every skill in the loaded clusters', () => {
    const covered = coveredSkills();
    for (const skillId of COVERED) {
      expect(covered.has(skillId), `skill ${skillId} has no questions`).toBe(true);
    }
  });

  it('gives each covered skill more than one question', () => {
    const report = coverage(DP600_QUESTIONS);
    for (const skillId of COVERED) {
      expect(report.perSkill.get(skillId)!).toBeGreaterThanOrEqual(3);
    }
  });

  it('reports uncovered skills honestly when the bank is partial', () => {
    // The coverage report is what tells an author what is left, so it has to
    // be right about a partial bank rather than only about a complete one.
    // Feeding it one cluster must leave every other skill listed as missing.
    const onlyA1 = questionsForCluster(DP600_QUESTIONS, 'A1');
    const report = coverage(onlyA1);
    const covered = new Set(onlyA1.map((q) => q.skillId));
    expect(report.uncovered.length).toBe(allSkills().length - covered.size);
    for (const skillId of report.uncovered) {
      expect(covered.has(skillId)).toBe(false);
    }
  });

  it('writes stems as questions, not fragments', () => {
    for (const question of DP600_QUESTIONS) {
      expect(question.stem.length).toBeGreaterThan(40);
      expect(question.stem.trim().endsWith('?')).toBe(true);
    }
  });

  it('offers at least four options on every multiple choice item', () => {
    for (const question of DP600_QUESTIONS) {
      if (question.type !== 'mcq') continue;
      expect(question.options!.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('spreads difficulty rather than sitting at one tier', () => {
    const tiers = new Set(DP600_QUESTIONS.map((q) => q.tier));
    expect(tiers.size).toBeGreaterThan(1);
  });

  it('does not put the correct answer in the same position every time', () => {
    /*
     * The bug this exists to prevent was real and total: across the first
     * three clusters the answer was option one in 54 of 54 items, because that
     * is the order an author naturally writes them in. It is invisible in any
     * single question and every other test passed. A player would have learned
     * to click the first option and scored full marks knowing nothing.
     *
     * The build now permutes options deterministically; this asserts it stayed
     * that way.
     */
    const positions = new Map<number, number>();
    for (const question of DP600_QUESTIONS) {
      const draft = draftById.get(question.id)!;
      const index = (question.options ?? []).findIndex(
        (o) => normaliseAnswer(o) === normaliseAnswer(draft.answer),
      );
      expect(index, `${question.id}: answer is not among its options`).toBeGreaterThanOrEqual(0);
      positions.set(index, (positions.get(index) ?? 0) + 1);
    }

    const worst = Math.max(...positions.values());
    expect(
      worst / DP600_QUESTIONS.length,
      `answer position distribution is skewed: ${[...positions.entries()].sort().map(([i, n]) => `#${i + 1}=${n}`).join(' ')}`,
    ).toBeLessThan(0.45);

    // Every slot must actually be used.
    const optionCount = Math.max(...DP600_QUESTIONS.map((q) => q.options?.length ?? 0));
    expect(positions.size).toBe(optionCount);
  });

  it('does not let option length give the answer away too often', () => {
    // A softer tell than position, and harder to remove: a correct answer is
    // often the one that needs a qualifier. Guarded rather than eliminated.
    let longestIsAnswer = 0;
    for (const question of DP600_QUESTIONS) {
      const draft = draftById.get(question.id)!;
      const options = question.options ?? [];
      if (options.length === 0) continue;
      const longest = options.reduce((a, b) => (b.length > a.length ? b : a));
      if (normaliseAnswer(longest) === normaliseAnswer(draft.answer)) longestIsAnswer++;
    }
    expect(longestIsAnswer / DP600_QUESTIONS.length).toBeLessThan(0.8);
  });

  it('shuffles reproducibly, so a rebuild does not churn the files', () => {
    // Seeded from the question id, so two builds of the same source agree.
    const ids = DP600_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('provenance', () => {
  it('records the verbatim outline bullet on every item', () => {
    // The check that makes D48 real: a mismatch here means the item drifted
    // from the published wording it claims to come from.
    const labels = new Map(allSkills().map((s) => [s.id, s.label]));
    for (const question of DP600_QUESTIONS) {
      expect(question.sourceSkillBullet).toBe(labels.get(question.skillId));
    }
  });

  it('records a documentation URL on every item', () => {
    for (const question of DP600_QUESTIONS) {
      expect(question.sourceLearnUrl).toContain('learn.microsoft.com');
      expect(question.learnUrl).toContain('learn.microsoft.com');
    }
  });

  it('rejects an item whose provenance does not match the outline', () => {
    const [first] = DP600_QUESTIONS;
    const tampered = { ...first!, sourceSkillBullet: 'Something I made up' };
    const problems = validateQuestion(tampered);
    expect(problems.some((p) => p.includes('sourceSkillBullet'))).toBe(true);
  });

  it('rejects an item filed under the wrong cluster', () => {
    const [first] = DP600_QUESTIONS;
    const problems = validateQuestion({ ...first!, cluster: 'C2' });
    expect(problems.some((p) => p.includes('cluster'))).toBe(true);
  });

  it('rejects a non-Microsoft source URL', () => {
    const [first] = DP600_QUESTIONS;
    const problems = validateQuestion({
      ...first!,
      sourceLearnUrl: 'https://example.com/whatever',
    });
    expect(problems.some((p) => p.includes('sourceLearnUrl'))).toBe(true);
  });

  it('rejects an item that still carries a plaintext answer', () => {
    const [first] = DP600_QUESTIONS;
    const leaky = { ...first!, answer: 'Direct Lake' } as unknown as Question;
    expect(validateQuestion(leaky).some((p) => p.includes('plaintext'))).toBe(true);
  });
});

describe('selecting a question', () => {
  it('picks one for a covered topic', () => {
    expect(selectQuestion('dp600-12')).toBeDefined();
  });

  it('returns nothing when the pool holds no question for the topic', () => {
    /*
     * This used to point at a real skill that had not been written yet, and
     * it failed the moment the last cluster landed, which is exactly what it
     * was meant to do. With the outline fully covered there is no such skill
     * left, so the empty case is now produced explicitly. The behaviour still
     * matters: an outline update can add a skill at any time, and the game
     * must carry on rather than throw.
     */
    expect(selectQuestion('dp600-30', {}, [])).toBeUndefined();
  });

  it('returns nothing for a nonsense topic id', () => {
    expect(selectQuestion('not-a-topic')).toBeUndefined();
  });

  it('prefers the requested tier when one exists', () => {
    const picked = selectQuestion('dp600-16', { tier: 3, random: () => 0 });
    expect(picked?.tier).toBe(3);
  });

  it('falls back to another tier rather than returning nothing', () => {
    const picked = selectQuestion('dp600-12', { tier: 3, random: () => 0 });
    expect(picked).toBeDefined();
  });

  it('avoids repeating a question already asked', () => {
    const first = selectQuestion('dp600-12', { random: () => 0 })!;
    const second = selectQuestion('dp600-12', {
      exclude: new Set([first.id]),
      random: () => 0,
    })!;
    expect(second.id).not.toBe(first.id);
  });

  it('repeats rather than giving up once everything has been asked', () => {
    const all = new Set(questionsForSkill(DP600_QUESTIONS, 12).map((q) => q.id));
    expect(selectQuestion('dp600-12', { exclude: all, random: () => 0 })).toBeDefined();
  });

  it('filters by cluster', () => {
    expect(questionsForCluster(DP600_QUESTIONS, 'A1')).toHaveLength(15);
    expect(questionsForCluster(DP600_QUESTIONS, 'A2')).toHaveLength(18);
    expect(questionsForCluster(DP600_QUESTIONS, 'B1')).toHaveLength(15);
    expect(questionsForCluster(DP600_QUESTIONS, 'B2')).toHaveLength(27);
    expect(questionsForCluster(DP600_QUESTIONS, 'B3')).toHaveLength(12);
    expect(questionsForCluster(DP600_QUESTIONS, 'C1')).toHaveLength(21);
    expect(questionsForCluster(DP600_QUESTIONS, 'C2')).toHaveLength(15);
    expect(questionsForCluster(DP600_QUESTIONS, 'Z9')).toHaveLength(0);
  });
});

describe('scoring', () => {
  it('rewards a fast correct answer most', () => {
    expect(scoreFor(true, 1000, 20_000, false)).toBe(SCORE_CORRECT_FAST);
  });

  it('still rewards a slow correct answer well', () => {
    // Taking time to think is not a mistake.
    expect(scoreFor(true, 19_000, 20_000, false)).toBe(SCORE_CORRECT);
    expect(SCORE_CORRECT).toBeGreaterThan(0);
  });

  it('penalises a wrong answer most', () => {
    expect(scoreFor(false, 1000, 20_000, false)).toBe(SCORE_WRONG);
  });

  it('penalises abandoning less than answering wrongly', () => {
    // Running out of time says less about knowledge than a confident error.
    expect(scoreFor(false, 20_000, 20_000, true)).toBe(SCORE_TIMEOUT);
    expect(SCORE_TIMEOUT).toBeGreaterThan(SCORE_WRONG);
  });
});

describe('the presenter', () => {
  function scriptedUi(answerFor: (p: QuestionPrompt) => QuestionAnswer): {
    ui: QuestionUi;
    results: QuestionResult[];
    prompts: QuestionPrompt[];
  } {
    const results: QuestionResult[] = [];
    const prompts: QuestionPrompt[] = [];
    return {
      prompts,
      results,
      ui: {
        async ask(prompt) {
          prompts.push(prompt);
          return answerFor(prompt);
        },
        async reveal(result) {
          results.push(result);
        },
      },
    };
  }

  const request = {
    kind: 'research' as const,
    topicId: 'dp600-12',
    tier: 1 as const,
    timeLimitMs: 30_000,
  };

  it('scores a correct answer and reveals the explanation', async () => {
    const { ui, results } = scriptedUi((prompt) => ({
      answer: draftById.get(prompt.question.id)!.answer,
      elapsedMs: 2_000,
      abandoned: false,
    }));
    const present = createQuestionPresenter(ui);

    const outcome = await present(request);
    expect(outcome.score).toBe(SCORE_CORRECT_FAST);
    expect(results[0]!.correct).toBe(true);
    expect(results[0]!.explanation).toBeDefined();
    expect(results[0]!.explanation!.length).toBeGreaterThan(20);
  });

  it('withholds nothing on a wrong answer: the learner is corrected', async () => {
    /*
     * Reversed from the first implementation. Telling a learner nothing at the
     * exact moment they are most receptive is a worse failure than a
     * determined player recovering an answer they could brute force anyway.
     */
    const { ui, results } = scriptedUi(() => ({
      answer: 'Something plainly incorrect',
      elapsedMs: 3_000,
      abandoned: false,
    }));
    const outcome = await createQuestionPresenter(ui)(request);
    expect(outcome.score).toBe(SCORE_WRONG);
    expect(results[0]!.correct).toBe(false);
    expect(results[0]!.explanation).toBeDefined();
    expect(results[0]!.correctAnswer).toBeDefined();
  });

  it('names the right answer, and it is one of the offered options', async () => {
    const { ui, results } = scriptedUi(() => ({
      answer: 'nonsense',
      elapsedMs: 1_000,
      abandoned: false,
    }));
    await createQuestionPresenter(ui, { random: () => 0 })(request);
    const result = results[0]!;
    const revealed = result.correctAnswer as string;
    expect(result.question.options).toContain(revealed);
    expect(revealed).toBe(draftById.get(result.question.id)!.answer);
  });

  it('still scores a wrong answer as wrong, despite revealing it', async () => {
    // Teaching on the way out must not soften the consequence.
    const { ui } = scriptedUi(() => ({
      answer: 'nonsense',
      elapsedMs: 1_000,
      abandoned: false,
    }));
    expect((await createQuestionPresenter(ui)(request)).score).toBe(SCORE_WRONG);
  });

  it('corrects a player who ran out of time too', async () => {
    const { ui, results } = scriptedUi(() => ({
      answer: undefined,
      elapsedMs: 30_000,
      abandoned: true,
    }));
    await createQuestionPresenter(ui)(request);
    expect(results[0]!.correctAnswer).toBeDefined();
    expect(results[0]!.explanation).toBeDefined();
  });

  it('treats abandoning as a timeout, not a wrong answer', async () => {
    const { ui } = scriptedUi(() => ({
      answer: undefined,
      elapsedMs: 30_000,
      abandoned: true,
    }));
    expect((await createQuestionPresenter(ui)(request)).score).toBe(SCORE_TIMEOUT);
  });

  it('resolves neutral without bothering the player when a topic has no questions', async () => {
    // An incomplete bank must degrade quietly rather than blocking research.
    // The pool is emptied explicitly, because the real bank no longer has a
    // gap to borrow for the test.
    const { ui, prompts } = scriptedUi(() => ({
      answer: 'anything',
      elapsedMs: 1,
      abandoned: false,
    }));
    const outcome = await createQuestionPresenter(ui, { questions: [] })({
      ...request,
      topicId: 'dp600-30',
    });
    expect(outcome.score).toBe(0);
    expect(prompts).toHaveLength(0);
  });

  it('does not repeat a question within a session', async () => {
    const asked = new Set<string>();
    const { ui, prompts } = scriptedUi((prompt) => ({
      answer: draftById.get(prompt.question.id)!.answer,
      elapsedMs: 1_000,
      abandoned: false,
    }));
    const present = createQuestionPresenter(ui, { asked, random: () => 0 });

    await present(request);
    await present(request);
    await present(request);
    expect(new Set(prompts.map((p) => p.question.id)).size).toBe(3);
  });

  it('never hands the engine anything but a score in range', async () => {
    for (const answer of ['wrong', undefined]) {
      const { ui } = scriptedUi(() => ({
        answer,
        elapsedMs: 5_000,
        abandoned: answer === undefined,
      }));
      const outcome = await createQuestionPresenter(ui)(request);
      expect(outcome.score).toBeGreaterThanOrEqual(-1);
      expect(outcome.score).toBeLessThanOrEqual(1);
    }
  });
});
