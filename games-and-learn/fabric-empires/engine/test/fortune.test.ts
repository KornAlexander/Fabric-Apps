/**
 * Fortune: offers the player may refuse, and a difficulty that finally does
 * something.
 *
 * ⚠️ **The claim this file exists to defend is that answering can only help.**
 * Every other question in the game happens TO the player. A fortune is chosen,
 * and the whole reason it is safe to attempt one you are unsure about is that
 * declining and getting it wrong land in exactly the same place. If that ever
 * stops being true, saying yes becomes a gamble and the feature has quietly
 * turned back into the compulsory thing it replaced.
 */

import { describe, expect, it } from 'vitest';
import {
  ANTAGONIST_FACTION_ID,
  PLAYER_FACTION_ID,
  applyFortune,
  createGameState,
  createRng,
  endTurn,
  fortuneTaken,
  garrisonCapFor,
  MAX_GARRISON_PER_FACTION,
  rollFortune,
  unitsOf,
  type FortuneOffer,
  type GameState,
} from '../src/index.js';

const start = (): GameState => createGameState('FABRIC');

/** Roll seeds until one produces the kind we want to reason about. */
function offerOf(kind: FortuneOffer['kind']): { state: GameState; offer: FortuneOffer } {
  const state = start();
  for (let i = 0; i < 400; i += 1) {
    const offer = rollFortune(state, createRng('FABRIC', `probe:${i}`), PLAYER_FACTION_ID);
    if (offer?.kind === kind) return { state, offer };
  }
  throw new Error(`no ${kind} offer in 400 rolls`);
}

describe('what the map offers', () => {
  it('offers something only now and then, not every turn', () => {
    /*
     * These are voluntary, so somebody who wants the practice says yes to all
     * of them. A prompt every single turn stops being an opportunity and
     * becomes the compulsory thing it was meant to replace.
     */
    const state = start();
    let offered = 0;
    for (let turn = 1; turn <= 200; turn += 1) {
      if (rollFortune(state, createRng('FABRIC', `fortune:${turn}`), PLAYER_FACTION_ID)) {
        offered += 1;
      }
    }
    expect(offered).toBeGreaterThan(20);
    expect(offered).toBeLessThan(120);
  });

  it('⚠️ rolls the same luck for the same seed and turn', () => {
    /*
     * Two players on one seed get the same turn, and a replay asks the same
     * things (D39). A fortune from `Math.random` would make the seed a lie.
     */
    const state = start();
    const once = rollFortune(state, createRng('FABRIC', 'fortune:7'), PLAYER_FACTION_ID);
    const twice = rollFortune(state, createRng('FABRIC', 'fortune:7'), PLAYER_FACTION_ID);
    expect(twice).toEqual(once);
  });

  it('only ever picks a unit that belongs to the faction asked about', () => {
    const state = start();
    for (let i = 0; i < 60; i += 1) {
      const offer = rollFortune(state, createRng('FABRIC', `who:${i}`), ANTAGONIST_FACTION_ID);
      if (!offer) continue;
      expect(state.units.get(offer.unitId)?.factionId).toBe(ANTAGONIST_FACTION_ID);
    }
  });

  it('offers nothing to a faction with no units', () => {
    const state = { ...start(), units: new Map() };
    expect(rollFortune(state, createRng('FABRIC', 'empty'), PLAYER_FACTION_ID)).toBeUndefined();
  });
});

describe('⚠️ answering can only help', () => {
  it('pays the windfall for a good answer', () => {
    const { state, offer } = offerOf('gold');
    const before = state.factions.get(PLAYER_FACTION_ID)!.resources[offer.resource];
    const after = applyFortune(state, offer, 1).factions.get(PLAYER_FACTION_ID)!.resources[
      offer.resource
    ];
    expect(after).toBe(before + offer.amount);
    expect(offer.amount).toBeGreaterThan(0);
  });

  it('⚠️ leaves a declined windfall exactly as it was, and a missed one too', () => {
    /*
     * Not a smaller pile: nothing. The chest in `treasure.ts` deliberately
     * halves on a miss, because a chest can be ground at repeatedly. A fortune
     * is gone either way, so there is nothing to protect against guessing and
     * no reason to charge for it.
     */
    const { state, offer } = offerOf('gold');
    const before = state.factions.get(PLAYER_FACTION_ID)!.resources;
    for (const answer of [undefined, -1, 0]) {
      expect(
        applyFortune(state, offer, answer as number | undefined).factions.get(PLAYER_FACTION_ID)!
          .resources,
        `answer ${String(answer)}`,
      ).toEqual(before);
    }
  });

  it('frees a bogged unit for a good answer', () => {
    const { state, offer } = offerOf('mire');
    const before = state.units.get(offer.unitId)!.movesLeft;
    expect(before).toBeGreaterThan(0);
    expect(applyFortune(state, offer, 1).units.get(offer.unitId)!.movesLeft).toBe(before);
  });

  it('⚠️ a refusal and a wrong answer cost exactly the same', () => {
    /*
     * The core promise. If these two ever diverge, attempting becomes a gamble
     * and a player who is unsure learns to walk away, which is precisely the
     * behaviour a revision tool must not teach.
     */
    const { state, offer } = offerOf('mire');
    const declined = applyFortune(state, offer, undefined);
    const missed = applyFortune(state, offer, -1);
    expect(missed.units.get(offer.unitId)!.movesLeft).toBe(
      declined.units.get(offer.unitId)!.movesLeft,
    );
    expect(declined.units.get(offer.unitId)!.movesLeft).toBe(0);
  });

  it('⚠️ never costs health, a town, or anything that compounds', () => {
    /*
     * A mire is the mildest adversity the game has, which is why it can be
     * handed to somebody who is already losing. If it ever grew teeth it would
     * be an attack, and attacks are the thing this replaced.
     */
    const { state, offer } = offerOf('mire');
    const after = applyFortune(state, offer, -1);
    expect(after.units.get(offer.unitId)!.hp).toBe(state.units.get(offer.unitId)!.hp);
    expect(after.cities).toBe(state.cities);
    expect(after.units.size).toBe(state.units.size);
  });

  it('treats a non-number as no answer', () => {
    const { state, offer } = offerOf('gold');
    expect(fortuneTaken(Number.NaN)).toBe(false);
    expect(applyFortune(state, offer, Number.NaN).factions).toEqual(state.factions);
  });

  it('wants a real answer, not a shrug', () => {
    // A single threshold rather than a sliding scale: scaling the haul by the
    // score would make a half-remembered answer pay, which teaches guessing.
    expect(fortuneTaken(1)).toBe(true);
    expect(fortuneTaken(0.5)).toBe(true);
    expect(fortuneTaken(0.2)).toBe(false);
    expect(fortuneTaken(0)).toBe(false);
  });
});

describe('difficulty finally does something', () => {
  it('⚠️ was inert before this, which is worse than not having it', () => {
    // Three named difficulties that all played identically is a menu making a
    // promise the game does not keep.
    expect(garrisonCapFor('apprentice')).toBeLessThan(garrisonCapFor('analyst'));
    expect(garrisonCapFor('analyst')).toBeLessThan(garrisonCapFor('architect'));
    expect(garrisonCapFor('architect')).toBe(MAX_GARRISON_PER_FACTION);
  });

  it('⚠️ thins the raiders WITHOUT removing a faction', () => {
    /*
     * Dropping a faction is the obvious way to face fewer enemies, and it
     * would quietly remove a seventh of the exam: each faction quizzes on its
     * own cluster, so an easier game would be one that never tests you on two
     * of the branches you are revising for.
     */
    const easy = createGameState('FABRIC', { difficulty: 'analyst' });
    const hard = createGameState('FABRIC', { difficulty: 'architect' });
    expect(easy.factions.size).toBe(hard.factions.size);
    const clusters = (s: GameState): string[] =>
      [...s.factions.values()].map((f) => f.topicCluster).sort();
    expect(clusters(easy)).toEqual(clusters(hard));
  });

  it('fields a smaller army on medium than on hard, played out', () => {
    const play = (difficulty: 'analyst' | 'architect'): number => {
      let state = createGameState('FABRIC', { difficulty });
      for (let i = 0; i < 30; i += 1) state = endTurn(state).state;
      return unitsOf(state, ANTAGONIST_FACTION_ID).length;
    };
    expect(play('analyst')).toBeLessThanOrEqual(play('architect'));
  });
});
