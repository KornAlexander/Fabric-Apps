import type {
  Question,
  QuestionAnswer,
  QuestionPrompt,
  QuestionResult,
  QuestionUi,
} from '@fabric-empires/learn';
import { t } from '../i18n.js';

/**
 * The question modal.
 *
 * Implements the learn layer's `QuestionUi`, so all it does is turn a prompt
 * into an answer and show a result. It knows nothing about the game, and the
 * game knows nothing about it.
 *
 * Timer behaviour follows D50: timed by default, because exam pressure is the
 * point, but every modal can be paused without penalty. The defect that rule
 * exists to fix is not the timer itself, it is that a real-world interruption
 * silently costs you a unit.
 */

const STYLE = `
.fe-backdrop {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(4, 6, 10, 0.72);
  /*
    ⚠️ Scrollable, and anchored to the top rather than centred.

    This is the tallest thing in the game: a stem, four options, a verdict, an
    explanation and a documentation link. Centred inside a container that could
    not scroll at all, a long question on a phone is clipped at both ends with
    no way to reach either. An auto margin on the card keeps it centred
    whenever there is room for it.

    ⚠️ No backticks in this comment. The whole stylesheet is a template
    literal, so one would end the string and the error lands on a later line.
  */
  display: flex; align-items: flex-start; justify-content: center;
  overflow: auto; padding: 16px 0;
  backdrop-filter: blur(3px);
}
.fe-backdrop[hidden] { display: none; }
.fe-modal {
  width: min(680px, 92vw);
  margin: auto;
  background: #10141c; color: #e8eaf0;
  border: 1px solid rgba(255,255,255,0.14); border-radius: 14px;
  padding: 20px 22px; box-shadow: 0 24px 70px rgba(0,0,0,0.6);
  font: 14px/1.55 "Segoe UI", system-ui, sans-serif;
}
.fe-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
.fe-kind {
  font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
  padding: 2px 8px; border-radius: 999px; background: #2f5d8c; color: #dceaf7;
}
.fe-kind.battle { background: #8c3a2f; color: #f7dcd8; }
.fe-kind.boss { background: #4a2f7a; color: #ede4ff; letter-spacing: 0.1em; }
.fe-skill { color: #96a0b5; font-size: 12px; flex: 1; }
.fe-timer { font-variant-numeric: tabular-nums; font-weight: 600; }
.fe-timer.low { color: #ff8b80; }
.fe-bar { height: 4px; border-radius: 2px; background: rgba(255,255,255,0.1); margin: 8px 0 14px; overflow: hidden; }
.fe-bar > div { height: 100%; background: #4c8fd6; width: 100%; transition: width .2s linear; }
.fe-bar > div.low { background: #e05a4a; }
.fe-stem { font-size: 15px; margin-bottom: 14px; }
.fe-hint { color: #96a0b5; font-size: 12px; margin-bottom: 8px; }
.fe-options { display: flex; flex-direction: column; gap: 8px; }
.fe-option {
  display: flex; gap: 10px; align-items: flex-start; text-align: left;
  background: #171d28; border: 1px solid rgba(255,255,255,0.12);
  border-radius: 8px; padding: 10px 12px; cursor: pointer; color: inherit;
  font: inherit; width: 100%;
}
.fe-option:hover { background: #1e2734; }
.fe-option[aria-pressed="true"] { border-color: #4c8fd6; background: #1b2a3c; }
.fe-option.correct { border-color: #5ac46a; background: #17301c; }
.fe-option.correct .key { background: #5ac46a; color: #0d1a10; }
.fe-option.wrong { border-color: #e05a4a; background: #2c1715; }
.fe-option .key {
  flex: 0 0 auto; width: 20px; height: 20px; border-radius: 5px;
  background: rgba(255,255,255,0.1); display: grid; place-items: center;
  font-size: 11px; font-weight: 600;
}
.fe-option[aria-pressed="true"] .key { background: #4c8fd6; }
.fe-foot { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.fe-modal button.act {
  background: #1d2636; border: 1px solid rgba(255,255,255,0.12); color: #e8eaf0;
  border-radius: 6px; padding: 7px 14px; font: inherit; cursor: pointer;
}
.fe-modal button.act:hover:not(:disabled) { background: #2a3750; }
.fe-modal button.act:disabled { opacity: .4; cursor: not-allowed; }
.fe-modal button.act.primary { background: #2f5d8c; border-color: #3f7cb8; }
.fe-verdict { margin-top: 16px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.1); }
.fe-verdict h3 { margin: 0 0 6px; font-size: 15px; }
.fe-verdict.good h3 { color: #8fd694; }
.fe-verdict.bad h3 { color: #ff9b91; }
.fe-verdict a { color: #7cc0f5; }
.fe-explain { color: #c8cede; }
.fe-source { color: #7c8699; font-size: 12px; margin-top: 10px; }
`;

const KEYS = ['1', '2', '3', '4', '5', '6'];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export interface QuestionModal extends QuestionUi {
  /** True while a question is on screen, so the map can ignore input. */
  isOpen(): boolean;
  /**
   * The question currently on screen, if any.
   *
   * Exposed for automated play. A test cannot answer correctly by reading the
   * screen: the right answer is only revealed after submitting, and a retry
   * serves a different question, so guessing never terminates. Handing out the
   * question lets a harness check each option against the hash exactly as the
   * player's click does. It leaks nothing a determined player could not
   * already get from the shipped bundle, which is why the answers are hashed
   * rather than merely hidden.
   */
  current(): Question | undefined;
}

export function createQuestionModal(): QuestionModal {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);

  const backdrop = el('div', 'fe-backdrop');
  backdrop.hidden = true;
  const modal = el('div', 'fe-modal');
  backdrop.append(modal);
  document.body.append(backdrop);

  let open = false;
  let showing: Question | undefined;

  function render(prompt: QuestionPrompt): Promise<QuestionAnswer> {
    const { question, request } = prompt;
    showing = question;
    const multi = question.type === 'multi';
    const needed = multi ? (question.selectCount ?? 2) : 1;

    modal.replaceChildren();

    const head = el('div', 'fe-head');
    // `boss` is the Proctor, which is why the kind is styled rather than
    // printed plain: the exam should not look like an ordinary skirmish.
    const kind = el('span', `fe-kind ${request.kind === 'battle' || request.kind === 'boss' ? request.kind : ''}`);
    /*
     * ⚠️ The other kinds used to be rendered raw, so a German player was shown
     * the literal identifiers `research` and `review` in the header of the one
     * screen they spend the whole game looking at.
     */
    kind.textContent =
      request.kind === 'boss'
        ? t('The Proctor')
        : request.kind === 'research'
          ? t('Research')
          : request.kind === 'unrest'
            ? t('Unrest')
            : request.kind === 'treasure'
              ? t('Treasure')
              : request.kind === 'settle'
                ? t('Founding')
                : t('Battle');
    const skill = el('span', 'fe-skill');
    skill.textContent = question.sourceSkillBullet;
    const timerLabel = el('span', 'fe-timer');
    head.append(kind, skill, timerLabel);

    const bar = el('div', 'fe-bar');
    const barFill = el('div');
    bar.append(barFill);

    const stem = el('div', 'fe-stem');
    stem.textContent = question.stem;

    const options = el('div', 'fe-options');
    const selected = new Set<string>();
    const buttons: HTMLButtonElement[] = [];

    // Assigned by the promise executor below, which runs synchronously, so it
    // is always in place long before a click can happen.
    let toggle: (text: string, button: HTMLButtonElement) => void = () => {};

    (question.options ?? []).forEach((text, index) => {
      const button = el('button', 'fe-option');
      button.type = 'button';
      button.setAttribute('aria-pressed', 'false');
      const key = el('span', 'key');
      key.textContent = KEYS[index] ?? '';
      const label = el('span');
      label.textContent = text;
      button.append(key, label);
      button.addEventListener('click', () => toggle(text, button));
      options.append(button);
      buttons.push(button);
    });

    const foot = el('div', 'fe-foot');
    const pauseButton = el('button', 'act');
    pauseButton.type = 'button';
    pauseButton.textContent = t('Pause');
    const submitButton = el('button', 'act primary');
    submitButton.type = 'button';
    submitButton.textContent = t('Submit');
    submitButton.disabled = true;
    /*
     * ⚠️ Stable ids, because these labels are now translated.
     *
     * The test harness found this button with `textContent === 'Submit'`,
     * which worked for exactly as long as the interface was English. Keying
     * automation on words a player reads is the same mistake as keying a
     * selector on a placeholder that rotates: it breaks the moment the text
     * does its job.
     */
    pauseButton.dataset.act = 'pause';
    submitButton.dataset.act = 'submit';
    foot.append(pauseButton, submitButton);

    modal.append(head, bar, stem);
    if (multi) {
      const hint = el('div', 'fe-hint');
      hint.textContent = t('Choose {n}.', { n: String(needed) });
      modal.append(hint);
    }
    modal.append(options, foot);

    backdrop.hidden = false;
    open = true;

    return new Promise<QuestionAnswer>((resolve) => {
      const started = performance.now();
      let pausedFor = 0;
      let pausedAt: number | undefined;
      let finished = false;

      function elapsed(): number {
        const now = pausedAt ?? performance.now();
        return now - started - pausedFor;
      }

      function toggleSubmit(): void {
        submitButton.disabled = multi ? selected.size !== needed : selected.size !== 1;
      }

      toggle = (text: string, button: HTMLButtonElement): void => {
        if (finished) return;
        if (selected.has(text)) {
          selected.delete(text);
          button.setAttribute('aria-pressed', 'false');
        } else {
          if (!multi) {
            selected.clear();
            for (const other of buttons) other.setAttribute('aria-pressed', 'false');
          }
          selected.add(text);
          button.setAttribute('aria-pressed', 'true');
        }
        toggleSubmit();
      };

      function finish(answer: QuestionAnswer): void {
        if (finished) return;
        finished = true;
        clearInterval(ticker);
        window.removeEventListener('keydown', onKey, true);
        // Freeze the clock at what the player actually took, rather than
        // leaving it showing the time they had left.
        timerLabel.textContent = `${(answer.elapsedMs / 1000).toFixed(1)}s`;
        timerLabel.classList.remove('low');
        pauseButton.disabled = true;
        resolve(answer);
      }

      const ticker = window.setInterval(() => {
        if (pausedAt !== undefined) return;
        const remaining = Math.max(0, request.timeLimitMs - elapsed());
        const seconds = Math.ceil(remaining / 1000);
        timerLabel.textContent = `${seconds}s`;
        const fraction = remaining / request.timeLimitMs;
        barFill.style.width = `${fraction * 100}%`;
        const low = fraction < 0.25;
        timerLabel.classList.toggle('low', low);
        barFill.classList.toggle('low', low);
        if (remaining <= 0) {
          finish({ answer: undefined, elapsedMs: request.timeLimitMs, abandoned: true });
        }
      }, 100);

      pauseButton.addEventListener('click', () => {
        if (finished) return;
        if (pausedAt === undefined) {
          pausedAt = performance.now();
          pauseButton.textContent = t('Resume');
          timerLabel.textContent = t('paused');
        } else {
          pausedFor += performance.now() - pausedAt;
          pausedAt = undefined;
          pauseButton.textContent = t('Pause');
        }
      });

      submitButton.addEventListener('click', () => {
        if (submitButton.disabled) return;
        finish({
          answer: multi ? [...selected] : [...selected][0],
          elapsedMs: elapsed(),
          abandoned: false,
        });
      });

      function onKey(event: KeyboardEvent): void {
        if (finished) return;
        const index = KEYS.indexOf(event.key);
        if (index >= 0 && buttons[index]) {
          event.preventDefault();
          event.stopPropagation();
          buttons[index]!.click();
          return;
        }
        if (event.key === 'Enter' && !submitButton.disabled) {
          event.preventDefault();
          event.stopPropagation();
          submitButton.click();
        }
        // Escape deliberately does nothing: abandoning has a cost, so it must
        // not be one keystroke away from a player reaching for the map.
      }

      window.addEventListener('keydown', onKey, true);
    });
  }

  function reveal(result: QuestionResult): Promise<void> {
    const verdict = el('div', `fe-verdict ${result.correct ? 'good' : 'bad'}`);
    const title = el('h3');
    title.textContent = result.correct
      ? result.score >= 1
        ? t('Correct, and quickly')
        : t('Correct')
      : result.given === undefined
        ? t('Out of time')
        : t('Not quite');
    verdict.append(title);

    // Mark the options: green on the right answer, red on a wrong pick. A
    // learner who missed should not have to work out what they should have
    // chosen.
    const correctSet = new Set(
      (Array.isArray(result.correctAnswer)
        ? result.correctAnswer
        : result.correctAnswer === undefined
          ? []
          : [result.correctAnswer]
      ).map((a) => a.trim().toLowerCase()),
    );
    const givenSet = new Set(
      (Array.isArray(result.given)
        ? result.given
        : result.given === undefined
          ? []
          : [result.given]
      ).map((a) => String(a).trim().toLowerCase()),
    );

    for (const node of modal.querySelectorAll('.fe-option')) {
      const text = (node.textContent ?? '').trim();
      // Strip the leading number key from the rendered label.
      const label = text.replace(/^\d+\s*/, '').trim().toLowerCase();
      if (correctSet.has(label)) node.classList.add('correct');
      else if (givenSet.has(label)) node.classList.add('wrong');
    }

    if (result.explanation) {
      const explain = el('div', 'fe-explain');
      explain.textContent = result.explanation;
      verdict.append(explain);
    }

    const source = el('div', 'fe-source');
    const link = el('a');
    link.href = result.question.learnUrl;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.textContent = t('Read the documentation');
    source.append(link);
    source.append(
      document.createTextNode(`  ${result.question.cluster}  ${result.question.sourceSkillBullet}`),
    );
    verdict.append(source);

    const foot = el('div', 'fe-foot');
    const continueButton = el('button', 'act primary');
    continueButton.type = 'button';
    continueButton.textContent = t('Continue');
    continueButton.dataset.act = 'continue';
    foot.append(continueButton);
    verdict.append(foot);

    modal.append(verdict);
    for (const button of modal.querySelectorAll('button.fe-option')) {
      (button as HTMLButtonElement).disabled = true;
    }
    for (const button of modal.querySelectorAll('.fe-foot button.act')) {
      if (button !== continueButton) (button as HTMLButtonElement).disabled = true;
    }
    /*
      ⚠️ preventScroll, then back to the top of the verdict.

      The verdict is the moment the game teaches: right or wrong, then why,
      then the documentation link. Focusing Continue is what lets Enter carry
      on, but a plain focus() scrolls the button into view and the button is
      the last thing in the modal. Measured on a 390x700 phone: an answered
      question is 811px tall in a 700px viewport, and focusing Continue put
      the modal top at -127, so the player was shown the bottom of the
      explanation the instant they answered.
    */
    continueButton.focus({ preventScroll: true });
    backdrop.scrollTop = 0;

    return new Promise<void>((resolve) => {
      function close(): void {
        window.removeEventListener('keydown', onKey, true);
        backdrop.hidden = true;
        open = false;
        resolve();
      }
      function onKey(event: KeyboardEvent): void {
        if (event.key === 'Enter' || event.key === 'Escape' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }
      continueButton.addEventListener('click', close);
      window.addEventListener('keydown', onKey, true);
    });
  }

  return {
    isOpen: () => open,
    current: () => showing,
    ask: render,
    reveal,
  };
}
