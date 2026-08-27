/**
 * Settlements rising: Siedlung, Dorf, Gemeinde, Stadt, Großstadt.
 *
 * ⚠️ **The assertion that matters most in this file is that a rank cannot be
 * bought with food alone.** That is the whole reason the mechanic exists: a
 * town which grows purely by ending turns rewards ending turns, and a town
 * which grows on what its owner has retained rewards revising. If a future
 * change quietly lets population carry a city to Großstadt, the tiers become
 * decoration and nobody would notice from a screenshot.
 */

import { describe, expect, it } from 'vitest';
import {
  CITY_RANKS,
  PLAYER_FACTION_ID,
  createGameState,
  earnedRank,
  nextRankNeed,
  promoteCities,
  promotionFor,
  rankIndex,
  rankInfo,
  stalledOnKnowledge,
  type City,
  type CityRank,
  type GameState,
} from '../src/index.js';

const town = (over: Partial<City> = {}): City => ({
  id: 'c1',
  factionId: PLAYER_FACTION_ID,
  hex: { q: 0, r: 0 },
  name: 'Test',
  kind: 'workspace',
  hp: 200,
  wallLevel: 0,
  wallHp: 0,
  population: 1,
  rank: 'siedlung',
  growthStore: 0,
  boundSkills: [],
  unrest: 0,
  ignoredReviews: 0,
  reviewBonusUntilTurn: 0,
  lastReviewTurn: -1,
  productionProgress: 0,
  lastRaidedTurn: -1,
  ...over,
});

/** Everything known perfectly. */
const omniscient = () => 1;
/** Nothing known at all. */
const ignorant = () => 0;

describe('the five ranks', () => {
  it('are Siedlung, Dorf, Gemeinde, Stadt, Großstadt, in that order', () => {
    expect(CITY_RANKS.map((r) => r.id)).toEqual([
      'siedlung',
      'dorf',
      'gemeinde',
      'stadt',
      'grossstadt',
    ]);
    expect(CITY_RANKS.map((r) => r.labelDe)).toEqual([
      'Siedlung',
      'Dorf',
      'Gemeinde',
      'Stadt',
      'Großstadt',
    ]);
  });

  it('carries both names on one row, so they cannot drift apart', () => {
    for (const rank of CITY_RANKS) {
      expect(rank.label.trim(), rank.id).not.toBe('');
      expect(rank.labelDe.trim(), rank.id).not.toBe('');
      expect(rank.label, rank.id).not.toBe(rank.labelDe);
    }
  });

  it('asks for more of everything, the higher it goes', () => {
    for (let i = 1; i < CITY_RANKS.length; i++) {
      const lower = CITY_RANKS[i - 1]!;
      const higher = CITY_RANKS[i]!;
      expect(higher.minPopulation, higher.id).toBeGreaterThan(lower.minPopulation);
      expect(higher.topicsRequired, higher.id).toBeGreaterThan(lower.topicsRequired);
      expect(higher.yieldBonus, higher.id).toBeGreaterThan(lower.yieldBonus);
      expect(higher.bonusHp, higher.id).toBeGreaterThan(lower.bonusHp);
    }
  });

  it('starts everyone at the bottom with nothing asked of them', () => {
    const first = CITY_RANKS[0]!;
    expect(first.topicsRequired).toBe(0);
    expect(first.yieldBonus).toBe(1);
  });
});

describe('⚠️ a rank cannot be bought with food alone', () => {
  it('refuses every rank above the first to a city that knows nothing', () => {
    // A hundred citizens and four bound topics, none of them retained.
    const fat = town({
      population: 100,
      boundSkills: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(earnedRank(fat, ignorant).id).toBe('siedlung');
  });

  it('refuses every rank to a city that knows everything and is empty', () => {
    // The mirror. Knowledge without people is not a city either.
    const learned = town({ population: 1, boundSkills: ['a', 'b', 'c', 'd'] });
    expect(earnedRank(learned, omniscient).id).toBe('siedlung');
  });

  it('grants the top rank only when both are satisfied', () => {
    const real = town({ population: 9, boundSkills: ['a', 'b', 'c', 'd'] });
    expect(earnedRank(real, omniscient).id).toBe('grossstadt');
  });

  it('counts only topics retained well enough for that rank', () => {
    // Familiar is enough for a Township, and not for a City.
    const familiar = () => 0.67;
    const city = town({ population: 20, boundSkills: ['a', 'b', 'c', 'd', 'e'] });
    expect(earnedRank(city, familiar).id).toBe('stadt');
  });
});

describe('⚠️ it stalls, it never falls', () => {
  it('does not take a rank away when the topics lapse', () => {
    /*
     * The plan wanted the full reference behaviour in 24.1, where a house
     * downgrades when its demand goes unmet, and that is the sharper
     * mechanic. It is also the one most likely to read as a punishment on a
     * study aid, which is the last thing a study aid can afford. Forgetting
     * blocks progress. It does not burn your town down.
     */
    const grand = town({ population: 9, rank: 'grossstadt', boundSkills: ['a'] });
    expect(promotionFor(grand, ignorant)).toBeUndefined();
    expect(earnedRank(grand, ignorant).id).toBe('siedlung');

    const after = promoteCities(stateWith(grand), ignorant);
    expect(after.state.cities.get('c1')!.rank).toBe('grossstadt');
    expect(after.promoted).toEqual([]);
  });

  it('still refuses to promote further while they are lapsed', () => {
    const stuck = town({ population: 9, rank: 'dorf', boundSkills: ['a', 'b', 'c', 'd'] });
    expect(promotionFor(stuck, ignorant)).toBeUndefined();
  });
});

function stateWith(city: City): GameState {
  const state = createGameState('RANKTEST');
  const cities = new Map(state.cities);
  cities.set(city.id, city);
  return { ...state, cities, activeFactionId: PLAYER_FACTION_ID };
}

describe('promotion', () => {
  it('raises a city one step at a time and says so', () => {
    const ready = town({ population: 2, boundSkills: ['a'] });
    const result = promoteCities(stateWith(ready), omniscient);

    expect(result.promoted).toHaveLength(1);
    expect(result.promoted[0]!.from.id).toBe('siedlung');
    expect(result.promoted[0]!.to.id).toBe('dorf');
    expect(result.state.cities.get('c1')!.rank).toBe('dorf');
  });

  it('can jump more than one rank when a city has earned it', () => {
    // Catching up after a long study session should not take four turns.
    const ready = town({ population: 9, boundSkills: ['a', 'b', 'c', 'd'] });
    const result = promoteCities(stateWith(ready), omniscient);
    expect(result.state.cities.get('c1')!.rank).toBe('grossstadt');
  });

  it('⚠️ returns the same state object when nothing changed', () => {
    // So the caller can skip a redraw cheaply and this is safe every turn.
    const state = stateWith(town());
    const result = promoteCities(state, ignorant);
    expect(result.state).toBe(state);
  });

  it('raises the ceiling on hit points without healing the damage', () => {
    const hurt = town({ population: 2, boundSkills: ['a'], hp: 40 });
    const result = promoteCities(stateWith(hurt), omniscient);
    expect(result.state.cities.get('c1')!.hp).toBe(40 + rankInfo('dorf').bonusHp);
  });

  it('leaves other factions alone', () => {
    const theirs = town({ id: 'c1', factionId: 'rival', population: 9, boundSkills: ['a'] });
    const result = promoteCities(stateWith(theirs), omniscient, PLAYER_FACTION_ID);
    expect(result.promoted).toEqual([]);
  });
});

describe('telling the player what is missing', () => {
  it('names the citizens and the topics still wanted', () => {
    const need = nextRankNeed(town({ population: 1 }), ignorant)!;
    expect(need.rank.id).toBe('dorf');
    expect(need.citizensShort).toBe(1);
    expect(need.topicsShort).toBe(1);
  });

  it('⚠️ flags the case the player can act on right now', () => {
    /*
     * Waiting on food is waiting on time and there is nothing to be done. Being
     * held back by a lapsed topic is a thing a player can fix this minute, and
     * a settlement that has quietly stopped growing is indistinguishable from a
     * slow one unless it is said out loud.
     */
    const fed = town({ population: 6, boundSkills: ['a', 'b', 'c'] });
    expect(nextRankNeed(fed, ignorant)!.blockedByKnowledge).toBe(true);

    const hungry = town({ population: 1, boundSkills: ['a'] });
    expect(nextRankNeed(hungry, omniscient)!.blockedByKnowledge).toBe(false);
  });

  it('says nothing at the top', () => {
    expect(nextRankNeed(town({ rank: 'grossstadt' }), omniscient)).toBeUndefined();
  });

  it('lists the settlements held back purely by revision', () => {
    const fed = town({ population: 6, boundSkills: ['a', 'b', 'c'] });
    expect(stalledOnKnowledge(stateWith(fed), ignorant).map((c) => c.id)).toEqual(['c1']);
    expect(stalledOnKnowledge(stateWith(fed), omniscient)).toEqual([]);
  });
});

describe('the rank table is self-consistent', () => {
  it('orders every id the way the array is ordered', () => {
    for (const [i, rank] of CITY_RANKS.entries()) {
      expect(rankIndex(rank.id)).toBe(i);
      expect(rankInfo(rank.id)).toBe(rank);
    }
  });

  it('falls back to the first rank rather than throwing on nonsense', () => {
    expect(rankInfo('grossdorf' as CityRank).id).toBe('siedlung');
  });
});
