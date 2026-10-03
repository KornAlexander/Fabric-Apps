/**
 * Two questions, one screen, two people.
 *
 * Built so a parent and a first grader can play the same empire at the same
 * moment, each at their own level. A battle asks both seats at once: the adult
 * gets their DP-600 question and answers with **1 2 3 4**, the child gets a
 * Klasse 1 question and answers with **a b c d**. Neither waits for the other
 * to finish.
 *
 * ⚠️ **One keypress is the whole answer.** The single-player modal selects,
 * then submits, then continues, which is right when the question is the only
 * thing happening. Here there are two of them under one clock, and asking a
 * six-year-old to press a number and then find Enter is asking them to lose.
 *
 * Each seat is an independent `QuestionUi`, so the two challenge providers
 * call `ask` concurrently and this simply renders whatever is pending. Nothing
 * about the learning loop had to change to support a second player.
 */

import type {
  Question,
  QuestionAnswer,
  QuestionPrompt,
  QuestionResult,
  QuestionUi,
} from '@fabric-empires/learn';
import { t } from '../i18n.js';

export type Seat = 1 | 2;

export interface SeatConfig {
  readonly seat: Seat;
  /** Who is answering, shown above the question. */
  readonly who: string;
  /** The course they are answering from. */
  readonly course: string;
}

export interface DuoModal {
  ui(config: SeatConfig): QuestionUi;
  readonly isOpen: () => boolean;
  hide(): void;
}

/** The keys each seat answers with, in option order. */
export const SEAT_KEYS: Readonly<Record<Seat, readonly string[]>> = Object.freeze({
  1: ['1', '2', '3', '4'],
  2: ['a', 'b', 'c', 'd'],
});

interface Pane {
  readonly root: HTMLElement;
  readonly config: SeatConfig;
  readonly question: Question;
  readonly buttons: HTMLButtonElement[];
  readonly started: number;
  /** The countdown shown in the head, and the interval painting it. */
  readonly clock: HTMLElement;
  ticker?: number | undefined;
  resolve?: ((answer: QuestionAnswer) => void) | undefined;
  answered: boolean;
}

export function createDuoModal(): DuoModal {
  const root = document.createElement('div');
  root.className = 'fe-duo';
  root.hidden = true;
  document.body.append(root);

  const panes = new Map<Seat, Pane>();

  /**
   * Stop a pane's countdown.
   *
   * ⚠️ Every path that ends a question has to call this, or the interval
   * outlives the pane it was painting and keeps writing to a detached node.
   */
  function stopClock(pane: Pane): void {
    if (pane.ticker !== undefined) {
      window.clearInterval(pane.ticker);
      pane.ticker = undefined;
    }
  }

  function refresh(): void {
    root.hidden = panes.size === 0;
    // Seat order, always, so neither player's question moves under them.
    const ordered = [...panes.entries()].sort((a, b) => a[0] - b[0]);
    root.replaceChildren(...ordered.map(([, pane]) => pane.root));
  }

  function answer(pane: Pane, index: number): void {
    if (pane.answered) return;
    const option = pane.question.options?.[index];
    if (option === undefined) return;

    pane.answered = true;
    stopClock(pane);
    for (const [i, button] of pane.buttons.entries()) {
      button.classList.toggle('picked', i === index);
      button.disabled = true;
    }
    pane.resolve?.({
      answer: option,
      elapsedMs: Date.now() - pane.started,
      abandoned: false,
    });
    pane.resolve = undefined;
  }

  /*
   * One capture-phase listener for both seats.
   *
   * ⚠️ Capture, and it stops propagation, because the map is still listening
   * underneath: `b` founds a city and `p` raids. A child hunting for their
   * letter would otherwise be issuing orders.
   */
  window.addEventListener(
    'keydown',
    (e) => {
      if (panes.size === 0) return;
      const key = e.key.toLowerCase();
      for (const [seat, pane] of panes) {
        const index = SEAT_KEYS[seat].indexOf(key);
        if (index < 0) continue;
        e.preventDefault();
        e.stopPropagation();
        answer(pane, index);
        return;
      }
      // Any other key while both seats are open belongs to nobody, but it must
      // not reach the map either.
      e.stopPropagation();
    },
    true,
  );

  function buildPane(config: SeatConfig, question: Question, started: number): Pane {
    const el = document.createElement('div');
    el.className = `fe-duo-pane seat-${config.seat}`;

    const head = document.createElement('div');
    head.className = 'fe-duo-head';
    const who = document.createElement('b');
    /*
     * ⚠️ Translated HERE rather than at the call site, because the pane is
     * rebuilt for every question while the `SeatConfig` is built once when the
     * game starts. Resolving it at the call site would be correct until
     * somebody switched language mid-game, and then permanently wrong.
     *
     * ⚠️ This read "Player 1" in a fully German game for as long as co-op has
     * existed, with `'Player 1': 'Spieler 1'` sitting unused in the catalogue.
     * The i18n test that catches untranslated prose looks for STRING LITERALS
     * assigned to `textContent`; this assigns a variable, so it was invisible
     * to the one check written to find exactly this mistake.
     */
    who.textContent = t(config.who);
    head.append(who);
    const course = document.createElement('span');
    // NOT translated: a course name is content, and it arrives already written
    // in the language of its own bank.
    course.textContent = config.course;
    head.append(course);
    /*
     * The clock, which this pane did not have.
     *
     * ⚠️ A seat that runs out of time is already scored as abandoned, so the
     * time limit was real and enforced and simply never shown: the pane went
     * blank on you with no warning that it was going to. A hidden clock that
     * fails you is worse than no clock at all.
     */
    const clock = document.createElement('em');
    clock.className = 'fe-duo-clock';
    head.append(clock);
    el.append(head);

    const stem = document.createElement('div');
    stem.className = 'fe-duo-stem';
    stem.textContent = question.stem;
    el.append(stem);

    const list = document.createElement('div');
    list.className = 'fe-duo-options';
    const buttons: HTMLButtonElement[] = [];
    const keys = SEAT_KEYS[config.seat];

    (question.options ?? []).forEach((text, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'fe-duo-option';

      const key = document.createElement('kbd');
      key.textContent = (keys[index] ?? '').toUpperCase();
      button.append(key);

      const label = document.createElement('span');
      label.textContent = text;
      button.append(label);

      // Clickable too: player one is using a mouse anyway, and a child who
      // has not found the key yet should not be stuck.
      button.addEventListener('click', () => {
        const pane = panes.get(config.seat);
        if (pane) answer(pane, index);
      });

      buttons.push(button);
      list.append(button);
    });
    el.append(list);

    return { root: el, config, question, buttons, started, clock, answered: false };
  }

  function ui(config: SeatConfig): QuestionUi {
    return {
      ask(prompt: QuestionPrompt): Promise<QuestionAnswer> {
        return new Promise<QuestionAnswer>((resolve) => {
          const pane = buildPane(config, prompt.question, Date.now());
          pane.resolve = resolve;
          panes.set(config.seat, pane);
          refresh();

          /*
           * The clock still runs, and now it is also visible.
           *
           * ⚠️ **One owner for expiry.** The ticker paints the countdown AND
           * calls time, rather than painting while a separate `setTimeout`
           * decides: two independent clocks on one deadline drift, and the
           * pane would go blank a beat before or after the number said zero,
           * which reads as the game cheating.
           *
           * A seat that never answers resolves as abandoned rather than
           * hanging the turn, which is what the single-player modal does and
           * what the scoring already expects.
           */
          const limit = prompt.request.timeLimitMs;

          const expire = (): void => {
            const current = panes.get(config.seat);
            if (current !== pane || pane.answered) return;
            pane.answered = true;
            stopClock(pane);
            pane.resolve?.({ answer: undefined, elapsedMs: limit, abandoned: true });
            pane.resolve = undefined;
          };

          const paint = (): void => {
            const remaining = Math.max(0, limit - (Date.now() - pane.started));
            pane.clock.textContent = `${Math.ceil(remaining / 1000)}s`;
            // The same quarter-left threshold the single-player modal uses, so
            // "running out" looks the same wherever a question is asked.
            pane.clock.classList.toggle('low', remaining / limit < 0.25);
            if (remaining <= 0) expire();
          };

          paint();
          pane.ticker = window.setInterval(paint, 100);
        });
      },

      async reveal(result: QuestionResult): Promise<void> {
        const pane = panes.get(config.seat);
        if (!pane) return;
        stopClock(pane);

        const right = Array.isArray(result.correctAnswer)
          ? result.correctAnswer
          : [result.correctAnswer];
        for (const [i, button] of pane.buttons.entries()) {
          const text = pane.question.options?.[i];
          if (text !== undefined && right.includes(text)) button.classList.add('right');
          if (button.classList.contains('picked') && !button.classList.contains('right')) {
            button.classList.add('wrong');
          }
        }

        const verdict = document.createElement('div');
        verdict.className = result.correct ? 'fe-duo-verdict good' : 'fe-duo-verdict bad';
        verdict.textContent = result.correct
          ? t('Correct')
          : t('The answer was: {answer}', { answer: right.join(', ') });
        pane.root.append(verdict);

        // Long enough to read the correction, short enough that the other
        // player is not left waiting on somebody else's mistake.
        await new Promise((r) => window.setTimeout(r, result.correct ? 900 : 2200));
        panes.delete(config.seat);
        refresh();
      },
    };
  }

  return {
    ui,
    isOpen: () => panes.size > 0,
    hide() {
      // Or a hidden pane's ticker keeps running for the rest of the session.
      for (const pane of panes.values()) stopClock(pane);
      panes.clear();
      refresh();
    },
  };
}
