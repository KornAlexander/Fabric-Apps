/**
 * The turn pipeline.
 *
 * Phases run in a fixed order and each one is a pure function from state to
 * state. The report they build up is what the UI shows the player, and it is
 * also what tests assert against, so the two never disagree about what
 * happened during a turn.
 *
 * Phases from the plan not yet implemented (research, production, enemy AI,
 * events) have no hook here on purpose: an empty phase that does nothing is
 * indistinguishable from a phase that silently broke.
 */

import { unitType, type Faction } from '../entities/index.js';
import { FORTIFY_HEAL_SHARE } from '../rules/combat.js';
import { addResources, empireIncome, growthThreshold } from '../rules/yields.js';
import { autoSelectResearch, fundResearch, researchReady } from '../rules/research.js';
import { reviewOpportunities, reviewPhase, type ReviewOpportunity } from '../rules/review.js';
import { runFactionTurn, garrisonPhase, type AiEvent } from '../rules/ai.js';
import { rememberVisible } from '../rules/vision.js';
import { productionPhase, type ProductionEvent } from '../rules/production.js';
import { checkOutcome, type Outcome } from '../rules/victory.js';
import type { DefenceStance } from '../rules/defence.js';
import type { Hex } from '../hex/index.js';
import type { GameState } from '../state/index.js';

export interface TurnOptions {
  /**
   * Topics the learning layer says have fallen due.
   *
   * Passed in rather than looked up, because the engine has no idea what a
   * topic is or when it should come back. Omitting it disables reviews
   * entirely, which is what the standalone strategy game does (D35).
   */
  readonly dueTopics?: readonly string[] | undefined;
  /**
   * How well the player answered when an antagonist raids them, in -1..+1.
   *
   * Defaults to zero, which means no challenge was asked and the raid is
   * fought on the units alone. It is an option rather than a callback because
   * the engine stays synchronous and pure: asking a human a question is the
   * app's job, exactly as it is for research (D35).
   *
   * ⚠️ **Only reaches the tile named by `defendAt`.** See below.
   */
  readonly defenderChallengeScore?: number | undefined;
  /**
   * How the player meets the raid, when one is coming.
   *
   * Same reasoning as the score above: the engine stays pure, so the choice
   * arrives as data rather than a callback. Defaults to `hold`, which is a
   * no-op on every number in combat, so a caller that does not offer the
   * choice fights the raid exactly as it always did.
   *
   * ⚠️ **Only reaches the tile named by `defendAt`.** See below.
   */
  readonly defenceStance?: DefenceStance | undefined;
  /**
   * Which tile the player was actually asked about.
   *
   * ⚠️ **Without this, one answer was applied to every fight on the map.**
   *
   * The app previews the turn, finds the raids, and asks the player about
   * *one* of them. Both the answer and the stance were then handed to the
   * whole enemy phase, so a garrison bracing behind its walls in the north
   * also braced a lone scout being jumped in the south, and a battle question
   * answered about one siege stiffened every unrelated skirmish in the same
   * breath. Neither unit was in the fight the player was shown.
   *
   * Naming the tile keeps the engine pure and the scope honest: the
   * preparation applies where it was made, and every other defender that turn
   * fights on its own merits with `hold` and a score of zero, exactly as it
   * would if the player had never been asked anything.
   *
   * Omitted means the old behaviour is *not* restored: nothing is scoped
   * anywhere, so the score and stance are simply unused. A caller that wants
   * them to count has to say where.
   */
  readonly defendAt?: Hex | undefined;
}

export interface TurnReport {
  /** The turn that just ended. */
  readonly turn: number;
  readonly factionId: string;
  readonly treasuryGained: {
    readonly compute: number;
    readonly cu: number;
    readonly trust: number;
  };
  readonly upkeepPaid: number;
  /** Cities that gained a citizen. */
  readonly grownCities: readonly string[];
  /** Compute moved into research this turn. */
  readonly researchSpent: number;
  /**
   * A topic the engine picked because nothing was selected.
   *
   * ⚠️ Reported rather than done silently. Something choosing what you study
   * on your behalf and not saying so is the kind of help that reads as a bug
   * the first time somebody notices the tech tree moving without them.
   */
  readonly researchAutoSelected: string | undefined;
  /**
   * A topic that is fully funded and waiting for its challenge.
   *
   * The engine stops here on purpose: presenting a question is the app's job,
   * and the result comes back through `completeResearch`.
   */
  readonly researchReadyTopicId: string | undefined;
  /** True when upkeep could not be paid in full. */
  readonly bankrupt: boolean;
  /**
   * Council reviews the player can hold next turn.
   *
   * Reported as an opportunity rather than a demand: this is the list the UI
   * flags on cities, and ignoring it costs only the bonus (D49).
   */
  readonly reviewsAvailable: readonly ReviewOpportunity[];
  /** Reviews that were available this turn and were not held. */
  readonly reviewsIgnored: readonly ReviewOpportunity[];
  /** Cities whose unrest rose this turn. */
  readonly citiesUnsettled: readonly string[];
  /**
   * Everything the antagonists did, in the order they did it.
   *
   * The app replays this as movement and duels. It is a list rather than a
   * summary because "the Silo Horde attacked" and "the Silo Horde attacked
   * your Architect and killed it" are different messages, and only the second
   * one tells the player where to look.
   */
  readonly enemyEvents: readonly AiEvent[];
  /** Compute moved into production this turn. */
  readonly productionSpent: number;
  /** Units that finished building and are standing in the world. */
  readonly unitsBuilt: readonly ProductionEvent[];
  /** Cities that finished something with nowhere to put it. */
  readonly citiesBlocked: readonly string[];
  /**
   * How the game stands, or undefined while it is still being played.
   *
   * Computed after the antagonists have moved, so a raid that takes the last
   * unit ends the game on the turn it happens rather than the turn after.
   */
  readonly outcome: Outcome | undefined;
}

export interface TurnResult {
  readonly state: GameState;
  readonly report: TurnReport;
}

/**
 * UPKEEP: collect income, pay the army, grow the cities.
 *
 * A negative treasury is clamped at zero rather than going into debt, and the
 * shortfall is reported. Debt spirals are a punishing mechanic to explain and
 * this game already asks the player to learn something else.
 */
function upkeepPhase(state: GameState, factionId: string): TurnResult {
  const faction = state.factions.get(factionId);
  if (!faction) {
    throw new Error(`Unknown faction ${factionId}`);
  }

  const income = empireIncome(state, factionId);
  const combined = addResources(faction.resources, income.treasury);
  const bankrupt = combined.cu < 0;

  const updatedFaction: Faction = {
    ...faction,
    resources: Object.freeze({
      data: combined.data,
      compute: combined.compute,
      cu: Math.max(0, combined.cu),
      trust: combined.trust,
    }),
  };

  const cities = new Map(state.cities);
  const grown: string[] = [];
  for (const [id, city] of cities) {
    if (city.factionId !== factionId) continue;
    const gained = income.growth.get(id) ?? 0;
    let store = city.growthStore + gained;
    let population = city.population;
    // A single turn can only ever add one citizen, so a windfall does not
    // detonate a city from size 1 to size 5.
    const threshold = growthThreshold(population);
    if (store >= threshold) {
      store -= threshold;
      population += 1;
      grown.push(id);
    }
    cities.set(id, { ...city, growthStore: store, population });
  }

  const factions = new Map(state.factions);
  factions.set(factionId, updatedFaction);

  return {
    state: { ...state, factions, cities },
    report: {
      turn: state.turn,
      factionId,
      treasuryGained: {
        compute: income.treasury.compute,
        cu: income.treasury.cu,
        trust: income.treasury.trust,
      },
      upkeepPaid: income.upkeep,
      grownCities: grown,
      researchSpent: 0,
      researchAutoSelected: undefined,
      researchReadyTopicId: undefined,
      bankrupt,
      reviewsAvailable: [],
      reviewsIgnored: [],
      citiesUnsettled: [],
      enemyEvents: [],
      productionSpent: 0,
      unitsBuilt: [],
      citiesBlocked: [],
      outcome: undefined,
    },
  };
}

/** REFRESH: give every unit of the faction its movement back, and let the dug-in mend. */
function refreshPhase(state: GameState, factionId: string): GameState {
  const units = new Map(state.units);
  for (const [id, unit] of units) {
    if (unit.factionId !== factionId) continue;
    const type = unitType(unit.typeId);
    /*
     * ⚠️ **Digging in is now the only way a unit gets its health back, and
     * before this there was no way at all.**
     *
     * Cities repaired their walls and grew their hit points back through rank;
     * a wounded unit simply stayed wounded for the rest of the game. That
     * compounds, because `hpFactor` scales strength by health: one bad fight
     * permanently devalued a unit and the only cure was to lose it and build
     * another.
     *
     * Attached to fortifying rather than granted freely, so mending costs
     * something real. A unit that stops to recover is a unit that is not
     * moving, not scouting and not holding a line somewhere else.
     */
    const healed = unit.fortified
      ? Math.min(type.maxHp, unit.hp + Math.round(type.maxHp * FORTIFY_HEAL_SHARE))
      : unit.hp;
    units.set(id, {
      ...unit,
      hp: healed,
      /*
       * ⚠️ **Every unit, including the fortified ones, and that is the fix
       * for a deadlock rather than a preference.**
       *
       * This line used to read `unit.fortified ? 0 : ...`, on the reasoning
       * that a dug-in unit should not turn up in the "units still to move"
       * nag. That reasoning was sound and the implementation was redundant:
       * `idleUnits` already filters on `!u.fortified`, so the nag was never
       * relying on this.
       *
       * What it did instead was strand the unit for ever. `moveUnit` clears
       * the fortified flag, which is the documented way to wake up, but it
       * rejects a unit with no movement several lines before it gets there.
       * A fortified unit therefore never had the movement it needed to
       * trigger its own wake-up, and the only thing on the map that could
       * clear the flag was an enemy raid.
       *
       * Nothing else reads a fortified unit's movement: the defence bonus in
       * `combat.ts` keys off the flag alone.
       */
      movesLeft: type.movement,
    });
  }
  return { ...state, units };
}

/**
 * End the active faction's turn.
 *
 * The antagonists move last, after the player's upkeep, research and refresh.
 * Putting them at the end means the board the player sees at the start of
 * their turn is the board they will act on: an opponent that moved *after*
 * the screen was drawn would look like it teleported.
 */
export function endTurn(state: GameState, options: TurnOptions = {}): TurnResult {
  const factionId = state.activeFactionId;
  const afterUpkeep = upkeepPhase(state, factionId);

  // UNREST: anything still due at the end of a turn was not attended to. A
  // review the player actually held has already been rescheduled by the
  // learning layer and is therefore no longer in this list.
  const due = options.dueTopics ?? [];
  const reviewed = reviewPhase(afterUpkeep.state, due, factionId);

  /*
   * PRODUCTION before RESEARCH, both drawing on Compute.
   *
   * Production is capped per city per turn and research is not, so running
   * production first lets a queued unit take its slice while research still
   * sweeps up everything left. The other order would starve production
   * completely whenever a topic was being studied, which is most of the game.
   */
  const produced = productionPhase(reviewed.state, factionId);

  /*
   * Nothing being studied is not a strategy, it is an oversight.
   *
   * `completeResearch` already picks the next topic the moment one finishes,
   * so this is the net underneath: a loaded save, a topic that vanished from
   * a re-imported curriculum, or any path that leaves research idle.
   *
   * ⚠️ **A topic picked here is deliberately NOT funded on the same turn.**
   * Switching away from a topic forfeits its progress, so investing Compute
   * into something the player never chose, in the same breath as choosing it,
   * would charge them for a decision they had no chance to see. Selecting now
   * and funding from the next turn gives them a full turn to change it for
   * free, because progress is still zero.
   */
  const chosen = autoSelectResearch(produced.state);
  const autoSelected = chosen === produced.state ? undefined : chosen.research.current;
  const funded = autoSelected
    ? { state: chosen, spent: 0, readyTopicId: undefined }
    : fundResearch(chosen, factionId);
  const refreshed = refreshPhase(funded.state, factionId);

  /*
   * ENEMY: every faction that is not the one whose turn just ended.
   *
   * Each is refreshed before it acts, because `refreshPhase` only ever
   * restored movement for the faction ending its turn. Without that the
   * antagonists would spend the movement they were created with and then
   * stand still for the rest of the game, which is indistinguishable from
   * having no opponent at all.
   */
  let world = refreshed;
  const enemyEvents: AiEvent[] = [];
  for (const id of [...world.factions.keys()].filter((f) => f !== factionId)) {
    // Villages raise troops first, so a unit mustered this turn is on the map
    // when the faction plans, but with no moves left to use.
    const raised = garrisonPhase(refreshPhase(world, id), id);
    enemyEvents.push(...raised.events);
    const played = runFactionTurn(raised.state, id, {
      defenderChallengeScore: options.defenderChallengeScore ?? 0,
      defenceStance: options.defenceStance ?? 'hold',
      defendAt: options.defendAt,
    });
    world = played.state;
    enemyEvents.push(...played.events);
  }

  /*
   * Sight is folded in last, after everything has moved and been built.
   *
   * A unit mustered this turn watches from where it stands, and a city taken
   * this turn lights up its new surroundings immediately. Doing it earlier
   * would leave both blind until the following turn for no reason a player
   * could work out.
   */
  const next: GameState = rememberVisible(
    { ...world, turn: world.turn + 1 },
    factionId,
  );
  return {
    state: next,
    report: {
      ...afterUpkeep.report,
      researchSpent: funded.spent,
      researchAutoSelected: autoSelected,
      researchReadyTopicId: funded.readyTopicId ?? researchReady(funded.state),
      // Recomputed against the new turn, so a city that reviewed this turn is
      // offered again next turn rather than looking permanently spent.
      reviewsAvailable: reviewOpportunities(next, due, factionId),
      reviewsIgnored: reviewed.ignored,
      citiesUnsettled: reviewed.unsettled,
      enemyEvents,
      productionSpent: produced.spent,
      unitsBuilt: produced.built,
      citiesBlocked: produced.blocked,
      outcome: checkOutcome(next, factionId),
    },
  };
}
