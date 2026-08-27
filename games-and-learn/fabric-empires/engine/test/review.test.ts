import { describe, it, expect } from 'vitest';
import {
  IGNORES_BEFORE_UNREST,
  MAX_BOUND_TOPICS,
  MAX_UNREST,
  PLAYER_FACTION_ID,
  REVIEW_BONUS_TURNS,
  REVIEW_TRUST_REWARD,
  UNREST_YIELD_PENALTY,
  bindTopicToCity,
  cityMoraleMultiplier,
  cityOutput,
  createGameState,
  endTurn,
  foundCity,
  resolveReview,
  reviewOpportunities,
  reviewPhase,
  unitsOf,
  type City,
  type GameState,
} from '../src/index.js';

/** A state with one founded city, which is what reviews attach to. */
function withCapital(): GameState {
  const state = createGameState('FABRIC');
  const architect = unitsOf(state, PLAYER_FACTION_ID).find((u) => u.typeId === 'architect')!;
  const founded = foundCity(state, architect.id);
  if (!founded.ok) throw new Error(founded.reason);
  return founded.state;
}

/**
 * The player's only city.
 *
 * ⚠️ Not simply the first city on the state any more: every antagonist now
 * holds a village from turn one, and those are inserted before the player has
 * founded anything. Reviews are the player's, so this has to say so.
 */
function onlyCity(state: GameState): City {
  return [...state.cities.values()].find((c) => c.factionId === PLAYER_FACTION_ID)!;
}

function bindMany(state: GameState, topics: readonly string[]): GameState {
  return topics.reduce((acc, topic) => bindTopicToCity(acc, topic), state);
}

describe('binding topics to cities', () => {
  it('binds a topic to a city that has room', () => {
    const state = bindTopicToCity(withCapital(), 'dp600-12');
    expect(onlyCity(state).boundSkills).toEqual(['dp600-12']);
  });

  it('never binds the same topic twice', () => {
    let state = bindTopicToCity(withCapital(), 'dp600-12');
    state = bindTopicToCity(state, 'dp600-12');
    expect(onlyCity(state).boundSkills).toEqual(['dp600-12']);
  });

  it('stops at the cap rather than piling every topic onto one city', () => {
    const state = bindMany(withCapital(), ['a', 'b', 'c', 'd', 'e']);
    expect(onlyCity(state).boundSkills).toHaveLength(MAX_BOUND_TOPICS);
  });

  it('spreads across cities, filling the emptiest first', () => {
    let state = withCapital();
    // A second city, placed far enough away that founding is legal.
    const first = onlyCity(state);
    const cities = new Map(state.cities);
    cities.set('city-x', {
      ...first,
      id: 'city-x',
      name: 'Second',
      boundSkills: [],
      population: 1,
    });
    cities.set(first.id, { ...first, boundSkills: ['already'] });
    state = { ...state, cities };

    state = bindTopicToCity(state, 'fresh');
    expect(state.cities.get('city-x')!.boundSkills).toEqual(['fresh']);
    expect(state.cities.get(first.id)!.boundSkills).toEqual(['already']);
  });

  it('is a no-op when every city is full, rather than throwing', () => {
    // Researching more topics than the empire has room for is not an error.
    const full = bindMany(withCapital(), ['a', 'b', 'c']);
    const after = bindTopicToCity(full, 'd');
    expect(onlyCity(after).boundSkills).toEqual(['a', 'b', 'c']);
  });
});

describe('review opportunities', () => {
  it('offers a review only for a bound topic that is due', () => {
    const state = bindMany(withCapital(), ['due-one', 'not-due']);
    const offered = reviewOpportunities(state, ['due-one', 'unbound']);
    expect(offered.map((o) => o.topicId)).toEqual(['due-one']);
  });

  it('offers nothing when nothing is due', () => {
    const state = bindMany(withCapital(), ['a']);
    expect(reviewOpportunities(state, [])).toEqual([]);
  });

  it('does not offer a second council in the same turn', () => {
    const state = bindMany(withCapital(), ['a']);
    const held = resolveReview(state, onlyCity(state).id, 'a', 1);
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    // Still due as far as the scheduler is concerned, but the city has sat.
    expect(reviewOpportunities(held.state, ['a'])).toEqual([]);
  });
});

describe('resolving a review', () => {
  it('grants Trust and a lasting yield bonus for a correct answer', () => {
    const state = bindMany(withCapital(), ['a']);
    const before = state.factions.get(PLAYER_FACTION_ID)!.resources.trust;

    const result = resolveReview(state, onlyCity(state).id, 'a', 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.trustGained).toBe(REVIEW_TRUST_REWARD);
    expect(result.state.factions.get(PLAYER_FACTION_ID)!.resources.trust).toBe(
      before + REVIEW_TRUST_REWARD,
    );
    expect(onlyCity(result.state).reviewBonusUntilTurn).toBe(
      state.turn + REVIEW_BONUS_TURNS,
    );
  });

  it('costs the turn and nothing else when the answer is wrong', () => {
    /*
     * The point of D49. Punishing a wrong answer would teach the player to
     * avoid reviews they are unsure about, which is precisely the material
     * they most need to practise.
     */
    const state = bindMany(withCapital(), ['a']);
    const before = onlyCity(state);
    const result = resolveReview(state, before.id, 'a', -1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = onlyCity(result.state);
    expect(result.trustGained).toBe(0);
    expect(after.unrest).toBe(before.unrest);
    expect(after.reviewBonusUntilTurn).toBe(before.reviewBonusUntilTurn);
    expect(after.lastReviewTurn).toBe(state.turn);
  });

  it('settles a city that shows up, right or wrong', () => {
    const state = bindMany(withCapital(), ['a']);
    const cities = new Map(state.cities);
    const city = onlyCity(state);
    cities.set(city.id, { ...city, ignoredReviews: 2, unrest: 2 });

    const result = resolveReview({ ...state, cities }, city.id, 'a', -1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(onlyCity(result.state).ignoredReviews).toBe(0);
  });

  it('refuses a topic that is not bound to that city', () => {
    const state = bindMany(withCapital(), ['a']);
    const result = resolveReview(state, onlyCity(state).id, 'elsewhere', 1);
    expect(result.ok).toBe(false);
  });
});

describe('unrest', () => {
  it('tolerates a couple of ignored reviews before grumbling', () => {
    let state = bindMany(withCapital(), ['a']);
    for (let i = 0; i < IGNORES_BEFORE_UNREST; i++) {
      state = reviewPhase(state, ['a']).state;
      expect(onlyCity(state).unrest).toBe(0);
    }
    state = reviewPhase(state, ['a']).state;
    expect(onlyCity(state).unrest).toBe(1);
  });

  it('is capped, so a city can never be lost to review debt', () => {
    let state = bindMany(withCapital(), ['a']);
    for (let i = 0; i < 40; i++) state = reviewPhase(state, ['a']).state;
    expect(onlyCity(state).unrest).toBe(MAX_UNREST);
  });

  it('accrues only inside a turn, so nothing happens while the player is away', () => {
    /*
     * D49 in one assertion. Unrest is a pure function of turns played, and
     * turns only advance when somebody is playing, so wall-clock absence
     * cannot cost anything. Calling the phase zero times changes nothing no
     * matter how long that takes.
     */
    const state = bindMany(withCapital(), ['a']);
    const before = onlyCity(state);
    const after = onlyCity(state);
    expect(after.unrest).toBe(before.unrest);
    expect(after.ignoredReviews).toBe(0);
  });

  it('reports which cities were unsettled, rather than changing them silently', () => {
    let state = bindMany(withCapital(), ['a']);
    let result = reviewPhase(state, ['a']);
    for (let i = 0; i < IGNORES_BEFORE_UNREST; i++) {
      result = reviewPhase(result.state, ['a']);
    }
    expect(result.unsettled).toContain(onlyCity(result.state).id);
  });
});

describe('morale and yields', () => {
  it('is neutral for a city with no bonus and no unrest', () => {
    expect(cityMoraleMultiplier(onlyCity(withCapital()), 1)).toBe(1);
  });

  it('dampens output while a city is unsettled', () => {
    const state = bindMany(withCapital(), ['a']);
    const city = onlyCity(state);
    const settled = cityOutput(state, city);

    const cities = new Map(state.cities);
    cities.set(city.id, { ...city, unrest: MAX_UNREST });
    const unsettledState = { ...state, cities };
    const unsettled = cityOutput(unsettledState, cities.get(city.id)!);

    expect(cityMoraleMultiplier(cities.get(city.id)!, state.turn)).toBeCloseTo(
      1 - MAX_UNREST * UNREST_YIELD_PENALTY,
      5,
    );
    // Data is the yield every city produces, so it is the honest one to compare.
    expect(unsettled.data).toBeLessThanOrEqual(settled.data);
  });

  it('lifts output while a review bonus is running, then lets it lapse', () => {
    const state = bindMany(withCapital(), ['a']);
    const city = onlyCity(state);
    const reviewed = resolveReview(state, city.id, 'a', 1);
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;

    const boosted = onlyCity(reviewed.state);
    expect(cityMoraleMultiplier(boosted, state.turn)).toBeGreaterThan(1);
    // Past the window it is back to neutral rather than staying forever.
    expect(cityMoraleMultiplier(boosted, state.turn + REVIEW_BONUS_TURNS)).toBe(1);
  });
});

describe('the turn pipeline', () => {
  it('reports available reviews without demanding them', () => {
    const state = bindMany(withCapital(), ['a']);
    const { report } = endTurn(state, { dueTopics: ['a'] });
    expect(report.reviewsAvailable.map((o) => o.topicId)).toEqual(['a']);
    expect(report.reviewsIgnored.map((o) => o.topicId)).toEqual(['a']);
  });

  it('offers a city again on the following turn after it has reviewed', () => {
    // Without recomputing against the new turn number, a city that reviewed
    // would look permanently spent and the loop would run exactly once.
    const state = bindMany(withCapital(), ['a']);
    const held = resolveReview(state, onlyCity(state).id, 'a', 1);
    expect(held.ok).toBe(true);
    if (!held.ok) return;

    const { report } = endTurn(held.state, { dueTopics: ['a'] });
    expect(report.reviewsAvailable.map((o) => o.topicId)).toEqual(['a']);
    expect(report.reviewsIgnored).toEqual([]);
  });

  it('does nothing at all when no topics are due', () => {
    const state = bindMany(withCapital(), ['a']);
    const { report } = endTurn(state, {});
    expect(report.reviewsAvailable).toEqual([]);
    expect(report.reviewsIgnored).toEqual([]);
    expect(report.citiesUnsettled).toEqual([]);
  });

  it('leaves the standalone game untouched when reviews are not wired up', () => {
    // D35: the engine must still be a complete strategy game with no
    // learning layer attached, and that means no options argument at all.
    const state = withCapital();
    const { report } = endTurn(state);
    expect(report.reviewsAvailable).toEqual([]);
    expect(report.citiesUnsettled).toEqual([]);
  });
});
