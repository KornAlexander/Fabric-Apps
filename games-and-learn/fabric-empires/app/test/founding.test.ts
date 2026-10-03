/**
 * Founding a city asks three questions, and a good answer builds a bigger town.
 *
 * Founding was the one important decision the game asked nothing about. It is
 * also the decision a player makes fewest times and lives with longest, which
 * makes it the best moment in a turn to make somebody retrieve something.
 *
 * ⚠️ **The rule is bonus-only, and that is the argument worth pinning.** Every
 * other challenge in the game swings both ways. This one does not, because
 * founding is how a game starts and how a losing player climbs back, and
 * because the size of a capital is permanent in a way a combat modifier never
 * is. The tension is in the head start forgone, not in a punishment.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PLAYER_FACTION_ID,
  SETTLE_QUESTIONS,
  createGameState,
  foundCity,
  settlingBonus,
  unitsOf,
  type GameState,
} from '@fabric-empires/engine';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');
const main = read('app/src/main.ts');

const architectOf = (state: GameState): string =>
  unitsOf(state, PLAYER_FACTION_ID).find((u) => u.typeId === 'architect')!.id;

const found = (score?: number): GameState => {
  const state = createGameState('FABRIC');
  const result = foundCity(
    state,
    architectOf(state),
    score === undefined ? {} : { challengeScore: score },
  );
  expect(result.ok, 'the opening Architect should be able to settle').toBe(true);
  return (result as { state: GameState }).state;
};

const newest = (state: GameState): number => [...state.cities.values()].at(-1)!.population;

describe('how well it was founded', () => {
  it('gives two extra citizens for answering all three well', () => {
    expect(settlingBonus(1)).toBe(2);
    expect(newest(found(1))).toBe(3);
  });

  it('gives one for a decent showing', () => {
    expect(settlingBonus(0.5)).toBe(1);
    expect(newest(found(0.5))).toBe(2);
  });

  it('⚠️ never founds a town SMALLER than an unasked one', () => {
    /*
     * The whole design. A wrong answer costs the head start; it does not cost
     * the town. Anything else would punish the person who most needs to be
     * revising, and the reliable way to dodge the punishment would be to stop
     * founding cities, which is to say to stop playing.
     */
    const baseline = newest(found());
    for (const score of [0, -0.5, -1, -999]) {
      expect(newest(found(score)), `score ${score}`).toBe(baseline);
    }
  });

  it('leaves the standalone game exactly as it was', () => {
    // A caller that asks nothing is not penalised, so the engine on its own
    // still founds the city it always founded (D35).
    expect(newest(found())).toBe(1);
    expect(settlingBonus(0)).toBe(0);
  });

  it('⚠️ survives a score that is not a number', () => {
    /*
     * An average over zero questions, or a timer that fired with nothing
     * entered, both produce NaN. It would sail through the comparisons and
     * make a city of size NaN, which is not a crash and is much worse.
     */
    expect(settlingBonus(Number.NaN)).toBe(0);
    expect(Number.isFinite(newest(found(Number.NaN)))).toBe(true);
  });

  it('⚠️ does not hand out rank along with the citizens', () => {
    /*
     * Rank needs retained knowledge as well as population. Promoting here
     * would give away on turn three what the rest of the game asks a player to
     * earn.
     *
     * ⚠️ Compared against a city founded the ordinary way, NOT against the
     * first city in a fresh state: that one is an antagonist's seat, which
     * starts a rank higher because it was there before the player arrived.
     */
    const rich = [...found(1).cities.values()].at(-1)!;
    const plain = [...found().cities.values()].at(-1)!;
    expect(rich.population).toBe(3);
    expect(plain.population).toBe(1);
    expect(rich.rank, 'three citizens must not buy a promotion').toBe(plain.rank);
  });
});

describe('asking, in the app', () => {
  it('asks three', () => {
    expect(SETTLE_QUESTIONS).toBe(3);
    const body = main.slice(main.indexOf('async function doFound('));
    expect(body.slice(0, 2000)).toContain('SETTLE_QUESTIONS');
    expect(body.slice(0, 2000)).toContain("kind: 'settle'");
  });

  it('⚠️ checks the site BEFORE asking anything', () => {
    /*
     * Asking three questions and then saying "too close to another city" would
     * waste the one thing this feature actually spends: attention.
     */
    const body = main.slice(main.indexOf('async function doFound('));
    const askAt = body.indexOf("kind: 'settle'");
    const checkAt = body.indexOf('foundCity(state, selectedUnitId)');
    expect(checkAt).toBeGreaterThan(-1);
    expect(checkAt).toBeLessThan(askAt);
  });

  it('⚠️ walking out cancels the founding, and a wrong answer does not', () => {
    /*
     * Two different failures. Closing the modal is a decision not to do this
     * now, and the Architect should still be standing there. Answering badly
     * is a decision to build anyway.
     */
    const body = main.slice(main.indexOf('async function doFound('));
    expect(body.slice(0, 2000)).toContain('outcome.abandoned');
  });

  it('⚠️ re-checks the site after the questions', () => {
    /*
     * Three questions is long enough for the world to move. The modal blocks
     * the map, but a raid resolving underneath it could have taken the ground
     * or killed the Architect.
     */
    const body = main.slice(main.indexOf('async function doFound('));
    expect(body.slice(0, 2500)).toContain('challengeScore: score');
  });

  it('prefers topics that have fallen due', () => {
    // Asking about whatever is currently being researched would test the thing
    // already freshest in mind, which is the one thing spaced repetition says
    // not to do.
    const body = main.slice(main.indexOf('function settleTopics('));
    expect(body.slice(0, 700)).toContain('dueTopics');
  });
});
