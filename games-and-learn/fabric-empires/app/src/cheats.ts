/**
 * Cheat codes.
 *
 * ⚠️ **Every TYPED code here leaves `mastery` alone. The O+K chord does not.**
 *
 * This is a study tool wearing a strategy game. Its only real output is the
 * readiness figure and the Great Library behind it, and those are built from
 * spaced-repetition data about questions actually answered. A code that wrote
 * to mastery would hand somebody a green 82% and a false belief that they can
 * sit DP-600, which is a worse outcome than any amount of losing.
 *
 * So the codes in this file move Compute, armies, walls and turns. Not one of
 * them touches `mastery`, and the two that come near the exam are careful:
 *
 *   - `sitthepaper` opens the Proctor early. It does not answer the paper.
 *     You still take forty questions and you still have to pass them.
 *   - `iknowthis` completes the research you are funding, because that is a
 *     GAME gate (it unlocks units). It marks the topic known to the tech tree
 *     and leaves the Great Library untouched, so the topic still shows as
 *     unlearned in the place that matters.
 *
 * ⚠️ **`okay` is the exception, and it is deliberate.** Holding O and K while
 * a question is open picks the right answer and submits it, and that answer
 * counts exactly as if it had been known: it feeds the schedule, the Library
 * and the readiness figure. Alexander asked for it on those terms.
 *
 * This file used to promise the opposite, in this docblock and in the console's
 * help text. Both were rewritten rather than left standing, because a promise
 * the code no longer keeps is worse than no promise: the next reader has no
 * reason to doubt it.
 *
 * What is left is disclosure. Every use is appended to `state.cheatsUsed`,
 * which lives in the save, so an empire built with help says so on the victory
 * screen and keeps saying so after a reload.
 */

import {
  ANTAGONIST_FACTION_ID,
  MAX_WALL_LEVEL,
  PLAYER_FACTION_ID,
  UNIT_TYPES,
  cityAt,
  hexNeighbours,
  hexKey,
  maxWallHp,
  memoryOf,
  promotionFor,
  rankInfo,
  unitAt,
  unitType,
  unitsOf,
  type GameState,
  type Hex,
  type UnitTypeId,
} from '@fabric-empires/engine';

export type CheatCategory = 'treasury' | 'army' | 'war' | 'world' | 'exam';

/**
 * The chord that answers a question for you.
 *
 * ⚠️ Not in `CHEATS`, because it is not typed into the console: it is held on
 * the keyboard while a question is on screen. The code string lives here so
 * the thing that records it and the thing that lists it cannot disagree about
 * its name, which is the only reason a UI concern is declared in this file.
 */
export const OKAY_CHEAT = 'okay';

export interface CheatContext {
  readonly state: GameState;
  /**
   * The seat the person typing is playing.
   *
   * ⚠️ Passed in rather than assumed to be the player faction. A code that
   * traces the map or provisions a unit has to do it for whichever empire is
   * being played, and after taking a vacant seat that is not the one the game
   * started you in.
   */
  readonly seat: string;
  /** The unit the player has selected, if any. */
  readonly selectedUnitId: string | undefined;
  /** Open the Proctor's paper. Resolves when it is over. */
  readonly faceProctor: () => void;
  /**
   * Toggle the fog off, or back on. Returns whether it is now off.
   *
   * ⚠️ **A callback, like `faceProctor`, because there is no state to
   * change.** Fog is a view: the engine's memory of what this seat has
   * explored is not touched, so the code is reversible and turning it off puts
   * the player back where they were. A version that wrote the whole map into
   * the seat's memory would be permanent, would be indistinguishable from
   * `lineage`, and would be a lie about what the player has actually seen.
   */
  readonly liftFog: () => boolean;
  /**
   * Whatever was typed after the code, lower-cased and unspaced.
   *
   * Empty for every code that takes no argument, which is most of them. A
   * code that wants one says so with `takesArgument`, because otherwise
   * `provisionprofiler` would simply be an unknown code.
   */
  readonly argument: string;
}

export interface CheatOutcome {
  /**
   * The new state, or undefined if the code changed nothing.
   *
   * ⚠️ Explicitly `| undefined` because `exactOptionalPropertyTypes` treats an
   * absent key and a key set to undefined as different things, and these are
   * written as plain returns rather than conditional spreads.
   */
  readonly state?: GameState | undefined;
  /** What to tell the player. */
  readonly message: string;
  readonly ok: boolean;
}

export interface Cheat {
  readonly code: string;
  readonly category: CheatCategory;
  /** Shown by the `help` code, so it has to read like a menu item. */
  readonly describe: string;
  /**
   * Whether text after the code belongs to it.
   *
   * ⚠️ Opt-in rather than automatic, so a typo is still an unknown code. If
   * every code swallowed a suffix, `onelakes` would silently run `onelake` and
   * the console would stop being able to tell anybody they had mistyped.
   */
  readonly takesArgument?: boolean;
  readonly apply: (ctx: CheatContext) => CheatOutcome;
}

// Helpers -----------------------------------------------------------------

function grant(
  state: GameState,
  amounts: { data?: number; compute?: number; cu?: number; trust?: number },
): GameState {
  const factions = new Map(state.factions);
  const player = factions.get(PLAYER_FACTION_ID);
  if (!player) return state;
  factions.set(PLAYER_FACTION_ID, {
    ...player,
    resources: {
      data: player.resources.data + (amounts.data ?? 0),
      compute: player.resources.compute + (amounts.compute ?? 0),
      cu: player.resources.cu + (amounts.cu ?? 0),
      trust: player.resources.trust + (amounts.trust ?? 0),
    },
  });
  return { ...state, factions };
}

/**
 * A free hex on or beside a hex, for putting a conjured unit down.
 *
 * ⚠️ Delegates to `nearestFreeSpot`, which searches outward in rings. The
 * original looked only at the origin and its six neighbours, so `directlake`,
 * `mirrored` and `provision` all reported "no room beside your capital" as
 * soon as a capital had a few units around it, which is most of the time you
 * would want to conjure another one.
 */
function freeSpotNear(state: GameState, origin: Hex): Hex | undefined {
  return nearestFreeSpot(state, origin);
}

/** Where the player's forces are, for spawning things near them. */
function playerAnchor(state: GameState): Hex | undefined {
  const capital = [...state.cities.values()].find(
    (c) => c.factionId === PLAYER_FACTION_ID,
  );
  if (capital) return capital.hex;
  return unitsOf(state, PLAYER_FACTION_ID)[0]?.hex;
}

function conjure(
  state: GameState,
  typeId: UnitTypeId,
  at: Hex,
): GameState | undefined {
  const spot = freeSpotNear(state, at);
  if (!spot) return undefined;
  const id = `unit-${state.nextEntityId}`;
  const type = unitType(typeId);
  const units = new Map(state.units);
  units.set(id, {
    id,
    typeId,
    factionId: PLAYER_FACTION_ID,
    hex: spot,
    hp: type.maxHp,
    movesLeft: type.movement,
    fortified: false,
  });
  return { ...state, units, nextEntityId: state.nextEntityId + 1 };
}

// The codes ---------------------------------------------------------------

/** The player's nearest town, which is what most of the war codes act on. */
function playerTown(state: GameState) {
  return [...state.cities.values()].find((c) => c.factionId === PLAYER_FACTION_ID);
}

/** Free neighbours of a hex, in a stable order, that a unit could stand on. */
function openNeighbours(state: GameState, at: Hex): Hex[] {
  return hexNeighbours(at).filter((hex) => standable(state, hex));
}

/** Whether something could be placed here at all. */
function standable(state: GameState, hex: Hex): boolean {
  const tile = state.map.tiles.get(hexKey(hex));
  if (!tile || tile.terrain === 'onelake' || tile.terrain === 'semanticPeaks') return false;
  return !unitAt(state, hex) && !cityAt(state, hex);
}

/**
 * The nearest empty tile, searching outward.
 *
 * ⚠️ **Rings, not just the six neighbours.** The one-ring version failed on
 * exactly the board these codes exist for: measured on a real save at turn 12,
 * three of six new codes reported "no room" because the town was already
 * ringed by units. A test affordance that gives up when the map gets
 * interesting is no affordance at all.
 *
 * Bounded, because an enclosed lake or a full map must end the search rather
 * than spiral off the edge of the world for ever.
 */
function nearestFreeSpot(state: GameState, origin: Hex, maxRings = 6): Hex | undefined {
  if (standable(state, origin)) return origin;
  let frontier: Hex[] = [origin];
  const seen = new Set<string>([hexKey(origin)]);

  for (let ring = 0; ring < maxRings; ring += 1) {
    const next: Hex[] = [];
    for (const hex of frontier) {
      for (const neighbour of hexNeighbours(hex)) {
        const key = hexKey(neighbour);
        if (seen.has(key)) continue;
        seen.add(key);
        if (standable(state, neighbour)) return neighbour;
        if (state.map.tiles.has(key)) next.push(neighbour);
      }
    }
    if (next.length === 0) return undefined;
    frontier = next;
  }
  return undefined;
}

export const CHEATS: readonly Cheat[] = Object.freeze([
  {
    code: 'onelake',
    category: 'treasury',
    describe: 'One lake to hold it all: 500 of every resource.',
    apply: ({ state }) => ({
      ok: true,
      state: grant(state, { data: 500, compute: 500, cu: 500, trust: 500 }),
      message: 'The lake fills. 500 of everything.',
    }),
  },
  {
    code: 'f64',
    category: 'treasury',
    describe: 'Provision a larger capacity: 2000 Compute.',
    apply: ({ state }) => ({
      ok: true,
      state: grant(state, { compute: 2000 }),
      message: 'Capacity scaled up. 2000 Compute.',
    }),
  },
  {
    code: 'refreshnow',
    category: 'army',
    describe: 'Every unit you own is healed and has its moves back.',
    apply: ({ state }) => {
      const units = new Map(state.units);
      let touched = 0;
      for (const [id, unit] of units) {
        if (unit.factionId !== PLAYER_FACTION_ID) continue;
        units.set(id, {
          ...unit,
          hp: unitType(unit.typeId).maxHp,
          movesLeft: unitType(unit.typeId).movement,
        });
        touched += 1;
      }
      return {
        ok: touched > 0,
        state: touched > 0 ? { ...state, units } : undefined,
        message:
          touched > 0
            ? `Refreshed ${touched} unit${touched === 1 ? '' : 's'}.`
            : 'You have nothing left to refresh.',
      };
    },
  },
  {
    code: 'directlake',
    category: 'army',
    describe: 'A Direct Lake Titan reports for duty.',
    apply: ({ state }) => {
      const anchor = playerAnchor(state);
      if (!anchor) return { ok: false, message: 'You have nowhere to muster.' };
      const next = conjure(state, 'directLakeTitan', anchor);
      return next
        ? { ok: true, state: next, message: 'A Direct Lake Titan takes the field.' }
        : { ok: false, message: 'No room beside your capital.' };
    },
  },
  {
    code: 'mirrored',
    category: 'army',
    describe: 'Duplicate the selected unit.',
    apply: ({ state, selectedUnitId }) => {
      const unit = selectedUnitId ? state.units.get(selectedUnitId) : undefined;
      if (!unit || unit.factionId !== PLAYER_FACTION_ID) {
        return { ok: false, message: 'Select one of your own units first.' };
      }
      const next = conjure(state, unit.typeId, unit.hex);
      return next
        ? {
            ok: true,
            state: next,
            message: `Mirrored: a second ${unitType(unit.typeId).label}.`,
          }
        : { ok: false, message: 'No room beside that unit.' };
    },
  },
  {
    code: 'provision',
    category: 'army',
    takesArgument: true,
    describe: 'provision <unit>: muster any unit beside your capital. Bare code lists them.',
    apply: ({ state, argument }) => {
      // ⚠️ `UNIT_TYPES` is a Record keyed by id, not an array.
      const types = Object.values(UNIT_TYPES).map((t) => t.id);
      if (!argument) {
        return { ok: false, message: `Provision what? ${types.join(', ')}` };
      }
      /*
       * ⚠️ Matched against the id with punctuation and case stripped, because
       * the console has already removed the spaces: a player typing
       * "provision direct lake titan" arrives here as "directlaketitan", and
       * refusing that while accepting "directLakeTitan" would be a riddle.
       */
      const wanted = types.find((id: UnitTypeId) => id.toLowerCase() === argument);
      if (!wanted) {
        return { ok: false, message: `No such unit: ${argument}. Try one of ${types.join(', ')}` };
      }
      const anchor = playerAnchor(state);
      if (!anchor) return { ok: false, message: 'You have nowhere to muster.' };
      const next = conjure(state, wanted, anchor);
      return next
        ? { ok: true, state: next, message: `${unitType(wanted).label} reports for duty.` }
        : { ok: false, message: 'No room beside your capital.' };
    },
  },
  {
    code: 'noisyneighbour',
    category: 'war',
    describe: 'A hostile ring closes on your town, ready to storm it next turn.',
    apply: ({ state }) => {
      const town = playerTown(state);
      if (!town) return { ok: false, message: 'You have no town to besiege.' };

      const spots = openNeighbours(state, town.hex);
      /*
       * ⚠️ A full ring is not a failure. Somebody already besieging the town
       * is the state this code exists to produce, so reporting "no room" there
       * tells the player the code is broken at the moment it has nothing left
       * to do. Only a ring with no hostiles AND no space is a real refusal.
       */
      const already = hexNeighbours(town.hex).filter((hex) => {
        const sitting = unitAt(state, hex);
        return sitting !== undefined && sitting.factionId !== PLAYER_FACTION_ID;
      }).length;
      if (spots.length === 0) {
        return already > 0
          ? { ok: true, message: `${town.name} is already invested by ${already}. End the turn.` }
          : { ok: false, message: 'No room around your town.' };
      }

      const units = new Map(state.units);
      let id = state.nextEntityId;
      for (const hex of spots) {
        const key = `siege-${id}`;
        units.set(key, {
          id: key,
          typeId: 'pipelineRunner',
          factionId: ANTAGONIST_FACTION_ID,
          hex,
          hp: 100,
          /*
           * ⚠️ Moves left, unlike the other spawn codes. A besieger with a
           * spent turn just stands there, and the whole point of this code is
           * to watch the assault land on the next End turn.
           */
          movesLeft: 1,
          fortified: false,
        });
        id += 1;
      }
      return {
        ok: true,
        state: { ...state, units, nextEntityId: id },
        message: `${spots.length} raiders invest ${town.name}. End the turn to be attacked.`,
      };
    },
  },
  {
    code: 'firewall',
    category: 'war',
    describe: 'A walled rival town appears next door, to practise assaults on.',
    apply: ({ state, selectedUnitId }) => {
      const anchor = selectedUnitId ? state.units.get(selectedUnitId)?.hex : playerAnchor(state);
      if (!anchor) return { ok: false, message: 'Select a unit, or found something first.' };

      const spot = nearestFreeSpot(state, anchor);
      if (!spot) return { ok: false, message: 'Nowhere within reach to build it.' };

      const id = `fort-${state.nextEntityId}`;
      const cities = new Map(state.cities);
      /*
       * ⚠️ Every field written out, not spread from an existing town.
       * The first draft used `...(playerTown(state) ?? {})` as a base, which
       * quietly inherits whatever that town happens to be building and breaks
       * entirely for a player who has not founded one.
       */
      cities.set(id, {
        id,
        factionId: ANTAGONIST_FACTION_ID,
        hex: spot,
        name: 'Bastion',
        kind: 'workspace',
        hp: 200,
        wallLevel: MAX_WALL_LEVEL,
        wallHp: maxWallHp(MAX_WALL_LEVEL),
        population: 4,
        rank: 'siedlung',
        growthStore: 0,
        boundSkills: [],
        unrest: 0,
        ignoredReviews: 0,
        reviewBonusUntilTurn: 0,
        lastReviewTurn: -1,
        productionProgress: 0,
        lastRaidedTurn: -1,
      } as never);
      return {
        ok: true,
        state: { ...state, cities, nextEntityId: state.nextEntityId + 1 },
        message: 'A walled Bastion stands next door. Attack it to see the tactics.',
      };
    },
  },
  {
    code: 'spill',
    category: 'war',
    describe: 'Your town drops to half health, so you can see what damage looks like.',
    apply: ({ state }) => {
      const town = playerTown(state);
      if (!town) return { ok: false, message: 'You have no town to damage.' };
      const cities = new Map(state.cities);
      cities.set(town.id, { ...town, hp: Math.max(1, Math.floor(town.hp / 2)) });
      return {
        ok: true,
        state: { ...state, cities },
        message: `${town.name} is battered. It will not mend on its own.`,
      };
    },
  },
  {
    code: 'scaleup',
    category: 'world',
    describe: 'Your town gains the citizens for its next rank.',
    apply: ({ state }) => {
      const town = playerTown(state);
      if (!town) return { ok: false, message: 'You have no town to grow.' };

      /*
       * ⚠️ Grants POPULATION, not the rank itself.
       *
       * Promotion also needs retained knowledge, and that lives on the other
       * side of the D35 line in the spaced-repetition data. A code that set
       * `rank` directly would step over the one gate this game exists to make
       * you earn, and would leave a Township whose Library says nothing is
       * known. This hands over the half that is a game resource and leaves the
       * half that is learning alone.
       */
      const cities = new Map(state.cities);
      cities.set(town.id, { ...town, population: town.population + 4 });
      const next = promotionFor({ ...town, population: town.population + 4 }, () => 1);
      return {
        ok: true,
        state: { ...state, cities },
        message: next
          ? `${town.name} has the citizens for ${rankInfo(next.id).label}.`
          : `${town.name} grows by four citizens.`,
      };
    },
  },
  {
    code: 'lineage',
    category: 'world',
    describe: 'Trace the whole map: every tile becomes explored.',
    apply: ({ state, seat }) => {
      const seen = memoryOf(state, seat);
      const explored = new Set(seen.explored);
      const before = explored.size;
      for (const key of state.map.tiles.keys()) explored.add(key);
      /*
       * ⚠️ Explored, NOT visible, and the difference is the point. This lifts
       * the black; it does not hand over a live feed of what is standing on
       * the ground now. Towns still have to be walked past before they are
       * remembered, which keeps the memory honest about what was actually
       * seen.
       */
      return {
        ok: true,
        state: { ...state, memory: new Map(state.memory).set(seat, { ...seen, explored }) },
        message: `${explored.size - before} tiles traced. What stands on them is still yours to find.`,
      };
    },
  },
  {
    code: 'adminportal',
    category: 'world',
    describe: 'Lift the fog completely: every army and town, live. Type it again to drop it.',
    apply: ({ liftFog }) => {
      /*
       * The other half of `lineage`, and the two are deliberately separate.
       *
       * `lineage` marks ground explored, which lifts the black and leaves the
       * map honest: you still have to walk past a town to know it is there.
       * This is the tenant-admin view, and it shows the things as well as the
       * ground, live, including the seven camps the opening works hard not to
       * give away.
       *
       * ⚠️ **It changes nothing in the save, and that is why it can be turned
       * off.** Every other world code writes state; this one flips a view flag,
       * so dropping the fog again puts the player back exactly where they were
       * rather than leaving them with a map they never actually scouted. The
       * use is still recorded in `cheatsUsed` and still shows on the victory
       * screen, because that is the part that has to survive.
       */
      const now = liftFog();
      return {
        ok: true,
        message: now
          ? 'The whole tenant, live. Nothing is hidden while this is on.'
          : 'The fog closes again. You know only what you actually scouted.',
      };
    },
  },
  {
    code: 'shortcut',
    category: 'treasury',
    describe: 'A buried cache appears beside your Profiler, to dig up.',
    apply: ({ state, selectedUnitId }) => {
      /*
       * ⚠️ Placed next to a PROFILER specifically, because only a Profiler can
       * open one. Dropping it beside an Architect would look like the code had
       * worked and then nothing would ever happen, which is the most annoying
       * kind of test affordance.
       */
      const digger = selectedUnitId ? state.units.get(selectedUnitId) : undefined;
      const profiler =
        digger?.typeId === 'profiler'
          ? digger
          : unitsOf(state, PLAYER_FACTION_ID).find((u) => u.typeId === 'profiler');
      if (!profiler) return { ok: false, message: 'You have no Profiler to dig with.' };

      const spot = nearestFreeSpot(state, profiler.hex);
      if (!spot) return { ok: false, message: 'Nowhere within reach to bury it.' };

      const id = `treasure-${state.nextEntityId}`;
      const treasures = new Map(state.treasures);
      treasures.set(id, { id, hex: spot, resource: 'compute', amount: 60 });
      return {
        ok: true,
        state: { ...state, treasures, nextEntityId: state.nextEntityId + 1 },
        message: 'A cache is buried beside your Profiler. Walk onto it.',
      };
    },
  },
  {
    code: 'dropthetable',
    category: 'war',
    describe: 'Every rival unit is destroyed. Their villages still stand.',
    apply: ({ state }) => {
      const units = new Map(state.units);
      let removed = 0;
      for (const [id, unit] of units) {
        if (unit.factionId === PLAYER_FACTION_ID) continue;
        units.delete(id);
        removed += 1;
      }
      return {
        ok: removed > 0,
        state: removed > 0 ? { ...state, units } : undefined,
        // Villages are deliberately spared: Conquest still has to be earned
        // by walking in and taking them, which is where the questions are.
        message:
          removed > 0
            ? `${removed} rival unit${removed === 1 ? '' : 's'} dropped. The villages remain.`
            : 'Nothing left to drop.',
      };
    },
  },
  {
    code: 'iknowthis',
    category: 'exam',
    describe:
      'Finish the topic you are funding without answering. The Library is not fooled.',
    apply: ({ state }) => {
      const current = state.research.current;
      if (!current) return { ok: false, message: 'You are not researching anything.' };
      /*
       * ⚠️ Writes to the tech tree, never to mastery.
       *
       * `research.known` is a GAME gate: it unlocks units and buildings. The
       * Great Library and the readiness figure are built from `mastery`, which
       * only records questions genuinely answered. So this buys the unlock and
       * leaves the topic showing as unlearned in the one place that decides
       * whether you are told you are ready.
       */
      return {
        ok: true,
        state: {
          ...state,
          research: {
            known: [...state.research.known, current],
            current: undefined,
            progress: 0,
          },
        },
        message: 'Learned, as far as the empire is concerned. The Library disagrees.',
      };
    },
  },
  {
    code: 'sitthepaper',
    category: 'exam',
    describe: 'Summon the Proctor now. You still have to pass.',
    apply: ({ faceProctor }) => {
      faceProctor();
      return { ok: true, message: 'The Proctor is called early. Forty questions.' };
    },
  },
]);

export function findCheat(input: string): Cheat | undefined {
  return matchCheat(input)?.cheat;
}

export interface CheatMatch {
  readonly cheat: Cheat;
  /** Whatever followed the code. Empty unless the cheat takes an argument. */
  readonly argument: string;
}

/**
 * Resolve typed text to a code and its argument.
 *
 * ⚠️ Exact match first, then the longest matching prefix among codes that
 * actually take an argument. Longest wins so that adding a code which happens
 * to start with an existing one cannot silently capture it, and only
 * argument-taking codes are considered so a typo stays a typo rather than
 * becoming a near-miss that runs something.
 */
export function matchCheat(input: string): CheatMatch | undefined {
  const code = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!code) return undefined;

  const exact = CHEATS.find((c) => c.code === code);
  if (exact) return { cheat: exact, argument: '' };

  const prefixed = CHEATS.filter((c) => c.takesArgument && code.startsWith(c.code)).sort(
    (a, b) => b.code.length - a.code.length,
  )[0];
  if (!prefixed) return undefined;
  return { cheat: prefixed, argument: code.slice(prefixed.code.length) };
}

/** The width the help listing needs, so a long code cannot collide with its text. */
export const CHEAT_CODE_WIDTH = Math.max(...CHEATS.map((c) => c.code.length), 3) + 2;
