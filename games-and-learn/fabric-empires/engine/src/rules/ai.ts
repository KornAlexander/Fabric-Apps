import { hexDistance, hexKey, type Hex } from '../hex/index.js';
import { isCivilian, unitType, type UnitTypeId } from '../entities/index.js';
import type { GameState } from '../state/index.js';
import { cityAt, unitAt } from '../state/index.js';
import { moveUnit } from './actions.js';
import { canAttack, previewAttack, resolveAttack, type CombatLog } from './combat.js';

/**
 * How many turns of pounding an antagonist will accept before it looks
 * elsewhere.
 *
 * Generous on purpose. A real siege should take several turns, so this must
 * not talk the AI out of a fight it would actually win: it exists to stop the
 * pathological case where the arithmetic says never, not to make antagonists
 * cautious.
 *
 * ⚠️ **Raised from 12, which was quietly cautious rather than generous.**
 * Measured against a fresh Workspace on seed FABRIC: a Pipeline Runner does
 * `MIN_DAMAGE` to a town, so it needed 20 turns for an UNWALLED one and 32 for
 * a level-three. Both were over the old limit, so a lone raider declined every
 * town in the game, walls or no walls. The player saw enemies gather outside
 * their capital and mill about for the rest of the match, which is the exact
 * failure this constant's own comment says it must not cause.
 *
 * At 24 a lone unit will besiege an unwalled town (20 turns) and still declines
 * a full fortress alone (32), which is right: against `WALL_MEND_PER_CYCLE` it
 * is doing floor damage into a wall that repairs faster than it breaks.
 */
export const HOPELESS_ASSAULT_TURNS = 24;

/**
 * Which way an antagonist goes at a wall.
 *
 * ⚠️ **Without this the AI had one tactic where the player has three.** Every
 * antagonist attack used the default, so a player who walled up was never
 * escaladed and never sapped: walls were strictly better for the player than
 * for the seven factions that also build them. Same asymmetry as the AI not
 * building walls at all (D424), one layer up.
 *
 * The rule is progress, not damage. While the wall stands, only wall damage
 * moves the siege along; once it is down, only damage to the town does. Scoring
 * raw damage would pick sap forever, including after the breach where it is the
 * worst choice in the game.
 *
 * ⚠️ And it will not choose a tactic that kills the attacker. Escalade against
 * a fresh wall costs a full counterattack, which is lethal to most of the
 * roster, and an AI that storms a fortress with scouts is not aggressive, it is
 * broken.
 */
export function chooseTactic(
  state: GameState,
  unitId: string,
  target: Hex,
): AssaultTactic {
  const city = cityAt(state, target);
  const unit = state.units.get(unitId);
  if (!city || !unit || city.wallLevel <= 0) return DEFAULT_TACTIC;

  const wallStanding = city.wallHp > 0;
  const ranged = unitType(unit.typeId).range > 1;

  let best: AssaultTactic = DEFAULT_TACTIC;
  let bestScore = -Infinity;

  for (const id of ASSAULT_TACTICS) {
    // You cannot storm a parapet from a mile away, and a ranged attacker takes
    // no counter, so allowing it would be a free bypass (D441).
    if (id === 'escalade' && ranged) continue;

    const preview = previewAttack(state, unitId, target, { tactic: id });
    if (!preview) continue;
    if (preview.expectedDamageToAttacker >= unit.hp) continue;

    const split = absorbWithWalls(city, preview.expectedDamageToDefender, TACTICS[id].wallShare);
    const progress = wallStanding ? city.wallHp - split.wallHp : split.toCity;
    // Damage taken is a real cost, so a tactic that trades badly loses ties.
    const score = progress - preview.expectedDamageToAttacker * 0.25;

    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

/**
 * How an antagonist meets an attack (D143).
 *
 * ⚠️ **Without this the AI defends one way where the player has three**, which
 * is exactly the asymmetry `chooseTactic` was written to close, seen from the
 * other side. A defender that always holds makes two of the three stances
 * something only the player ever experiences.
 *
 * The rule is survival first, and it is deliberately simple:
 *
 *   Brace when the blow would be fatal and enduring it might not be. Bracing
 *         cannot win, but a defender that is dead has no later.
 *   Sally when there is little left to defend with, or when the counter would
 *         finish the attacker outright. Giving up a wall costs nothing if the
 *         wall is already down.
 *   Hold  otherwise, which is what defending always was.
 *
 * ⚠️ It will not sally when that turns a survivable blow into a fatal one.
 * A stance is chosen by comparing what each actually costs this defender, not
 * by a table, for the same reason `chooseTactic` scores progress rather than
 * reading a preference off the tactic's description.
 */
export function chooseStance(
  state: GameState,
  attackerId: string,
  target: Hex,
): DefenceStance {
  const defendingUnit = unitAt(state, target);
  const city = cityAt(state, target);
  if (!defendingUnit && !city) return DEFAULT_STANCE;

  const hp = defendingUnit ? defendingUnit.hp : (city?.hp ?? 0);
  const attacker = state.units.get(attackerId);
  if (!attacker) return DEFAULT_STANCE;

  let best: DefenceStance = DEFAULT_STANCE;
  let bestScore = -Infinity;

  for (const id of DEFENCE_STANCES) {
    const preview = previewAttack(state, attackerId, target, { defenceStance: id });
    if (!preview) continue;

    const survived = hp - preview.expectedDamageToDefender;
    const kills = preview.expectedDamageToAttacker >= attacker.hp;

    /*
     * Staying alive dominates everything else. A stance that leaves the
     * defender standing is worth more than any amount of damage returned by
     * one that does not, because a destroyed defender never gets to use the
     * damage it dealt.
     */
    const alive = survived > 0 ? 1000 : 0;
    // Finishing the attacker ends the siege, which is worth more than chipping.
    const finish = kills ? 500 : 0;
    const score = alive + finish + survived + preview.expectedDamageToAttacker * 0.5;

    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}
import { findPath, reachable } from './movement.js';
import { musterTile } from './production.js';
import { absorbWithWalls, maxWallHp, mendedBy, wallWork, WALL_MEND_PER_CYCLE } from './walls.js';
import {
  ASSAULT_TACTICS,
  DEFAULT_TACTIC,
  TACTICS,
  type AssaultTactic,
} from './assault.js';
import {
  DEFAULT_STANCE,
  DEFENCE_STANCES,
  type DefenceStance,
} from './defence.js';

/**
 * The antagonist's turn.
 *
 * ⚠️ **Deterministic, with no randomness of its own.** A seed has always
 * decided this game's map and its combat rolls, so an opponent that drew from
 * `Math.random` would be the one thing in it that could not be replayed, and
 * "send a friend your seed and compare" (D39) would quietly stop meaning
 * anything. Every choice below breaks ties on a stable key.
 *
 * The decision is small on purpose. It is one function, {@link planUnitAction},
 * used twice: once by {@link runFactionTurn} to actually act, and once by
 * {@link planFactionTurn} to say what it *would* do without touching the
 * state. Two implementations of "what does the enemy do" would drift, and the
 * one that drifts is always the one nothing asserts.
 *
 * What it does not do yet is as important. It does not build, it does not
 * research, and it does not co-ordinate between units: each unit takes the
 * best move it can see for itself. That is enough to make the map dangerous,
 * which is the thing the game was missing, and it is honest about being
 * enough rather than pretending to be a general.
 */

/** How many times one unit may act in a turn. Move, then strike, then stop. */
const MAX_ACTIONS_PER_UNIT = 3;

/**
 * How far from itself an antagonist will go looking for a fight, in hexes.
 *
 * ⚠️ **This exists because the first version had none, and it was measurably
 * too good.** With a free rein the Silo Horde crossed the map and wiped out a
 * passive player's entire empire by turn six. That is a working opponent and
 * the wrong game: the plan's first raid is meant to be a teaching moment that
 * the player wins, and someone still learning which key fortifies should not
 * lose everything while reading the interface.
 *
 * A radius rather than a timer, because it is stateless. Nothing new is
 * stored on a unit, nothing has to be migrated into old saves, and it keeps
 * the one property that matters: **step inside it and they will always fight
 * back.** A leash is not a truce.
 */
export const BASE_AGGRO_RADIUS = 5;

/**
 * Turns before the horde will look one hex further.
 *
 * The pressure has to arrive eventually or the map is scenery again. Widening
 * rather than switching on means there is no single turn where the game
 * changes character, and it stays a pure function of the turn number, so a
 * replayed seed meets the same opposition at the same time.
 */
export const AGGRO_TURNS_PER_HEX = 3;

/**
 * The map these numbers were measured against.
 *
 * ⚠️ **The leash is proportional to the world, not a fixed number of hexes.**
 * Both constants above were tuned on a radius-25 map, where the first raid
 * lands on turn 9 to 20. Left absolute, a map three times the area would put
 * the far camps 45 hexes away and the leash would take 121 turns to reach
 * them: six of the seven factions would simply never arrive, and making the
 * map bigger would quietly make the game emptier.
 *
 * Scaling by the ratio keeps the measured pacing wherever the map size ends
 * up, because a camp's distance scales with the map for the same reason.
 */
export const REFERENCE_MAP_RADIUS = 25;

export function aggroRadius(turn: number, mapRadius: number = REFERENCE_MAP_RADIUS): number {
  const scale = Math.max(1, mapRadius) / REFERENCE_MAP_RADIUS;
  const widened = BASE_AGGRO_RADIUS + Math.floor(Math.max(0, turn - 1) / AGGRO_TURNS_PER_HEX);
  return widened * scale;
}

export type AiIntent =
  | {
      readonly kind: 'move';
      readonly unitId: string;
      readonly to: Hex;
      /** What the unit is walking towards, for the log and for tests. */
      readonly towards: Hex;
    }
  | {
      readonly kind: 'raid';
      readonly unitId: string;
      readonly target: Hex;
      readonly targetKind: 'unit' | 'city';
    };

export interface AiEvent {
  readonly factionId: string;
  readonly unitId: string;
  readonly intent: AiIntent;
  /** Present for a raid that was actually fought. */
  readonly log?: CombatLog;
}

export interface AiTurnResult {
  readonly state: GameState;
  readonly events: readonly AiEvent[];
}

/**
 * Units in a stable order.
 *
 * Ids look like `unit-12`, and a plain string sort puts `unit-12` before
 * `unit-2`. That is still deterministic, so nothing would break, but the order
 * would jump around as a game grows and any test reading the event list would
 * look arbitrary. Sorting on the number reads the way the ids do.
 */
function inTurnOrder(ids: readonly string[]): string[] {
  const rank = (id: string): number => {
    const n = Number.parseInt(id.replace(/^\D+/, ''), 10);
    return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
  };
  return [...ids].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * Every tile holding something this faction would like to attack.
 *
 * ⚠️ **Antagonists are hostile to the player and to nobody else.** The first
 * version returned everything not their own, and with seven factions on the
 * map that meant they spent the opening turns fighting each other: the first
 * raid landed on turn 2 of every seed and had nothing to do with the player,
 * who then watched their opposition delete itself for free.
 *
 * There is no diplomacy model here and there should not be one. These are
 * seven misconceptions besieging a learner, not seven nations with interests.
 * Every human is hostile to everyone; the machine is hostile to every human.
 *
 * ⚠️ **Hostility follows the SEAT, not an id.** Once a person can take over
 * an antagonist, "is this the player" stops being answerable by name. A human
 * who sits down in the Silo Horde becomes a target for the remaining machines
 * on the turn they sit down, which is the correct answer and falls out of
 * asking about control rather than about identity.
 */
function targetsFor(state: GameState, factionId: string): Hex[] {
  const acting = state.factions.get(factionId);
  const hostile = (ownerId: string): boolean => {
    if (ownerId === factionId) return false;
    if (acting?.control === 'human') return true;
    return state.factions.get(ownerId)?.control === 'human';
  };

  const out: Hex[] = [];
  for (const city of state.cities.values()) {
    if (hostile(city.factionId)) out.push(city.hex);
  }
  for (const unit of state.units.values()) {
    if (hostile(unit.factionId)) out.push(unit.hex);
  }
  return out;
}

/**
 * What one unit should do right now, or nothing.
 *
 * Order of preference: hit something in reach, otherwise walk towards the
 * nearest thing worth hitting. A city outranks a unit at equal distance
 * because a captured city is the only permanent gain on this map.
 */
/**
 * What this faction can take off a town in one turn, all attackers together.
 *
 * ⚠️ Counts every unit of the faction that could strike the tile **this turn**,
 * which is what makes a siege a siege. `canAttack` is the same gate the attack
 * itself uses, so a unit that is out of moves, out of range or civilian is not
 * counted as part of a force it cannot join.
 *
 * The unit doing the asking is included by the same rule as everybody else,
 * so a lone raider still gets its own honest number rather than a special case.
 */
function siegeRate(state: GameState, factionId: string, target: Hex): number {
  let total = 0;
  for (const unit of state.units.values()) {
    if (unit.factionId !== factionId) continue;
    if (!canAttack(state, unit.id, target).ok) continue;
    total += previewAttack(state, unit.id, target)?.expectedDamageToDefender ?? 0;
  }
  return total;
}

export function planUnitAction(state: GameState, unitId: string): AiIntent | undefined {
  const unit = state.units.get(unitId);
  if (!unit || unit.movesLeft <= 0) return undefined;

  const type = unitType(unit.typeId);
  const hostile = targetsFor(state, unit.factionId);

  if (!isCivilian(unit.typeId)) {
    let best: { hex: Hex; kind: 'unit' | 'city'; score: number } | undefined;
    for (const hex of hostile) {
      if (hexDistance(unit.hex, hex) > Math.max(1, type.range)) continue;
      if (!canAttack(state, unitId, hex).ok) continue;

      const city = cityAt(state, hex);
      const defender = unitAt(state, hex);
      const kind: 'unit' | 'city' = !defender && city ? 'city' : 'unit';

      /*
       * ⚠️ **Do not batter a fortress that cannot be broken** (section 19.2).
       *
       * Cities outrank units, so without this an army that reaches a walled
       * capital stands there hitting it at the damage floor for the rest of
       * the game while a soft target waits one hex away. Walls made that
       * reachable: they roughly double the defence, and the floor is
       * `MIN_DAMAGE`.
       *
       * The test is how long the target would take at the rate actually being
       * achieved, which is a number the engine already computes for the
       * player's own odds display. Nothing here guesses at wall levels.
       */
      if (kind === 'city' && city) {
        const preview = previewAttack(state, unitId, hex);
        if (preview) {
          /*
           * ⚠️ **The whole besieging force, not this one raider.**
           *
           * The original asked each unit privately whether IT could break the
           * town, which is the wrong question and produced the worst possible
           * answer: six units around a walled capital each computed a siege
           * they could not finish alone, every one declined, and nobody
           * attacked at all. Six-to-one must never resolve to nobody moving.
           *
           * ⚠️ Only this faction's units count. The seven antagonists plan
           * separately and do not coordinate, so pooling their arithmetic
           * would have them fight as an alliance the game does not model.
           */
          const perTurn = siegeRate(state, unit.factionId, hex);
          const shield = city.wallHp + city.hp;
          if (perTurn <= 0 || shield / perTurn > HOPELESS_ASSAULT_TURNS) continue;
        }
      }

      // Lower is better: cities first, then whatever is closest to dying.
      const score = (kind === 'city' ? 0 : 1_000) + (defender?.hp ?? city?.hp ?? 0);
      if (!best || score < best.score || (score === best.score && hexKey(hex) < hexKey(best.hex))) {
        best = { hex, kind, score };
      }
    }
    if (best) {
      return { kind: 'raid', unitId, target: best.hex, targetKind: best.kind };
    }
  }

  // Nothing in reach, so close the distance. Civilians walk too: an enemy
  // settler wandering the map is a target the player can take, which is more
  // interesting than one that stands in its camp forever.
  //
  // Only towards something inside the leash, though. Everything further away
  // is not yet this faction's business.
  const limit = aggroRadius(state.turn, state.map.radius);
  let towards: Hex | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const hex of hostile) {
    const distance = hexDistance(unit.hex, hex);
    if (distance > limit) continue;
    if (distance < bestDistance || (distance === bestDistance && towards && hexKey(hex) < hexKey(towards))) {
      bestDistance = distance;
      towards = hex;
    }
  }
  if (!towards) return undefined;

  const planned = findPath(state, unit, towards);
  if (!planned || planned.path.length < 2) return undefined;

  /*
   * Walk as far along the path as this turn allows.
   *
   * ⚠️ The last tile of the path is the target itself, which is occupied, so
   * it is never a legal destination. Stepping backwards from the end and
   * taking the first tile that is genuinely reachable also handles zones of
   * control and terrain costs, because `reachable` is the same function that
   * constrains the player.
   */
  const reach = reachable(state, unit);
  for (let i = planned.path.length - 2; i >= 1; i--) {
    const step = planned.path[i]!;
    if (reach.has(hexKey(step))) {
      return { kind: 'move', unitId, to: step, towards };
    }
  }
  return undefined;
}

/** What the faction would do from this state, without changing it. */
export function planFactionTurn(state: GameState, factionId: string): AiIntent[] {
  const ids = inTurnOrder(
    [...state.units.values()].filter((u) => u.factionId === factionId).map((u) => u.id),
  );
  const out: AiIntent[] = [];
  for (const id of ids) {
    const intent = planUnitAction(state, id);
    if (intent) out.push(intent);
  }
  return out;
}

/**
 * Play the faction's turn.
 *
 * ⚠️ **`activeFactionId` is switched for the duration and restored at the end.**
 * `moveUnit` and `canAttack` both refuse a unit that does not belong to the
 * active faction, which is exactly right and means an AI turn has to genuinely
 * be that faction's turn rather than a special case that bypasses the rules.
 * Every move the opponent makes is therefore legal by the same code that
 * judges the player's.
 *
 * Units are re-planned after each action, so one can close the distance and
 * strike in the same turn if it has the movement for it.
 */
/**
 * Turns a village spends raising one unit.
 *
 * ⚠️ **Deliberately slow.** The antagonists are not plugged into the economy:
 * they have no treasury the player can see, so an income-driven garrison would
 * look arbitrary. A fixed cadence is legible instead, and it is the single knob
 * that decides whether villages are a standing threat or scenery. Measured
 * against the section 16.7 experiment before it was allowed to stay.
 */
export const GARRISON_INTERVAL_TURNS = 6;

/**
 * Units a faction may field from its villages.
 *
 * Counts the whole faction, not the city, so seven factions cannot each grow an
 * unbounded army while the player is busy elsewhere. Starting strength is two,
 * so this is room for two more.
 */
export const MAX_GARRISON_PER_FACTION = 4;

/** What a village raises. Melee, because a village defends and marches. */
const GARRISON_UNIT: UnitTypeId = 'pipelineRunner';

/**
 * Villages raise troops.
 *
 * Uses `productionProgress` as the counter rather than adding state, because it
 * is already on every city, already saved, and already means exactly this.
 * A faction at its cap holds at the threshold instead of resetting, so losing a
 * unit is followed by a replacement rather than another six turns of nothing.
 */
export function garrisonPhase(state: GameState, factionId: string): AiTurnResult {
  const faction = state.factions.get(factionId);
  if (!faction || faction.control === 'human') return { state, events: [] };

  const cities = new Map(state.cities);
  const units = new Map(state.units);
  const events: AiEvent[] = [];
  let nextEntityId = state.nextEntityId;
  let standing = [...state.units.values()].filter((u) => u.factionId === factionId).length;
  let changed = false;

  for (const id of [...state.cities.keys()].sort()) {
    const city = state.cities.get(id)!;
    if (city.factionId !== factionId) continue;

    const progress = city.productionProgress + 1;
    if (progress < GARRISON_INTERVAL_TURNS) {
      cities.set(id, { ...city, productionProgress: progress });
      changed = true;
      continue;
    }
    if (standing >= MAX_GARRISON_PER_FACTION) {
      /*
       * ⚠️ **An army at full strength digs in.**
       *
       * This cycle used to be thrown away: a faction at its unit cap held at
       * the threshold and did nothing with the tick. Walls were therefore
       * something only the player ever had, which left half the siege system
       * unexercised in an actual game and made every antagonist city a soft
       * target no matter how late it was taken.
       *
       * Spending the spare cycle here keeps the AI's simple-timer model, needs
       * no new saved field, and gives the same competition the player has:
       * troops first, earthworks with what is left over. A faction that loses
       * units drops below the cap and goes back to raising them, which is the
       * right priority.
       *
       * `wallWork` is the player's own rule, so an antagonist mends a breach
       * exactly as a player would and stops when there is nothing to do.
       */
      const work = wallWork(city);
      if (work) {
        // ⚠️ A raise builds the new course to its full height, because that is
        // what building it means. A **mend** only patches: this cycle is free,
        // and a free rebuild to full made a level-three wall unbreakable by
        // anything but the heaviest unit in the game. See WALL_MEND_PER_CYCLE.
        const raising = work.kind === 'raise';
        const level = raising ? work.level : city.wallLevel;
        cities.set(id, {
          ...city,
          wallLevel: level,
          wallHp: raising ? maxWallHp(level) : mendedBy(city, WALL_MEND_PER_CYCLE),
          productionProgress: 0,
        });
        changed = true;
        continue;
      }
      // Nothing left to raise or mend: ready, but with nowhere to put anyone.
      cities.set(id, { ...city, productionProgress: GARRISON_INTERVAL_TURNS });
      changed = true;
      continue;
    }

    const spot = musterTile({ ...state, cities }, { ...city, producing: GARRISON_UNIT });
    if (!spot) {
      cities.set(id, { ...city, productionProgress: GARRISON_INTERVAL_TURNS });
      changed = true;
      continue;
    }

    const unitId = `unit-${nextEntityId++}`;
    const type = unitType(GARRISON_UNIT);
    units.set(unitId, {
      id: unitId,
      typeId: GARRISON_UNIT,
      factionId,
      hex: spot,
      hp: type.maxHp,
      movesLeft: 0, // raised this turn, marches the next one
      fortified: false,
    });
    cities.set(id, { ...city, productionProgress: 0 });
    standing += 1;
    changed = true;
    events.push({
      factionId,
      unitId,
      intent: { kind: 'move', unitId, to: spot, towards: spot },
    });
  }

  if (!changed) return { state, events };
  return { state: { ...state, cities, units, nextEntityId }, events };
}

export function runFactionTurn(
  state: GameState,
  factionId: string,
  options: {
    readonly defenderChallengeScore?: number;
    readonly defenceStance?: DefenceStance;
    /**
     * The one tile the player was asked to defend.
     *
     * ⚠️ When absent, the score and stance above apply to **every** attack
     * this faction makes, which is what they used to do unconditionally and
     * is almost never what a caller means. `endTurn` always names a tile.
     */
    readonly defendAt?: Hex | undefined;
  } = {},
): AiTurnResult {
  const events: AiEvent[] = [];
  const restoreTo = state.activeFactionId;
  let current: GameState = { ...state, activeFactionId: factionId };

  /*
   * Whether this is the fight the player was shown and answered for.
   *
   * ⚠️ No tile named means nothing is prepared, rather than everything being
   * prepared. The failure modes are not symmetrical: a caller that forgets to
   * say where loses a bonus it can see is missing, whereas the old default
   * spread one answer silently across every skirmish on the map.
   */
  const prepared = (target: Hex): boolean =>
    options.defendAt !== undefined && hexKey(options.defendAt) === hexKey(target);

  const ids = inTurnOrder(
    [...current.units.values()].filter((u) => u.factionId === factionId).map((u) => u.id),
  );

  for (const id of ids) {
    for (let step = 0; step < MAX_ACTIONS_PER_UNIT; step++) {
      const intent = planUnitAction(current, id);
      if (!intent) break;

      if (intent.kind === 'move') {
        const moved = moveUnit(current, id, intent.to);
        // A refused move means the plan and the rules disagree, and repeating
        // it would spin. Give up on this unit rather than loop.
        if (!moved.ok) break;
        current = moved.state;
        events.push({ factionId, unitId: id, intent });
        continue;
      }

      const fought = resolveAttack(current, id, intent.target, {
        defenderChallengeScore: prepared(intent.target) ? options.defenderChallengeScore ?? 0 : 0,
        // ⚠️ The antagonists get the same three choices the player does.
        // Without this every AI attack used the default, so a player's walls
        // were never escaladed and never sapped.
        tactic: chooseTactic(current, id, intent.target),
        /*
         * The stance belongs to whoever is being hit, which here is the
         * player, so it is passed in rather than chosen. An AI city defending
         * against the player picks its own in `chooseStance`, on the other
         * side of this call.
         *
         * ⚠️ **Only on the tile the player was actually asked about.** This
         * used to apply to every attack in the phase, so bracing one city
         * braced a scout being jumped on the far side of the map, and that
         * scout's owner was never shown the fight or offered the choice. A
         * defender nobody asked fights on its own merits.
         */
        defenceStance: prepared(intent.target) ? options.defenceStance ?? 'hold' : 'hold',
      });
      if (!fought.ok) break;
      current = fought.result.state;
      events.push({ factionId, unitId: id, intent, log: fought.result.log });
      // One strike each. Attacking spends the unit's turn.
      break;
    }
  }

  return { state: { ...current, activeFactionId: restoreTo }, events };
}
