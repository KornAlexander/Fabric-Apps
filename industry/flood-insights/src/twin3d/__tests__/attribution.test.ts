import { describe, expect, it } from 'vitest';

import ahrtal from '@config/aoi/ahrtal-2021.json';
import steinbach from '@config/aoi/steinbach-2021.json';

import { ATTRIBUTION, CORRIDOR_ATTRIBUTION, attributionFor } from '../attribution';
import { SCENES } from '../scenes';

describe('footer attribution', () => {
  it('credits each scene from its own AOI config', () => {
    expect(ATTRIBUTION[0]).toBe(ahrtal.geobasis.attribution);
    expect(CORRIDOR_ATTRIBUTION[0]).toBe(steinbach.geobasis.attribution);
  });

  it('does not credit one survey authority under the other scene', () => {
    // The two Länder publish under different licences, so a copied line is both the wrong
    // credit and the wrong terms. This is the mixup the split footer exists to prevent.
    expect(ahrtal.geobasis.licence).not.toBe(steinbach.geobasis.licence);
    expect(CORRIDOR_ATTRIBUTION.join(' ')).not.toContain('LVermGeoRP');
    expect(ATTRIBUTION.join(' ')).not.toContain('Land NRW');
  });

  it('does not date the NRW tiles to the scenario year', () => {
    // They were retrieved in 2026; 2021 is the dam-break study's scenario year and was
    // previously typed into the credit, apparently from the AOI id.
    expect(CORRIDOR_ATTRIBUTION[0]).not.toContain('(2021)');
  });

  /**
   * ⚠️ Every registered scene needs its own entry, and this test exists because the footer used to
   * be a two-way choice — `isValley ? ATTRIBUTION : CORRIDOR_ATTRIBUTION`. That was correct while
   * there were two scenes and silently wrong the moment there were four: the Spanish and Italian
   * reaches were credited to Geobasis NRW under dl-de/zero-2-0, with a dam-break study about a
   * German reservoir attached, on maps of Valencia and Emilia-Romagna. Wrong authority, wrong
   * licence, wrong country.
   */
  it('gives every registered scene its own credits', () => {
    for (const scene of SCENES) {
      const lines = attributionFor(scene.id);
      expect(lines.length, `${scene.id} has no credits`).toBeGreaterThan(0);
      expect(lines[0], `${scene.id} has no survey authority line`).toBeTruthy();
    }
  });

  it('never credits one scene to another scene\'s authority', () => {
    // The surveys are the part that must not travel: each is a different authority under a
    // different licence, and the drape comes from the same body as the terrain.
    const surveys = SCENES.map((s) => attributionFor(s.id)[0]);
    expect(new Set(surveys).size, 'two scenes share a survey credit').toBe(SCENES.length);
  });

  it('refuses to guess for a scene it does not know', () => {
    // Falling back would put a real authority's name under someone else's data.
    expect(() => attributionFor('not-a-scene')).toThrow(/No attribution registered/);
  });
});
