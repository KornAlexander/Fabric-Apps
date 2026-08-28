import { describe, expect, it } from 'vitest';

import { AOIS } from '@/config/aoi';
import type { AoiConfig, AoiFocusPlace } from '@/config/aoi';

/**
 * A label that names a whole SITE must be recognisable as one.
 *
 * ⚠️ WRITTEN AFTER "CAMPUS GARCHING" SPENT ITS WHOLE LIFE BEING TREATED AS A BUILDING. `scene.ts`
 * decides what clicking a map label does: open the building, or fly to the site and say it is a
 * site. Guessing the nearest building for a site is the failure it exists to avoid, and its own
 * comment records why — "Campus Prüfeninger Straße" and "LMU Klinikum Campus Innenstadt" both sit
 * within 90 m of some building.
 *
 * It asked `campuses[]`, which is a DIFFERENT NAMESPACE that only sometimes lines up: on six of the
 * nine AOIs no declared campus id matches any focus place, so the check was inert there. It worked
 * at OTH and LMU by the coincidence that `pruefening` and `klinikum` are spelled the same in both
 * lists. Garching declares no campuses at all, so its campus label fell through to the
 * nearest-building search and opened the Galileo Conference Center — 44 m away — as the campus.
 *
 * ⚠️ AND THE REPAIR ALREADY EXISTED, UNUSED. `PlaceNote` has always keyed its "a campus outline,
 * not a single building" message on `place.kind === 'campus'`, in both languages, and no focus
 * place in any AOI had ever set it: the only `kind` in the repository was `station`. A written,
 * translated, unreachable branch is worse than a missing one, because it reads as covered.
 */

const NAMES_A_CAMPUS = /\bcampus\b/i;

function focusPlaces(aoi: AoiConfig): AoiFocusPlace[] {
  return aoi.focusPlaces ?? [];
}

/** How `scene.ts` decides, mirrored here so the data can be checked without a WebGL context. */
function recognisedAsSite(aoi: AoiConfig, place: AoiFocusPlace): boolean {
  const declared = new Set((aoi.campuses ?? []).map((campus) => campus.id));
  return place.kind === 'campus' || declared.has(place.id);
}

describe('a focus place that names a campus', () => {
  it('is recognised as a site, not left to be guessed at as a building', () => {
    const offenders: string[] = [];
    let checked = 0;

    for (const [id, aoi] of Object.entries(AOIS) as [string, AoiConfig][]) {
      for (const place of focusPlaces(aoi)) {
        if (!NAMES_A_CAMPUS.test(place.name)) continue;
        checked += 1;
        if (!recognisedAsSite(aoi, place)) offenders.push(`${id}/${place.id} ("${place.name}")`);
      }
    }

    /*
      ⚠️ The way this check fails open: the name rule stops matching anything — a rename, a
      translation, a site whose campus label is called "Gelände" — and the loop above runs zero
      times while reporting that every campus label is handled.
    */
    expect(checked, 'no focus place names a campus — has the naming changed?').toBeGreaterThan(0);
    expect(offenders, 'these labels would open an arbitrary nearby building').toEqual([]);
  });

  it('uses the `kind` field that PlaceNote has always read', () => {
    /*
      Not a style point. `campuses[]` exists for the planner to reason about a corridor between two
      locations; `kind` exists to say what a label IS. Garching needs the second and has no use for
      the first — it is one research campus, so there is no corridor — and forcing it to declare a
      campuses block purely to fix a label would have meant inventing a bounding box for it.
    */
    const marked = Object.values(AOIS)
      .flatMap((aoi) => focusPlaces(aoi as AoiConfig))
      .filter((place) => place.kind === 'campus');

    expect(marked.length, '`kind: "campus"` is set nowhere, so PlaceNote can never say so').toBeGreaterThan(0);
  });
});
