/**
 * The loaded question bank.
 *
 * Only built files are imported here. The plaintext authoring sources in
 * `src/` are never bundled, so a shipped app contains no readable answer key.
 */

import type { Question } from './questions.js';
import { clusterOf, skillIdFromTopic } from './outline.js';
import a1 from '../content/dp-600/questions/A1.json' with { type: 'json' };
import a2 from '../content/dp-600/questions/A2.json' with { type: 'json' };
import b1 from '../content/dp-600/questions/B1.json' with { type: 'json' };
import b2 from '../content/dp-600/questions/B2.json' with { type: 'json' };
import b3 from '../content/dp-600/questions/B3.json' with { type: 'json' };
import c1 from '../content/dp-600/questions/C1.json' with { type: 'json' };
import c2 from '../content/dp-600/questions/C2.json' with { type: 'json' };

interface BankFile {
  readonly cluster: string;
  readonly questions: readonly Question[];
}

const FILES: readonly BankFile[] = [
  a1 as unknown as BankFile,
  a2 as unknown as BankFile,
  b1 as unknown as BankFile,
  b2 as unknown as BankFile,
  b3 as unknown as BankFile,
  c1 as unknown as BankFile,
  c2 as unknown as BankFile,
];

export const DP600_QUESTIONS: readonly Question[] = FILES.flatMap(
  (file) => file.questions,
);

export const LOADED_CLUSTERS: readonly string[] = FILES.map((f) => f.cluster);

/** Skills that have at least one question. */
export function coveredSkills(
  questions: readonly Question[] = DP600_QUESTIONS,
): Set<number> {
  return new Set(questions.map((q) => q.skillId));
}

export interface SelectOptions {
  /** Preferred difficulty. Falls back to any tier rather than returning none. */
  readonly tier?: 1 | 2 | 3;
  /** Ids already used this session, avoided where possible. */
  readonly exclude?: ReadonlySet<string>;
  /**
   * Ids that must never be returned again this session.
   *
   * ⚠️ **Hard, unlike `exclude`.** `exclude` is a preference: when a skill has
   * nothing else left it is ignored and a question repeats. That is right for
   * variety and wrong for a question the player has already answered
   * correctly and promptly, which is the one thing they said they did not want
   * to see again. A retired id is dropped from the pool before anything else
   * happens, and if that empties the pool the caller is told so rather than
   * being handed the retired question anyway.
   */
  readonly retired?: ReadonlySet<string>;
  /**
   * When this skill has nothing left, take a question from another one.
   *
   * ⚠️ **The caller MUST look at `skillId` on what comes back.** Borrowing
   * means the returned question is not about the topic that was asked for, so
   * anything recording the result against the requested topic would be
   * crediting knowledge the player never demonstrated. `selectQuestion` cannot
   * enforce that, so it is stated here and honoured in `presenter.ts`.
   */
  readonly borrowWhenExhausted?: boolean;
  /** Injectable for deterministic tests. */
  readonly random?: () => number;
}

/**
 * Choose a question for a topic.
 *
 * Returns undefined when the skill has no questions yet, which is the normal
 * case for most of the 41 while the bank is being written. The caller treats
 * that as "no challenge", not as an error: an unfinished bank must degrade to
 * the neutral behaviour rather than blocking the game.
 */
export function selectQuestion(
  topicId: string,
  options: SelectOptions = {},
  questions: readonly Question[] = DP600_QUESTIONS,
): Question | undefined {
  const skillId = skillIdFromTopic(topicId);
  if (skillId === undefined) return undefined;

  const retired = options.retired ?? new Set<string>();
  const live = questions.filter((q) => !retired.has(q.id));

  let forSkill = live.filter((q) => q.skillId === skillId);

  /*
   * Nothing left on this skill, so borrow.
   *
   * ⚠️ This breaks the game's own promise that the faction attacking you tells
   * you what you are about to be tested on, and that is the accepted cost of
   * the alternative: with exactly three questions per skill, a player who
   * knows a topic would otherwise face a battle with no question in it, and so
   * no defence bonus, purely for having answered well.
   *
   * Nearest first: the same cluster is at least adjacent material, so the
   * question is usually still recognisably about the branch the enemy came
   * from. Only when the whole cluster is spent does it reach across the exam.
   */
  if (forSkill.length === 0 && options.borrowWhenExhausted) {
    const cluster = clusterOf(skillId)?.cluster;
    const sameCluster = cluster
      ? live.filter((q) => cluster.skills.some((s) => s.id === q.skillId))
      : [];
    forSkill = sameCluster.length > 0 ? sameCluster : live;
  }

  if (forSkill.length === 0) return undefined;

  const exclude = options.exclude ?? new Set<string>();
  const unseen = forSkill.filter((q) => !exclude.has(q.id));
  const pool = unseen.length > 0 ? unseen : forSkill;

  const atTier =
    options.tier === undefined ? [] : pool.filter((q) => q.tier === options.tier);
  const candidates = atTier.length > 0 ? atTier : pool;

  const random = options.random ?? Math.random;
  const index = Math.min(
    candidates.length - 1,
    Math.floor(random() * candidates.length),
  );
  return candidates[index];
}
