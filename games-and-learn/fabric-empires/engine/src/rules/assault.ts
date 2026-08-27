/**
 * How you go at a wall.
 *
 * Section 19.3 wants an assault to be a decision rather than a repeated click.
 * Until now every attack on a city was the same attack, so a wall was a number
 * that made the number smaller and nothing about the fight changed.
 *
 * Three tactics, and the choice is real because each is best against a
 * different city:
 *
 *   Batter    everything at the wall. No risk, no shortcut. What an attack
 *             already was, kept as the default so nothing silently changes.
 *   Escalade  over the top. Most of the blow bypasses the wall entirely and
 *             lands on the city, at the cost of a much harder counter. The
 *             answer to a fortress you cannot afford to demolish.
 *   Sap       under it. The best wall-breaker in the game and almost nothing
 *             else: once the wall is down it is a poor way to take a city.
 *
 * ⚠️ **`wallShare` is the interesting number, not `strength`.** A tactic that
 * was only "more damage" would collapse into "pick the biggest one". What makes
 * escalade worth choosing is that it does not care how tall the wall is, and
 * what makes sap worth choosing is that it does.
 */

export type AssaultTactic = 'batter' | 'escalade' | 'sap';

export interface TacticProfile {
  readonly id: AssaultTactic;
  /**
   * Fraction of the blow the wall is allowed to absorb.
   *
   * The remainder goes past it to the city. At 1 the wall soaks everything it
   * can, which is what happened before tactics existed, so `batter` is exactly
   * the old behaviour and no existing balance moves.
   */
  readonly wallShare: number;
  /** Multiplier on the attacker's effective strength while a wall stands. */
  readonly strength: number;
  /**
   * Multiplier once there is no wall left to work on.
   *
   * ⚠️ **Sap needed this, or its own description was a lie.** With a single
   * strength number a sapper's large bonus kept applying after the breach was
   * open, which made `sap` the best tactic in every situation and the other two
   * decoration. The card says "almost no use once the breach is open"; this is
   * what makes that true. Nothing changes for the other two, because neither of
   * them was ever about the masonry.
   */
  readonly strengthOpen: number;
  /**
   * How much of a full counterattack the attacker takes back from the city.
   *
   * ⚠️ **Cities do not counterattack at all by default**, which is why this is
   * a share of nothing for two of the three tactics. That default is right for
   * bombardment: you cannot be hurt by a wall you are knocking down from a
   * distance. It is wrong for men on ladders, and escalade is the tactic that
   * puts them there. So this is not a discount on an existing cost, it is the
   * only tactic that has one.
   */
  readonly cityCounter: number;
}

export const TACTICS: Readonly<Record<AssaultTactic, TacticProfile>> = Object.freeze({
  batter: Object.freeze({
    id: 'batter', wallShare: 1, strength: 1, strengthOpen: 1, cityCounter: 0,
  }),
  /*
   * Costly on purpose. Escalade is the tactic that ignores the thing the
   * defender paid for, so it has to hurt: it takes a full counter, exactly as
   * though the city were a unit fighting back, while every other way of
   * attacking a city is free.
   */
  escalade: Object.freeze({
    id: 'escalade', wallShare: 0.2, strength: 0.85, strengthOpen: 0.85, cityCounter: 1,
  }),
  /*
   * Sappers are not stormtroopers. The bonus is spent entirely on masonry, and
   * once the masonry is gone they are a worse choice than walking in.
   */
  sap: Object.freeze({
    id: 'sap', wallShare: 1, strength: 1.55, strengthOpen: 0.7, cityCounter: 0,
  }),
});

/** The strength multiplier that applies to this city right now. */
export function tacticStrength(profile: TacticProfile, wallStanding: boolean): number {
  return wallStanding ? profile.strength : profile.strengthOpen;
}

export const DEFAULT_TACTIC: AssaultTactic = 'batter';

export function tacticProfile(tactic: AssaultTactic = DEFAULT_TACTIC): TacticProfile {
  return TACTICS[tactic] ?? TACTICS[DEFAULT_TACTIC];
}

/** Every tactic, in the order they should be offered. */
export const ASSAULT_TACTICS: readonly AssaultTactic[] = ['batter', 'escalade', 'sap'];
