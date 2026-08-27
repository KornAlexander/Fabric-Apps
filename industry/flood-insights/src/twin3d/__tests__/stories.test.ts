import { describe, expect, it } from 'vitest';

import aoi from '@config/aoi/ahrtal-2021.json';
import {
  actsAreMonotonic,
  DEFAULT_STORY_ID,
  STORIES,
  storyById,
  storyEndsOnActIV,
} from '../stories';
import de from '@/i18n/de.json';
import en from '@/i18n/en.json';

/**
 * The rules that make a preset a story rather than a list of viewpoints.
 *
 * These used to hold for the one tour that existed. Adding presets is exactly the change that
 * could let a story quietly opt out of them, which is why they are asserted per story.
 */

const PLACE_IDS = new Set(aoi.focusPlaces.map((p) => p.id));

describe('preset stories', () => {
  it('offers more than one, and the default exists', () => {
    expect(STORIES.length).toBeGreaterThan(1);
    expect(storyById(DEFAULT_STORY_ID).id).toBe(DEFAULT_STORY_ID);
  });

  it('unknown ids fall back rather than returning undefined', () => {
    expect(storyById('does-not-exist').id).toBe(STORIES[0].id);
  });

  for (const story of STORIES) {
    describe(story.id, () => {
      // PLAN §2.3. With one tour this was a property of that array; with several it has to hold
      // for each, or the rule could be dodged by picking a different story.
      it('ends on Act IV and hands over to the closing screen', () => {
        expect(storyEndsOnActIV(story)).toBe(true);
      });

      it('never runs the acts backwards', () => {
        expect(actsAreMonotonic(story)).toBe(true);
      });

      it('only finishes on its last step', () => {
        const finishing = story.steps.filter((s) => s.finishes);
        expect(finishing).toHaveLength(1);
        expect(finishing[0]).toBe(story.steps[story.steps.length - 1]);
      });

      it('names only places the AOI actually has', () => {
        for (const step of story.steps) {
          if (step.place) expect(PLACE_IDS.has(step.place)).toBe(true);
        }
      });

      it('has copy in both locales for every step', () => {
        for (const step of story.steps) {
          for (const [tag, bundle] of [['de', de], ['en', en]] as const) {
            const copy = (bundle.tour.step as Record<string, { title: string; body: string }>)[
              step.id
            ];
            expect(copy, `${tag} missing tour.step.${step.id}`).toBeDefined();
            expect(copy.title.length, `${tag} ${step.id} title`).toBeGreaterThan(0);
            expect(copy.body.length, `${tag} ${step.id} body`).toBeGreaterThan(0);
          }
        }
      });

      /**
       * ⚠️ The check above looks the key up with bracket access and therefore passed while the
       * app was rendering the literal string `tour.step.grenzen.intro.title` on screen. `t()`
       * treats a dot as a path separator, so an id containing one is resolved as nested objects
       * that do not exist. The bundle can hold the copy and the UI can still fail to find it.
       */
      it('uses ids that survive dot-path lookup', () => {
        for (const step of story.steps) {
          expect(step.id, `${step.id} would be resolved as a nested path`).not.toContain('.');
        }
      });

      it('has a label and blurb in both locales', () => {
        for (const bundle of [de, en]) {
          const stories = bundle.tour.stories as Record<string, { label: string; blurb: string }>;
          expect(stories[story.id]?.label?.length).toBeGreaterThan(0);
          expect(stories[story.id]?.blurb?.length).toBeGreaterThan(0);
        }
      });
    });
  }

  /**
   * The framing complaint, as a test.
   *
   * Altenahr sits a tenth of the way in from the western edge of the AOI, so a camera pointed
   * there fills a large part of the screen with terrain that has no data behind it. That is fine
   * when Altenahr is the subject — the gauge, the loop, the first arrival — and wrong for a step
   * making a general statement about the valley. Those now open on the middle reach.
   */
  it('opens each story somewhere with map on all sides', () => {
    const bbox = aoi.bbox;
    for (const story of STORIES) {
      const first = story.steps.find((s) => s.place);
      expect(first, `${story.id} has no placed step`).toBeDefined();
      const place = aoi.focusPlaces.find((p) => p.id === first!.place)!;
      const u = (place.lon - bbox.west) / (bbox.east - bbox.west);
      expect(u, `${story.id} opens at ${place.name} (u=${u.toFixed(2)})`).toBeGreaterThan(0.2);
      expect(u, `${story.id} opens at ${place.name} (u=${u.toFixed(2)})`).toBeLessThan(0.8);
    }
  });

  /**
   * The tic the user named: four bodies ended by commenting on the application itself rather than
   * on what was on screen. Pinned so it cannot creep back in with the next batch of copy.
   */
  it('does not talk about itself', () => {
    const banned = [
      /in dieser Anwendung/i,
      /diese Anwendung hinausläuft/i,
      /weil es dort hingehört/i,
      /aus dem es diese Anwendung gibt/i,
      /this application/i,
    ];
    for (const bundle of [de, en]) {
      const steps = bundle.tour.step as Record<string, { title: string; body: string }>;
      for (const [id, copy] of Object.entries(steps)) {
        for (const pattern of banned) {
          expect(copy.body, `${id} matches ${pattern}`).not.toMatch(pattern);
        }
      }
    }
  });

  /**
   * ⚠️ The inquiry states 136 deaths for Rheinland-Pfalz and publishes no breakdown by place.
   * A caption that attaches a death toll to a village would be inventing one.
   */
  it('attaches no death toll to a single place', () => {
    for (const bundle of [de, en]) {
      const steps = bundle.tour.step as Record<string, { title: string; body: string }>;
      for (const [id, copy] of Object.entries(steps)) {
        if (/136/.test(copy.body)) {
          expect(
            copy.body,
            `${id} cites 136 without saying it is the figure for the whole Land`
          ).toMatch(/Rheinland-Pfalz|Rhineland-Palatinate/);
        }
      }
    }
  });
});
