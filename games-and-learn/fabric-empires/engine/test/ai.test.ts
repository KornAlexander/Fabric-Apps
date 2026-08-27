import { describe, it, expect } from 'vitest';
import {
  ANTAGONIST_FACTION_ID,
  ANTAGONISTS,
  BASE_AGGRO_RADIUS,
  MIN_CAMP_SEPARATION,
  PLAYER_FACTION_ID,
  aggroRadius,
  cityAt,
  createGameState,
  endTurn,
  hexDistance,
  hexKey,
  hexNeighbours,
  planFactionTurn,
  planUnitAction,
  reachable,
  runFactionTurn,
  terrain,
  unitAt,
  unitType,
  unitsOf,
  type GameState,
  type Hex,
  type UnitTypeId,
} from '../src/index.js';

/**
 * The opponent.
 *
 * ⚠️ **The point of this file is that the antagonist actually does something.**
 * Adding the AI broke none of the 521 tests that existed before it, which is
 * either very good news or a sign that nothing exercises it. Almost every
 * assertion below is therefore about observable movement or damage, not about
 * the shape of a returned object: a planner that returns a tidy empty list on
 * every turn would satisfy a type check and leave the map as dead as it was.
 */

function place(
  state: GameState,
  id: string,
  typeId: UnitTypeId,
  hex: Hex,
  factionId: string,
  overrides: Partial<{ hp: number; movesLeft: number }> = {},
): GameState {
  const units = new Map(state.units);
  units.set(id, {
    id,
    typeId,
    factionId,
    hex,
    hp: overrides.hp ?? unitType(typeId).maxHp,
    movesLeft: overrides.movesLeft ?? unitType(typeId).movement,
    fortified: false,
  });
  return { ...state, units };
}

/**
 * A neighbouring tile a unit can actually stand on.
 *
 * ⚠️ Asserted rather than `!`-ed. The first version used a terrain predicate
 * that is not on the terrain record at all, so `find` returned undefined,
 * `!` waved it through, and four tests failed deep inside `hexDistance` with
 * an error that said nothing about the real cause.
 */
function walkableNeighbour(state: GameState, from: Hex): Hex {
  const hex = hexNeighbours(from).find((h) => {
    const tile = state.map.tiles.get(hexKey(h));
    return tile !== undefined && terrain(tile.terrain).settleable;
  });
  expect(hex, 'the start position should have a walkable neighbour').toBeDefined();
  return hex!;
}

/** One antagonist raider standing next to one player unit, and nothing else. */
function raidSetup(seed = 'FABRIC') {
  const base = createGameState(seed);
  const playerHex = unitsOf(base, PLAYER_FACTION_ID)[0]!.hex;
  const enemyHex = walkableNeighbour(base, playerHex);
  let state: GameState = { ...base, units: new Map() };
  state = place(state, 'p1', 'profiler', playerHex, PLAYER_FACTION_ID);
  state = place(state, 'e1', 'pipelineRunner', enemyHex, ANTAGONIST_FACTION_ID);
  return { state, playerHex, enemyHex };
}

function nearestEnemyDistance(state: GameState): number {
  const mine = unitsOf(state, PLAYER_FACTION_ID);
  const theirs = unitsOf(state, ANTAGONIST_FACTION_ID);
  let best = Number.POSITIVE_INFINITY;
  for (const a of mine) {
    for (const b of theirs) best = Math.min(best, hexDistance(a.hex, b.hex));
  }
  return best;
}

describe('the seven antagonists', () => {
  it('all take the field, one per cluster of the outline', () => {
    const state = createGameState('FABRIC');
    expect(ANTAGONISTS).toHaveLength(7);

    for (const antagonist of ANTAGONISTS) {
      const faction = state.factions.get(antagonist.id);
      expect(faction, `${antagonist.id} should exist`).toBeDefined();
      expect(unitsOf(state, antagonist.id).length).toBeGreaterThan(0);
    }

    // The clusters are the reason there are seven of them. Duplicates would
    // mean a branch of the exam that never sends anyone.
    const clusters = ANTAGONISTS.map((a) => a.topicCluster);
    expect(new Set(clusters).size).toBe(7);
    expect([...clusters].sort()).toEqual(['A1', 'A2', 'B1', 'B2', 'B3', 'C1', 'C2']);
    expect(new Set(ANTAGONISTS.map((a) => a.colour)).size).toBe(7);
  });

  it('camps them apart rather than in one heap', () => {
    for (const seed of ['FABRIC', 'CONTOSO', 'DP600']) {
      const state = createGameState(seed);
      const camps = ANTAGONISTS.map((a) => unitsOf(state, a.id)[0]?.hex).filter(
        (h): h is NonNullable<typeof h> => h !== undefined,
      );
      expect(camps.length).toBe(7);

      for (let i = 0; i < camps.length; i++) {
        for (let j = i + 1; j < camps.length; j++) {
          /*
           * ⚠️ Without a separation rule the greedy pick takes the seven
           * nearest wastes tiles, which are usually neighbours, and all seven
           * factions spawn as a single doom-stack on one side of the map.
           */
          expect(
            hexDistance(camps[i]!, camps[j]!),
            `${seed}: camps ${i} and ${j} are on top of each other`,
          ).toBeGreaterThanOrEqual(MIN_CAMP_SEPARATION - 2);
        }
      }
    }
  });

  it('starts every camp beyond the opening leash', () => {
    /*
     * ⚠️ The invariant that actually broke when the map grew.
     *
     * The leash became proportional to the map radius and the minimum spawn
     * distance stayed absolute at 7, so on a radius-45 map the leash opened
     * at 9 and camps were spawning *inside* it. Seed DP600 raided the player
     * on turn 4 and wiped them out on turn 5.
     *
     * Asserting the ordering directly is the point. Comparing against a bare
     * `BASE_AGGRO_RADIUS` passed happily through that entire bug, because 12
     * is greater than 5 and neither number was the one that mattered.
     */
    for (const seed of ['FABRIC', 'CONTOSO', 'DP600', 'HORDE', 'LAKEHOUSE']) {
      const state = createGameState(seed);
      const opening = aggroRadius(1, state.map.radius);
      expect(opening).toBeGreaterThanOrEqual(BASE_AGGRO_RADIUS);

      const mine = unitsOf(state, PLAYER_FACTION_ID);
      for (const antagonist of ANTAGONISTS) {
        for (const raider of unitsOf(state, antagonist.id)) {
          const closest = Math.min(...mine.map((m) => hexDistance(raider.hex, m.hex)));
          expect(closest, `${seed}: ${antagonist.id} spawned inside the leash`).toBeGreaterThan(
            opening,
          );
        }
      }
    }
  });

  it('never fights the other antagonists', () => {
    /*
     * ⚠️ The bug this exists to prevent, which is what the seven factions
     * did on their first run: `targetsFor` returned everything not their own,
     * so they spent the opening turns deleting each other. The first raid
     * landed on turn 2 of every seed and the player was not in it.
     *
     * These are seven misconceptions besieging a learner, not seven nations
     * with interests.
     */
    let state = createGameState('FABRIC');
    const enemyIds = new Set(ANTAGONISTS.map((a) => a.id));
    let raids = 0;

    for (let i = 0; i < 25; i++) {
      const before = state;
      const turn = endTurn(state);
      state = turn.state;
      for (const event of turn.report.enemyEvents) {
        if (event.intent.kind !== 'raid') continue;
        raids++;
        const victim =
          unitAt(before, event.intent.target) ?? cityAt(before, event.intent.target);
        // Whatever was struck, it was not another antagonist.
        expect(victim === undefined || !enemyIds.has(victim.factionId)).toBe(true);
      }
    }
    expect(raids).toBeGreaterThan(0);
  });
});

describe('the antagonist acts at all', () => {
  /*
   * ⚠️ These bounds are measured, not chosen. Across the seeds below the horde
   * first moves on turn 7 to 16 and lands its first raid on turn 9 to 20, and
   * a player who never does anything is wiped out between turn 11 and 22.
   * A passive player losing is correct; losing on turn six while still
   * reading the interface was not, which is why the leash exists.
   */
  const SEEDS = ['FABRIC', 'CONTOSO', 'LAKEHOUSE', 'DP600', 'HORDE'];

  it('leaves a new empire alone while it finds its feet', () => {
    // FABRIC starts them 10 hexes away, well outside the opening leash of 5.
    let state = createGameState('FABRIC');
    for (let i = 0; i < 5; i++) {
      const turn = endTurn(state);
      expect(turn.report.enemyEvents).toEqual([]);
      state = turn.state;
    }
  });

  it('comes for the player eventually, on every seed', () => {
    for (const seed of SEEDS) {
      let state = createGameState(seed);
      let raided = false;
      // 35, not 25: the map is 3.2 times the area and the far camps start
      // further out, so the opening is measurably longer. Measured first raid
      // across these seeds is turn 11 to 26.
      for (let i = 0; i < 35 && !raided; i++) {
        const turn = endTurn(state);
        state = turn.state;
        raided = turn.report.enemyEvents.some((e) => e.intent.kind === 'raid');
      }
      // A leash that never lets go is just scenery with extra steps.
      expect(raided, `${seed} should be raided within 35 turns`).toBe(true);
    }
  });

  it('reports what it did, and none of it is the player', () => {
    let state = createGameState('FABRIC');
    const events = [];
    for (let i = 0; i < 20; i++) {
      const turn = endTurn(state);
      state = turn.state;
      events.push(...turn.report.enemyEvents);
    }
    expect(events.length).toBeGreaterThan(0);
    // Seven factions can appear here now, so the assertion is that the player
    // is not among them rather than that one particular horde is.
    expect(events.every((e) => e.factionId !== PLAYER_FACTION_ID)).toBe(true);
  });

  it('actually closes the distance', () => {
    let state = createGameState('FABRIC');
    const before = nearestEnemyDistance(state);
    let closest = before;
    for (let i = 0; i < 18; i++) {
      state = endTurn(state).state;
      const now = nearestEnemyDistance(state);
      // Once a side is wiped out the distance is Infinity, which is not a
      // measurement. Track the closest they ever got instead.
      if (Number.isFinite(now)) closest = Math.min(closest, now);
    }
    expect(closest).toBeLessThan(before);
  });

  it('keeps acting once engaged, rather than spending its movement once', () => {
    let state = createGameState('HORDE');
    const perTurn: number[] = [];
    for (let i = 0; i < 8; i++) {
      const turn = endTurn(state);
      state = turn.state;
      perTurn.push(turn.report.enemyEvents.length);
    }
    // Refreshing the enemy faction is what makes this pass. Without it the
    // first engaged turn acts and every turn after it is silent.
    expect(perTurn.filter((n) => n > 0).length).toBeGreaterThan(1);
  });

  it('does nothing, and does not throw, in a sandbox with no antagonists', () => {
    const state = createGameState('FABRIC', { spawnAntagonists: false });
    const { report } = endTurn(state);
    expect(report.enemyEvents).toEqual([]);
  });

  it('fights back at once when the player walks up to it, leash or no leash', () => {
    // The grace period must never read as immunity.
    const { state } = raidSetup();
    expect(state.turn).toBe(1);
    const played = runFactionTurn(state, ANTAGONIST_FACTION_ID);
    expect(played.events.some((e) => e.intent.kind === 'raid')).toBe(true);
  });
});

describe('raiding', () => {
  it('attacks an adjacent player unit and hurts it', () => {
    const { state } = raidSetup();
    const before = state.units.get('p1')!.hp;
    const played = runFactionTurn(state, ANTAGONIST_FACTION_ID);

    const raid = played.events.find((e) => e.intent.kind === 'raid');
    expect(raid).toBeDefined();
    expect(raid?.log?.damageToDefender).toBeGreaterThan(0);

    const after = played.state.units.get('p1');
    expect(after === undefined || after.hp < before).toBe(true);
  });

  it('lets the defender answer for themselves', () => {
    const { state, playerHex } = raidSetup();
    const weak = runFactionTurn(state, ANTAGONIST_FACTION_ID, {
      defenderChallengeScore: -1,
      defendAt: playerHex,
    });
    const strong = runFactionTurn(state, ANTAGONIST_FACTION_ID, {
      defenderChallengeScore: 1,
      defendAt: playerHex,
    });

    const hurt = (r: ReturnType<typeof runFactionTurn>) =>
      r.events.find((e) => e.intent.kind === 'raid')?.log?.damageToDefender ?? 0;

    // Knowing the answer is the defence. If these are equal, the score is
    // being accepted and quietly dropped, which is the failure mode that
    // looks exactly like success.
    expect(hurt(strong)).toBeLessThan(hurt(weak));
  });

  it('⚠️ does not spend the answer on a fight the player was never shown', () => {
    /*
     * The score and the stance describe ONE defence: the raid the app put on
     * screen and asked a question about. They used to be handed to the whole
     * enemy phase, so answering about a siege in the north also stiffened a
     * scout being jumped in the south, whose owner saw nothing and chose
     * nothing.
     *
     * Naming a tile nobody is attacking is the cleanest way to state that:
     * the preparation exists, it simply does not belong here.
     */
    const { state, playerHex } = raidSetup();
    const elsewhere = { q: playerHex.q + 9, r: playerHex.r + 9 };

    const hurt = (score: number, at: typeof playerHex) =>
      runFactionTurn(state, ANTAGONIST_FACTION_ID, {
        defenderChallengeScore: score,
        defendAt: at,
      }).events.find((e) => e.intent.kind === 'raid')?.log?.damageToDefender ?? 0;

    // A right answer aimed at the wrong tile buys this defender nothing, and
    // a wrong one costs it nothing either: both equal the unprepared fight.
    const unprepared = hurt(0, elsewhere);
    expect(hurt(1, elsewhere)).toBe(unprepared);
    expect(hurt(-1, elsewhere)).toBe(unprepared);
    // ...and aimed correctly it still works, or the test above proves nothing.
    expect(hurt(1, playerHex)).toBeLessThan(unprepared);
  });

  it('⚠️ treats "no tile named" as nothing prepared, not everything prepared', () => {
    /*
     * The safer default of the two. A caller that forgets to say where loses
     * a bonus it can see is missing; the opposite default is what spread one
     * answer silently across every skirmish on the map.
     */
    const { state, playerHex } = raidSetup();
    const hurt = (options: Parameters<typeof runFactionTurn>[2]) =>
      runFactionTurn(state, ANTAGONIST_FACTION_ID, options).events.find(
        (e) => e.intent.kind === 'raid',
      )?.log?.damageToDefender ?? 0;

    expect(hurt({ defenderChallengeScore: 1 })).toBe(hurt({}));
    expect(hurt({ defenderChallengeScore: 1, defendAt: playerHex })).toBeLessThan(hurt({}));
  });

  it('⚠️ does not let one city\'s stance be adopted by a unit elsewhere', () => {
    const { state, playerHex } = raidSetup();
    const elsewhere = { q: playerHex.q + 9, r: playerHex.r + 9 };
    const hurt = (stance: 'hold' | 'brace', at: typeof playerHex) =>
      runFactionTurn(state, ANTAGONIST_FACTION_ID, {
        defenceStance: stance,
        defendAt: at,
      }).events.find((e) => e.intent.kind === 'raid')?.log?.damageToDefender ?? 0;

    // Bracing is a large, easily measured effect, which is what makes it a
    // good probe: if scoping leaked, this would be visibly softer.
    expect(hurt('brace', elsewhere)).toBe(hurt('hold', elsewhere));
    expect(hurt('brace', playerHex)).toBeLessThan(hurt('hold', playerHex));
  });

  it('does not send civilians into a fight', () => {
    const base = createGameState('FABRIC');
    const playerHex = unitsOf(base, PLAYER_FACTION_ID)[0]!.hex;
    const enemyHex = walkableNeighbour(base, playerHex);
    let state: GameState = { ...base, units: new Map() };
    state = place(state, 'p1', 'profiler', playerHex, PLAYER_FACTION_ID);
    state = place(state, 'e1', 'architect', enemyHex, ANTAGONIST_FACTION_ID);

    const intent = planUnitAction({ ...state, activeFactionId: ANTAGONIST_FACTION_ID }, 'e1');
    expect(intent?.kind).not.toBe('raid');
  });
});

describe('it plays by the same rules as the player', () => {
  it('only ever moves to tiles the movement rules allow', () => {
    let state = createGameState('FABRIC');
    for (let turn = 0; turn < 5; turn++) {
      const before = { ...state, activeFactionId: ANTAGONIST_FACTION_ID };
      for (const intent of planFactionTurn(before, ANTAGONIST_FACTION_ID)) {
        if (intent.kind !== 'move') continue;
        const unit = before.units.get(intent.unitId)!;
        expect(reachable(before, unit).has(hexKey(intent.to))).toBe(true);
      }
      state = endTurn(state).state;
    }
  });

  it('hands the turn back to the player', () => {
    const state = createGameState('FABRIC');
    const played = runFactionTurn(state, ANTAGONIST_FACTION_ID);
    expect(played.state.activeFactionId).toBe(PLAYER_FACTION_ID);
    expect(endTurn(state).state.activeFactionId).toBe(PLAYER_FACTION_ID);
  });

  it('cannot touch the player\'s units', () => {
    const state = createGameState('FABRIC');
    const before = unitsOf(state, PLAYER_FACTION_ID).map((u) => hexKey(u.hex));
    const played = runFactionTurn(state, ANTAGONIST_FACTION_ID);
    const after = unitsOf(played.state, PLAYER_FACTION_ID).map((u) => hexKey(u.hex));
    expect(after).toEqual(before);
  });
});

describe('determinism', () => {
  /** Every enemy action of a game, as comparable text. */
  function trace(seed: string, turns = 20): string[] {
    let state = createGameState(seed);
    const out: string[] = [];
    for (let i = 0; i < turns; i++) {
      const turn = endTurn(state);
      state = turn.state;
      for (const e of turn.report.enemyEvents) {
        out.push(
          e.intent.kind === 'move'
            ? `${e.unitId} move ${hexKey(e.intent.to)}`
            : `${e.unitId} raid ${hexKey(e.intent.target)} ${e.log?.damageToDefender ?? 0}`,
        );
      }
    }
    return out;
  }

  it('plays an identical game from an identical seed', () => {
    // Seed sharing (D39) is only meaningful if the opponent is part of what
    // the seed decides. Twenty turns, because the leash keeps the first few
    // deliberately empty and an empty list proves nothing.
    expect(trace('FABRIC')).toEqual(trace('FABRIC'));
    expect(trace('FABRIC').length).toBeGreaterThan(0);
  });

  it('plays a different game from a different seed', () => {
    expect(trace('FABRIC')).not.toEqual(trace('CONTOSO'));
  });
});

