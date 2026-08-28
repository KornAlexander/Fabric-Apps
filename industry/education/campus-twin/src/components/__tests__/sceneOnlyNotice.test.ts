import { describe, expect, it } from 'vitest';

import { AOIS } from '@/config/aoi';
import type { AoiConfig } from '@/config/aoi';
import { lensesFor } from '@/lenses/registry';
import de from '@/i18n/de.json';
import en from '@/i18n/en.json';

/**
 * What the app TELLS a visitor about a site must agree with what the site has.
 *
 * ⚠️ THIS FILE EXISTS BECAUSE A SCREENSHOT CAUGHT WHAT THE SUITE COULD NOT. Registering
 * `uni-regensburg` put two boxes on one screen: `site.noPlanner` promising "Gebäude, Räume und
 * Analysen sind vorhanden", and `lens.noRooms` immediately below it saying there are no interiors
 * and that none will be invented. Both were correct on their own and the pair was a plain
 * contradiction. Every test passed, because no test compared a sentence against the data it
 * describes — they only checked that the key resolved to a non-empty string.
 *
 * The claim is asserted here as a property of the WORDING, so a future site with a scene and no
 * interiors cannot re-acquire the promise by inheriting the wrong key.
 */

const CATALOGUES: Record<string, Record<string, unknown>> = { de, en };

function lookup(catalogue: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, catalogue);
}

/** The words that assert interiors exist, in each language. */
const ROOM_WORDS: Record<string, string[]> = {
  de: ['Räume'],
  en: ['rooms'],
};

/** The words that assert the analysis lenses exist. */
const LENS_WORDS: Record<string, string[]> = {
  de: ['Analysen'],
  en: ['lenses'],
};

describe('the notice shown on a site with no timetable', () => {
  it('offers a wording for a scene-only twin, in every language', () => {
    for (const [lang, catalogue] of Object.entries(CATALOGUES)) {
      const text = lookup(catalogue, 'site.noPlannerSceneOnly');
      expect(typeof text, lang).toBe('string');
      expect((text as string).length, lang).toBeGreaterThan(0);
    }
  });

  it('does not promise rooms or lenses when the site has neither', () => {
    for (const [lang, catalogue] of Object.entries(CATALOGUES)) {
      const text = lookup(catalogue, 'site.noPlannerSceneOnly') as string;
      /*
        The exact defect: the general notice says rooms and analyses are present. On a site with no
        interiors that is contradicted on the same screen by `lens.noRooms`.
      */
      for (const word of ROOM_WORDS[lang]) {
        expect(text.includes(`${word} und`), `${lang}: promises rooms`).toBe(false);
      }
      for (const word of LENS_WORDS[lang]) {
        expect(text.startsWith(word), `${lang}: promises lenses`).toBe(false);
      }
      // ...and it must still SAY what is missing, or it is not a notice at all.
      for (const word of ROOM_WORDS[lang]) {
        expect(text.includes(word), `${lang}: names rooms as absent`).toBe(true);
      }
    }
  });

  it('never leaves a planner-less site claiming interiors it does not have', () => {
    /*
      The guard with teeth, and the one that would have caught the original. It walks the real
      registry, works out which notice `TwinShell` would render for each planner-less site, and
      refuses any pairing where the sentence claims rooms the AOI does not carry.
    */
    const entries = Object.entries(AOIS) as [string, AoiConfig][];
    const plannerless = entries.filter(([, aoi]) => !aoi.schedulerSite);

    // If this is ever empty the assertion below is vacuous, exactly as in `rail.spec.ts`.
    expect(plannerless.length, 'no planner-less site left to check').toBeGreaterThan(0);

    for (const [id, aoi] of plannerless) {
      const key = aoi.rooms ? 'site.noPlanner' : 'site.noPlannerSceneOnly';
      for (const [lang, catalogue] of Object.entries(CATALOGUES)) {
        const text = lookup(catalogue, key) as string;
        if (!aoi.rooms) {
          for (const word of ROOM_WORDS[lang]) {
            expect(text.includes(`${word} und`), `${id}/${lang} claims rooms`).toBe(false);
          }
        }
        // The lens list the shell would actually build must agree with the sentence too.
        const lenses = lensesFor(aoi.lenses);
        if (lenses.length === 0) {
          for (const word of LENS_WORDS[lang]) {
            expect(text.includes(`${word} sind vorhanden`), `${id}/${lang}`).toBe(false);
          }
        }
      }
    }
  });
});
