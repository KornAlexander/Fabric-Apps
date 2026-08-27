/**
 * Seats: who is playing which empire, and what it costs to sit down.
 *
 * A faction is a seat. `control: 'ai'` means nobody is holding it and the
 * machine is keeping it warm; `'human'` means a person is. That is the whole
 * multiplayer model, and it is deliberately not a second concept living beside
 * the factions:
 *
 * ⚠️ **A fact maintained in two places drifts.** A parallel `seats` map keyed
 * by faction id would have to agree with `factions` about who exists, forever,
 * and the first disagreement would be a seat you can join that has no empire
 * or an empire nobody can reach.
 *
 * ## Joining a game already in progress
 *
 * The point of keeping the AI in the chair is that there is something to join.
 * An empire that has been fighting for thirty turns has cities, an army and a
 * position, and taking it over is a change of driver. That is why `standing`
 * exists: choosing a seat is a real decision and it needs the numbers to make
 * it on, measured against the seats that are already taken rather than in the
 * abstract.
 */

import { NO_MEMORY, type Faction, type FactionMemory } from '../entities/index.js';
import { unitType } from '../entities/index.js';
import type { GameState } from '../state/gameState.js';

/**
 * How an empire is doing, for somebody deciding whether to take it.
 *
 * ⚠️ Every field is a plain count except `share` and `band`, which are the two
 * that answer the question actually being asked. "Four cities" means nothing
 * on its own; "four cities while the biggest empire in the game has nine"
 * means quite a lot, and a joiner is choosing between seats rather than
 * appraising one.
 */
export interface Standing {
  readonly factionId: string;
  readonly label: string;
  readonly colour: string;
  readonly control: Faction['control'];
  readonly cities: number;
  readonly units: number;
  /** Total population across its towns, which is what actually grows. */
  readonly population: number;
  /**
   * Fighting weight: every unit's remaining health times its strength.
   *
   * ⚠️ Health rather than headcount. Six units at a tenth each is not an army,
   * and a joiner who picked that seat on a unit count would sit down into a
   * rout with no warning.
   */
  readonly strength: number;
  /**
   * This empire's share of everything on the board, 0..1.
   *
   * The denominator is EVERY faction, not just the taken ones, so the number
   * does not jump when somebody else joins or leaves.
   */
  readonly share: number;
  readonly band: StandingBand;
}

/**
 * The one-word version.
 *
 * ⚠️ Cut against the share of the board rather than against fixed counts. A
 * fixed threshold would call everybody "struggling" on turn three, when in
 * fact everybody is equal and the game has not started.
 */
export type StandingBand = 'commanding' | 'holding' | 'struggling';

const weightOf = (state: GameState, factionId: string): number => {
  let total = 0;
  for (const unit of state.units.values()) {
    if (unit.factionId !== factionId) continue;
    total += unit.hp * unitType(unit.typeId).strength;
  }
  return total;
};

/**
 * Where every empire stands, strongest first.
 *
 * Sorted so the join screen can show the board without deciding an order of
 * its own, and so "vs the current active ones" is answerable by looking at the
 * list rather than by doing arithmetic in the interface.
 */
export function standings(state: GameState): Standing[] {
  const rows = [...state.factions.values()].map((faction) => {
    const cities = [...state.cities.values()].filter((c) => c.factionId === faction.id);
    const units = [...state.units.values()].filter((u) => u.factionId === faction.id);
    return {
      factionId: faction.id,
      label: faction.label,
      colour: faction.colour,
      control: faction.control,
      cities: cities.length,
      units: units.length,
      population: cities.reduce((sum, c) => sum + c.population, 0),
      strength: weightOf(state, faction.id),
    };
  });

  /*
   * One number to rank on.
   *
   * Towns are weighted hardest because a town is the thing you can lose the
   * game without, and an army with nowhere to come home to is a raiding party
   * rather than an empire.
   */
  const scoreOf = (r: (typeof rows)[number]): number =>
    r.cities * 100 + r.population * 12 + r.strength / 20;

  const total = rows.reduce((sum, r) => sum + scoreOf(r), 0);

  return rows
    .map((r) => {
      const share = total > 0 ? scoreOf(r) / total : 0;
      const even = rows.length > 0 ? 1 / rows.length : 0;
      /*
       * ⚠️ Banded against an EVEN share, not against the leader. Measuring
       * against the leader would call every single faction "struggling" in a
       * game with one runaway winner, which is true of nobody except by
       * comparison and tells a joiner nothing about which chair to pick.
       */
      const band: StandingBand =
        share >= even * 1.35 ? 'commanding' : share >= even * 0.6 ? 'holding' : 'struggling';
      return { ...r, share, band };
    })
    .sort((a, b) => b.share - a.share);
}

/**
 * Sit down in an empty seat.
 *
 * ⚠️ **The new arrival starts blind.** They inherit the empire, not the
 * scouting: the memory begins empty rather than being handed whatever the
 * machine would have known, because the machine does not use fog at all and
 * has no memory to hand over. Inventing one from the AI's omniscience would
 * gift a joiner the whole map, which is both a cheat and the opposite of what
 * the fog is for.
 *
 * Returns the state unchanged when the seat is unknown or already taken, so a
 * stale join button costs a click rather than an exception, and two people
 * racing for the same chair cannot both end up in it.
 */
export function takeSeat(state: GameState, factionId: string): GameState {
  const faction = state.factions.get(factionId);
  if (!faction || faction.control === 'human') return state;

  const factions = new Map(state.factions);
  factions.set(factionId, { ...faction, control: 'human' });

  const memory = new Map<string, FactionMemory>(state.memory);
  memory.set(factionId, NO_MEMORY);

  return { ...state, factions, memory };
}

/**
 * Stand up, and let the machine have the chair back.
 *
 * ⚠️ **The memory is dropped with the seat.** Keeping it would mean a player
 * could take a seat, look, leave, and have somebody else inherit their
 * scouting; and it would keep a set of several thousand hex keys alive in
 * every save for a person who is no longer in the game.
 *
 * The empire itself is untouched. That is the point of handing it to the AI
 * rather than freezing it: a seat is never idle, so nobody waits on a player
 * who closed the tab, and an empire you come back to has been living without
 * you.
 */
export function vacateSeat(state: GameState, factionId: string): GameState {
  const faction = state.factions.get(factionId);
  if (!faction || faction.control === 'ai') return state;

  const factions = new Map(state.factions);
  factions.set(factionId, { ...faction, control: 'ai' });

  const memory = new Map(state.memory);
  memory.delete(factionId);

  return { ...state, factions, memory };
}
