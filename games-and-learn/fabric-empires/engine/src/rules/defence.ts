/**
 * How you meet an attack.
 *
 * Section 19.4 and D143: "today the defender is a number; in Stronghold the
 * defender is the more interesting side to play". Attacking a city has been a
 * decision since section 59, with three tactics and a dialog. Defending was
 * still one question and then arithmetic, so half of every siege was a
 * spectator sport.
 *
 * Three stances, and the choice is real because each loses something:
 *
 *   Hold    stand behind what you built. Exactly what defending already was,
 *           kept as the default so no existing balance moves.
 *   Sally   open the gates. The fortification counts for nothing, and the
 *           garrison hits back far harder than it otherwise could. The answer
 *           to a weakened besieger you want gone rather than survived.
 *   Brace   everything into cover. Much harder to hurt, and you do not hit
 *           back at all. The answer to a blow you only need to outlast.
 *
 * ⚠️ **The interesting number is `fortifyShare`, not `strength`.** A stance
 * that was only "tougher" would collapse into "always pick the toughest".
 * What makes sally worth choosing is that it throws away the wall you paid
 * for, and what makes brace expensive is that a defender who never counters
 * can never end a siege, only postpone it.
 *
 * ⚠️ **"Wait it out" from 19.4 is deliberately absent.** It spends population
 * and yield while attrition works on both sides, and attrition needs the
 * multi-turn siege state of 19.5 step 2, which carries its own cut trigger and
 * was cut. A stance that silently did nothing would be worse than three that
 * do something, so it is not offered rather than offered and hollow.
 */

export type DefenceStance = 'hold' | 'sally' | 'brace';

export interface StanceProfile {
  readonly id: DefenceStance;
  /** Multiplier on the defender's effective strength. */
  readonly strength: number;
  /**
   * How much of the defender's fortification still counts.
   *
   * Walls for a city, dug-in position for a unit. Terrain is deliberately not
   * scaled: leaving the gate does not move the hill you are standing on.
   */
  readonly fortifyShare: number;
  /** Multiplier on the damage the defender sends back. */
  readonly counter: number;
  /**
   * The least a *city* counters, whatever the attacker's tactic.
   *
   * ⚠️ **Without this, sallying from a city would do nothing at all.** Cities
   * counter only when the attacker chose escalade, so a stance that merely
   * multiplied the existing counter would multiply zero in every other case
   * and the option would read as broken. A garrison that comes out through the
   * gate is fighting whether or not the besieger brought ladders, so this is a
   * floor rather than a factor. It is the same reasoning that gives escalade
   * its `cityCounter`, seen from the other side of the wall.
   */
  readonly counterFloor: number;
}

export const STANCES: Readonly<Record<DefenceStance, StanceProfile>> = Object.freeze({
  hold: Object.freeze({
    id: 'hold', strength: 1, fortifyShare: 1, counter: 1, counterFloor: 0,
  }),
  /*
   * The gamble.
   *
   * ⚠️ **`strength` is below 1 on purpose, and the first draft had it above.**
   * Written as 1.3 it made the defender harder to hurt at the same time as it
   * made them hit harder, so sallying cancelled its own risk: measured against
   * a full wall it cost 12 more damage and returned 56, and `chooseStance`
   * picked it in every single situation it was offered. A stance the AI always
   * takes is not a choice, it is a default with extra steps.
   *
   * Below 1 it says the true thing: you left a prepared position and you are
   * standing in the open. That cost does not depend on owning a wall, which
   * matters, because otherwise sallying would be strictly free for every
   * unwalled defender in the game.
   */
  sally: Object.freeze({
    id: 'sally', strength: 0.85, fortifyShare: 0, counter: 1.8, counterFloor: 1,
  }),
  /*
   * The stall. Cheap, safe, and it cannot win: a braced defender takes far
   * less and returns nothing, so the siege ends when the attacker decides it
   * ends. Survival is not victory, and this stance is the difference.
   *
   * ⚠️ **The toughness is in `strength`, not only in `fortifyShare`.** With the
   * bonus living entirely in the fortification multiplier, bracing did nothing
   * whatever for a defender without a wall, and the accompanying strength
   * penalty then made it strictly worse than holding: measured at 100 damage
   * taken against holding's 98. A stance that is never worth picking is a
   * lie in a menu.
   */
  brace: Object.freeze({
    id: 'brace', strength: 1.35, fortifyShare: 1.6, counter: 0, counterFloor: 0,
  }),
});

export const DEFAULT_STANCE: DefenceStance = 'hold';

export function stanceProfile(stance: DefenceStance = DEFAULT_STANCE): StanceProfile {
  return STANCES[stance] ?? STANCES[DEFAULT_STANCE];
}

/** Every stance, in the order they should be offered. */
export const DEFENCE_STANCES: readonly DefenceStance[] = ['hold', 'sally', 'brace'];

/**
 * The share of a full counterattack this defender lands.
 *
 * `tacticCityCounter` is what the attacker's approach already allowed, and is
 * irrelevant to a unit, which always counters a melee attacker.
 */
export function counterShare(
  profile: StanceProfile,
  targetKind: 'unit' | 'city',
  tacticCityCounter: number,
): number {
  if (targetKind === 'unit') return profile.counter;
  return profile.counter * Math.max(tacticCityCounter, profile.counterFloor);
}
