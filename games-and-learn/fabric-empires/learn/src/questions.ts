/**
 * The question bank: schema, loading and validation.
 *
 * Every item carries machine-checkable provenance (D48). `sourceSkillBullet`
 * must equal the outline label for its skill exactly, which turns "these
 * questions come from the published outline" from a claim in a README into
 * something a test proves. That matters most for the portion of the bank that
 * is not individually reviewed (D44): provenance is what makes a disputed item
 * traceable and repairable rather than merely disclaimed.
 */

import { allSkills, clusterOf, DP600_OUTLINE } from './outline.js';

export type QuestionType = 'mcq' | 'multi' | 'hotspot';
export type QuestionTier = 1 | 2 | 3;
export type ReviewStatus = 'draft' | 'reviewed';

export interface Question {
  readonly id: string;
  readonly cert: string;
  readonly branch: string;
  readonly cluster: string;
  readonly skillId: number;
  readonly type: QuestionType;
  readonly tier: QuestionTier;
  readonly stem: string;
  /** Present for mcq and multi. */
  readonly options?: readonly string[];
  /** How many options to pick, for multi. */
  readonly selectCount?: number;
  /** Diagram id, for hotspot. */
  readonly diagram?: string;
  /** Clickable region names, for hotspot. */
  readonly regions?: readonly string[];
  readonly answerHash: string;
  readonly explanationCipher: string;
  readonly learnUrl: string;
  /** Verbatim outline bullet this item was written from (D48). */
  readonly sourceSkillBullet: string;
  /** Documentation page the fact came from (D48). */
  readonly sourceLearnUrl: string;
  readonly reviewStatus: ReviewStatus;
  readonly tags: readonly string[];
}

/** The plaintext form used for authoring, before the bank is built. */
export interface QuestionDraft
  extends Omit<Question, 'answerHash' | 'explanationCipher'> {
  readonly answer: string | readonly string[];
  readonly explanation: string;
}

const LEARN_HOST = 'learn.microsoft.com';
const HASH_PATTERN = /^[0-9a-f]{64}$/;

function isLearnUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith(LEARN_HOST);
  } catch {
    return false;
  }
}

/**
 * Validate one item. Returns every problem rather than the first, so an author
 * fixes a whole question in one pass.
 */
export function validateQuestion(question: Question): string[] {
  const problems: string[] = [];
  const where = question.id || '(no id)';

  if (!question.id) problems.push('Question has no id');
  if (question.cert !== DP600_OUTLINE.cert) {
    problems.push(`${where}: cert is ${question.cert}, expected ${DP600_OUTLINE.cert}`);
  }
  if (!question.stem?.trim()) problems.push(`${where}: empty stem`);

  const location = clusterOf(question.skillId);
  if (!location) {
    problems.push(`${where}: skillId ${question.skillId} is not in the outline`);
  } else {
    if (location.cluster.id !== question.cluster) {
      problems.push(
        `${where}: cluster ${question.cluster} does not match skill ${question.skillId} (${location.cluster.id})`,
      );
    }
    if (location.branch.id !== question.branch) {
      problems.push(
        `${where}: branch ${question.branch} does not match skill ${question.skillId} (${location.branch.id})`,
      );
    }

    // The provenance check that does real work: the recorded bullet must be
    // the published wording, character for character.
    const skill = location.cluster.skills.find((s) => s.id === question.skillId);
    if (skill && question.sourceSkillBullet !== skill.label) {
      problems.push(
        `${where}: sourceSkillBullet does not match the outline label for skill ${question.skillId}`,
      );
    }
  }

  if (!question.sourceSkillBullet?.trim()) {
    problems.push(`${where}: missing sourceSkillBullet (D48)`);
  }
  if (!question.sourceLearnUrl?.trim()) {
    problems.push(`${where}: missing sourceLearnUrl (D48)`);
  } else if (!isLearnUrl(question.sourceLearnUrl)) {
    problems.push(`${where}: sourceLearnUrl is not a ${LEARN_HOST} URL`);
  }
  if (!isLearnUrl(question.learnUrl)) {
    problems.push(`${where}: learnUrl is not a ${LEARN_HOST} URL`);
  }

  if (![1, 2, 3].includes(question.tier)) {
    problems.push(`${where}: tier must be 1, 2 or 3`);
  }
  if (!HASH_PATTERN.test(question.answerHash)) {
    problems.push(`${where}: answerHash is not a SHA-256 hex digest`);
  }
  if (!question.explanationCipher || question.explanationCipher.length < 16) {
    problems.push(`${where}: explanationCipher is missing or too short`);
  }

  switch (question.type) {
    case 'mcq':
      if (!question.options || question.options.length < 3) {
        problems.push(`${where}: an mcq needs at least three options`);
      }
      break;
    case 'multi':
      if (!question.options || question.options.length < 4) {
        problems.push(`${where}: a multi needs at least four options`);
      }
      if (
        question.selectCount === undefined ||
        question.selectCount < 2 ||
        question.selectCount >= (question.options?.length ?? 0)
      ) {
        problems.push(`${where}: selectCount must be between 2 and options-1`);
      }
      break;
    case 'hotspot':
      if (!question.diagram) problems.push(`${where}: a hotspot needs a diagram`);
      if (!question.regions || question.regions.length < 2) {
        problems.push(`${where}: a hotspot needs at least two regions`);
      }
      break;
    default:
      problems.push(`${where}: unknown type`);
  }

  if (question.options) {
    const unique = new Set(question.options.map((o) => o.trim().toLowerCase()));
    if (unique.size !== question.options.length) {
      problems.push(`${where}: duplicate options`);
    }
  }

  // Guard against a draft escaping the build with its answer intact.
  const leaked = question as unknown as Record<string, unknown>;
  if ('answer' in leaked) problems.push(`${where}: plaintext answer must not ship`);
  if ('explanation' in leaked) {
    problems.push(`${where}: plaintext explanation must not ship`);
  }

  return problems;
}

export function validateBank(questions: readonly Question[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const question of questions) {
    if (seen.has(question.id)) problems.push(`Duplicate question id: ${question.id}`);
    seen.add(question.id);
    problems.push(...validateQuestion(question));
  }

  return problems;
}

export function questionsForSkill(
  questions: readonly Question[],
  skillId: number,
): Question[] {
  return questions.filter((q) => q.skillId === skillId);
}

/**
 * Every answer a player could give to this question.
 *
 * For a single-answer item that is just the options; for a multi-select it is
 * every subset of the required size. Bounded and small: six options choose
 * three is twenty candidates.
 */
export function candidateAnswers(question: Question): (string | string[])[] {
  const options = question.options ?? question.regions ?? [];
  if (question.type !== 'multi') return [...options];

  const size = question.selectCount ?? 2;
  const out: string[][] = [];
  const build = (start: number, chosen: string[]): void => {
    if (chosen.length === size) {
      out.push([...chosen]);
      return;
    }
    for (let i = start; i < options.length; i++) {
      chosen.push(options[i]!);
      build(i + 1, chosen);
      chosen.pop();
    }
  };
  build(0, []);
  return out;
}

export function questionsForCluster(
  questions: readonly Question[],
  cluster: string,
): Question[] {
  return questions.filter((q) => q.cluster === cluster);
}

/** Coverage report: how many items exist per skill, and which have none. */
export function coverage(questions: readonly Question[]): {
  perSkill: Map<number, number>;
  uncovered: number[];
} {
  const perSkill = new Map<number, number>();
  for (const skill of allSkills()) perSkill.set(skill.id, 0);
  for (const question of questions) {
    perSkill.set(question.skillId, (perSkill.get(question.skillId) ?? 0) + 1);
  }
  const uncovered = [...perSkill.entries()]
    .filter(([, count]) => count === 0)
    .map(([id]) => id);
  return { perSkill, uncovered };
}
