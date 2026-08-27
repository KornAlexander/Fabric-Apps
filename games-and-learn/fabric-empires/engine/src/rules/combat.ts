/**
 * Combat.
 *
 * Strength and hit points decide fights; the challenge outcome applies a large
 * modifier on top. The intended feel: early on, when base strengths are small,
 * knowing the answer is close to decisive. Later, a well-built army survives a
 * wrong answer. The engine itself never learns what the question was.
 */

import { hexDistance, hexKey, type Hex } from '../hex/index.js';
import { terrain } from '../map/index.js';
import { createRng, type Rng } from '../rng/index.js';
import { isCivilian, cityKind, unitType, type City, type Unit } from '../entities/index.js';
import { cityAt, tileAt, unitAt, type GameState } from '../state/index.js';
import { absorbWithWalls, isBreached, wallDefenceBonus } from './walls.js';
import { DEFAULT_TACTIC, tacticProfile, tacticStrength, type AssaultTactic } from './assault.js';
import { counterShare, stanceProfile, type DefenceStance } from './defence.js';
import { grantFoothold, razeCityAt } from './sack.js';
import type { ResourceId } from '../map/index.js';

/**
 * Strength swing between a perfect answer and a wrong one.
 *
 * At +/-18 against base strengths of 8 to 60, the total swing of 36 is
 * decisive for a Profiler and merely important for a Direct Lake Titan.
 */
export const CHALLENGE_STRENGTH_SWING = 18;

/** Fortifying trades movement for staying power. */
export const FORTIFY_DEFENCE_BONUS = 0.4;

/**
 * How much weaker an attack is when it lands on a unit that has dug in.
 *
 * ⚠️ **A different lever from `FORTIFY_DEFENCE_BONUS`, on purpose.** Raising
 * the defender's strength only reduces the damage the defender takes. Lowering
 * the ATTACKER's strength does that too, and it also raises what the attacker
 * takes back, because the counterblow divides the same two numbers the other
 * way round. Charging a prepared position should hurt the person charging, not
 * merely fail to hurt the person waiting.
 *
 * Measured on even matchups, against the dug-in bonus alone:
 *
 * | | damage dealt to the defender | damage the attacker takes back |
 * | --- | --- | --- |
 * | dug in, defence bonus only | −38% | +64% |
 * | dug in, and this penalty too | **−52%** | **+112%** |
 *
 * Small on purpose. Fortifying already pays 40 percent on defence and costs
 * only the remainder of one turn, so this is meant to tip an exchange rather
 * than decide it. The check that it has not gone too far is that a proper
 * soldier can still break a dug-in scout: a Pipeline Runner attacking a
 * fortified Profiler deals 40 and takes 22, so weight still wins.
 */
export const FORTIFY_ATTACK_PENALTY = 0.15;

/**
 * What share of its full hit points a dug-in unit recovers each turn.
 *
 * ⚠️ **Nothing in the game healed a unit before this.** Cities repaired their
 * walls and grew their own hit points back through rank, but a wounded unit
 * stayed wounded for the rest of the game. Since `hpFactor` scales strength by
 * health, one bad fight permanently devalued a unit, and the only cure was to
 * lose it and build another. That is a strange thing to teach.
 *
 * Expressed as a share of `maxHp` rather than a flat number, so a Direct Lake
 * Titan does not take five times as long to recover as a Profiler does. At
 * 0.12 a unit on its last legs is fit again in eight quiet turns, which is
 * long enough that retreating to heal is a real cost.
 */
export const FORTIFY_HEAL_SHARE = 0.12;

/**
 * What a unit gains by standing inside a friendly city.
 *
 * ⚠️ **Taking cover in a city used to do nothing whatsoever.** A unit could
 * always walk into its own city, and once there defended with exactly the
 * terrain and dug-in bonuses it would have had standing in the open field
 * beside it. There was no rule that noticed the walls it was standing behind.
 *
 * Worse than nothing, in fact. `previewAttack` picks the defender by asking
 * whether a unit is on the tile, so garrisoning REPLACED the city as the
 * defender: an attacker who would have faced a city defending at 20 plus six
 * per citizen instead faced a Profiler at strength 8, with the walls taking no
 * part at all. Putting a unit in a city made the city easier to take.
 *
 * Two numbers, because a city is two things. The base is the settlement
 * itself: buildings, streets and people to fight from, which every city has
 * from the day it is founded. On top of that the garrison inherits whatever
 * the walls are worth, damage included, through `wallDefenceBonus`.
 */
export const GARRISON_DEFENCE_BONUS = 0.5;

/**
 * Siege units are built to break cities and little else.
 *
 * Held at 0.75 rather than a full doubling: at 1.0 a Notebook Cannon was
 * already hitting the damage cap against an untouched city, which meant a
 * siege could not get easier as the walls came down, and the cap hid the
 * difference between a good assault and a terrible one.
 */
export const SIEGE_CITY_BONUS = 0.75;

export const MIN_DAMAGE = 10;
export const MAX_DAMAGE = 100;

export type CombatTargetKind = 'unit' | 'city';

export interface CombatSide {
  readonly baseStrength: number;
  readonly hpFactor: number;
  readonly terrainBonus: number;
  readonly fortifyBonus: number;
  /** The settlement and its walls, when this unit is defending inside one. */
  readonly garrisonBonus: number;
  /**
   * How much this side's blow is blunted by a defender that has dug in.
   *
   * ⚠️ Only ever non-zero on the ATTACKER. It is a property of what is being
   * hit rather than of who is hitting, which is why it cannot be computed by
   * `unitCombatSide`: that function is handed one unit and never learns what
   * is on the other tile.
   */
  readonly dugInPenalty: number;
  readonly techBonus: number;
  readonly challengeModifier: number;
  readonly effective: number;
}

export interface CombatPreview {
  readonly attacker: CombatSide;
  readonly defender: CombatSide;
  readonly targetKind: CombatTargetKind;
  /**
   * Whether this blow lands against a city's defences.
   *
   * ⚠️ **Not the same question as `targetKind`.** A unit garrisoning its own
   * city is a `unit` target standing behind walls, and both the siege bonus
   * and the assault tactics care about the walls rather than about who is on
   * the tile. Published here so `resolveAttack` cannot answer it differently
   * from the preview: that split has already happened once, and it showed the
   * player 33 damage and then dealt 17.
   */
  readonly againstWalls: boolean;
  /** Damage before the random roll, so the UI can show honest odds. */
  readonly expectedDamageToDefender: number;
  readonly expectedDamageToAttacker: number;
  readonly ranged: boolean;
}

export interface CombatLog {
  readonly attackerId: string;
  readonly defenderId: string;
  readonly targetKind: CombatTargetKind;
  readonly damageToDefender: number;
  readonly damageToAttacker: number;
  readonly defenderDestroyed: boolean;
  readonly attackerDestroyed: boolean;
  readonly cityCaptured: boolean;
  /** The walls came down and the attacker chose to burn it instead. */
  readonly cityRazed: boolean;
  /** Who held the city, so the log can name what was taken from whom. */
  readonly cityFormerFactionId?: string;
  /** Plunder carried off by a razing. */
  readonly loot?: Partial<Record<ResourceId, number>>;
  /**
   * Topic opened by capturing a city from a faction that quizzes on it.
   *
   * ⚠️ This is the reason to capture rather than raze, and the only one that
   * matters: loot is spent, a cluster is learned.
   */
  readonly clusterOpened?: string;
  readonly challengeScore: number;
  /**
   * How the blow was actually struck and met.
   *
   * ⚠️ **Reported rather than assumed, for the same reason
   * `ChallengeOutcome.topicId` is.** The presentation stages the tactic and
   * the stance literally now, and both are defaulted inside this function: an
   * AI attack picks its tactic in `chooseTactic`, and an omitted stance
   * becomes `hold`. A caller that re-derived them would eventually draw a
   * siege that did not match the one the numbers came from, and nothing would
   * say so.
   */
  readonly tactic: AssaultTactic;
  readonly stance: DefenceStance;
  /**
   * This blow took the wall past the breach threshold.
   *
   * Distinct from `cityCaptured`: a wall can come down turns before the town
   * falls, and the collapse is worth showing on the blow that caused it.
   */
  readonly wallBroken: boolean;
}

export type AttackCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * Convert a challenge score in -1..+1 into a strength modifier.
 * Linear on purpose: a player should be able to feel the relationship.
 */
export function challengeModifier(score: number): number {
  const clamped = Math.min(1, Math.max(-1, score));
  return clamped * CHALLENGE_STRENGTH_SWING;
}

function hpFactor(hp: number, maxHp: number): number {
  // A wounded unit hits softer, but never falls below half strength, so a
  // damaged unit is still worth committing rather than being written off.
  return 0.5 + 0.5 * (Math.max(0, hp) / maxHp);
}

export interface SideOptions {
  readonly challengeScore?: number;
  readonly techBonus?: number;
  readonly attacking?: boolean;
  /**
   * How this side is meeting the attack.
   *
   * Ignored when attacking. Defaults to `hold`, which is a no-op on every
   * number here, so an omitted stance fights exactly the fight this function
   * fought before stances existed.
   */
  readonly stance?: DefenceStance;
}

export function unitCombatSide(
  state: GameState,
  unit: Unit,
  options: SideOptions = {},
): CombatSide {
  const type = unitType(unit.typeId);
  const tile = tileAt(state, unit.hex);
  // Terrain and fortification protect a defender; they do not help an attack.
  const defending = options.attacking !== true;
  const stance = stanceProfile(defending ? options.stance : 'hold');
  const terrainBonus = defending && tile ? terrain(tile.terrain).defenceBonus : 0;
  // ⚠️ The stance scales the dug-in bonus, not the ground. Coming out to fight
  // gives up the position you prepared; it does not flatten the hill.
  const fortifyBonus =
    defending && unit.fortified ? FORTIFY_DEFENCE_BONUS * stance.fortifyShare : 0;
  /*
   * Cover, when the unit is standing in a city of its own.
   *
   * ⚠️ **A city belonging to somebody else is not cover.** The check is on the
   * faction, not merely on a city being present: a unit that has just fought
   * its way onto an enemy tile is standing in a place whose walls are being
   * held against it.
   *
   * ⚠️ Scaled by the stance like the dug-in bonus, and for the same reason. A
   * garrison that sallies out to meet the attacker in the open has given up
   * the walls; the walls did not fall down.
   */
  const city = defending ? cityAt(state, unit.hex) : undefined;
  const ownCity = city && city.factionId === unit.factionId ? city : undefined;
  const garrisonBonus = ownCity
    ? (GARRISON_DEFENCE_BONUS + wallDefenceBonus(ownCity)) * stance.fortifyShare
    : 0;
  const techBonus = options.techBonus ?? 0;
  const modifier = challengeModifier(options.challengeScore ?? 0);

  const factor = hpFactor(unit.hp, type.maxHp);
  const effective =
    (type.strength *
      factor *
      (1 + terrainBonus) *
      (1 + fortifyBonus) *
      (1 + garrisonBonus) *
      (1 + techBonus) +
      modifier) *
    stance.strength;

  /*
   * ⚠️ **A garrison never defends worse than the empty city would have.**
   *
   * The bonus above is not enough on its own, and the measurement says so
   * loudly. `previewAttack` picks the defender by asking whether a unit is on
   * the tile, so a garrison REPLACES the city rather than reinforcing it. On a
   * size-one city: empty it defended at 32.5 and took 14 damage a blow, and
   * with a Profiler inside it defended at 15.0 and took 46. A siege engine
   * went from 47 damage to the cap at 100.
   *
   * Putting a soldier in your own city more than tripled the damage it took.
   * That is a trap the player cannot see and would never guess, and no bonus
   * on a strength-8 scout closes a gap against 20 plus six per citizen.
   *
   * So the city's own defence is a FLOOR. The reading is that the garrison
   * mans the walls rather than replacing the people on them: the attacker
   * still has to chew through the unit first, and the unit is not a hole in
   * the wall while they do it.
   */
  const manned = ownCity
    ? Math.max(
        effective,
        cityCombatSide(state, ownCity, {
          challengeScore: options.challengeScore ?? 0,
          // ⚠️ Spread rather than `stance: options.stance`. Under
          // `exactOptionalPropertyTypes` an explicit undefined is not the same
          // as an absent key, and passing one would refuse the default.
          ...(options.stance ? { stance: options.stance } : {}),
        }).effective,
      )
    : effective;

  return {
    baseStrength: type.strength,
    hpFactor: factor,
    terrainBonus,
    fortifyBonus,
    garrisonBonus,
    // Filled in by `previewAttack`, which is the only place that knows both
    // sides of the fight.
    dugInPenalty: 0,
    techBonus,
    challengeModifier: modifier,
    // A negative effective strength is meaningless and would invert the
    // damage curve, so the floor is 1 rather than 0.
    effective: Math.max(1, manned),
  };
}

export function cityCombatSide(
  state: GameState,
  city: City,
  options: SideOptions = {},
): CombatSide {
  const tile = tileAt(state, city.hex);
  const terrainBonus = tile ? terrain(tile.terrain).defenceBonus : 0;
  // A city defends with its walls and its size rather than a unit's strength.
  // Pitched so that a lone melee unit cannot realistically take a capital and
  // a siege unit still needs several turns: at the first tuning a size-one
  // city defended at strength 16 against a siege unit at 50.
  const baseStrength = 20 + city.population * 6;
  // Measured against the kind's full hit points, not its current ones. An
  // earlier version compared the city to itself, so hpFactor was always 1 and
  // a city on its last hit point defended as well as an untouched one, which
  // made a siege pointless right up until the moment it succeeded.
  const factor = hpFactor(city.hp, cityKind(city.kind).baseHp);
  const modifier = challengeModifier(options.challengeScore ?? 0);
  // Walls sit in `fortifyBonus` because that is what they are: a defensive
  // work rather than a property of the ground. Scaled by how much of the wall
  // is still standing, so battering it down actually helps the besieger, and
  // then by the stance, because a garrison that comes out through the gate has
  // chosen to stop standing behind it.
  const stance = stanceProfile(options.stance);
  const wallBonus = wallDefenceBonus(city) * stance.fortifyShare;

  return {
    baseStrength,
    hpFactor: factor,
    terrainBonus,
    fortifyBonus: wallBonus,
    // A city IS the settlement; it does not additionally take cover in one.
    // The number exists on both sides so callers never have to ask which kind
    // of defender they are looking at before reading a field.
    garrisonBonus: 0,
    // A city never attacks, so this is never anything else.
    dugInPenalty: 0,
    techBonus: 0,
    challengeModifier: modifier,
    effective: Math.max(
      1,
      (baseStrength * factor * (1 + terrainBonus + wallBonus) + modifier) * stance.strength,
    ),
  };
}

/**
 * Damage curve.
 *
 * A power curve on the strength ratio, so a small advantage matters and a
 * large one is decisive without ever being an instant kill: clamped to
 * 10..100, every fight costs the winner something.
 *
 * ⚠️ **`floorScale` exists because the floor was erasing the tactic system.**
 *
 * `MIN_DAMAGE` guarantees a fight makes progress. Flattening every weak blow to
 * the same 10 also flattened away *how* it was struck: a Profiler sapping a
 * wall and a Profiler battering it both clamped to 10, so the assault prompt
 * asked the player a question whose answer could not matter until they fielded
 * a much heavier unit. Measured four separate times before it was believed.
 *
 * The floor is a floor on **effort**, and a technique changes what that effort
 * achieves, so the technique scales the floor too. Passing 1 leaves every
 * existing caller exactly where it was.
 */
export function damageFrom(
  attackerEffective: number,
  defenderEffective: number,
  roll = 1,
  floorScale = 1,
): number {
  const ratio = attackerEffective / defenderEffective;
  const raw = 30 * Math.pow(ratio, 1.5) * roll;
  const floor = MIN_DAMAGE * Math.max(0, floorScale);
  return Math.round(Math.min(MAX_DAMAGE, Math.max(floor, raw)));
}

/** Whether the attacker may strike the given hex at all. */
export function canAttack(
  state: GameState,
  attackerId: string,
  target: Hex,
): AttackCheck {
  const attacker = state.units.get(attackerId);
  if (!attacker) return { ok: false, reason: 'No such unit' };
  if (attacker.factionId !== state.activeFactionId) {
    return { ok: false, reason: 'Not your unit' };
  }
  if (isCivilian(attacker.typeId)) {
    return { ok: false, reason: 'Civilians cannot attack' };
  }
  if (attacker.movesLeft <= 0) {
    return { ok: false, reason: 'This unit has already acted' };
  }
  if (!state.map.tiles.has(hexKey(target))) {
    return { ok: false, reason: 'Off the map' };
  }

  const defendingUnit = unitAt(state, target);
  const defendingCity = cityAt(state, target);
  if (!defendingUnit && !defendingCity) {
    return { ok: false, reason: 'Nothing to attack there' };
  }
  if (defendingUnit && defendingUnit.factionId === attacker.factionId) {
    return { ok: false, reason: 'That is your own unit' };
  }
  if (!defendingUnit && defendingCity?.factionId === attacker.factionId) {
    return { ok: false, reason: 'That is your own city' };
  }

  const type = unitType(attacker.typeId);
  const distance = hexDistance(attacker.hex, target);
  const reach = Math.max(1, type.range);
  if (distance > reach) {
    return { ok: false, reason: 'Out of reach' };
  }

  return { ok: true };
}

export interface AttackOptions {
  /** Challenge result in -1..+1 for the attacker. Zero means none was asked. */
  readonly challengeScore?: number;
  /**
   * Challenge result for the defender.
   *
   * When an antagonist raids the player, it is the player who is defending and
   * therefore the player who answers. Without this the API could only ever
   * express a battle where the aggressor is the one being tested.
   */
  readonly defenderChallengeScore?: number;
  readonly techBonus?: number;
  readonly rng?: Rng;
  /**
   * What to do with the city if this blow brings it down.
   *
   * Defaults to capture, which is what the game did before there was a choice,
   * so every existing caller and save keeps its old behaviour.
   */
  readonly cityOutcome?: 'capture' | 'raze';
  /**
   * How the attacker goes at a walled city.
   *
   * Ignored against units and against an unwalled city, because there is no
   * wall to go over, under or through. Defaults to `batter`, which is exactly
   * what an attack did before tactics existed.
   */
  readonly tactic?: AssaultTactic;
  /**
   * How the defender meets it.
   *
   * Defaults to `hold`, which is a no-op on every number, so every existing
   * caller and every replay fights the fight it fought before.
   */
  readonly defenceStance?: DefenceStance;
}

/**
 * The numbers a player should see before committing, with no randomness.
 * Preview and resolution share every calculation, so the odds shown are the
 * odds fought.
 */
export function previewAttack(
  state: GameState,
  attackerId: string,
  target: Hex,
  options: AttackOptions = {},
): CombatPreview | undefined {
  const attacker = state.units.get(attackerId);
  if (!attacker) return undefined;
  const check = canAttack(state, attackerId, target);
  if (!check.ok) return undefined;

  const type = unitType(attacker.typeId);
  const ranged = type.range > 0;
  const defendingUnit = unitAt(state, target);
  const targetKind: CombatTargetKind = defendingUnit ? 'unit' : 'city';

  const openAttack = unitCombatSide(state, attacker, {
    ...options,
    attacking: true,
  });

  /*
   * ⚠️ **The penalty is folded into the attacker's effective strength, not
   * carried alongside it as another multiplier.**
   *
   * `resolveAttack` recomputes the damage from `preview.attacker.effective`,
   * so anything expressed as a separate factor has to be remembered in two
   * places. That has gone wrong twice already in this file: the tactic split
   * the preview from the resolution once, and `againstWalls` nearly did it
   * again. A number baked into `effective` cannot be forgotten by the second
   * caller, because there is nothing left for it to forget.
   *
   * Charging a prepared position also costs the attacker more, and that falls
   * out for free: the counterblow divides the same two numbers the other way
   * round, so a weaker attacker takes a heavier answer.
   */
  const dugIn = defendingUnit?.fortified === true;
  const attackerSide: CombatSide = dugIn
    ? {
        ...openAttack,
        dugInPenalty: FORTIFY_ATTACK_PENALTY,
        // The same floor `unitCombatSide` applies: a non-positive strength
        // would invert the damage curve rather than weaken the blow.
        effective: Math.max(1, openAttack.effective * (1 - FORTIFY_ATTACK_PENALTY)),
      }
    : openAttack;

  let defenderSide: CombatSide;
  if (defendingUnit) {
    defenderSide = unitCombatSide(state, defendingUnit, {
      techBonus: 0,
      attacking: false,
      challengeScore: options.defenderChallengeScore ?? 0,
      stance: options.defenceStance ?? 'hold',
    });
  } else {
    defenderSide = cityCombatSide(state, cityAt(state, target)!, {
      challengeScore: options.defenderChallengeScore ?? 0,
      stance: options.defenceStance ?? 'hold',
    });
  }

  /*
   * ⚠️ **A siege engine answers walls, whoever is standing behind them.**
   *
   * This asked `targetKind === 'city'`, which is only true when the tile is
   * EMPTY of units. Now that a garrison inherits the city's walls, that test
   * would have made a single unit inside a city cancel the siege bonus
   * outright: the cheapest possible counter to a Notebook Cannon would be to
   * park one Profiler in the gateway.
   *
   * The question a siege bonus is really asking is "is there a wall in the
   * way", so that is what it asks. The same reasoning gives the attacker the
   * tactic choice, since over, under and through are all still available
   * against a defended city.
   */
  const walledCity = cityAt(state, target);
  const againstWalls =
    walledCity !== undefined &&
    (targetKind === 'city' || walledCity.factionId === defendingUnit?.factionId);

  const siegeMultiplier = againstWalls && type.role === 'siege' ? 1 + SIEGE_CITY_BONUS : 1;
  // Tactics only exist against a city. Against a unit in the open there is no
  // wall to go over, under or through, so the profile is never consulted.
  const tactic = againstWalls ? tacticProfile(options.tactic) : tacticProfile('batter');
  // Sap is a bonus against masonry, not against people. Once the breach is
  // open it is the worst way in, which is what its own description promises.
  const wallStanding = againstWalls && (walledCity?.wallHp ?? 0) > 0;
  const tacticStrengthNow = tacticStrength(tactic, wallStanding);

  return {
    attacker: attackerSide,
    defender: defenderSide,
    targetKind,
    againstWalls,
    ranged,
    expectedDamageToDefender: damageFrom(
      attackerSide.effective * siegeMultiplier * tacticStrengthNow,
      defenderSide.effective,
      1,
      tacticStrengthNow,
    ),
    // A ranged attacker takes nothing back, which is the entire reason to
    // build one. Beyond that the counter is the attacker's tactic and the
    // defender's stance together: a city counters if either the besieger put
    // men on the parapet or the garrison came out to meet them.
    expectedDamageToAttacker: counterDamage(
      ranged,
      targetKind,
      defenderSide.effective,
      attackerSide.effective,
      1,
      tactic.cityCounter,
      options.defenceStance,
    ),
  };
}

/**
 * Return damage, shared by the preview and the resolution.
 *
 * ⚠️ **Shared on purpose.** Section 59 found the preview and the resolution
 * had silently drifted apart once each grew its own copy of the tactic
 * arithmetic: sap previewed 33 damage and resolved for 17. The stance adds a
 * second factor to the same sum, so it is written once and called twice.
 */
function counterDamage(
  ranged: boolean,
  targetKind: CombatTargetKind,
  defenderEffective: number,
  attackerEffective: number,
  roll: number,
  tacticCityCounter: number,
  stance: DefenceStance | undefined,
): number {
  if (ranged) return 0;
  const share = counterShare(stanceProfile(stance), targetKind, tacticCityCounter);
  return Math.round(damageFrom(defenderEffective, attackerEffective, roll) * share);
}

export interface AttackResult {
  readonly state: GameState;
  readonly log: CombatLog;
}

export type AttackOutcome =
  | { readonly ok: true; readonly result: AttackResult }
  | { readonly ok: false; readonly reason: string };

/**
 * Resolve an attack.
 *
 * The random roll is drawn from a stream keyed by the seed, turn, attacker and
 * target, so a replayed game fights identical battles without the caller
 * having to thread an RNG through the UI.
 */
export function resolveAttack(
  state: GameState,
  attackerId: string,
  target: Hex,
  options: AttackOptions = {},
): AttackOutcome {
  const check = canAttack(state, attackerId, target);
  if (!check.ok) return { ok: false, reason: check.reason };

  const preview = previewAttack(state, attackerId, target, options);
  if (!preview) return { ok: false, reason: 'Attack could not be resolved' };

  const attacker = state.units.get(attackerId)!;
  const rng =
    options.rng ??
    createRng(state.seed, `combat:${state.turn}:${attackerId}:${hexKey(target)}`);

  const attackRoll = rng.float(0.9, 1.1);
  const defenceRoll = rng.float(0.9, 1.1);
  const type = unitType(attacker.typeId);
  const siegeMultiplier =
    preview.againstWalls && type.role === 'siege' ? 1 + SIEGE_CITY_BONUS : 1;
  /*
   * ⚠️ **The tactic has to be applied here as well as in the preview.**
   *
   * This function recomputes the damage rather than reading it off the
   * preview, so a factor added to one and not the other silently splits them.
   * Measured when tactics were first wired: `sap` previewed 33 damage and
   * resolved for 17, and `escalade` showed the player a hundred points of
   * counterattack and then charged nothing at all. The comment on
   * `previewAttack` promises "the odds shown are the odds fought", and it was
   * true only because nothing had ever differed between them before.
   *
   * ⚠️ Which is why these read `againstWalls` off the preview rather than
   * recomputing it. Garrisoning gave that condition a second clause, and a
   * second clause is exactly the kind of thing that gets added in one place.
   */
  const tactic = tacticProfile(preview.againstWalls ? options.tactic : 'batter');
  const wallStanding = preview.againstWalls && (cityAt(state, target)?.wallHp ?? 0) > 0;

  const damageToDefender = damageFrom(
    preview.attacker.effective * siegeMultiplier * tacticStrength(tactic, wallStanding),
    preview.defender.effective,
    attackRoll,
    tacticStrength(tactic, wallStanding),
  );
  const damageToAttacker = counterDamage(
    preview.ranged,
    preview.targetKind,
    preview.defender.effective,
    preview.attacker.effective,
    defenceRoll,
    tactic.cityCounter,
    options.defenceStance,
  );

  const units = new Map(state.units);
  const cities = new Map(state.cities);

  const attackerHp = attacker.hp - damageToAttacker;
  const attackerDestroyed = attackerHp <= 0;

  let defenderId: string;
  let defenderDestroyed = false;
  let cityCaptured = false;
  let cityRazed = false;
  let wallBroken = false;
  let razedCityId: string | undefined;
  let cityFormerFactionId: string | undefined;

  if (preview.targetKind === 'unit') {
    const defender = unitAt(state, target)!;
    defenderId = defender.id;
    const defenderHp = defender.hp - damageToDefender;
    defenderDestroyed = defenderHp <= 0;
    if (defenderDestroyed) {
      units.delete(defender.id);
    } else {
      units.set(defender.id, { ...defender, hp: defenderHp });
    }
  } else {
    const city = cityAt(state, target)!;
    defenderId = city.id;
    /*
     * ⚠️ **The walls take it first, and this is what makes a siege a siege.**
     *
     * Until this was wired, nothing in the game ever reduced `wallHp`. Walls
     * changed the odds and then stood forever at full integrity, so
     * `wallDefenceBonus` never decayed and the rule that battering them down
     * helps was unreachable code with passing tests behind it. A tested helper
     * nobody calls is not a feature.
     */
    const { wallHp, toCity } = absorbWithWalls(
      city,
      damageToDefender,
      tacticProfile(options.tactic).wallShare,
    );
    /*
     * Did THIS blow break the wall?
     *
     * ⚠️ Both sides of the comparison go through `isBreached`, rather than
     * comparing hit points to a threshold here. The threshold is a rule that
     * lives in `walls.ts` and has already been changed once; a second copy of
     * it in the presentation path would put the collapse animation on the
     * wrong blow the next time it moves.
     */
    const wasBreached = isBreached(city);
    wallBroken = !wasBreached && isBreached({ ...city, wallHp });
    const cityHp = city.hp - toCity;
    if (cityHp <= 0 && !preview.ranged) {
      // Only a melee unit can walk in and take the city. Bombardment alone
      // never captures anything, which is what keeps siege units support
      // rather than a win button.
      cityFormerFactionId = city.factionId;
      if (options.cityOutcome === 'raze') {
        cityRazed = true;
        razedCityId = city.id;
      } else {
        cityCaptured = true;
        cities.set(city.id, {
          ...city,
          factionId: attacker.factionId,
          hp: Math.round(city.hp * 0.25),
          population: Math.max(1, city.population - 1),
          // The walls were breached to get in. The level stands, so the new
          // owner inherits the earthworks and can mend them, which is what
          // `wallWork`'s repair branch exists for.
          wallHp: 0,
        });
      }
    } else {
      cities.set(city.id, { ...city, hp: Math.max(1, cityHp), wallHp });
    }
  }

  if (attackerDestroyed) {
    units.delete(attacker.id);
  } else {
    const movesLeft = 0; // attacking always ends the unit's turn
    // A razed hex is walked into as well: there is nothing left holding it.
    const nextHex =
      cityCaptured || cityRazed || (defenderDestroyed && !preview.ranged)
        ? target
        : attacker.hex;
    units.set(attacker.id, {
      ...attacker,
      hp: attackerHp,
      movesLeft,
      fortified: false,
      hex: nextHex,
    });
  }

  let next: GameState = { ...state, units, cities };
  let loot: Record<ResourceId, number> | undefined;
  let clusterOpened: string | undefined;

  if (cityRazed && razedCityId) {
    const burned = razeCityAt(next, razedCityId, attacker.factionId);
    next = burned.state;
    loot = burned.loot;
  }

  /*
   * Spoils of capture: the loser's syllabus.
   *
   * ⚠️ Only for a human, because `state.research` is a person's own progress
   * and no antagonist has any. A machine taking a city must not quietly hand
   * somebody a topic, which is what a faction-blind version of this did.
   */
  if (cityCaptured && cityFormerFactionId) {
    const captor = state.factions.get(attacker.factionId);
    const loser = state.factions.get(cityFormerFactionId);
    if (captor?.control === 'human' && loser) {
      const granted = grantFoothold(next, loser.topicCluster);
      next = granted.state;
      if (granted.topicId !== undefined) clusterOpened = granted.topicId;
    }
  }

  return {
    ok: true,
    result: {
      state: next,
      log: {
        attackerId,
        defenderId,
        targetKind: preview.targetKind,
        damageToDefender,
        damageToAttacker,
        defenderDestroyed,
        attackerDestroyed,
        cityCaptured,
        cityRazed,
        ...(cityFormerFactionId !== undefined ? { cityFormerFactionId } : {}),
        ...(loot !== undefined ? { loot } : {}),
        ...(clusterOpened !== undefined ? { clusterOpened } : {}),
        challengeScore: options.challengeScore ?? 0,
        tactic: options.tactic ?? DEFAULT_TACTIC,
        stance: options.defenceStance ?? 'hold',
        wallBroken,
      },
    },
  };
}
