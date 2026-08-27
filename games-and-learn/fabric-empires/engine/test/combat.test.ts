import { describe, it, expect } from 'vitest';
import {
  CHALLENGE_STRENGTH_SWING,
  FORTIFY_DEFENCE_BONUS,
  GENERIC_TOPIC_GRAPH,
  MAX_DAMAGE,
  MIN_DAMAGE,
  NEUTRAL_OUTCOME,
  NullChallengeProvider,
  PLAYER_FACTION_ID,
  ScriptedChallengeProvider,
  availableTopics,
  canAttack,
  challengeModifier,
  cityCombatSide,
  createGameState,
  createRng,
  damageFrom,
  foundCity,
  hexKey,
  hexNeighbours,
  previewAttack,
  resolveAttack,
  terrain,
  unitCombatSide,
  unitType,
  unitsOf,
  validateTopicGraph,
  type GameState,
  type Hex,
  type TopicGraph,
  type UnitTypeId,
} from '../src/index.js';

const ENEMY = 'enemy';

function place(
  state: GameState,
  id: string,
  typeId: UnitTypeId,
  hex: Hex,
  factionId: string,
  overrides: Partial<{ hp: number; fortified: boolean; movesLeft: number }> = {},
): GameState {
  const units = new Map(state.units);
  units.set(id, {
    id,
    typeId,
    factionId,
    hex,
    hp: overrides.hp ?? unitType(typeId).maxHp,
    movesLeft: overrides.movesLeft ?? unitType(typeId).movement,
    fortified: overrides.fortified ?? false,
  });
  return { ...state, units };
}

/** Two adjacent walkable tiles, and a state cleared of the starting units. */
function duelGround(seed = 'FABRIC'): {
  state: GameState;
  a: Hex;
  b: Hex;
} {
  const base = createGameState(seed);
  const start = unitsOf(base, PLAYER_FACTION_ID)[0]!.hex;
  const b = hexNeighbours(start).find((h) => {
    const tile = base.map.tiles.get(hexKey(h));
    return tile !== undefined && terrain(tile.terrain).settleable;
  })!;
  return { state: { ...base, units: new Map() }, a: start, b };
}

/** A founded city, handed to the enemy so the player can besiege it. */
function citySetup() {
  const base = createGameState('FABRIC');
  const architect = unitsOf(base, PLAYER_FACTION_ID).find(
    (u) => u.typeId === 'architect',
  )!;
  const founded = foundCity(base, architect.id);
  if (!founded.ok) throw new Error(founded.reason);

  const cityHex = [...founded.state.cities.values()][0]!.hex;
  const attackHex = hexNeighbours(cityHex).find((h) => {
    const tile = founded.state.map.tiles.get(hexKey(h));
    return tile !== undefined && terrain(tile.terrain).settleable;
  })!;

  const cities = new Map(founded.state.cities);
  for (const [id, city] of cities) cities.set(id, { ...city, factionId: ENEMY });
  return {
    state: { ...founded.state, cities, units: new Map() },
    cityHex,
    attackHex,
  };
}

describe('challenge modifier', () => {
  it('maps a perfect answer to the full positive swing', () => {
    expect(challengeModifier(1)).toBe(CHALLENGE_STRENGTH_SWING);
    expect(challengeModifier(-1)).toBe(-CHALLENGE_STRENGTH_SWING);
  });

  it('is neutral when nothing was asked', () => {
    expect(challengeModifier(0)).toBe(0);
  });

  it('is linear, so the player can feel the relationship', () => {
    expect(challengeModifier(0.5)).toBeCloseTo(CHALLENGE_STRENGTH_SWING / 2, 9);
  });

  it('clamps scores from a misbehaving provider', () => {
    expect(challengeModifier(99)).toBe(CHALLENGE_STRENGTH_SWING);
    expect(challengeModifier(-99)).toBe(-CHALLENGE_STRENGTH_SWING);
  });
});

describe('effective strength', () => {
  it('falls with damage but never below half', () => {
    const { state, a } = duelGround();
    const full = place(state, 'u', 'pipelineRunner', a, PLAYER_FACTION_ID);
    const hurt = place(state, 'u', 'pipelineRunner', a, PLAYER_FACTION_ID, { hp: 1 });

    const fullSide = unitCombatSide(full, full.units.get('u')!, { attacking: true });
    const hurtSide = unitCombatSide(hurt, hurt.units.get('u')!, { attacking: true });

    expect(hurtSide.effective).toBeLessThan(fullSide.effective);
    expect(hurtSide.effective).toBeGreaterThanOrEqual(fullSide.effective * 0.5);
  });

  it('gives terrain and fortification to the defender only', () => {
    const { state, a } = duelGround();
    const dug = place(state, 'u', 'rlsSentinel', a, PLAYER_FACTION_ID, {
      fortified: true,
    });
    const unit = dug.units.get('u')!;

    const defending = unitCombatSide(dug, unit, { attacking: false });
    const attacking = unitCombatSide(dug, unit, { attacking: true });

    expect(defending.fortifyBonus).toBe(FORTIFY_DEFENCE_BONUS);
    expect(attacking.fortifyBonus).toBe(0);
    expect(attacking.terrainBonus).toBe(0);
    expect(defending.effective).toBeGreaterThan(attacking.effective);
  });

  it('never drops below one, even for a wrong answer on a weak unit', () => {
    // A negative effective strength would invert the damage curve and make a
    // catastrophic answer better than a merely bad one.
    const { state, a } = duelGround();
    const weak = place(state, 'u', 'profiler', a, PLAYER_FACTION_ID, { hp: 1 });
    const side = unitCombatSide(weak, weak.units.get('u')!, {
      attacking: true,
      challengeScore: -1,
    });
    expect(side.effective).toBeGreaterThanOrEqual(1);
  });

  it('lets a right answer beat a stronger unit, early on', () => {
    const { state, a } = duelGround();
    const scout = place(state, 'u', 'profiler', a, PLAYER_FACTION_ID);
    const unit = scout.units.get('u')!;

    const informed = unitCombatSide(scout, unit, {
      attacking: true,
      challengeScore: 1,
    });
    const runnerStrength = unitType('pipelineRunner').strength;
    // A Profiler is strength 8 against a Pipeline Runner's 20. Knowing the
    // answer must be enough to close that gap at this tier.
    expect(informed.effective).toBeGreaterThan(runnerStrength);
  });

  it('matters less to a heavy unit than to a light one', () => {
    const { state, a } = duelGround();
    const light = place(state, 'u', 'profiler', a, PLAYER_FACTION_ID);
    const heavy = place(state, 'u', 'directLakeTitan', a, PLAYER_FACTION_ID);

    const lightGain =
      unitCombatSide(light, light.units.get('u')!, { attacking: true, challengeScore: 1 })
        .effective /
      unitCombatSide(light, light.units.get('u')!, { attacking: true }).effective;
    const heavyGain =
      unitCombatSide(heavy, heavy.units.get('u')!, { attacking: true, challengeScore: 1 })
        .effective /
      unitCombatSide(heavy, heavy.units.get('u')!, { attacking: true }).effective;

    expect(lightGain).toBeGreaterThan(heavyGain);
  });
});

describe('damage curve', () => {
  it('is clamped at both ends, so every fight costs something', () => {
    expect(damageFrom(1, 1000)).toBe(MIN_DAMAGE);
    expect(damageFrom(1000, 1)).toBe(MAX_DAMAGE);
  });

  it('rises with the strength ratio', () => {
    expect(damageFrom(30, 20)).toBeGreaterThan(damageFrom(20, 20));
    expect(damageFrom(20, 30)).toBeLessThan(damageFrom(20, 20));
  });

  it('is an even fight at equal strength', () => {
    expect(damageFrom(25, 25)).toBe(30);
  });

  it('always returns a whole number in range', () => {
    const rng = createRng('damage', 'fuzz');
    for (let i = 0; i < 2000; i++) {
      const value = damageFrom(rng.float(1, 90), rng.float(1, 90), rng.float(0.9, 1.1));
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(MIN_DAMAGE);
      expect(value).toBeLessThanOrEqual(MAX_DAMAGE);
    }
  });
});

describe('attack legality', () => {
  it('refuses civilians', () => {
    const { state, a, b } = duelGround();
    let s = place(state, 'civ', 'architect', a, PLAYER_FACTION_ID);
    s = place(s, 'foe', 'pipelineRunner', b, ENEMY);
    const check = canAttack(s, 'civ', b);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toContain('Civilians');
  });

  it('refuses an empty tile', () => {
    const { state, a, b } = duelGround();
    const s = place(state, 'me', 'pipelineRunner', a, PLAYER_FACTION_ID);
    expect(canAttack(s, 'me', b).ok).toBe(false);
  });

  it('refuses your own unit', () => {
    const { state, a, b } = duelGround();
    let s = place(state, 'me', 'pipelineRunner', a, PLAYER_FACTION_ID);
    s = place(s, 'friend', 'pipelineRunner', b, PLAYER_FACTION_ID);
    const check = canAttack(s, 'me', b);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toContain('own unit');
  });

  it('refuses a unit that has already acted', () => {
    const { state, a, b } = duelGround();
    let s = place(state, 'me', 'pipelineRunner', a, PLAYER_FACTION_ID, { movesLeft: 0 });
    s = place(s, 'foe', 'pipelineRunner', b, ENEMY);
    expect(canAttack(s, 'me', b).ok).toBe(false);
  });

  it('lets melee reach one tile and ranged reach further', () => {
    const { state, a, b } = duelGround();
    const far = hexNeighbours(b).find(
      (h) => hexKey(h) !== hexKey(a) && state.map.tiles.has(hexKey(h)),
    )!;

    let melee = place(state, 'me', 'pipelineRunner', a, PLAYER_FACTION_ID);
    melee = place(melee, 'foe', 'pipelineRunner', far, ENEMY);
    expect(canAttack(melee, 'me', far).ok).toBe(false);

    let ranged = place(state, 'me', 'querySlinger', a, PLAYER_FACTION_ID);
    ranged = place(ranged, 'foe', 'pipelineRunner', far, ENEMY);
    expect(unitType('querySlinger').range).toBe(2);
    expect(canAttack(ranged, 'me', far).ok).toBe(true);
  });
});

describe('resolving an attack', () => {
  function duel(
    attackerType: UnitTypeId,
    defenderType: UnitTypeId,
    score = 0,
  ) {
    const { state, a, b } = duelGround();
    let s = place(state, 'me', attackerType, a, PLAYER_FACTION_ID);
    s = place(s, 'foe', defenderType, b, ENEMY);
    const outcome = resolveAttack(s, 'me', b, { challengeScore: score });
    if (!outcome.ok) throw new Error(outcome.reason);
    return outcome.result;
  }

  it('damages both sides in melee', () => {
    const { log } = duel('pipelineRunner', 'pipelineRunner');
    expect(log.damageToDefender).toBeGreaterThan(0);
    expect(log.damageToAttacker).toBeGreaterThan(0);
  });

  it('lets a ranged attacker strike without taking damage back', () => {
    const { log } = duel('querySlinger', 'pipelineRunner');
    expect(log.damageToDefender).toBeGreaterThan(0);
    expect(log.damageToAttacker).toBe(0);
  });

  it('ends the attacker\'s turn', () => {
    const { state } = duel('pipelineRunner', 'pipelineRunner');
    expect(state.units.get('me')!.movesLeft).toBe(0);
  });

  it('a right answer does more damage than a wrong one', () => {
    const right = duel('pipelineRunner', 'pipelineRunner', 1);
    const wrong = duel('pipelineRunner', 'pipelineRunner', -1);
    expect(right.log.damageToDefender).toBeGreaterThan(wrong.log.damageToDefender);
    expect(right.log.damageToAttacker).toBeLessThan(wrong.log.damageToAttacker);
  });

  it('removes a unit that reaches zero hit points', () => {
    const { state, a, b } = duelGround();
    let s = place(state, 'me', 'directLakeTitan', a, PLAYER_FACTION_ID);
    s = place(s, 'foe', 'profiler', b, ENEMY, { hp: 5 });
    const outcome = resolveAttack(s, 'me', b, { challengeScore: 1 });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.log.defenderDestroyed).toBe(true);
    expect(outcome.result.state.units.has('foe')).toBe(false);
  });

  it('advances a melee winner onto the tile, but not a ranged one', () => {
    const { state, a, b } = duelGround();
    let melee = place(state, 'me', 'directLakeTitan', a, PLAYER_FACTION_ID);
    melee = place(melee, 'foe', 'profiler', b, ENEMY, { hp: 1 });
    const meleeOut = resolveAttack(melee, 'me', b, { challengeScore: 1 });
    expect(meleeOut.ok).toBe(true);
    if (!meleeOut.ok) return;
    expect(hexKey(meleeOut.result.state.units.get('me')!.hex)).toBe(hexKey(b));

    let ranged = place(state, 'me', 'querySlinger', a, PLAYER_FACTION_ID);
    ranged = place(ranged, 'foe', 'profiler', b, ENEMY, { hp: 1 });
    const rangedOut = resolveAttack(ranged, 'me', b, { challengeScore: 1 });
    expect(rangedOut.ok).toBe(true);
    if (!rangedOut.ok) return;
    expect(hexKey(rangedOut.result.state.units.get('me')!.hex)).toBe(hexKey(a));
  });

  it('is deterministic for a given state', () => {
    const first = duel('pipelineRunner', 'rlsSentinel', 0.6);
    const second = duel('pipelineRunner', 'rlsSentinel', 0.6);
    expect(first.log).toEqual(second.log);
  });

  it('never mutates the state it was given', () => {
    const { state, a, b } = duelGround();
    let s = place(state, 'me', 'pipelineRunner', a, PLAYER_FACTION_ID);
    s = place(s, 'foe', 'pipelineRunner', b, ENEMY);
    const before = s.units.get('foe')!.hp;
    resolveAttack(s, 'me', b);
    expect(s.units.get('foe')!.hp).toBe(before);
  });

  it('matches the preview it showed the player', () => {
    // The odds displayed must be the odds fought. A preview computed by a
    // second implementation is a preview that will eventually lie.
    const { state, a, b } = duelGround();
    let s = place(state, 'me', 'pipelineRunner', a, PLAYER_FACTION_ID);
    s = place(s, 'foe', 'rlsSentinel', b, ENEMY);

    const preview = previewAttack(s, 'me', b, { challengeScore: 0.6 })!;
    const outcome = resolveAttack(s, 'me', b, {
      challengeScore: 0.6,
      rng: { ...createRng('x', 'y'), float: () => 1 },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.log.damageToDefender).toBe(preview.expectedDamageToDefender);
    expect(outcome.result.log.damageToAttacker).toBe(preview.expectedDamageToAttacker);
  });
});

describe('attacking cities', () => {
  it('damages the city without capturing it while it stands', () => {
    const { state, cityHex, attackHex } = citySetup();
    const s = place(state, 'me', 'pipelineRunner', attackHex, PLAYER_FACTION_ID);
    const outcome = resolveAttack(s, 'me', cityHex);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.log.targetKind).toBe('city');
    expect(outcome.result.log.cityCaptured).toBe(false);
    const city = [...outcome.result.state.cities.values()][0]!;
    expect(city.hp).toBeLessThan(200);
    expect(city.factionId).toBe(ENEMY);
  });

  it('does not hurt the attacker, since walls do not counterattack', () => {
    const { state, cityHex, attackHex } = citySetup();
    const s = place(state, 'me', 'pipelineRunner', attackHex, PLAYER_FACTION_ID);
    const outcome = resolveAttack(s, 'me', cityHex);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.log.damageToAttacker).toBe(0);
  });

  it('gives siege units their bonus against walls', () => {
    const { state, cityHex, attackHex } = citySetup();
    const siege = place(state, 'me', 'notebookCannon', attackHex, PLAYER_FACTION_ID);
    const melee = place(state, 'me', 'pipelineRunner', attackHex, PLAYER_FACTION_ID);
    const siegePreview = previewAttack(siege, 'me', cityHex)!;
    const meleePreview = previewAttack(melee, 'me', cityHex)!;
    // The cannon is only 25 strength to a Runner's 20, so a large gap here
    // can only come from the siege bonus.
    expect(siegePreview.expectedDamageToDefender).toBeGreaterThan(
      meleePreview.expectedDamageToDefender * 1.3,
    );
  });

  it('a melee unit captures a broken city, a ranged one cannot', () => {
    const { state, cityHex, attackHex } = citySetup();
    const cities = new Map(state.cities);
    for (const [id, city] of cities) cities.set(id, { ...city, hp: 1 });
    const weakened = { ...state, cities };

    const melee = place(weakened, 'me', 'directLakeTitan', attackHex, PLAYER_FACTION_ID);
    const meleeOut = resolveAttack(melee, 'me', cityHex);
    expect(meleeOut.ok).toBe(true);
    if (!meleeOut.ok) return;
    expect(meleeOut.result.log.cityCaptured).toBe(true);
    expect([...meleeOut.result.state.cities.values()][0]!.factionId).toBe(
      PLAYER_FACTION_ID,
    );

    const ranged = place(weakened, 'me', 'querySlinger', attackHex, PLAYER_FACTION_ID);
    const rangedOut = resolveAttack(ranged, 'me', cityHex);
    expect(rangedOut.ok).toBe(true);
    if (!rangedOut.ok) return;
    expect(rangedOut.result.log.cityCaptured).toBe(false);
    expect([...rangedOut.result.state.cities.values()][0]!.factionId).toBe(ENEMY);
  });

  it('a lone melee unit cannot flatten a capital in a couple of hits', () => {
    // Cities must be a campaign objective, not a speed bump.
    const { state, cityHex, attackHex } = citySetup();
    const s = place(state, 'me', 'pipelineRunner', attackHex, PLAYER_FACTION_ID);
    const preview = previewAttack(s, 'me', cityHex)!;
    const city = [...s.cities.values()][0]!;
    const hitsNeeded = city.hp / preview.expectedDamageToDefender;
    expect(hitsNeeded).toBeGreaterThan(5);
  });

  it('scores city defence from its size', () => {
    const { state } = citySetup();
    const city = [...state.cities.values()][0]!;
    const small = cityCombatSide(state, city);
    const large = cityCombatSide(state, { ...city, population: 8 });
    expect(large.effective).toBeGreaterThan(small.effective);
  });

  it('a battered city defends worse than a fresh one', () => {
    /*
     * An earlier version compared the city's hit points to themselves, so the
     * factor was always 1 and a city on its last hit point held the walls as
     * well as an untouched one. Sieges made no visible progress until the
     * instant they succeeded.
     */
    const { state } = citySetup();
    const city = [...state.cities.values()][0]!;
    const fresh = cityCombatSide(state, city);
    const battered = cityCombatSide(state, { ...city, hp: 10 });
    expect(battered.effective).toBeLessThan(fresh.effective);
  });

  it('a siege gets easier as it goes on', () => {
    const { state, cityHex, attackHex } = citySetup();
    // Deliberately a melee unit: a siege unit's damage is near the cap, and a
    // clamped number cannot demonstrate a gradient.
    const s = place(state, 'me', 'pipelineRunner', attackHex, PLAYER_FACTION_ID);
    const atFull = previewAttack(s, 'me', cityHex)!;

    const cities = new Map(s.cities);
    for (const [id, city] of cities) cities.set(id, { ...city, hp: 40 });
    const atLow = previewAttack({ ...s, cities }, 'me', cityHex)!;

    expect(atLow.expectedDamageToDefender).toBeGreaterThan(
      atFull.expectedDamageToDefender,
    );
  });
});

describe('defending', () => {
  it('the defender can answer too, which is how raids work', () => {
    // When an antagonist attacks, it is the player who is defending and
    // therefore the player who is questioned.
    const { state, a, b } = duelGround();
    let s = place(state, 'raider', 'pipelineRunner', a, ENEMY);
    s = place(s, 'me', 'pipelineRunner', b, PLAYER_FACTION_ID);
    const raiding = { ...s, activeFactionId: ENEMY };

    const defendedWell = previewAttack(raiding, 'raider', b, {
      defenderChallengeScore: 1,
    })!;
    const defendedBadly = previewAttack(raiding, 'raider', b, {
      defenderChallengeScore: -1,
    })!;

    expect(defendedWell.expectedDamageToDefender).toBeLessThan(
      defendedBadly.expectedDamageToDefender,
    );
    expect(defendedWell.expectedDamageToAttacker).toBeGreaterThan(
      defendedBadly.expectedDamageToAttacker,
    );
  });

  it('a city under siege can be defended by answering', () => {
    const { state, cityHex, attackHex } = citySetup();
    const s = place(state, 'me', 'pipelineRunner', attackHex, PLAYER_FACTION_ID);
    const undefended = previewAttack(s, 'me', cityHex, {})!;
    const defended = previewAttack(s, 'me', cityHex, {
      defenderChallengeScore: 1,
    })!;
    expect(defended.expectedDamageToDefender).toBeLessThan(
      undefended.expectedDamageToDefender,
    );
  });
});

describe('challenge provider', () => {
  it('the null provider always returns neutral', async () => {
    const provider = new NullChallengeProvider();
    const outcome = await provider.present({
      kind: 'battle',
      topicId: 'anything',
      tier: 2,
      timeLimitMs: 20_000,
    });
    expect(outcome).toEqual(NEUTRAL_OUTCOME);
    expect(provider.dueTopics(Date.now())).toEqual([]);
  });

  it('the null provider still supplies a usable tech tree', () => {
    // Without this the standalone game has nothing to research, which would
    // make the whole boundary claim hollow.
    const graph = new NullChallengeProvider().topics();
    expect(graph.nodes.length).toBeGreaterThan(5);
    expect(validateTopicGraph(graph)).toEqual([]);
  });

  it('the generic graph names no subject matter', () => {
    // It exists to prove the engine needs no learning layer, so anything
    // certification-flavoured here would defeat the point.
    const text = JSON.stringify(GENERIC_TOPIC_GRAPH).toLowerCase();
    for (const word of ['dp-600', 'fabric', 'lakehouse', 'semantic', 'dax']) {
      expect(text).not.toContain(word);
    }
  });

  it('the scripted provider returns its script in order, then neutral', async () => {
    const provider = new ScriptedChallengeProvider([
      { score: 1, elapsedMs: 500, abandoned: false },
      { score: -1, elapsedMs: 20_000, abandoned: true },
    ]);
    const request = {
      kind: 'battle' as const,
      topicId: 't',
      tier: 1 as const,
      timeLimitMs: 20_000,
    };

    expect((await provider.present(request)).score).toBe(1);
    expect((await provider.present(request)).score).toBe(-1);
    expect(await provider.present(request)).toEqual(NEUTRAL_OUTCOME);
    expect(provider.seen).toHaveLength(3);
    expect(provider.remaining).toBe(0);
  });
});

describe('topic graph validation', () => {
  it('accepts the generic graph', () => {
    expect(validateTopicGraph(GENERIC_TOPIC_GRAPH)).toEqual([]);
  });

  it('reports a missing prerequisite', () => {
    const graph: TopicGraph = {
      nodes: [{ id: 'a', label: 'A', cluster: 'x', requires: ['ghost'], weight: 1 }],
    };
    expect(validateTopicGraph(graph)[0]).toContain('unknown topic ghost');
  });

  it('reports a cycle rather than hanging', () => {
    const graph: TopicGraph = {
      nodes: [
        { id: 'a', label: 'A', cluster: 'x', requires: ['b'], weight: 1 },
        { id: 'b', label: 'B', cluster: 'x', requires: ['a'], weight: 1 },
      ],
    };
    expect(validateTopicGraph(graph).some((p) => p.includes('Cycle'))).toBe(true);
  });

  it('reports duplicates and bad weights', () => {
    const graph: TopicGraph = {
      nodes: [
        { id: 'a', label: 'A', cluster: 'x', requires: [], weight: 0 },
        { id: 'a', label: 'A again', cluster: 'x', requires: [], weight: 1 },
      ],
    };
    const problems = validateTopicGraph(graph);
    expect(problems.some((p) => p.includes('Duplicate'))).toBe(true);
    expect(problems.some((p) => p.includes('non-positive'))).toBe(true);
  });

  it('opens with the roots and unlocks as topics are learned', () => {
    const start = availableTopics(GENERIC_TOPIC_GRAPH, new Set());
    expect(start.map((n) => n.id)).toEqual(['foundations']);

    const next = availableTopics(GENERIC_TOPIC_GRAPH, new Set(['foundations']));
    expect(next.map((n) => n.id).sort()).toEqual(['masonry', 'survey']);
  });

  it('every topic is eventually reachable from nothing', () => {
    // A node no player can ever reach is content that does not exist.
    const known = new Set<string>();
    for (let i = 0; i < GENERIC_TOPIC_GRAPH.nodes.length + 1; i++) {
      for (const node of availableTopics(GENERIC_TOPIC_GRAPH, known)) {
        known.add(node.id);
      }
    }
    expect(known.size).toBe(GENERIC_TOPIC_GRAPH.nodes.length);
  });
});

describe('attacking a unit that has dug in', () => {
  /*
   * ⚠️ **A second lever, and not the same as the defence bonus.**
   *
   * Raising the defender's strength only reduces what the defender takes.
   * Lowering the ATTACKER's strength does that too AND raises what the
   * attacker takes back, because the counterblow divides the same two numbers
   * the other way round. Measured on even matchups, against the dug-in bonus
   * alone: damage dealt went from -38% to -52%, and damage taken from +64% to
   * +112%.
   */
  function fight(fortified: boolean) {
    const { state, a, b } = duelGround();
    const withAttacker = place(state, 'att', 'pipelineRunner', a, 'silo-horde');
    const ready = place(withAttacker, 'def', 'profiler', b, PLAYER_FACTION_ID, { fortified });
    return previewAttack({ ...ready, activeFactionId: 'silo-horde' }, 'att', b)!;
  }

  it('blunts the blow, on the ATTACKER rather than the defender', () => {
    const open = fight(false);
    const dug = fight(true);
    expect(dug.attacker.dugInPenalty).toBeGreaterThan(0);
    expect(open.attacker.dugInPenalty).toBe(0);
    expect(dug.attacker.effective).toBeLessThan(open.attacker.effective);
  });

  it('⚠️ makes the counterblow hurt more, not just the blow hurt less', () => {
    // The whole reason this is not simply a larger FORTIFY_DEFENCE_BONUS.
    const open = fight(false);
    const dug = fight(true);
    expect(dug.expectedDamageToDefender).toBeLessThan(open.expectedDamageToDefender);
    expect(dug.expectedDamageToAttacker).toBeGreaterThan(open.expectedDamageToAttacker);
  });

  it('⚠️ leaves weight still winning, so digging in is not the answer to everything', () => {
    // A proper soldier must still be able to break a dug-in scout, or the only
    // move in the game becomes fortify and wait.
    const dug = fight(true);
    expect(dug.expectedDamageToDefender).toBeGreaterThan(dug.expectedDamageToAttacker);
  });

  it('⚠️ fights the odds it showed', () => {
    /*
     * The penalty is folded into `attacker.effective` precisely so that
     * `resolveAttack`, which recomputes damage from that field, cannot use a
     * different number. This file has already caught that split twice.
     */
    const { state, a, b } = duelGround();
    const withAttacker = place(state, 'att', 'pipelineRunner', a, 'silo-horde');
    const ready = place(withAttacker, 'def', 'profiler', b, PLAYER_FACTION_ID, {
      fortified: true,
    });
    const fighting = { ...ready, activeFactionId: 'silo-horde' };
    const preview = previewAttack(fighting, 'att', b)!;
    // The roll is pinned to 1 so the only thing that can differ between the
    // two numbers is the arithmetic, which is what is under test.
    const outcome = resolveAttack(fighting, 'att', b, {
      rng: { ...createRng('dug', 'in'), float: () => 1 },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.log.damageToDefender).toBe(preview.expectedDamageToDefender);
    expect(outcome.result.log.damageToAttacker).toBe(preview.expectedDamageToAttacker);
  });
});
