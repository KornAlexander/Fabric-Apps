/**
 * The story file, checked against the engine.
 *
 * ⚠️ **STORY.md ends with a promise: "every figure in this document was read
 * out of the engine, and if one of them ever disagrees with the code, the code
 * is right and this file is a bug."** A promise nothing enforces is a promise
 * that lasts until the first balance change.
 *
 * Documentation rots more quietly than code does. Nothing fails, nothing warns,
 * and the file goes on sounding authoritative while describing a game that no
 * longer exists. That matters more than usual here, because this file is what
 * the project is explained *with*: it is written to be read by people who will
 * never open the source and cannot tell when it has drifted.
 *
 * So the constants are imported and looked for in the prose. Not every
 * sentence can be checked this way, and the ones that can are the ones most
 * likely to move: costs, thresholds, multipliers and weights.
 */

import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANTAGONISTS,
  CHALLENGE_STRENGTH_SWING,
  CITY_RANKS,
  CITY_WORK_RADIUS,
  COMPUTE_PER_WEIGHT,
  FREE_UNIT_ALLOWANCE,
  MAX_BOUND_TOPICS,
  MAX_UNREST,
  PRODUCTION_BASE_COST,
  PRODUCTION_CAP_PER_TURN,
  RAID_COOLDOWN_TURNS,
  RAZE_TAKE,
  REVIEW_BONUS_MULTIPLIER,
  REVIEW_BONUS_TURNS,
  REVIEW_TRUST_REWARD,
  UNIT_TYPES,
  UNREST_YIELD_PENALTY,
  growthThreshold,
  unitCost,
} from '@fabric-empires/engine';
import { DP600_CAMPAIGN } from '@fabric-empires/learn';

const story = readFileSync(resolve(process.cwd(), 'STORY.md'), 'utf8');

/**
 * The prose with its line breaks flattened away.
 *
 * ⚠️ Markdown is hard-wrapped, so a phrase like "an army of twelve costs nine
 * CU" is split across two lines and a literal `includes` for it fails. Two of
 * these assertions failed exactly that way on the first run. Without this,
 * re-wrapping a paragraph, which changes nothing at all, would break the
 * build, and a test that cries wolf about formatting gets deleted rather than
 * fixed.
 */
const flat = story.replace(/\s+/g, ' ');

/** Does the prose contain this figure, written the way a person writes it? */
const says = (value: string): boolean => flat.includes(value.replace(/\s+/g, ' '));

describe('⚠️ the story matches the engine', () => {
  it('is actually there and long enough to be the story', () => {
    // A guard against the whole file passing because it is empty.
    expect(story.length).toBeGreaterThan(4_000);
  });

  it('quotes the growth thresholds', () => {
    expect(growthThreshold(1)).toBe(18);
    expect(says('**18 Data**')).toBe(true);
    expect(says(`${growthThreshold(2)}`)).toBe(true);
    expect(says(`${growthThreshold(9)}`)).toBe(true);
  });

  it('quotes the two things Compute buys', () => {
    expect(says(`\`weight × ${COMPUTE_PER_WEIGHT}\``)).toBe(true);
    expect(says(`\`${PRODUCTION_BASE_COST} + strength × 1.5\``)).toBe(true);
    expect(unitCost(UNIT_TYPES.pipelineRunner)).toBe(54);
    expect(unitCost(UNIT_TYPES.directLakeTitan)).toBe(114);
    expect(says('**54**')).toBe(true);
    expect(says('**114**')).toBe(true);
    expect(says(`**${PRODUCTION_CAP_PER_TURN} Compute a turn**`)).toBe(true);
  });

  it('quotes the upkeep rule and its worked example', () => {
    expect(FREE_UNIT_ALLOWANCE).toBe(3);
    expect(says('first three')).toBe(true);
    // "An army of twelve costs nine CU every single turn".
    expect(12 - FREE_UNIT_ALLOWANCE).toBe(9);
    expect(says('army of twelve costs nine')).toBe(true);
  });

  it('quotes the city work radius', () => {
    expect(CITY_WORK_RADIUS).toBe(2);
    expect(says('two-hex border')).toBe(true);
  });

  it('⚠️ quotes every rank requirement, including the knowledge one', () => {
    /*
     * The rank table is the most important thing in the file, because the
     * knowledge requirement is the argument the whole project rests on. Each
     * row is checked in full.
     */
    for (const rank of CITY_RANKS) {
      expect(story, `${rank.id} is missing from the story`).toContain(rank.labelDe);
      expect(story, `${rank.id} population`).toContain(`| ${rank.minPopulation} |`);
    }
    const top = CITY_RANKS[CITY_RANKS.length - 1]!;
    expect(top.strengthRequired).toBe(0.95);
    expect(says('**0.95**')).toBe(true);
    // "45% more of everything, forever".
    expect(Math.round((top.yieldBonus - 1) * 100)).toBe(45);
    expect(says('**45% more**')).toBe(true);
  });

  it('quotes the combat swing and both ends of what it means', () => {
    expect(says(`±${CHALLENGE_STRENGTH_SWING} strength`)).toBe(true);
    expect(says(`swing of ${CHALLENGE_STRENGTH_SWING * 2}`)).toBe(true);
    expect(says(`(strength ${UNIT_TYPES.profiler.strength})`)).toBe(true);
    expect(says(`(strength ${UNIT_TYPES.directLakeTitan.strength})`)).toBe(true);
  });

  it('quotes the review bonus, which is the reward-not-punishment rule', () => {
    expect(says(`×${REVIEW_BONUS_MULTIPLIER} on everything for five`)).toBe(true);
    expect(REVIEW_BONUS_TURNS).toBe(5);
    expect(says(`${REVIEW_TRUST_REWARD} Trust`)).toBe(true);
    expect(MAX_BOUND_TOPICS).toBe(3);
    expect(says('up to three *bound topics*')).toBe(true);
  });

  it('⚠️ quotes the worst case correctly, because the claim is that it is survivable', () => {
    // "unrest is hard-capped at 3, and the worst case is a 36% dampening".
    const worst = Math.round(MAX_UNREST * UNREST_YIELD_PENALTY * 100);
    expect(worst).toBe(36);
    expect(says(`${worst}%`)).toBe(true);
    expect(says('ever be lost to review debt')).toBe(true);
  });

  it('quotes the sacking trade-off', () => {
    expect(says(`**${Math.round(RAZE_TAKE * 100)}%**`)).toBe(true);
    expect(says(`${RAID_COOLDOWN_TURNS}-turn cooldown`)).toBe(true);
  });

  it('⚠️ names every antagonist and gets its cluster right', () => {
    // Who is marching on you tells you what you are about to be revised on,
    // so a wrong cluster here would misdirect actual study.
    for (const enemy of ANTAGONISTS) {
      const row = story.split('\n').find((line) => line.includes(enemy.label));
      expect(row, `${enemy.label} is missing from the story`).toBeDefined();
      expect(row, `${enemy.label} has the wrong cluster`).toContain(enemy.topicCluster);
    }
  });

  it('quotes the exam as the campaign defines it', () => {
    const exam = DP600_CAMPAIGN.exam;
    expect(says(`**${exam.length} questions**`)).toBe(true);
    expect(says(`**${Math.round(exam.passMark * 100)}%**`)).toBe(true);
    expect(says(`**${Math.round(exam.threshold * 100)}% exam readiness**`)).toBe(true);
    expect(says(`${exam.questionMs / 1000} seconds each`)).toBe(true);
  });

  it('⚠️ gets the size of the tree right, which gates the last unit', () => {
    const nodes = DP600_CAMPAIGN.outline.branches.flatMap((b) =>
      b.clusters.flatMap((c) => c.skills),
    ).length;
    expect(nodes).toBe(41);
    expect(says('41 nodes')).toBe(true);
    // The Refresh Guard is gated on the final node, and the story makes a
    // point of it. If the tree ever shrinks, that unit silently disappears.
    expect(UNIT_TYPES.refreshGuard.unlockedBySkill).toBe(nodes);
    expect(says('node **41 of 41**')).toBe(true);
  });

  it('⚠️ still admits that nothing spends Trust', () => {
    /*
     * The honesty clause. If a Trust sink is ever added this test fails, and
     * the correct fix is to rewrite that section rather than to delete this.
     * A story file that keeps confessing a hole which has since been filled is
     * just a different flavour of wrong.
     */
    expect(says('nothing spends it')).toBe(true);
    expect(says('score, not a currency')).toBe(true);
  });

  it('⚠️ links only to files that exist', () => {
    /*
     * The first draft linked to README.md, which this repository does not
     * have. A dead link in the one document written for people who will never
     * open the source is worse than a dead link anywhere else: they cannot
     * work out what it was supposed to point at.
     */
    const targets = [...story.matchAll(/\]\(([^)#][^)]*)\)/g)].map((m) => m[1]!);
    const local = targets.filter((t) => !t.startsWith('http'));
    expect(local.length, 'no local links found, the scan must be broken').toBeGreaterThan(0);
    const missing = local.filter((t) => !existsSync(resolve(process.cwd(), t)));
    expect(missing).toEqual([]);
  });
});
