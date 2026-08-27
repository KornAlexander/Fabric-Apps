// @vitest-environment jsdom
/**
 * The end screen, and specifically the one line on it that is a promise.
 *
 * ⚠️ **The thing worth testing here is the disclosure, not the layout.** The
 * screen exists to tell the player how their empire ended; the cheat line
 * exists to tell them, honestly, whether that ending was earned. A wrong
 * pixel is a blemish. A wrong sentence there is the screen certifying
 * something untrue at the exact moment somebody is checking.
 *
 * This file was written after the first full playthrough this game has ever
 * had. It finished on turn one with zero cities and zero of forty-one skills,
 * and the end screen said nothing at all, because the debug harness that had
 * granted the mastery was not recorded as help. Fixing that then exposed the
 * second half of the problem: the reassurance printed next to the disclosure
 * had become false.
 */

import { describe, expect, it } from 'vitest';
import { createEndScreen } from '../src/ui/endScreen.js';

const STATS = (cheats: readonly string[]) => ({
  turn: 1,
  skills: '0/41',
  cities: 0,
  cheats,
});

const EXAM = {
  kind: 'exam' as const,
  summary: '40 of 40 correct, 100 percent. The Proctor has no further questions.',
};

/** The rendered text of the cheat line, or undefined when it is hidden. */
const disclosure = (cheats: readonly string[]): string | undefined => {
  document.body.innerHTML = '';
  const screen = createEndScreen(() => {});
  screen.show(EXAM, STATS(cheats));
  const el = document.querySelector<HTMLElement>('[data-f="cheats"]');
  if (!el || el.hidden) return undefined;
  return el.textContent ?? undefined;
};

/** The headline shown for one kind of ending. */
const titleFor = (kind: 'defeat' | 'conquest' | 'mastery' | 'exam'): string => {
  document.body.innerHTML = '';
  const screen = createEndScreen(() => {});
  screen.show({ kind, summary: 'x' }, STATS([]));
  return document.querySelector<HTMLElement>('[data-f="title"]')?.textContent ?? '';
};

describe('the victory titles', () => {
  it('gives every ending a headline', () => {
    for (const kind of ['defeat', 'conquest', 'mastery', 'exam'] as const) {
      expect(titleFor(kind)).not.toBe('');
    }
  });

  /*
   * ⚠️ This is an IP decision with a test attached, which is unusual and
   * deliberate.
   *
   * The end screen used to title a conquest win with the bare genre noun. The
   * IP assessment had recorded the overlap but filed it as "internal
   * identifiers, not player-facing branding", which was simply not true: the
   * word was the largest text on the screen at the moment somebody would take
   * a screenshot. A rename that only touched the union would have left it
   * there. Renames get reverted by autocomplete; this makes that visible.
   */
  it('⚠️ does not put the two genre nouns on the screen', () => {
    for (const kind of ['defeat', 'conquest', 'mastery', 'exam'] as const) {
      expect(titleFor(kind).toLowerCase()).not.toContain('domination');
      expect(titleFor(kind).toLowerCase()).not.toContain('science');
    }
  });
});

describe('the cheat disclosure', () => {
  it('says nothing at all when the empire had no help', () => {
    expect(disclosure([])).toBeUndefined();
  });

  it('names the help that was used', () => {
    const text = disclosure(['harness:studyAll']);
    expect(text).toContain('harness:studyAll');
  });

  it('lists each kind of help once, however often it was used', () => {
    const text = disclosure(['harness:studyAll', 'harness:studyAll', 'stonework']);
    expect(text?.match(/harness:studyAll/g)).toHaveLength(1);
    expect(text).toContain('stonework');
  });

  it('⚠️ does not claim the readiness figure was earned when it was granted', () => {
    const text = disclosure(['harness:studyAll']);
    // The old wording promised this unconditionally, and studyAll makes it false.
    expect(text).not.toContain('never does');
    expect(text).toContain('granted rather than earned');
  });

  it('still reassures when the help could not reach readiness', () => {
    // A typed code cannot touch readiness, and the console says so itself.
    const text = disclosure(['stonework']);
    expect(text).toContain('never does');
  });

  it('⚠️ warns if any single entry touched readiness, not only if all of them did', () => {
    const text = disclosure(['stonework', 'harness:studyAll']);
    expect(text).toContain('granted rather than earned');
    expect(text).not.toContain('never does');
  });
});
