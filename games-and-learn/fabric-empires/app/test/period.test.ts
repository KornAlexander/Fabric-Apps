/**
 * The period, and the scale contract behind it.
 *
 * ⚠️ **The rule this file exists to enforce is "a stronger unit is a bigger
 * crowd, never a bigger man".** The old units were scaled bodily by strength,
 * so a Direct Lake Titan was drawn at 1.5x an Architect: same object, inflated.
 * That is the exact thing the standing instruction on 3D scenes forbids, and
 * it is invisible in a screenshot because there is nothing beside it to
 * compare against.
 *
 * These tests build the real geometry. `buildUnit` needs no renderer and no
 * canvas, only three's maths, so the assertions here are measurements of the
 * actual objects the game puts on the map rather than greps for words in the
 * source that produced them.
 */

import { Box3, Mesh, type Group } from 'three';
import { describe, expect, it } from 'vitest';
import {
  UNIT_TYPE_IDS,
  unitType,
  type Unit,
  type UnitTypeId,
} from '@fabric-empires/engine';
import { buildUnit } from '../src/three/entities.js';

const FACTION = '#4c8fd6';

const make = (typeId: UnitTypeId): Group =>
  buildUnit(
    {
      id: `u-${typeId}`,
      typeId,
      factionId: 'player',
      hex: { q: 0, r: 0 },
      hp: 100,
      movesLeft: 2,
      fortified: false,
    } satisfies Unit,
    FACTION,
  );

/**
 * How far the stand reaches ABOVE the ground, measured, not declared.
 *
 * ⚠️ Not the bounding box's height. The base is a plinth that is deliberately
 * mostly underground, so the full box is a fifth of a unit taller than
 * anything a player can see, and measuring it reports a two metre soldier as
 * a four metre one.
 */
const standsProud = (group: Group): number => new Box3().setFromObject(group).max.y;

const meshCount = (group: Group): number => {
  let n = 0;
  group.traverse((o) => {
    if ((o as Mesh).isMesh) n += 1;
  });
  return n;
};

describe('every unit is a stand of figures', () => {
  it('builds one for every type in the roster', () => {
    for (const id of UNIT_TYPE_IDS) {
      const group = make(id);
      expect(group.userData.kind, id).toBe('unit');
      expect(meshCount(group), id).toBeGreaterThan(3);
    }
  });

  it('⚠️ never scales the whole unit, which is how a man gets bigger', () => {
    for (const id of UNIT_TYPE_IDS) {
      const group = make(id);
      expect(
        [group.scale.x, group.scale.y, group.scale.z],
        `${id} is scaled bodily`,
      ).toEqual([1, 1, 1]);
    }
  });

  it('⚠️ answers strength with more bodies, not taller ones', () => {
    /*
     * The Direct Lake Titan has three times the strength of a Pipeline Runner
     * and they are both blocks of pikemen. The Titan must be the heavier
     * block, and it must not be the block of giants.
     */
    const weakest = make('pipelineRunner');
    const strongest = make('directLakeTitan');
    expect(unitType('directLakeTitan').strength).toBeGreaterThan(
      unitType('pipelineRunner').strength,
    );

    expect(meshCount(strongest)).toBeGreaterThan(meshCount(weakest));
    // Same men, so the same height, give or take the deterministic slop in
    // how far each individual pike is leaning.
    expect(standsProud(strongest)).toBeCloseTo(standsProud(weakest), 1);
  });

  it('⚠️ keeps every soldier shorter than the house he is marching past', () => {
    /*
     * The cross-check that catches a figure quietly growing. A village house
     * stands about 0.35 to its ridge, and the tallest thing on a stand is a
     * pike or a flag, roughly a man and a half. If a stand ever approaches
     * the height of a building, the scale has drifted.
     */
    for (const id of UNIT_TYPE_IDS) {
      const height = standsProud(make(id));
      expect(height, `${id} stands ${height.toFixed(2)} above ground`).toBeLessThan(0.35);
      expect(height, `${id} has nothing standing on it`).toBeGreaterThan(0.05);
    }
  });

  it('⚠️ makes every foot stand the same height, because they are the same men', () => {
    /*
     * The sharper version of the rule. Twelve unit types, one man: a pike
     * block, a musket line, a gun crew and a party of pioneers must all come
     * out within a few centimetres of each other, because the only thing that
     * differs between them is what the men are holding.
     *
     * The boat is excluded and is the reason this is a separate test. A hoy
     * with a five metre mast really is taller than a soldier, and folding it
     * in would have meant loosening the bound until it stopped catching
     * anything.
     */
    const feet = UNIT_TYPE_IDS.filter((id) => unitType(id).domain !== 'water').map((id) => ({
      id,
      height: standsProud(make(id)),
    }));

    const tallest = feet.reduce((a, b) => (a.height > b.height ? a : b));
    const shortest = feet.reduce((a, b) => (a.height < b.height ? a : b));
    expect(
      tallest.height - shortest.height,
      `${tallest.id} towers over ${shortest.id}`,
    ).toBeLessThan(0.05);
  });

  it('gives every stand its faction colour somewhere', () => {
    for (const id of UNIT_TYPE_IDS) {
      let found = false;
      make(id).traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as { color?: { getHexString(): string } };
        if (mat.color && `#${mat.color.getHexString()}` === FACTION) found = true;
      });
      expect(found, `${id} shows nothing of whose it is`).toBe(true);
    }
  });
});

describe('⚠️ the elite melee units are knights, and the line unit is not', () => {
  /*
   * Three units share the role `melee` and used to share one drawing: a pike
   * block with more men in it. So a player's two most powerful units looked
   * exactly like the one they started the game with, which is a strange thing
   * for a strategy game to do with its top end.
   *
   * The split is by strength rather than by unit id, so a campaign that
   * invents its own roster inherits the same hierarchy.
   */
  const line = make('pipelineRunner');
  const colossus = make('semanticColossus');
  const titan = make('directLakeTitan');

  it('gives the heavy units more to draw than the line unit', () => {
    expect(unitType('semanticColossus').strength).toBeGreaterThan(
      unitType('pipelineRunner').strength,
    );
    expect(meshCount(colossus)).toBeGreaterThan(meshCount(line));
    expect(meshCount(titan)).toBeGreaterThan(meshCount(colossus));
  });

  it('keeps all three inside one stand, however grand they get', () => {
    // Knights are not an excuse to spill off the tray. A stand is a stand.
    for (const [name, group] of [
      ['line', line],
      ['colossus', colossus],
      ['titan', titan],
    ] as const) {
      const box = new Box3().setFromObject(group);
      const reach = Math.max(
        Math.abs(box.min.x),
        Math.abs(box.max.x),
        Math.abs(box.min.z),
        Math.abs(box.max.z),
      );
      // The tray is 0.46; a lance and a flag may overhang a little.
      expect(reach, `${name} spills off its tray`).toBeLessThan(0.75);
    }
  });

  it('⚠️ still obeys the rule that armour does not make a man taller', () => {
    /*
     * D244. A knight is better equipped, not bigger, and a mounted man sits
     * higher only by the height of the horse. The tallest thing on any land
     * stand remains the colours it carries, so all three end up within a few
     * centimetres of each other.
     */
    const heights = [line, colossus, titan].map(standsProud);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.05);
  });

  it('gives every knight the faction colour to be recognised by', () => {
    for (const [name, group] of [
      ['colossus', colossus],
      ['titan', titan],
    ] as const) {
      let found = 0;
      group.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as { color?: { getHexString(): string } };
        if (mat.color && `#${mat.color.getHexString()}` === FACTION) found += 1;
      });
      // A sash, a crest, the tray ring and the colours: more than one place,
      // so losing any single one does not make the stand anonymous.
      expect(found, `${name} shows too little of whose it is`).toBeGreaterThan(2);
    }
  });
});

describe('⚠️ nothing on the map glows any more', () => {  /*
   * The old unit carried an emissive strip at intensity 2.4, and the old city
   * a glowing beacon. Both were the most science-fiction objects in a scene
   * that is trying to be 1600. The tray band under a stand is the single
   * exception and is documented as one: it is a painted counter, not an
   * object in the world, and it is what keeps a unit findable in shadow.
   */
  it('keeps the one exception faint enough to stay a colour, not a lamp', () => {
    const emitters: { intensity: number }[] = [];
    for (const id of UNIT_TYPE_IDS) {
      make(id).traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as {
          emissive?: { getHex(): number };
          emissiveIntensity?: number;
        };
        if (mat.emissive && mat.emissive.getHex() !== 0 && (mat.emissiveIntensity ?? 0) > 0) {
          emitters.push({ intensity: mat.emissiveIntensity ?? 0 });
        }
      });
    }

    expect(emitters.length).toBeGreaterThan(0);
    for (const e of emitters) {
      expect(e.intensity, 'an emissive this strong is a light source').toBeLessThan(0.6);
    }
  });
});
