/**
 * Preset stories — the guided tour, generalised (PLAN §12 Phase 8, §2.3).
 *
 * There were three storytelling features here that were the same idea three times: the guided
 * tour (a scripted walk), the timeline annotations (captions that fire as playback passes them)
 * and bookmarks (a walk the presenter authors). All three are "put the map in a state, then say
 * something about it". This file is the one model underneath them.
 *
 * A `StoryStep` and a `Bookmark` describe the same thing from opposite ends: a step names a
 * *place* and lets the camera frame it, a bookmark carries the exact camera the presenter had.
 * `bookmarks.ts` converts between them, so a saved view can be dropped into a story and a story
 * step can be captured as a bookmark.
 *
 * ⚠️ **Every story ends on Act IV.** PLAN §2.3: "The tour is not complete and the demo is not
 * shown unless it ends on Act IV." §13 names the risk — a presenter skips the framing, jumps to
 * the water, and the evening becomes a technology show. That applied to *the* tour when there was
 * one; with several it binds all of them, or the rule would be avoidable by picking another
 * story. `storyEndsOnActIV` asserts it for every preset.
 *
 * ⚠️ **No step invents an event.** The same rule `storyBeats.ts` carries: a caption may describe
 * what the model shows, or repeat something with a citation, and may not narrate the night.
 * Sinzig is the case that makes this concrete — the inquiry (Drucksache 18/10000) states 136
 * deaths for Rheinland-Pfalz and publishes no breakdown by place, so no step here attaches a
 * number of dead to a village. What the model does know about Sinzig is when the water arrived.
 */

export interface StoryStep {
  id: string;
  /** Timeline position in minutes relative to the gauge peak, where the step pins the clock. */
  minutes?: number;
  /** Focus place id, matching `config/aoi/*.json` `focusPlaces`. */
  place?: string;
  /** Layer states this step wants. Anything omitted is left as the user had it. */
  layers?: { hazard?: boolean; landuse?: boolean; trees?: boolean };
  /** Which act the step belongs to — used for the progress label, and asserted in tests. */
  act: 1 | 2 | 3 | 4;
  /** The step opens the closing screen instead of advancing. Exactly one step may do this. */
  finishes?: boolean;
}

export interface Story {
  id: string;
  /** i18n key for the name shown in the picker. */
  labelKey: string;
  /** i18n key for the one-line description under the picker. */
  blurbKey: string;
  steps: StoryStep[];
}

/**
 * Act IV, the step every story ends on.
 *
 * Shared rather than repeated so a new story cannot end on a *different* Act IV step and quietly
 * drop the levers, which are the point of the ending.
 */
const CLOSING_STEP: StoryStep = { id: 'whatif', act: 4, minutes: 85, finishes: true };

/**
 * ⚠️ Framing note, and the reason several steps moved.
 *
 * Altenahr sits at u=0.10 of the AOI — a tenth of the way in from the western edge. Pointing the
 * camera there fills a third of the screen with terrain that has no data behind it, and it shows
 * the narrowest, least recognisable end of the valley. Three of the four opening steps used to do
 * exactly that. General statements now frame the middle reach (Dernau u=0.25 to Bad Neuenahr
 * u=0.54), which is both the part of the Ahr people picture and the part with map on all sides.
 * Altenahr is still used where Altenahr is the subject — the gauge, the loop, the first wave.
 */
export const STORIES: Story[] = [
  {
    id: 'ablauf',
    labelKey: 'tour.stories.ablauf.label',
    blurbKey: 'tour.stories.ablauf.blurb',
    steps: [
      // Act I — what was known.
      { id: 'valley', act: 1, minutes: -360, place: 'ahrweiler', layers: { hazard: false } },
      { id: 'schleife', act: 1, minutes: -360, place: 'altenahr' },
      { id: 'gauge', act: 1, minutes: -60, place: 'altenahr' },
      { id: 'hazard', act: 1, minutes: -360, place: 'dernau', layers: { hazard: true } },

      // Act II — the night.
      { id: 'wave', act: 2, minutes: 17, place: 'altenahr', layers: { hazard: false } },
      { id: 'village', act: 2, minutes: 85, place: 'dernau' },
      { id: 'altstadt', act: 2, minutes: 120, place: 'ahrweiler' },
      { id: 'downstream', act: 2, minutes: 252, place: 'sinzig' },
      { id: 'mouth', act: 2, minutes: 300, place: 'kripp' },

      // Act III — the damage, and how far to trust it.
      { id: 'validation', act: 3, minutes: 85, place: 'badneuenahr' },

      CLOSING_STEP,
    ],
  },
  {
    id: 'orte',
    labelKey: 'tour.stories.orte.label',
    blurbKey: 'tour.stories.orte.blurb',
    // The same night read as geography rather than as a clock: each place at its own modelled
    // peak, walking downstream. The times are the wave arriving, so they only ever increase.
    steps: [
      { id: 'orteIntro', act: 1, minutes: -60, place: 'ahrweiler', layers: { hazard: false } },
      { id: 'orteAltenahr', act: 2, minutes: 17, place: 'altenahr' },
      { id: 'orteMayschoss', act: 2, minutes: 45, place: 'mayschoss' },
      { id: 'orteDernau', act: 2, minutes: 85, place: 'dernau' },
      { id: 'orteAhrweiler', act: 2, minutes: 120, place: 'ahrweiler' },
      { id: 'orteBadneuenahr', act: 2, minutes: 145, place: 'badneuenahr' },
      { id: 'orteHeimersheim', act: 2, minutes: 190, place: 'heimersheim' },
      { id: 'orteSinzig', act: 2, minutes: 252, place: 'sinzig' },
      { id: 'orteKripp', act: 2, minutes: 300, place: 'kripp' },
      { id: 'orteSpread', act: 3, minutes: 252, place: 'badneuenahr' },
      CLOSING_STEP,
    ],
  },
  {
    id: 'grenzen',
    labelKey: 'tour.stories.grenzen.label',
    blurbKey: 'tour.stories.grenzen.blurb',
    // What the model does not know. A demo that only shows the water invites more trust than the
    // numbers earn, so this one walks the caveats deliberately.
    steps: [
      { id: 'grenzenIntro', act: 1, minutes: 85, place: 'ahrweiler', layers: { hazard: false } },
      { id: 'grenzenGauge', act: 1, minutes: -60, place: 'altenahr' },
      { id: 'grenzenTerrain', act: 3, minutes: 85, place: 'dernau' },
      { id: 'grenzenIou', act: 3, minutes: 85, place: 'badneuenahr' },
      { id: 'grenzenHazard', act: 3, minutes: -360, place: 'ahrweiler', layers: { hazard: true } },
      { id: 'grenzenPeople', act: 3, minutes: 252, place: 'sinzig', layers: { hazard: false } },
      CLOSING_STEP,
    ],
  },
];

export const DEFAULT_STORY_ID = 'ablauf';

export function storyById(id: string): Story {
  return STORIES.find((s) => s.id === id) ?? STORIES[0];
}

/** The rule from §2.3, as a function so it can be asserted rather than remembered. */
export function storyEndsOnActIV(story: Story): boolean {
  const last = story.steps[story.steps.length - 1];
  return last?.act === 4 && last.finishes === true;
}

/** Acts must never run backwards inside a story — the frame is the argument. */
export function actsAreMonotonic(story: Story): boolean {
  return story.steps.every((s, i) => i === 0 || s.act >= story.steps[i - 1].act);
}

// ── Back-compat ────────────────────────────────────────────────────────────────
// The tour was a single array before it was a set of stories. These keep the existing call sites
// and tests meaningful while pointing at the default story.

export const TOUR_STEPS: StoryStep[] = storyById(DEFAULT_STORY_ID).steps;
export const TOUR_LENGTH = TOUR_STEPS.length;

export function finalStep(): StoryStep {
  return TOUR_STEPS[TOUR_STEPS.length - 1];
}

export function actOf(index: number): 1 | 2 | 3 | 4 {
  return TOUR_STEPS[Math.max(0, Math.min(index, TOUR_STEPS.length - 1))].act;
}
