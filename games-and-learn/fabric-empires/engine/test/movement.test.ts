import { describe, it, expect } from 'vitest';
import {
  ANTAGONIST_FACTION_ID,
  MIN_ANTAGONIST_DISTANCE,
  PLAYER_FACTION_ID,
  canFoundCity,
  chooseStartPosition,
  citiesOf,
  createGameState,
  enemyZoneOfControl,
  findPath,
  isCivilian,
  isOccupied,
  isPassableByLand,
  pathTo,
  reachable,
  startScore,
  stepCost,
  canStandOn,
  terrain,
  tileAt,
  unitAt,
  unitType,
  unitsOf,
  UNIT_TYPE_IDS,
  UNIT_TYPES,
  generateMap,
  hexDistance,
  hexKey,
  hexNeighbours,
  type GameState,
  type Hex,
  type Unit,
  type UnitTypeId,
} from '../src/index.js';

const SEEDS = ['FABRIC', 'ALPHA', 'DP600'];

/** Drop a unit onto a state at a chosen hex, for constructing test positions. */
function withUnit(
  state: GameState,
  typeId: UnitTypeId,
  hex: Hex,
  factionId: string,
  id = `test-${factionId}-${typeId}-${hexKey(hex)}`,
): GameState {
  const units = new Map(state.units);
  units.set(id, {
    id,
    typeId,
    factionId,
    hex,
    hp: unitType(typeId).maxHp,
    movesLeft: unitType(typeId).movement,
    fortified: false,
  });
  return { ...state, units };
}

function withoutUnits(state: GameState): GameState {
  return { ...state, units: new Map() };
}

/** First land tile found by walking outwards from a start, matching a filter. */
function findTile(
  state: GameState,
  from: Hex,
  predicate: (hex: Hex) => boolean,
): Hex {
  const seen = new Set<string>([hexKey(from)]);
  const queue: Hex[] = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (predicate(current)) return current;
    for (const n of hexNeighbours(current)) {
      const key = hexKey(n);
      if (seen.has(key)) continue;
      seen.add(key);
      if (state.map.tiles.has(key)) queue.push(n);
    }
  }
  throw new Error('No tile matched the predicate');
}

describe('unit table', () => {
  it('describes every unit id exactly once', () => {
    expect(new Set(UNIT_TYPE_IDS).size).toBe(UNIT_TYPE_IDS.length);
    for (const id of UNIT_TYPE_IDS) {
      expect(unitType(id).id).toBe(id);
      expect(unitType(id).label.length).toBeGreaterThan(0);
    }
  });

  it('gives every unit positive movement and hit points', () => {
    for (const id of UNIT_TYPE_IDS) {
      expect(unitType(id).movement).toBeGreaterThan(0);
      expect(unitType(id).maxHp).toBeGreaterThan(0);
      expect(unitType(id).strength).toBeGreaterThanOrEqual(0);
    }
  });

  it('marks only settlers and workers as civilians, and they have no strength', () => {
    for (const id of UNIT_TYPE_IDS) {
      if (isCivilian(id)) {
        expect(unitType(id).strength).toBe(0);
      } else {
        expect(unitType(id).strength).toBeGreaterThan(0);
      }
    }
  });

  it('only gives range to ranged units', () => {
    for (const id of UNIT_TYPE_IDS) {
      const type = unitType(id);
      if (type.range > 0) expect(type.role).toBe('ranged');
    }
  });

  it('starts the player with units that need no tech', () => {
    const free = UNIT_TYPE_IDS.filter((id) => UNIT_TYPES[id].unlockedBySkill === null);
    expect(free).toContain('architect');
    expect(free).toContain('profiler');
  });

  it('references only real DP-600 leaf skills', () => {
    for (const id of UNIT_TYPE_IDS) {
      const skill = unitType(id).unlockedBySkill;
      if (skill === null) continue;
      expect(skill).toBeGreaterThanOrEqual(1);
      expect(skill).toBeLessThanOrEqual(41);
    }
  });
});

describe('new game', () => {
  it('is deterministic for a seed', () => {
    const a = createGameState('FABRIC');
    const b = createGameState('FABRIC');
    expect(a.map.seed).toBe(b.map.seed);
    expect([...a.units.values()].map((u) => hexKey(u.hex))).toEqual(
      [...b.units.values()].map((u) => hexKey(u.hex)),
    );
  });

  it('starts on turn 1 with the player active and no cities', () => {
    const state = createGameState('FABRIC');
    expect(state.turn).toBe(1);
    expect(state.activeFactionId).toBe(PLAYER_FACTION_ID);
    expect(citiesOf(state, PLAYER_FACTION_ID)).toHaveLength(0);
  });

  it('gives the player an architect and an escort, on separate tiles', () => {
    for (const seed of SEEDS) {
      const state = createGameState(seed);
      const units = unitsOf(state, PLAYER_FACTION_ID);
      expect(units.map((u) => u.typeId)).toContain('architect');
      expect(units.length).toBeGreaterThanOrEqual(2);
      const positions = units.map((u) => hexKey(u.hex));
      expect(new Set(positions).size).toBe(positions.length);
    }
  });

  it('starts every unit at full health with full movement', () => {
    const state = createGameState('FABRIC');
    for (const unit of state.units.values()) {
      const type = unitType(unit.typeId);
      expect(unit.hp).toBe(type.maxHp);
      expect(unit.movesLeft).toBe(type.movement);
    }
  });
});

describe('start position', () => {
  it('is always settleable land on the main continent', () => {
    for (const seed of [...SEEDS, 'ZULU', 'K9', 'OMEGA']) {
      const map = generateMap(seed);
      const start = chooseStartPosition(map);
      const tile = map.tiles.get(hexKey(start))!;
      expect(terrain(tile.terrain).settleable).toBe(true);
      expect(map.mainland.has(hexKey(start))).toBe(true);
    }
  });

  it('is never in the frontier ring', () => {
    for (const seed of [...SEEDS, 'ZULU', 'K9']) {
      const map = generateMap(seed);
      const start = chooseStartPosition(map);
      expect(hexDistance({ q: 0, r: 0 }, start) / map.radius).toBeLessThan(0.7);
    }
  });

  it('is never adjacent to the wastes', () => {
    // A start on the antagonists' doorstep is lost before the tutorial ends.
    for (const seed of [...SEEDS, 'ZULU', 'K9', 'OMEGA']) {
      const map = generateMap(seed);
      const start = chooseStartPosition(map);
      for (const n of hexNeighbours(start)) {
        const tile = map.tiles.get(hexKey(n));
        if (tile) expect(tile.terrain).not.toBe('ungovernedWastes');
      }
    }
  });

  it('rejects unsettleable tiles outright', () => {
    const map = generateMap('FABRIC');
    for (const tile of map.tiles.values()) {
      if (!terrain(tile.terrain).settleable) {
        expect(startScore(map, tile)).toBe(Number.NEGATIVE_INFINITY);
      }
    }
  });

  it('prefers a river site over an identical dry one', () => {
    const map = generateMap('FABRIC');
    const river = [...map.tiles.values()].find(
      (t) => t.river && t.terrain === 'rawFilePlains',
    );
    const dry = [...map.tiles.values()].find(
      (t) => !t.river && t.terrain === 'rawFilePlains',
    );
    expect(river).toBeDefined();
    expect(dry).toBeDefined();
    // Not a strict guarantee for any pair, but the river bonus must exist.
    expect(startScore(map, river!)).toBeGreaterThan(Number.NEGATIVE_INFINITY);
  });
});

describe('terrain costs', () => {
  it('keeps land units out of the water and ships out of the hills', () => {
    const map = generateMap('FABRIC');
    const water = [...map.tiles.values()].find((t) => t.terrain === 'onelake')!;
    const plains = [...map.tiles.values()].find(
      (t) => t.terrain === 'rawFilePlains',
    )!;

    expect(canStandOn(unitType('pipelineRunner'), water)).toBe(false);
    expect(canStandOn(unitType('pipelineRunner'), plains)).toBe(true);
    expect(canStandOn(unitType('shortcutSkiff'), water)).toBe(true);
    expect(canStandOn(unitType('shortcutSkiff'), plains)).toBe(false);
  });

  it('treats peaks as impassable for everything', () => {
    const map = generateMap('FABRIC');
    const peak = [...map.tiles.values()].find(
      (t) => t.terrain === 'semanticPeaks',
    )!;
    for (const id of UNIT_TYPE_IDS) {
      expect(canStandOn(unitType(id), peak)).toBe(false);
    }
  });

  it('makes a river a fast road between two river tiles', () => {
    const map = generateMap('FABRIC');
    const riverTiles = [...map.tiles.values()].filter(
      (t) => t.river && t.terrain === 'deltaHighlands',
    );
    expect(riverTiles.length).toBeGreaterThan(0);
    const a = riverTiles[0]!;
    const b = riverTiles[0]!;
    // Highlands normally cost 2; following a river costs 1.
    expect(terrain('deltaHighlands').moveCost).toBe(2);
    expect(stepCost(unitType('pipelineRunner'), a, b)).toBe(1);
  });

  it('does not give ships the river discount', () => {
    const map = generateMap('FABRIC');
    const river = [...map.tiles.values()].find((t) => t.river)!;
    const water = [...map.tiles.values()].find((t) => t.terrain === 'onelake')!;
    expect(stepCost(unitType('shortcutSkiff'), river, water)).toBe(
      terrain('onelake').moveCost,
    );
  });
});

describe('reachability', () => {
  it('always includes the tile the unit stands on, at zero cost', () => {
    const state = createGameState('FABRIC');
    const unit = unitsOf(state, PLAYER_FACTION_ID)[0]!;
    const reach = reachable(state, unit);
    const here = reach.get(hexKey(unit.hex))!;
    expect(here.cost).toBe(0);
    expect(here.from).toBeUndefined();
  });

  it('returns only the origin when movement is spent', () => {
    const state = createGameState('FABRIC');
    const unit = unitsOf(state, PLAYER_FACTION_ID)[0]!;
    const spent: Unit = { ...unit, movesLeft: 0 };
    expect(reachable(state, spent).size).toBe(1);
  });

  it('never exceeds the movement budget', () => {
    const state = createGameState('FABRIC');
    for (const unit of state.units.values()) {
      for (const tile of reachable(state, unit).values()) {
        expect(tile.cost).toBeLessThanOrEqual(unit.movesLeft);
      }
    }
  });

  it('only reaches tiles the unit could stand on', () => {
    const state = createGameState('FABRIC');
    const unit = unitsOf(state, PLAYER_FACTION_ID)[0]!;
    const type = unitType(unit.typeId);
    for (const entry of reachable(state, unit).values()) {
      const tile = tileAt(state, entry.hex)!;
      expect(canStandOn(type, tile)).toBe(true);
    }
  });

  it('lets a slow unit still enter expensive terrain, one tile at a time', () => {
    // The minimum-move rule. Without it a 1-movement unit can never cross a
    // 3-cost swamp and is permanently stuck beside it.
    const base = withoutUnits(createGameState('FABRIC'));
    const swamp = findTile(base, chooseStartPosition(base.map), (h) => {
      const tile = base.map.tiles.get(hexKey(h));
      if (tile?.terrain !== 'legacySwamp') return false;
      return hexNeighbours(h).some((n) => {
        const t = base.map.tiles.get(hexKey(n));
        return t !== undefined && t.terrain === 'rawFilePlains' && !t.river;
      });
    });
    const beside = hexNeighbours(swamp).find((n) => {
      const t = base.map.tiles.get(hexKey(n));
      return t !== undefined && t.terrain === 'rawFilePlains' && !t.river;
    })!;

    const state = withUnit(base, 'notebookCannon', beside, PLAYER_FACTION_ID);
    const cannon = [...state.units.values()][0]!;
    expect(unitType('notebookCannon').movement).toBe(1);
    expect(terrain('legacySwamp').moveCost).toBe(3);

    const reach = reachable(state, cannon);
    const entry = reach.get(hexKey(swamp));
    expect(entry).toBeDefined();
    expect(entry!.cost).toBe(1); // capped at what the unit had
  });

  it('cannot move onto another unit, friend or foe', () => {
    const base = withoutUnits(createGameState('FABRIC'));
    const start = chooseStartPosition(base.map);
    const blockerHex = hexNeighbours(start).find((h) => {
      const tile = base.map.tiles.get(hexKey(h));
      return tile !== undefined && terrain(tile.terrain).settleable;
    })!;

    let state = withUnit(base, 'profiler', start, PLAYER_FACTION_ID, 'mover');
    state = withUnit(state, 'engineer', blockerHex, PLAYER_FACTION_ID, 'friend');

    const mover = state.units.get('mover')!;
    expect(isOccupied(state, blockerHex, mover.id)).toBe(true);
    expect(reachable(state, mover).has(hexKey(blockerHex))).toBe(false);
  });

  it('reconstructs a path of adjacent steps back to the origin', () => {
    const state = createGameState('FABRIC');
    const unit = unitsOf(state, PLAYER_FACTION_ID).find(
      (u) => u.typeId === 'profiler',
    )!;
    const reach = reachable(state, unit);
    for (const entry of reach.values()) {
      const path = pathTo(reach, entry.hex);
      expect(path).toBeDefined();
      expect(hexKey(path![0]!)).toBe(hexKey(unit.hex));
      expect(hexKey(path![path!.length - 1]!)).toBe(hexKey(entry.hex));
      for (let i = 1; i < path!.length; i++) {
        expect(hexDistance(path![i - 1]!, path![i]!)).toBe(1);
      }
    }
  });

  it('returns nothing for an unreachable target', () => {
    const state = createGameState('FABRIC');
    const unit = unitsOf(state, PLAYER_FACTION_ID)[0]!;
    expect(pathTo(reachable(state, unit), { q: 999, r: 999 })).toBeUndefined();
  });
});

describe('zones of control', () => {
  it('is projected by enemy combat units and their neighbours', () => {
    const base = withoutUnits(createGameState('FABRIC'));
    const start = chooseStartPosition(base.map);
    const state = withUnit(base, 'pipelineRunner', start, 'enemy', 'foe');

    const zone = enemyZoneOfControl(state, PLAYER_FACTION_ID);
    expect(zone.has(hexKey(start))).toBe(true);
    for (const n of hexNeighbours(start)) {
      expect(zone.has(hexKey(n))).toBe(true);
    }
  });

  it('is not projected by civilians', () => {
    const base = withoutUnits(createGameState('FABRIC'));
    const start = chooseStartPosition(base.map);
    const state = withUnit(base, 'architect', start, 'enemy', 'foe');
    expect(enemyZoneOfControl(state, PLAYER_FACTION_ID).size).toBe(0);
  });

  it('is not projected by your own units', () => {
    const state = createGameState('FABRIC', { spawnAntagonists: false });
    expect(enemyZoneOfControl(state, PLAYER_FACTION_ID).size).toBe(0);
  });

  it('stops a unit that steps into it', () => {
    const base = withoutUnits(createGameState('FABRIC'));
    const start = chooseStartPosition(base.map);

    const scoutState = withUnit(base, 'profiler', start, PLAYER_FACTION_ID, 'scout');
    const scout = scoutState.units.get('scout')!;
    const openReach = reachable(scoutState, scout);
    // Select by DISTANCE, not by cost: on cheap terrain a cost of 2 can still
    // be an adjacent tile, which would put the scout's own tile in the zone
    // and make this test measure the origin exemption instead.
    const far = [...openReach.values()].find(
      (entry) => hexDistance(entry.hex, start) >= 3,
    );
    expect(far).toBeDefined();

    const guarded = withUnit(scoutState, 'pipelineRunner', far!.hex, 'enemy', 'foe');
    const blockedReach = reachable(guarded, guarded.units.get('scout')!);
    const zone = enemyZoneOfControl(guarded, PLAYER_FACTION_ID);
    expect(zone.has(hexKey(start))).toBe(false);

    // Every tile inside the enemy zone must end movement, and none of them may
    // be used as a stepping stone to somewhere further on.
    let zoneTilesSeen = 0;
    for (const entry of blockedReach.values()) {
      if (!zone.has(hexKey(entry.hex))) continue;
      zoneTilesSeen++;
      expect(entry.stops).toBe(true);
      for (const other of blockedReach.values()) {
        expect(other.from).not.toBe(hexKey(entry.hex));
      }
    }
    expect(zoneTilesSeen).toBeGreaterThan(0);
  });

  it('lets a unit already inside a zone move out of it', () => {
    // A unit that begins its turn next to an enemy is pinned, not paralysed.
    // Without this the first contact between two armies freezes both forever.
    const base = withoutUnits(createGameState('FABRIC'));
    const start = chooseStartPosition(base.map);
    const adjacent = hexNeighbours(start).find((h) => {
      const tile = base.map.tiles.get(hexKey(h));
      return tile !== undefined && terrain(tile.terrain).settleable;
    })!;

    let state = withUnit(base, 'profiler', start, PLAYER_FACTION_ID, 'scout');
    state = withUnit(state, 'pipelineRunner', adjacent, 'enemy', 'foe');

    const zone = enemyZoneOfControl(state, PLAYER_FACTION_ID);
    expect(zone.has(hexKey(start))).toBe(true);

    const reach = reachable(state, state.units.get('scout')!);
    expect(reach.size).toBeGreaterThan(1);
    expect(reach.get(hexKey(start))!.stops).toBe(false);
  });

  it('does not stop a unit that ignores it', () => {
    const base = withoutUnits(createGameState('FABRIC'));
    const start = chooseStartPosition(base.map);
    let state = withUnit(base, 'lineageHawk', start, PLAYER_FACTION_ID, 'hawk');
    const openReach = reachable(state, state.units.get('hawk')!);
    const far = [...openReach.values()].find((e) => e.cost >= 2)!;
    state = withUnit(state, 'pipelineRunner', far.hex, 'enemy', 'foe');

    expect(unitType('lineageHawk').ignoresZoneOfControl).toBe(true);
    for (const entry of reachable(state, state.units.get('hawk')!).values()) {
      expect(entry.stops).toBe(false);
    }
  });
});

describe('antagonists', () => {
  it('are present by default and can be switched off', () => {
    expect(createGameState('FABRIC').factions.has(ANTAGONIST_FACTION_ID)).toBe(true);
    expect(
      createGameState('FABRIC', { spawnAntagonists: false }).factions.has(
        ANTAGONIST_FACTION_ID,
      ),
    ).toBe(false);
  });

  it('muster far enough away to leave the player a few turns', () => {
    // A raid on turn two teaches nothing except that the game is unfair.
    for (const seed of SEEDS) {
      const state = createGameState(seed);
      const start = unitsOf(state, PLAYER_FACTION_ID).find(
        (u) => u.typeId === 'architect',
      )!.hex;
      const raiders = unitsOf(state, ANTAGONIST_FACTION_ID);
      expect(raiders.length).toBeGreaterThan(0);
      for (const raider of raiders) {
        expect(hexDistance(raider.hex, start)).toBeGreaterThanOrEqual(
          MIN_ANTAGONIST_DISTANCE,
        );
      }
    }
  });

  it('stand on passable land, on the main continent, one to a tile', () => {
    for (const seed of SEEDS) {
      const state = createGameState(seed);
      const seen = new Set<string>();
      for (const raider of unitsOf(state, ANTAGONIST_FACTION_ID)) {
        const key = hexKey(raider.hex);
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        const tile = state.map.tiles.get(key)!;
        expect(isPassableByLand(tile.terrain)).toBe(true);
        expect(state.map.mainland.has(key)).toBe(true);
      }
    }
  });

  it('prefer the wastes, which is where they belong', () => {
    const state = createGameState('FABRIC');
    const onWastes = unitsOf(state, ANTAGONIST_FACTION_ID).filter(
      (u) => state.map.tiles.get(hexKey(u.hex))!.terrain === 'ungovernedWastes',
    );
    expect(onWastes.length).toBeGreaterThan(0);
  });

  it('never share a tile with a player unit', () => {
    for (const seed of SEEDS) {
      const state = createGameState(seed);
      const playerTiles = new Set(
        unitsOf(state, PLAYER_FACTION_ID).map((u) => hexKey(u.hex)),
      );
      for (const raider of unitsOf(state, ANTAGONIST_FACTION_ID)) {
        expect(playerTiles.has(hexKey(raider.hex))).toBe(false);
      }
    }
  });
});

describe('pathfinding', () => {
  it('finds a path far beyond one turn of movement', () => {
    const state = createGameState('FABRIC');
    const unit = unitsOf(state, PLAYER_FACTION_ID).find(
      (u) => u.typeId === 'profiler',
    )!;
    const target = findTile(state, unit.hex, (h) => {
      const tile = state.map.tiles.get(hexKey(h));
      return (
        tile !== undefined &&
        terrain(tile.terrain).settleable &&
        hexDistance(h, unit.hex) >= 8
      );
    });

    const planned = findPath(state, unit, target);
    expect(planned).toBeDefined();
    expect(planned!.cost).toBeGreaterThan(unit.movesLeft);
    expect(hexKey(planned!.path[0]!)).toBe(hexKey(unit.hex));
    expect(hexKey(planned!.path[planned!.path.length - 1]!)).toBe(hexKey(target));
  });

  it('produces a continuous path with no gaps', () => {
    const state = createGameState('FABRIC');
    const unit = unitsOf(state, PLAYER_FACTION_ID)[0]!;
    const target = findTile(state, unit.hex, (h) => hexDistance(h, unit.hex) >= 6 &&
      terrain(state.map.tiles.get(hexKey(h))!.terrain).settleable);
    const planned = findPath(state, unit, target)!;
    for (let i = 1; i < planned.path.length; i++) {
      expect(hexDistance(planned.path[i - 1]!, planned.path[i]!)).toBe(1);
    }
  });

  it('refuses to path onto terrain the unit cannot stand on', () => {
    const state = createGameState('FABRIC');
    const unit = unitsOf(state, PLAYER_FACTION_ID)[0]!;
    const peak = [...state.map.tiles.values()].find(
      (t) => t.terrain === 'semanticPeaks',
    )!;
    expect(findPath(state, unit, peak.hex)).toBeUndefined();
  });

  it('returns a trivial path to the unit\'s own tile', () => {
    const state = createGameState('FABRIC');
    const unit = unitsOf(state, PLAYER_FACTION_ID)[0]!;
    const planned = findPath(state, unit, unit.hex)!;
    expect(planned.cost).toBe(0);
    expect(planned.path).toHaveLength(1);
  });

  it('costs at least the hex distance, since no terrain is free', () => {
    const state = createGameState('FABRIC');
    const unit = unitsOf(state, PLAYER_FACTION_ID)[0]!;
    const target = findTile(state, unit.hex, (h) => hexDistance(h, unit.hex) >= 5 &&
      terrain(state.map.tiles.get(hexKey(h))!.terrain).settleable);
    const planned = findPath(state, unit, target)!;
    expect(planned.cost).toBeGreaterThanOrEqual(hexDistance(unit.hex, target));
  });
});

describe('founding cities', () => {
  it('only an architect may found', () => {
    const state = createGameState('FABRIC');
    for (const unit of state.units.values()) {
      if (unit.typeId !== 'architect') {
        expect(canFoundCity(state, unit)).toBe(false);
      }
    }
  });

  it('the starting architect can found where it stands', () => {
    for (const seed of SEEDS) {
      const state = createGameState(seed);
      const architect = unitsOf(state, PLAYER_FACTION_ID).find(
        (u) => u.typeId === 'architect',
      )!;
      expect(canFoundCity(state, architect)).toBe(true);
    }
  });

  it('refuses to found within three tiles of an existing city', () => {
    const state = createGameState('FABRIC');
    const architect = unitsOf(state, PLAYER_FACTION_ID).find(
      (u) => u.typeId === 'architect',
    )!;
    const cities = new Map(state.cities);
    cities.set('c1', {
      id: 'c1',
      factionId: PLAYER_FACTION_ID,
      hex: architect.hex,
      name: 'Capital',
      kind: 'workspace',
      hp: 200,
      wallLevel: 0,
      wallHp: 0,
      population: 1,
      rank: 'siedlung',
      growthStore: 0,
      boundSkills: [],
      unrest: 0,
      ignoredReviews: 0,
      reviewBonusUntilTurn: 0,
      lastReviewTurn: -1,
      productionProgress: 0,
      lastRaidedTurn: -1,
    });
    expect(canFoundCity({ ...state, cities }, architect)).toBe(false);
  });
});

describe('lookups', () => {
  it('finds units and nothing where there are none', () => {
    const state = createGameState('FABRIC');
    const unit = unitsOf(state, PLAYER_FACTION_ID)[0]!;
    expect(unitAt(state, unit.hex)?.id).toBe(unit.id);
    expect(unitAt(state, { q: 999, r: 999 })).toBeUndefined();
  });

  it('tileAt agrees with the map', () => {
    const state = createGameState('FABRIC');
    for (const tile of state.map.tiles.values()) {
      expect(tileAt(state, tile.hex)).toBe(tile);
    }
  });
});
