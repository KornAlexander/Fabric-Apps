import type { Question } from './questions.js';
import { DP600_OUTLINE, type Outline } from './outline.js';
import type { LibraryModel } from './library.js';

/**
 * The Proctor: the exam as the final boss.
 *
 * ⚠️ **This lives in the learning layer and cannot live anywhere else.** The
 * other two victories are statements about units, cities and topics, so the
 * engine owns them. This one is a statement about *weighted readiness against
 * a published certification outline*, and the engine is not allowed to know
 * such a thing exists (D35). The app asks here, and hands the engine nothing
 * but the fact that the game is over.
 *
 * The shape follows the real exam rather than the game's convenience: the
 * paper is a fixed length, the questions are spread across the branches in
 * their published proportions, and the pass mark is the published one.
 */

/**
 * Readiness at which the Proctor takes an interest.
 *
 * Deliberately below the pass mark. Being *invited* to sit the exam a little
 * before you are certain to pass it is the point: the siege is meant to be a
 * real test, not a lap of honour handed out once the outcome is settled.
 */
export const PROCTOR_THRESHOLD = 0.8;

/**
 * Questions in the siege.
 *
 * The real DP-600 sits between 40 and 60. Forty is the bottom of that range
 * and already a long sitting inside a strategy game, so it is the number that
 * respects the exam's shape without turning the climax into a second evening.
 */
export const SIEGE_LENGTH = 40;

/**
 * Share correct needed to pass.
 *
 * 700 of 1000 is the published Microsoft pass mark. It is a scaled score
 * rather than a percentage of questions, so this is an approximation and is
 * labelled as one wherever it is shown.
 */
export const SIEGE_PASS_MARK = 0.7;

/** Seconds a single siege question allows, matching the battle timer. */
export const SIEGE_QUESTION_MS = 45_000;

export interface SiegeQuestion {
  readonly question: Question;
  /** 1-based position in the paper, for "12 of 40". */
  readonly position: number;
}

export interface SiegeResult {
  readonly asked: number;
  readonly correct: number;
  /** 0 to 1. */
  readonly share: number;
  readonly passed: boolean;
  /** Correct answers per branch id, for the breakdown. */
  readonly byBranch: ReadonlyMap<string, { asked: number; correct: number }>;
}

/**
 * Whether the player has studied enough for the Proctor to call.
 *
 * ⚠️ The threshold is a parameter with a DP-600 default, not a constant. Each
 * campaign carries its own `exam.threshold`, and a Year 1 curriculum calls its
 * examiner earlier than a professional certification does.
 */
export function proctorReady(
  model: LibraryModel,
  threshold: number = PROCTOR_THRESHOLD,
): boolean {
  return model.examRetained >= threshold;
}

/**
 * Deterministic shuffle, so a seed produces the same paper.
 *
 * The same reason the map, the antagonists and the battle topics are all
 * seeded: two players comparing a seed should sit the same exam, and a replay
 * of your own run should not quietly become a different one.
 */
function seededOrder<T>(items: readonly T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    const j = Math.abs(h) % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Build the paper.
 *
 * ⚠️ **Weighted by branch, not spread evenly.** Branch B is 45 to 50 percent
 * of the real exam and 18 of the 41 skills; an even split across three
 * branches would be a different exam wearing this one's name, and would tell
 * the player they were ready for something they are not.
 *
 * Within a branch the questions are shuffled and taken in order, so a branch
 * with more questions than its allocation still draws from all of them across
 * different seeds.
 */
export function buildSiege(
  questions: readonly Question[],
  seed: string,
  outline: Outline = DP600_OUTLINE,
  length: number = SIEGE_LENGTH,
): SiegeQuestion[] {
  const byBranch = new Map<string, Question[]>();
  for (const question of questions) {
    const list = byBranch.get(question.branch);
    if (list) list.push(question);
    else byBranch.set(question.branch, [question]);
  }

  const midpoint = (branchId: string): number => {
    const branch = outline.branches.find((b) => b.id === branchId);
    if (!branch) return 0;
    return (branch.weightMin + branch.weightMax) / 2;
  };

  const weightTotal = outline.branches.reduce((sum, b) => sum + midpoint(b.id), 0);
  const picked: Question[] = [];

  for (const branch of outline.branches) {
    const pool = seededOrder(byBranch.get(branch.id) ?? [], `${seed}:${branch.id}`);
    const share = weightTotal > 0 ? midpoint(branch.id) / weightTotal : 0;
    const want = Math.round(length * share);
    picked.push(...pool.slice(0, Math.min(want, pool.length)));
  }

  /*
   * Rounding and short pools both leave gaps. Fill from whatever is left
   * rather than shipping a 38-question exam that claims to be 40, because the
   * length is quoted to the player and a paper that silently shrinks would
   * make the score mean something different every time.
   */
  if (picked.length < length) {
    const used = new Set(picked.map((q) => q.id));
    for (const question of seededOrder(questions, `${seed}:fill`)) {
      if (picked.length >= length) break;
      if (used.has(question.id)) continue;
      picked.push(question);
      used.add(question.id);
    }
  }

  return seededOrder(picked.slice(0, length), `${seed}:paper`).map((question, index) => ({
    question,
    position: index + 1,
  }));
}

/** Score a finished paper. */
export function scoreSiege(
  paper: readonly SiegeQuestion[],
  correctIds: ReadonlySet<string>,
): SiegeResult {
  const byBranch = new Map<string, { asked: number; correct: number }>();
  let correct = 0;

  for (const entry of paper) {
    const branch = entry.question.branch;
    const tally = byBranch.get(branch) ?? { asked: 0, correct: 0 };
    tally.asked += 1;
    if (correctIds.has(entry.question.id)) {
      tally.correct += 1;
      correct += 1;
    }
    byBranch.set(branch, tally);
  }

  const asked = paper.length;
  const share = asked > 0 ? correct / asked : 0;
  return { asked, correct, share, passed: share >= SIEGE_PASS_MARK, byBranch };
}
