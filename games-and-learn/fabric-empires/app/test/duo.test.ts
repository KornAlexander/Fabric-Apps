// @vitest-environment jsdom
/**
 * Two players, one keyboard.
 *
 * ⚠️ **The two seats share a keyboard, so the only thing keeping them apart is
 * that their keys do not overlap.** If `1` ever answered for both, a child
 * pressing a number would answer their parent's DP-600 question for them, and
 * the readiness figure this whole game exists to produce would be a lie.
 *
 * The second hazard is the map. `b` founds a city and `p` raids one, on a
 * `keydown` listener bound to `window` in the bubble phase, so the child
 * answering "b" would build something. That is tested here by dispatching a
 * real event at `document.body` and watching a stand-in for the map, rather
 * than by grepping the source for `stopPropagation`: the source containing
 * the word is not evidence that the event stopped.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEAT_KEYS, createDuoModal, type DuoModal, type Seat } from '../src/ui/duoModal.js';
import { setLang } from '../src/i18n.js';
import { DEFAULT_WORLD_CHOICE } from '@fabric-empires/engine';
import type {
  QuestionAnswer,
  QuestionPrompt,
  QuestionResult,
  QuestionUi,
} from '@fabric-empires/learn';

const SEATS: Seat[] = [1, 2];

/** A question of four options, which is all a pane reads. */
const prompt = (options: readonly string[]): QuestionPrompt =>
  ({
    question: { id: 'q1', skillId: 1, cluster: 'M1', stem: '3 + 4 = ?', options },
    request: { kind: 'battle', topicId: 'klasse1-1', tier: 1, timeLimitMs: 20_000 },
  }) as unknown as QuestionPrompt;

/** Type a key the way a keyboard does: at the focused element, and it bubbles. */
const press = (key: string): void => {
  document.body.dispatchEvent(
    new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
};

/**
 * Every modal registers a listener on `window` for as long as it lives, and
 * the app makes exactly one. A test file that makes five has to retire them,
 * or a modal left holding an unanswered pane keeps swallowing keys in the
 * next test. `hide()` empties the panes, after which the listener returns
 * immediately.
 */
const made: DuoModal[] = [];
const newDuo = (): DuoModal => {
  const duo = createDuoModal();
  made.push(duo);
  return duo;
};

afterEach(() => {
  for (const duo of made) duo.hide();
  made.length = 0;
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('the two keypads', () => {
  it('gives each seat one key per answer', () => {
    for (const seat of SEATS) {
      expect(SEAT_KEYS[seat], `seat ${seat}`).toHaveLength(4);
    }
  });

  it('⚠️ never gives the same key to both seats', () => {
    const [first, second] = [SEAT_KEYS[1], SEAT_KEYS[2]];
    for (const key of first) {
      expect(second, key).not.toContain(key);
    }
  });

  it('uses digits for the reader and letters for the child', () => {
    // A six-year-old finds A B C D faster than the number row, and the
    // grown-up is the one who can be asked to reach.
    expect([...SEAT_KEYS[1]]).toEqual(['1', '2', '3', '4']);
    expect([...SEAT_KEYS[2]]).toEqual(['a', 'b', 'c', 'd']);
  });

  it('needs no modifier and no second press', () => {
    for (const seat of SEATS) {
      for (const key of SEAT_KEYS[seat]) {
        expect(key, `seat ${seat}`).toHaveLength(1);
        expect(key).toBe(key.toLowerCase());
      }
    }
  });
});

describe('one keyboard, two open questions', () => {
  const OPTIONS = ['nine', 'ten', 'fifty five', 'eleven'] as const;

  /** Opens both seats and returns a promise and a ui per seat. */
  const openBoth = (): {
    first: Promise<QuestionAnswer>;
    second: Promise<QuestionAnswer>;
    uis: readonly QuestionUi[];
  } => {
    const duo = newDuo();
    const one = duo.ui({ seat: 1, who: 'Player 1', course: 'DP-600' });
    const two = duo.ui({ seat: 2, who: 'Player 2', course: '1. Klasse' });
    return { first: one.ask(prompt(OPTIONS)), second: two.ask(prompt(OPTIONS)), uis: [one, two] };
  };

  /** The verdict the presenter would send back. */
  const verdict = (correct: boolean): QuestionResult =>
    ({ correct, correctAnswer: OPTIONS[0], score: correct ? 1 : 0 }) as unknown as QuestionResult;

  it('⚠️ answers only the seat whose key was pressed', async () => {
    const { first, second } = openBoth();

    // The child answers. The parent's question must still be waiting.
    press('c');
    await expect(second).resolves.toMatchObject({ answer: 'fifty five' });

    const pending = vi.fn();
    void first.then(pending);
    await Promise.resolve();
    expect(pending).not.toHaveBeenCalled();

    press('2');
    await expect(first).resolves.toMatchObject({ answer: 'ten' });
  });

  it('takes an upper case letter too, because a child may hold shift', async () => {
    const { second } = openBoth();
    press('A');
    await expect(second).resolves.toMatchObject({ answer: 'nine' });
  });

  it('⚠️ never lets an answer reach the map', async () => {
    /*
     * `b` founds a city. Without the capture-phase listener stopping the
     * event, the child answering "b" builds one, on their parent's turn, in
     * whichever tile happened to be selected.
     */
    const map = vi.fn();
    window.addEventListener('keydown', map);
    try {
      const { first, second } = openBoth();

      press('b'); // seat two's second option
      press('1'); // seat one's first option
      await Promise.all([first, second]);
      expect(map).not.toHaveBeenCalled();

      // A key belonging to neither seat is swallowed too, for as long as
      // somebody still owes an answer.
      const { first: again } = openBoth();
      press('p');
      expect(map).not.toHaveBeenCalled();
      press('1');
      await again;
    } finally {
      window.removeEventListener('keydown', map);
    }
  });

  it('⚠️ keeps the keyboard while a correction is still on screen', async () => {
    /*
     * Answering does not release the keys: the pane stays up showing what the
     * right answer was, and a child reading it should not be able to found a
     * city by pressing the letter they just got wrong.
     */
    const map = vi.fn();
    window.addEventListener('keydown', map);
    try {
      const { first, second, uis } = openBoth();
      press('1');
      press('a');
      await Promise.all([first, second]);

      press('b');
      expect(map, 'locked while the verdict shows').not.toHaveBeenCalled();

      await Promise.all(uis.map((ui) => ui.reveal(verdict(true))));

      press('b');
      expect(map, 'released once both panes cleared').toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', map);
    }
  });

  it('does not hang the turn on a seat that never answers', async () => {
    vi.useFakeTimers();
    const { second } = openBoth();
    vi.advanceTimersByTime(20_000);
    await expect(second).resolves.toMatchObject({ abandoned: true });
  });

  it('shows the seats in a fixed order so neither question moves', async () => {
    const duo = newDuo();
    // Second seat asked first, on purpose.
    void duo.ui({ seat: 2, who: 'Player 2', course: '1. Klasse' }).ask(prompt(OPTIONS));
    void duo.ui({ seat: 1, who: 'Player 1', course: 'DP-600' }).ask(prompt(OPTIONS));
    await Promise.resolve();

    const seats = [...document.querySelectorAll('.fe-duo-pane')].map((el) =>
      el.className.includes('seat-1') ? 1 : 2,
    );
    expect(seats).toEqual([1, 2]);
    duo.hide();
  });
});

describe('⚠️ the seat says who it is in the language being played', () => {
  const OPTIONS = ['nine', 'ten', 'fifty five', 'eleven'] as const;

  afterEach(() => {
    setLang('en');
  });

  it('translates the player label', () => {
    /*
     * This read "Player 1" in a fully German game for as long as co-op has
     * existed, with the German sitting unused in the catalogue. Verified by
     * putting the bug back: assigning `config.who` straight to `textContent`
     * fails this with "Player 1".
     */
    setLang('de');
    const duo = newDuo();
    void duo.ui({ seat: 1, who: 'Player 1', course: 'DP-600' }).ask(prompt(OPTIONS));

    const label = document.querySelector('.fe-duo-head b');
    expect(label?.textContent).toBe('Spieler 1');
    duo.hide();
  });

  it('leaves the course name alone, because it is content and not chrome', () => {
    setLang('de');
    const duo = newDuo();
    void duo.ui({ seat: 2, who: 'Player 2', course: '1. Klasse: Mathe' }).ask(prompt(OPTIONS));

    expect(document.querySelector('.fe-duo-head span')?.textContent).toBe('1. Klasse: Mathe');
    duo.hide();
  });

  it('is translated at render time, so a language switch mid-game lands', () => {
    // The SeatConfig is built once when the game starts; the pane is rebuilt
    // per question. Resolving the label at the call site would be right until
    // somebody pressed the language toggle, and wrong for the rest of the game.
    const duo = newDuo();
    const ui = duo.ui({ seat: 1, who: 'Player 1', course: 'DP-600' });

    setLang('en');
    void ui.ask(prompt(OPTIONS));
    expect(document.querySelector('.fe-duo-head b')?.textContent).toBe('Player 1');
    duo.hide();

    setLang('de');
    void ui.ask(prompt(OPTIONS));
    expect(document.querySelector('.fe-duo-head b')?.textContent).toBe('Spieler 1');
    duo.hide();
  });
});

describe('⚠️ the clock a seat is running against is visible', () => {
  const OPTIONS = ['nine', 'ten', 'fifty five', 'eleven'] as const;

  it('shows the seconds left, counting down', () => {
    /*
     * The time limit was always enforced - a seat that ran out resolved as
     * abandoned - and simply never shown. The pane went blank on the player
     * with no warning it was about to. A hidden clock that fails you is worse
     * than no clock at all.
     */
    vi.useFakeTimers();
    const duo = newDuo();
    void duo.ui({ seat: 1, who: 'Player 1', course: 'DP-600' }).ask(prompt(OPTIONS));

    const clock = document.querySelector('.fe-duo-clock');
    expect(clock, 'the pane has a clock at all').not.toBeNull();
    expect(clock?.textContent).toBe('20s');

    vi.advanceTimersByTime(5_000);
    expect(clock?.textContent).toBe('15s');
    duo.hide();
  });

  it('turns red for the last quarter, the way the solo modal does', () => {
    vi.useFakeTimers();
    const duo = newDuo();
    void duo.ui({ seat: 1, who: 'Player 1', course: 'DP-600' }).ask(prompt(OPTIONS));
    const clock = document.querySelector('.fe-duo-clock')!;

    vi.advanceTimersByTime(14_000); // 6s of 20 left, still over a quarter
    expect(clock.classList.contains('low')).toBe(false);

    vi.advanceTimersByTime(2_000); // 4s of 20 left
    expect(clock.classList.contains('low')).toBe(true);
    duo.hide();
  });

  it('⚠️ stops the clock the moment the seat answers', () => {
    // Or the countdown keeps running under the verdict, telling a player who
    // has already answered that they are about to run out of time.
    vi.useFakeTimers();
    const duo = newDuo();
    void duo.ui({ seat: 1, who: 'Player 1', course: 'DP-600' }).ask(prompt(OPTIONS));
    const clock = document.querySelector('.fe-duo-clock')!;

    vi.advanceTimersByTime(3_000);
    const frozen = clock.textContent;
    press('1');
    vi.advanceTimersByTime(6_000);

    expect(clock.textContent, 'frozen at what was left').toBe(frozen);
    duo.hide();
  });

  it('⚠️ still calls time on a seat that never answers', () => {
    // The ticker now owns expiry as well as the paint, so this is the check
    // that folding the two together did not drop the abandoning.
    vi.useFakeTimers();
    const duo = newDuo();
    const answer = duo.ui({ seat: 2, who: 'Player 2', course: '1. Klasse' }).ask(prompt(OPTIONS));
    vi.advanceTimersByTime(20_000);
    return expect(answer).resolves.toMatchObject({ abandoned: true });
  });
});

describe('⚠️ the second seat is not a study record', () => {
  it('never reaches the mastery tracker', () => {
    /*
     * D205 in a second form. A six-year-old answering questions about Anlaute
     * must not move the number that says whether a grown-up is ready to sit
     * DP-600. The seat is built from a plain question list with no `mastery`,
     * and this reads the source because the ABSENCE of an argument is exactly
     * what a later refactor puts back without noticing.
     */
    const code = readFileSync(resolve(process.cwd(), 'app/src/main.ts'), 'utf8');
    const seatBlock = code.slice(
      code.indexOf('function buildSecondSeat'),
      code.indexOf('async function askBattle'),
    );
    expect(seatBlock.length).toBeGreaterThan(100);
    expect(seatBlock).toContain('secondSeat = createQuestionPresenter');
    expect(seatBlock).not.toContain('mastery');
  });
});

describe('the setup defaults', () => {
  it('starts as one player, so nothing changes for a lone candidate', () => {
    expect(DEFAULT_WORLD_CHOICE.players).toBe(1);
  });

  it('defaults the first seat to the certification being revised', () => {
    expect(DEFAULT_WORLD_CHOICE.courseP1).toBe('dp600');
  });
});
