import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import castelbolognese from '@config/aoi/castelbolognese-2023.json';
import hortasud from '@config/aoi/hortasud-2024.json';
import { SCENES } from '../scenes';

/**
 * Do the files each ready scene asks for actually exist?
 *
 * ⚠️ This test exists because they did not, and nothing caught it. Horta Sud was rebuilt from 5 m
 * to 10 m to fit the host's size limit and its flow field from 10 m to 20 m; the AOI config was
 * updated and the resolution map in TwinShell was not. tsc passed, 250 unit tests passed, the e2e
 * suite passed, the deploy succeeded — and the scene showed "could not be loaded" in the browser,
 * because the only thing wrong was a filename that 404s at runtime.
 *
 * A wrong resolution here is the good kind of wrong: it cannot draw the wrong map, only no map.
 * But it failed after a deploy, in a browser, which is the expensive place to find it.
 */

const AOIS: Record<string, { grids: { terrainResolutionM: number; flowResolutionM: number } }> = {
  'hortasud-2024': hortasud,
  'castelbolognese-2023': castelbolognese,
};

const TERRAIN_ROOT = resolve(__dirname, '../../../public/terrain');

describe('every ready scene has the assets it will ask for', () => {
  const ready = SCENES.filter((s) => s.ready);

  it('has at least the four scenes', () => {
    expect(ready.length).toBeGreaterThanOrEqual(4);
  });

  for (const scene of ready) {
    const aoi = AOIS[scene.id];
    // The valley and corridor build their own filenames internally; only the reach scenes are
    // driven by the config numbers this test defends.
    if (!aoi) continue;

    it(`${scene.id}: heightmap and flow field named by its config exist`, () => {
      const t = aoi.grids.terrainResolutionM;
      const f = aoi.grids.flowResolutionM;
      for (const file of [
        `heightmap_${t}m.json`,
        `heightmap_${t}m.u16`,
        `flowfield_${f}m.json`,
        `flowfield_${f}m.u16`,
        `flowfield_${f}m.u8`,
      ]) {
        const path = resolve(TERRAIN_ROOT, scene.id, file);
        expect(existsSync(path), `${scene.id} declares ${file}, which is not built`).toBe(true);
      }
    });

    it(`${scene.id}: the flow field is no finer than its terrain`, () => {
      // The builder refuses this, so a config that asks for it can never have been built.
      expect(aoi.grids.flowResolutionM).toBeGreaterThanOrEqual(aoi.grids.terrainResolutionM);
      expect(aoi.grids.flowResolutionM % aoi.grids.terrainResolutionM).toBe(0);
    });
  }
});
