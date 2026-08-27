/**
 * Taking cover in a city.
 *
 * ⚠️ **This began as a feature request and turned out to be a trap.** A unit
 * could always walk into its own city, so nothing was blocked; what happened
 * once it arrived was the problem. `previewAttack` chooses the defender by
 * asking whether a unit is standing on the tile, so a garrison REPLACED the
 * city rather than reinforcing it, and the walls took no part at all.
 *
 * Measured on a size-one city before any of this was fixed:
 *
 * | | defence | damage taken per blow |
 * | --- | --- | --- |
 * | empty | 32.5 | 14 |
 * | with a Profiler inside | 15.0 | **46** |
 * | siege engine, empty | | 47 |
 * | siege engine, garrisoned | | **100**, the cap |
 *
 * Putting a soldier in your own city more than tripled the damage it took and
 * let a siege engine max out. The player had no way of knowing, and the
 * obvious instinct, "get the scout indoors before the raid", was the worst
 * move available.
 */

import { describe, expect, it } from 'vitest';
import {
  PLAYER_FACTION_ID,
  createGameState,
  foundCity,
  previewAttack,
  resolveAttack,
  unitCombatSide,
  unitsOf,
  type City,
  type GameState,
  type Unit,
  type UnitTypeId,
} from '../src/index.js';

/** A city of the player's, founded where the Architect starts. */
function withCity(): { state: GameState; city: City } {
  const start = createGameState('FABRIC');
  const architect = unitsOf(start, PLAYER_FACTION_ID).find((u) => u.typeId === 'architect')!;
  const founded = foundCity(start, architect.id);
  if (!founded.ok) throw new Error(founded.reason);
  const city = [...founded.state.cities.values()].find(
    (c) => c.factionId === PLAYER_FACTION_ID,
  )!;
  return { state: founded.state, city };
}

/** Put an attacker of the given kind on a tile next to the city. */
function withAttacker(
  state: GameState,
  city: City,
  typeId: UnitTypeId,
  id = 'attacker',
): { state: GameState; id: string } {
  const enemy = [...state.units.values()].find((u) => u.factionId !== PLAYER_FACTION_ID)!;
  const units = new Map(state.units);
  units.set(id, {
    ...enemy,
    id,
    typeId,
    hex: { q: city.hex.q + 1, r: city.hex.r },
    hp: 100,
    movesLeft: 3,
    fortified: false,
  });
  return { state: { ...state, units, activeFactionId: enemy.factionId }, id };
}

/** Move a unit of the player's onto the city tile. */
function garrison(state: GameState, city: City, unit: Unit): GameState {
  const units = new Map(state.units);
  units.set(unit.id, { ...unit, hex: city.hex });
  return { ...state, units };
}

const profilerOf = (state: GameState) =>
  unitsOf(state, PLAYER_FACTION_ID).find((u) => u.typeId === 'profiler')!;

describe('cover in a city', () => {
  it('gives a defending unit the settlement and its walls', () => {
    const { state, city } = withCity();
    const scout = profilerOf(state);

    const open = unitCombatSide(state, scout, { attacking: false });
    const inside = unitCombatSide(garrison(state, city, scout), { ...scout, hex: city.hex }, {
      attacking: false,
    });

    expect(open.garrisonBonus).toBe(0);
    expect(inside.garrisonBonus).toBeGreaterThan(0);
    expect(inside.effective).toBeGreaterThan(open.effective);
  });

  it('⚠️ is not cover when the city belongs to somebody else', () => {
    /*
     * A unit that has fought its way onto an enemy tile is standing somewhere
     * whose walls are being held against it. The check is on the faction, not
     * merely on a city being present, and that is easy to write the other way.
     */
    const { state } = withCity();
    const scout = profilerOf(state);
    const enemyCity = [...state.cities.values()].find(
      (c) => c.factionId !== PLAYER_FACTION_ID,
    )!;

    const inside = unitCombatSide(state, { ...scout, hex: enemyCity.hex }, {
      attacking: false,
    });
    expect(inside.garrisonBonus).toBe(0);
  });

  it('does not help a unit attacking OUT of its own city', () => {
    const { state, city } = withCity();
    const scout = profilerOf(state);
    const side = unitCombatSide(state, { ...scout, hex: city.hex }, { attacking: true });
    expect(side.garrisonBonus).toBe(0);
  });

  it('⚠️ never makes the city easier to take than leaving it empty', () => {
    /*
     * The trap, stated as itself and as a number. This is the assertion that
     * would have caught the original behaviour, where a garrison took 46
     * damage a blow on a city that took 14 standing empty.
     */
    const { state, city } = withCity();
    const empty = withAttacker(state, city, 'pipelineRunner');
    const held = withAttacker(garrison(state, city, profilerOf(state)), city, 'pipelineRunner');

    const bare = previewAttack(empty.state, empty.id, city.hex)!;
    const covered = previewAttack(held.state, held.id, city.hex)!;

    expect(bare.targetKind).toBe('city');
    expect(covered.targetKind).toBe('unit');
    expect(
      covered.defender.effective,
      'a garrison must man the walls, not replace the people on them',
    ).toBeGreaterThanOrEqual(bare.defender.effective);
    expect(covered.expectedDamageToDefender).toBeLessThanOrEqual(
      bare.expectedDamageToDefender,
    );
  });

  it('⚠️ leaves a siege engine its bonus against a garrison', () => {
    /*
     * Otherwise the cheapest counter to a siege train is one scout parked in
     * the gateway: the bonus is written against `targetKind === 'city'`, and a
     * unit on the tile makes that false. What the bonus is really asking is
     * whether there is a wall in the way.
     */
    const { state, city } = withCity();
    const held = withAttacker(garrison(state, city, profilerOf(state)), city, 'notebookCannon');
    const preview = previewAttack(held.state, held.id, city.hex)!;

    expect(preview.targetKind).toBe('unit');
    expect(preview.againstWalls, 'a defended city is still a city').toBe(true);
  });

  it('⚠️ fights the odds it showed, against a garrison too', () => {
    /*
     * `resolveAttack` recomputes damage rather than reading it off the
     * preview, and it used to decide "is this a city" for itself. Garrisoning
     * gave that condition a second clause, which is exactly the kind of thing
     * that gets added in one place: the siege multiplier is 1.75, so a split
     * would show the player nearly twice the damage they actually dealt.
     */
    const { state, city } = withCity();
    const held = withAttacker(garrison(state, city, profilerOf(state)), city, 'notebookCannon');
    const preview = previewAttack(held.state, held.id, city.hex)!;
    const outcome = resolveAttack(held.state, held.id, city.hex);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // The only thing between them is a roll of 0.9 to 1.1.
    const ratio = outcome.result.log.damageToDefender / preview.expectedDamageToDefender;
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.15);
  });

  it('counts walls as part of the cover', () => {
    const { state, city } = withCity();
    const scout = profilerOf(state);

    const walled: City = { ...city, wallLevel: 2, wallHp: 100, wallMaxHp: 100 } as City;
    const cities = new Map(state.cities);
    cities.set(city.id, walled);
    const fortified = garrison({ ...state, cities }, walled, scout);

    const plain = unitCombatSide(garrison(state, city, scout), { ...scout, hex: city.hex }, {
      attacking: false,
    });
    const behindWalls = unitCombatSide(fortified, { ...scout, hex: city.hex }, {
      attacking: false,
    });

    expect(behindWalls.garrisonBonus).toBeGreaterThan(plain.garrisonBonus);
  });
});
