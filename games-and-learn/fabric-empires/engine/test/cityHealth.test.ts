import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CITY_KINDS,
  CITY_RANKS,
  FIRST_RANK,
  cityIntegrity,
  maxCityHp,
  rankInfo,
  type City,
} from '../src/index.js';

/*
  A city's health, and the fact that it is permanent.

  ⚠️ The reason this is worth showing at all: nothing in the engine restores a
  city's hit points. Promotion raises the ceiling and keeps the damage, so a
  town chipped in turn twelve is still chipped at the end of the game. A player
  who cannot see the number has no way to know that a raid they shrugged off
  cost them something they will never get back.
*/

function city(overrides: Partial<City> = {}): City {
  return {
    id: 'c1',
    factionId: 'player',
    hex: { q: 0, r: 0 },
    name: 'Test',
    kind: 'workspace',
    rank: FIRST_RANK,
    hp: 200,
    population: 1,
    wallLevel: 0,
    wallHp: 0,
    ...overrides,
  } as City;
}

describe('a city ceiling', () => {
  it('is the kind base plus the rank bonus', () => {
    const c = city({ kind: 'workspace', rank: FIRST_RANK });
    expect(maxCityHp(c)).toBe(CITY_KINDS.workspace.baseHp + rankInfo(FIRST_RANK).bonusHp);
  });

  it('⚠️ rises with rank, which is why a fraction needs the helper', () => {
    /*
     * The bug this prevents: reporting `hp / baseHp` would show a promoted
     * city at over 100 percent, and reporting `hp / 200` would show every
     * non-workspace kind wrong. The sum was never written down before, so any
     * caller wanting it had to rediscover it.
     */
    const ranks = CITY_RANKS.map((r) => maxCityHp(city({ rank: r.id })));
    for (let i = 1; i < ranks.length; i += 1) {
      expect(ranks[i]!).toBeGreaterThan(ranks[i - 1]!);
    }
  });

  it('differs by kind, not just by rank', () => {
    const kinds = Object.values(CITY_KINDS).map((k) => k.baseHp);
    expect(new Set(kinds).size).toBeGreaterThan(1);
  });
});

describe('integrity as a fraction', () => {
  it('is 1 at full health', () => {
    const c = city();
    expect(cityIntegrity(city({ hp: maxCityHp(c) }))).toBe(1);
  });

  it('halves at half health', () => {
    const c = city();
    expect(cityIntegrity(city({ hp: maxCityHp(c) / 2 }))).toBeCloseTo(0.5, 6);
  });

  it('⚠️ never leaves 0..1, even if hp somehow exceeds the ceiling', () => {
    /*
     * Promotion adds the bonus difference to current hp rather than topping
     * up, so hp and the ceiling move together. But a save migrated across a
     * balance change could arrive with either side stale, and a bar drawn
     * from an out-of-range fraction would render as a glitch rather than as
     * the wrong number.
     */
    const c = city();
    expect(cityIntegrity(city({ hp: maxCityHp(c) * 3 }))).toBe(1);
    expect(cityIntegrity(city({ hp: -50 }))).toBe(0);
  });
});

describe('where it is shown', () => {
  const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
  const main = read('app/src/main.ts');
  const scene = read('app/src/three/scene3d.ts');

  it('appears on every city row', () => {
    expect(main).toContain("t('{hp}/{full} HP'");
  });

  it('is marked when the city is hurt, because it will not mend', () => {
    expect(main).toContain("city.hp < maxCityHp(city) ? 'status hurt' : 'status'");
  });

  it('⚠️ appears for ENEMY cities too, on the tile panel, but only while seen', () => {
    /*
     * `describeTile` runs on whatever is hovered, not only on what the player
     * owns. Knowing a hostile town is at half strength is the information
     * that turns a raid into a plan, but only for a town actually in sight:
     * the 3D scene refuses to draw a remembered village for exactly this
     * reason, and a panel reporting live HP for one would undo that.
     */
    const fn = main.slice(main.indexOf('function describeTile('));
    const body = fn.slice(0, 5000);
    expect(body).toContain('maxCityHp(city)');
    expect(body).toContain('currentSight.has(hexKey(h))');
    expect(body).toContain('city.factionId === mySeat');
  });

  it('⚠️ draws a map bar only when damaged, and only when visible', () => {
    /*
     * Eight capitals each wearing a full green bar all game is furniture: on
     * screen constantly, meaning nothing, so the one moment it matters is the
     * moment nobody looks.
     *
     * ⚠️ The `canSee` guard is the one that actually bit. Overlay sprites use
     * `depthTest: false` so they are never buried by a hill, which means they
     * also punch through fog: the first version of this loop hovered a bar
     * over towns the player could not see.
     */
    const marker = 'A health bar over any town that has been hurt.';
    const block = scene.slice(scene.indexOf(marker));
    expect(scene.indexOf(marker)).toBeGreaterThan(0);
    expect(block.slice(0, 2000)).toContain('if (!canSee(city.hex, city.factionId)) continue;');
    expect(block.slice(0, 2000)).toContain('if (city.hp >= full) continue;');
    expect(block.slice(0, 2000)).toContain('healthBarSprite');
  });

  it('quantises the bar so a texture is not uploaded every frame', () => {
    expect(scene).toContain('const HEALTH_BAR_STEPS =');
    expect(scene).toContain('healthBarTextures.set(step, texture)');
  });

  it('sizes the bar in screen pixels, so it survives map zoom', () => {
    expect(scene).toMatch(/const HEALTH_BAR_PIXELS = \d+;/);
  });
});
