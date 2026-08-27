/**
 * A campaign: everything the game needs in order to teach one subject.
 *
 * ⚠️ **This is the payoff of D35, and the first thing to test whether it was
 * real.** The engine has always claimed to be a complete strategy game that
 * knows nothing about certifications. Measured before writing any of this:
 * every mention of DP-600 in `engine/` is a comment, and `unlockedBySkill` is
 * a 1-based index into the topic graph rather than a topic id, exactly as its
 * doc comment promised. So a second subject needs **no engine change at all**.
 *
 * What it does need is somewhere to put the things that are genuinely
 * subject-specific and were sitting in the wrong place: the outline, the
 * question bank, the exam's shape, and the enemies. The Silo Horde quizzes on
 * DP-600 cluster B1, which is correct for that campaign and meaningless for a
 * Year 1 class that needs Die Zahlendreher instead.
 */

import {
  ANTAGONISTS,
  minimumTopicCount,
  validateTopicGraph,
  type AntagonistDefinition,
  type TopicGraph,
} from '@fabric-empires/engine';
import { DP600_OUTLINE, buildTopicGraph, type Outline } from './outline.js';
import { DP600_QUESTIONS } from './bank.js';
import { KLASSE1_OUTLINE, KLASSE1_QUESTIONS } from './klasse1.js';
import type { Question } from './questions.js';

/** Interface language a campaign is written for. */
export type CampaignLanguage = 'en' | 'de';

/**
 * How the final exam works for this subject.
 *
 * ⚠️ Per campaign, because forty questions at forty-five seconds each is a
 * reasonable professional certification and a cruel thing to do to a
 * six-year-old.
 */
export interface CampaignExam {
  /** Questions in the final paper. */
  readonly length: number;
  /** Share of the paper needed to pass, 0..1. */
  readonly passMark: number;
  /** Readiness at which the Proctor appears, 0..1. */
  readonly threshold: number;
  /** Seconds per question in the final paper. */
  readonly questionMs: number;
}

export interface Campaign {
  readonly id: string;
  /** The name of the world this campaign builds. */
  readonly title: string;
  /**
   * The name of the subject being revised, which is not the same thing.
   *
   * ⚠️ Separate from `title` because the two are read in different places and
   * only one of them answers "what am I being asked about". DP-600's world is
   * called Fabric Empires, which is a fine name for a world and useless as a
   * label beside "1. Klasse: Mathe und Deutsch" on a seat.
   */
  readonly course: string;
  readonly blurb: string;
  readonly language: CampaignLanguage;
  /**
   * What this campaign can be used for.
   *
   * ⚠️ **`questions` campaigns are exempt from the world requirements**, and
   * that exemption is the whole reason a six-year-old can play along. Building
   * a world needs at least `minimumTopicCount()` topics and one faction per
   * cluster; a Year 1 curriculum has 24 skills and no business fielding
   * armies. In co-op the empire comes from player one's course and player two
   * simply answers alongside them, so their course only has to supply
   * questions.
   */
  readonly role: 'world' | 'questions';
  readonly outline: Outline;
  readonly questions: readonly Question[];
  /**
   * The enemies, one per cluster of this outline.
   *
   * Opaque cluster strings as far as the engine is concerned; the join between
   * these and the outline is checked by `validateCampaign`, because nothing
   * else would catch a renamed cluster. Empty for a `questions` campaign.
   */
  readonly antagonists: readonly AntagonistDefinition[];
  readonly exam: CampaignExam;
}

export const DP600_CAMPAIGN: Campaign = Object.freeze({
  id: 'dp600',
  title: 'Fabric Empires',
  course: 'DP-600: Fabric Analytics Engineer',
  blurb:
    'The DP-600 outline is the tech tree. Rival factions each hold one branch of it: beat them and take what they know, or burn it and stay ignorant.',
  language: 'en',
  role: 'world',
  outline: DP600_OUTLINE,
  questions: DP600_QUESTIONS,
  antagonists: ANTAGONISTS,
  exam: { length: 40, passMark: 0.7, threshold: 0.8, questionMs: 45_000 },
});

/**
 * One faction per Klasse 1 cluster, each named for the mistake it makes.
 *
 * ⚠️ The joke has to be the SKILL, not a generic monster. A child who beats
 * Die Silbenschlucker should be able to say what a Silbe is, so every name is
 * the error its cluster teaches you to stop making: the Zahlendreher swap
 * digits, the Kleinschreiber refuse capital letters, the Punktvergesser never
 * finish a sentence. Being frightening is not the point and would not survive
 * the audience.
 */
const KLASSE1_ANTAGONISTS: readonly AntagonistDefinition[] = Object.freeze([
  { id: 'zahlendreher', label: 'Die Zahlendreher', topicCluster: 'M1', colour: '#b5533f', seat: 'Zahlenburg', seatKind: 'lakehouse' },
  { id: 'rechenraeuber', label: 'Die Rechenräuber', topicCluster: 'M2', colour: '#c2793a', seat: 'Rechenfels', seatKind: 'warehouse' },
  { id: 'musterbrecher', label: 'Die Musterbrecher', topicCluster: 'M3', colour: '#7b8a3f', seat: 'Formenhain', seatKind: 'workspace' },
  { id: 'lautlose', label: 'Die Lautlosen', topicCluster: 'D1', colour: '#4f7f7a', seat: 'Lautturm', seatKind: 'eventhouse' },
  { id: 'silbenschlucker', label: 'Die Silbenschlucker', topicCluster: 'D2', colour: '#8a6fb0', seat: 'Silbenhain', seatKind: 'eventhouse' },
  { id: 'kleinschreiber', label: 'Die Kleinschreiber', topicCluster: 'D3', colour: '#9c5f8a', seat: 'Kleinstadt', seatKind: 'semanticModel' },
  { id: 'punktvergesser', label: 'Die Punktvergesser', topicCluster: 'D4', colour: '#a8474f', seat: 'Satzende', seatKind: 'semanticModel' },
] as const);

/**
 * Klasse 1: Mathe und Deutsch.
 *
 * ⚠️ **A world in its own right, not just a question source for seat two.**
 * It began as the latter, because two things stopped it being a world: the
 * unit table was secretly a statement about DP-600's 41 topics (section 70),
 * and the app built every world from DP-600 no matter what the setup screen
 * was told. Both are fixed, so a six-year-old can now have their own empire
 * rather than only riding along in somebody else's.
 *
 * Twenty-four skills and fifty-one questions, every stem short enough for
 * somebody still learning to read.
 */
export const KLASSE1_CAMPAIGN: Campaign = Object.freeze({
  id: 'klasse1',
  title: '1. Klasse: Mathe und Deutsch',
  course: '1. Klasse: Mathe und Deutsch',
  blurb: 'Zahlen bis 20, Plus und Minus, Anlaute, Silben und erste Sätze.',
  language: 'de',
  role: 'world',
  outline: KLASSE1_OUTLINE,
  questions: KLASSE1_QUESTIONS,
  antagonists: KLASSE1_ANTAGONISTS,
  /*
   * A gentler paper, and an examiner who calls earlier. `threshold` is read by
   * `proctorReady`, which used to hard-code DP-600's 0.8: a child would have
   * had to reach professional-certification readiness before anything
   * happened.
   */
  exam: { length: 10, passMark: 0.6, threshold: 0.6, questionMs: 60_000 },
});

export const CAMPAIGNS: readonly Campaign[] = Object.freeze([
  DP600_CAMPAIGN,
  KLASSE1_CAMPAIGN,
]);

export const DEFAULT_CAMPAIGN_ID = DP600_CAMPAIGN.id;

export function campaignById(id: string): Campaign | undefined {
  return CAMPAIGNS.find((c) => c.id === id);
}

/** The tech tree this campaign produces. */
export function topicsFor(campaign: Campaign): TopicGraph {
  // ⚠️ The id is not decoration. Topic ids are the keys SM-2 records and saves
  // are stored under, so two campaigns sharing a prefix share a mastery
  // history. See `topicIdFor`.
  return buildTopicGraph(campaign.outline, campaign.id);
}

/**
 * Everything wrong with a campaign, as a list rather than a throw.
 *
 * A content author should see all of it at once. Returning strings rather than
 * failing loudly also lets a test assert the exact problems, which is how the
 * 41-topic floor stops being invisible.
 */
export function validateCampaign(campaign: Campaign): string[] {
  const problems: string[] = [];
  const graph = topicsFor(campaign);

  problems.push(...validateTopicGraph(graph));

  // A cluster with no questions cannot test anybody, whatever the role.
  const clusters = new Set(
    campaign.outline.branches.flatMap((b) => b.clusters.map((c) => c.id)),
  );
  const asked = new Set(campaign.questions.map((q) => q.cluster));
  for (const cluster of clusters) {
    if (!asked.has(cluster)) {
      problems.push(`${campaign.id}: cluster ${cluster} has no questions.`);
    }
  }

  if (campaign.exam.length < 1) {
    problems.push(`${campaign.id}: an exam of ${campaign.exam.length} questions is not an exam.`);
  }
  if (campaign.exam.passMark <= 0 || campaign.exam.passMark > 1) {
    problems.push(`${campaign.id}: pass mark ${campaign.exam.passMark} is not a share of the paper.`);
  }
  if (campaign.exam.threshold <= 0 || campaign.exam.threshold > 1) {
    problems.push(`${campaign.id}: threshold ${campaign.exam.threshold} is not a share of readiness.`);
  }

  /*
   * Everything below is about running a WORLD, and a question source does not.
   *
   * ⚠️ Applying these to every campaign would make a Year 1 curriculum invalid
   * for having 24 skills and no armies, which is exactly what a Year 1
   * curriculum should have.
   */
  if (campaign.role !== 'world') return problems;

  /*
   * ⚠️ **There is no longer a topic-count floor, and removing it was a
   * correction rather than a relaxation.**
   *
   * This used to reject any world with fewer than `minimumTopicCount()`
   * topics, on the grounds that "the last N unit unlock(s) can never fire".
   * That was true when `unlockedBySkill` was read as a literal index into the
   * graph. It stopped being true when the ladder was scaled onto whatever
   * length the campaign actually has (section 70), and nothing came back here
   * to say so, so the validator went on enforcing a rule whose reason had been
   * deleted one package away.
   *
   * Measured before removing it: a 24-topic curriculum with every topic known
   * reaches 12 of 12 units, exactly as a 41-topic one does. The floor was
   * refusing worlds that work.
   *
   * ⚠️ It is still worth knowing that this WAS load-bearing. Leaving it in
   * place would have been the safe-looking choice and would have kept a
   * six-year-old's campaign permanently invalid for a reason that no longer
   * existed.
   */

  // Every cluster in the outline needs a faction, and every faction a cluster.
  const held = new Set(campaign.antagonists.map((a) => a.topicCluster));

  for (const antagonist of campaign.antagonists) {
    if (!clusters.has(antagonist.topicCluster)) {
      problems.push(
        `${campaign.id}: ${antagonist.label} quizzes on "${antagonist.topicCluster}", which the outline does not define.`,
      );
    }
  }
  for (const cluster of clusters) {
    if (!held.has(cluster)) {
      problems.push(`${campaign.id}: no faction holds cluster ${cluster}.`);
    }
  }

  return problems;
}
