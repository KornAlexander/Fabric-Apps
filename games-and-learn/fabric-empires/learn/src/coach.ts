/**
 * What to work on next.
 *
 * ⚠️ **This is deterministic, and that is the point.** The obvious way to build
 * a study coach is to hand a model the raw records and let it decide. Then
 * nothing can check what it says, it can invent a topic that is not on the
 * exam, and the free edition has no advice at all. So the ranking lives here,
 * in arithmetic, and the chat in the connected edition is a conversational
 * interface over *this* rather than a second opinion about it.
 *
 * That split has a pleasant consequence: every claim the coach makes can be
 * tested, and the model can be told to work from the same numbers, so it is
 * grounded in something rather than guessing.
 */

import type { LibraryModel } from './library.js';
import type { MasteryBand } from './sm2.js';

/**
 * How far a band is from being safe, 0 to 1.
 *
 * `strong` is not zero because spaced repetition decays: a topic held at
 * strong still has to come back round eventually, and a coach that says a
 * subject is finished is teaching the wrong lesson.
 */
const BAND_GAP: Readonly<Record<MasteryBand, number>> = Object.freeze({
  unseen: 1,
  learning: 0.7,
  familiar: 0.3,
  strong: 0.05,
});

/**
 * What being due is worth.
 *
 * ⚠️ Above 1 on purpose. A topic that has fallen due is actively decaying, and
 * the work already spent on it is what is being lost. Recovering it is cheaper
 * than learning something new, so it should outrank an equally weak topic that
 * is not yet due.
 */
const DUE_BOOST = 1.6;

export interface StudyAdvice {
  readonly topicId: string;
  readonly label: string;
  readonly clusterId: string;
  readonly clusterLabel: string;
  readonly branchId: string;
  readonly branchLabel: string;
  readonly band: MasteryBand;
  readonly due: boolean;
  /** Higher comes first. */
  readonly priority: number;
  /** Why this one, in words a learner can argue with. */
  readonly reason: string;
}

export interface BranchProgress {
  readonly id: string;
  readonly label: string;
  /** Midpoint of the published weight range, as a share of the exam. */
  readonly examShare: number;
  /** Skills at familiar or better, over skills in the branch, 0 to 1. */
  readonly retained: number;
  readonly skills: number;
  /** Exam share currently NOT retained. The size of the hole. */
  readonly atRisk: number;
}

export interface ProgressDigest {
  /** Share of the exam by published weight, at familiar or better. */
  readonly examRetained: number;
  readonly examSeen: number;
  readonly totalSkills: number;
  readonly dueNow: number;
  readonly bands: Readonly<Record<MasteryBand, number>>;
  readonly branches: readonly BranchProgress[];
  /** Ranked, most valuable first. */
  readonly next: readonly StudyAdvice[];
  /** The branch with the most exam weight not yet retained. */
  readonly weakestBranch: BranchProgress | undefined;
  /** One line, for a heading. */
  readonly headline: string;
}

function reasonFor(
  band: MasteryBand,
  due: boolean,
  branch: string,
  examShare: number,
): string {
  const weight = `${Math.round(examShare * 100)}% of the exam`;
  if (due) {
    return band === 'unseen'
      ? `Due, and never answered. ${branch} is ${weight}.`
      : `Due for review, and slipping. ${branch} is ${weight}.`;
  }
  if (band === 'unseen') return `Never answered. ${branch} is ${weight}.`;
  if (band === 'learning') return `Seen but not held yet. ${branch} is ${weight}.`;
  if (band === 'familiar') return `Familiar, not yet solid. ${branch} is ${weight}.`;
  return `Solid. It will come round again on its own.`;
}

/**
 * Build the digest.
 *
 * ⚠️ **Weighted by the published exam weighting, not by skill count.** Twelve
 * unlearned skills in a branch worth 20 percent of the paper matter less than
 * five in a branch worth 45, and a coach that counts skills tells a candidate
 * to spend their last evening in the wrong place.
 */
export function buildProgressDigest(model: LibraryModel, limit = 6): ProgressDigest {
  const branches: BranchProgress[] = model.branches.map((branch) => {
    const examShare = (branch.weightMin + branch.weightMax) / 2 / 100;
    const skills = branch.clusters.reduce((n, c) => n + c.skills.length, 0);
    return {
      id: branch.id,
      label: branch.label,
      examShare,
      retained: branch.retained,
      skills,
      atRisk: examShare * (1 - branch.retained),
    };
  });

  const advice: StudyAdvice[] = [];
  for (const branch of model.branches) {
    const share = (branch.weightMin + branch.weightMax) / 2 / 100;
    for (const cluster of branch.clusters) {
      for (const skill of cluster.skills) {
        const gap = BAND_GAP[skill.band];
        const priority = share * gap * (skill.due ? DUE_BOOST : 1);
        advice.push({
          topicId: skill.topicId,
          label: skill.label,
          clusterId: cluster.id,
          clusterLabel: cluster.label,
          branchId: branch.id,
          branchLabel: branch.label,
          band: skill.band,
          due: skill.due,
          priority,
          reason: reasonFor(skill.band, skill.due, branch.label, share),
        });
      }
    }
  }

  advice.sort(
    (a, b) => b.priority - a.priority || a.topicId.localeCompare(b.topicId),
  );

  const weakestBranch = [...branches].sort((a, b) => b.atRisk - a.atRisk)[0];
  const percent = Math.round(model.examRetained * 100);

  const headline =
    model.totalSkills === 0
      ? 'Nothing studied yet.'
      : model.dueNow > 0
        ? `${percent}% of the exam retained, and ${model.dueNow} ${
            model.dueNow === 1 ? 'topic is' : 'topics are'
          } due for review.`
        : `${percent}% of the exam retained. Nothing is due right now.`;

  return {
    examRetained: model.examRetained,
    examSeen: model.examSeen,
    totalSkills: model.totalSkills,
    dueNow: model.dueNow,
    bands: model.bands,
    branches,
    next: advice.slice(0, limit),
    weakestBranch,
    headline,
  };
}

/**
 * The digest as text, for sending to a model.
 *
 * ⚠️ **Only aggregates and outline labels leave the machine**: how well each
 * published exam skill is held, and what is due. No answers, no question text,
 * no name, nothing about the person. Worth keeping true, because the moment
 * this carries anything else it becomes a thing that has to be explained.
 *
 * Written as plain lines rather than JSON because a model follows prose more
 * reliably, and because a human can read exactly what was sent.
 */
export function digestAsPrompt(digest: ProgressDigest): string {
  const lines: string[] = [];
  lines.push(`Exam retained (weighted): ${Math.round(digest.examRetained * 100)}%`);
  lines.push(`Exam seen at all: ${Math.round(digest.examSeen * 100)}%`);
  lines.push(`Skills: ${digest.totalSkills}, due for review now: ${digest.dueNow}`);
  lines.push(
    `Bands: ${digest.bands.strong} strong, ${digest.bands.familiar} familiar, ` +
      `${digest.bands.learning} learning, ${digest.bands.unseen} unseen`,
  );

  lines.push('', 'By exam area:');
  for (const branch of digest.branches) {
    lines.push(
      `- ${branch.label}: ${Math.round(branch.examShare * 100)}% of the exam, ` +
        `${Math.round(branch.retained * 100)}% retained across ${branch.skills} skills`,
    );
  }

  lines.push('', 'Highest value to study next, already ranked:');
  for (const [i, item] of digest.next.entries()) {
    lines.push(`${i + 1}. ${item.label} (${item.clusterLabel}) - ${item.reason}`);
  }

  return lines.join('\n');
}

/**
 * What the model is told to be.
 *
 * ⚠️ It is given the ranking and told not to invent a different one. The whole
 * reason the ranking is computed here is so that the conversational answer and
 * the list on screen cannot disagree, and a model left to re-derive it will
 * cheerfully disagree.
 */
export const COACH_SYSTEM_PROMPT = [
  'You are a study coach for the Microsoft DP-600 exam, inside a strategy game',
  'where the exam outline is the tech tree.',
  '',
  'You are given a factual digest of the learner\'s spaced-repetition data,',
  'including a ranking of what is most valuable to study next. That ranking is',
  'already weighted by the published exam weighting and by how far each topic',
  'has decayed.',
  '',
  'Rules:',
  '- Answer from the digest. Do not invent topics, numbers or progress.',
  '- If the digest does not contain the answer, say so plainly.',
  '- Keep the given ranking. You may explain it, group it or reorder within',
  '  ties, but do not substitute a different opinion about priorities.',
  '- Be brief and concrete. Two or three sentences unless asked for more.',
  '- Never claim the learner is ready to sit the exam. Report the number and',
  '  let them decide.',
  '- Answer in the language the learner writes in.',
].join('\n');
