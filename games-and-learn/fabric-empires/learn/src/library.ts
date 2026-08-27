/**
 * The Great Library: what the player actually knows.
 *
 * A model, not a screen. Everything here is pure and synchronous so the
 * honest-reporting rules can be unit tested rather than eyeballed in a
 * browser, which matters because this is the one surface whose entire job is
 * to tell the truth about the learner's progress.
 *
 * Two temptations are refused on purpose.
 *
 * The first is counting skills instead of exam weight. Branch B is 18 of the
 * 41 skills but 45 to 50 percent of the exam, so "29 of 41 known" and "ready
 * for the exam" are very different claims. The weighted figure is the one a
 * learner should plan around.
 *
 * The second is treating researched as known. Unlocking a node in the tech
 * tree means a question was answered once. Retention is what `MasteryBand`
 * measures, and the two are reported separately rather than blended into one
 * flattering number.
 */

import {
  DP600_OUTLINE,
  clusterOf,
  topicIdFor,
  type Outline,
} from './outline.js';
import { questionsForSkill, type Question } from './questions.js';
import { dueAt, masteryBand, type MasteryBand, type MasteryRecord } from './sm2.js';

export interface LibrarySkillEntry {
  readonly skillId: number;
  readonly topicId: string;
  /** The outline bullet, verbatim. */
  readonly label: string;
  readonly band: MasteryBand;
  /** True when SM-2 says this is ready to be tested again. */
  readonly due: boolean;
  /** True when the tech tree node has been unlocked in the current run. */
  readonly researched: boolean;
  readonly reviews: number;
  readonly lapses: number;
  readonly intervalDays: number;
  /** Epoch millis of the next review, or undefined if never reviewed. */
  readonly nextReview: number | undefined;
  readonly questionCount: number;
  /** Distinct documentation pages behind this skill's questions. */
  readonly links: readonly string[];
}

export interface LibraryClusterEntry {
  readonly id: string;
  readonly label: string;
  readonly skills: readonly LibrarySkillEntry[];
}

export interface LibraryBranchEntry {
  readonly id: string;
  readonly label: string;
  readonly weightMin: number;
  readonly weightMax: number;
  readonly clusters: readonly LibraryClusterEntry[];
  readonly bands: Record<MasteryBand, number>;
  /** Skills at familiar or better, over skills in the branch. */
  readonly retained: number;
}

export interface LibraryModel {
  readonly branches: readonly LibraryBranchEntry[];
  readonly bands: Record<MasteryBand, number>;
  readonly totalSkills: number;
  readonly dueNow: number;
  readonly researched: number;
  /**
   * Share of the exam, 0 to 1, whose skills are at familiar or better.
   *
   * Each branch contributes the midpoint of its published weight range,
   * scaled by the fraction of its skills retained. This is the number worth
   * quoting, and it is deliberately harder to move than a skill count.
   */
  readonly examRetained: number;
  /** Same weighting, but counting anything the player has merely seen. */
  readonly examSeen: number;
}

export interface LibraryInput {
  /** Mastery records by topic id. Missing means never seen. */
  readonly records: ReadonlyMap<string, MasteryRecord | undefined>;
  /** Topic ids unlocked in the current run. */
  readonly researched: ReadonlySet<string>;
  /** The bank, for question counts and documentation links. */
  readonly questions: readonly Question[];
  /** Topic ids SM-2 currently considers due. */
  readonly due: ReadonlySet<string>;
  readonly outline?: Outline;
  /**
   * Which campaign these topic ids belong to.
   *
   * ⚠️ Must match the graph the game is actually running, or every lookup
   * into `records`, `researched` and `due` misses: the library would report a
   * fully studied empire as untouched, because it would be asking about
   * `dp600-7` while the run stored `klasse1-7`.
   */
  readonly campaignId?: string;
  /** Cap on links shown per skill, so a row stays readable. */
  readonly maxLinks?: number;
}

function emptyBands(): Record<MasteryBand, number> {
  return { unseen: 0, learning: 0, familiar: 0, strong: 0 };
}

/** Familiar and strong count as retained; learning and unseen do not. */
function isRetained(band: MasteryBand): boolean {
  return band === 'familiar' || band === 'strong';
}

export function buildLibraryModel(input: LibraryInput): LibraryModel {
  const outline = input.outline ?? DP600_OUTLINE;
  const campaignId = input.campaignId ?? 'dp600';
  const maxLinks = input.maxLinks ?? 3;

  const bands = emptyBands();
  let dueNow = 0;
  let researched = 0;
  let totalSkills = 0;
  let examRetained = 0;
  let examSeen = 0;
  let weightTotal = 0;

  const branches: LibraryBranchEntry[] = [];

  for (const branch of outline.branches) {
    const branchBands = emptyBands();
    let branchSkills = 0;
    let branchRetained = 0;
    let branchSeen = 0;
    const clusters: LibraryClusterEntry[] = [];

    for (const cluster of branch.clusters) {
      const skills: LibrarySkillEntry[] = [];

      for (const skill of cluster.skills) {
        const topicId = topicIdFor(skill.id, campaignId);
        const record = input.records.get(topicId);
        const band = masteryBand(record);
        const forSkill = questionsForSkill(input.questions, skill.id);

        // A skill's questions cite several pages between them, so the honest
        // presentation is a short list of further reading rather than one
        // link pretending to be the source of the whole topic.
        const links = [...new Set(forSkill.map((q) => q.sourceLearnUrl))].slice(0, maxLinks);

        const entry: LibrarySkillEntry = {
          skillId: skill.id,
          topicId,
          label: skill.label,
          band,
          due: input.due.has(topicId),
          researched: input.researched.has(topicId),
          reviews: record?.reviews ?? 0,
          lapses: record?.lapses ?? 0,
          intervalDays: record?.intervalDays ?? 0,
          nextReview: record && record.lastReviewed !== undefined ? dueAt(record) : undefined,
          questionCount: forSkill.length,
          links,
        };
        skills.push(entry);

        bands[band] += 1;
        branchBands[band] += 1;
        branchSkills += 1;
        totalSkills += 1;
        if (entry.due) dueNow += 1;
        if (entry.researched) researched += 1;
        if (isRetained(band)) branchRetained += 1;
        if (band !== 'unseen') branchSeen += 1;
      }

      clusters.push({ id: cluster.id, label: cluster.label, skills });
    }

    const weight = (branch.weightMin + branch.weightMax) / 2;
    weightTotal += weight;
    if (branchSkills > 0) {
      examRetained += weight * (branchRetained / branchSkills);
      examSeen += weight * (branchSeen / branchSkills);
    }

    branches.push({
      id: branch.id,
      label: branch.label,
      weightMin: branch.weightMin,
      weightMax: branch.weightMax,
      clusters,
      bands: branchBands,
      retained: branchSkills === 0 ? 0 : branchRetained / branchSkills,
    });
  }

  return {
    branches,
    bands,
    totalSkills,
    dueNow,
    researched,
    // Normalised by the published total rather than assumed to be 100, so a
    // future outline whose weights do not sum to 100 still reports a share.
    examRetained: weightTotal === 0 ? 0 : examRetained / weightTotal,
    examSeen: weightTotal === 0 ? 0 : examSeen / weightTotal,
  };
}

/**
 * A one-line honest summary.
 *
 * Deliberately leads with the weighted figure and names what is still
 * unseen, because a progress screen that only reports what you have done is
 * a congratulation, not a study aid.
 */
export function summarise(model: LibraryModel): string {
  const retained = Math.round(model.examRetained * 100);
  const unseen = model.bands.unseen;
  if (unseen === model.totalSkills) {
    return `Nothing studied yet. ${model.totalSkills} skills ahead of you.`;
  }
  const tail =
    unseen === 0
      ? 'every skill has been seen at least once'
      : `${unseen} of ${model.totalSkills} skills still unseen`;
  return `Retaining about ${retained} percent of the exam by weight, and ${tail}.`;
}
