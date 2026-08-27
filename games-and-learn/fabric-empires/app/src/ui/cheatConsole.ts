/**
 * The cheat console.
 *
 * A prompt rather than a key sequence, because every letter on this keyboard is
 * already spoken for: W A S D Q E R F fly the drone and b, p, h, x, c, g, l are
 * unit and interface actions. A buffer listening for "onelake" would have flown
 * the camera three times on the way.
 *
 * Opened with the backtick, which is the traditional place for this and one of
 * the few keys the game does not already use.
 */

export interface CheatConsole {
  toggle(): void;
  hide(): void;
  readonly isOpen: () => boolean;
  /** Print a line of output under the prompt. */
  say(text: string, kind?: 'good' | 'bad'): void;
}

export interface CheatConsoleOptions {
  /** Run a code. Return the message to print. */
  readonly submit: (code: string) => void;
}

export function createCheatConsole(options: CheatConsoleOptions): CheatConsole {
  const root = document.createElement('div');
  root.className = 'fe-cheat';
  root.style.display = 'none';

  const prompt = document.createElement('div');
  prompt.className = 'fe-cheat-prompt';

  const caret = document.createElement('span');
  caret.className = 'fe-cheat-caret';
  caret.textContent = '>';
  prompt.append(caret);

  const input = document.createElement('input');
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Cheat code');
  input.placeholder = 'type a code, or help';
  prompt.append(input);

  const output = document.createElement('div');
  output.className = 'fe-cheat-output';

  root.append(prompt, output);
  document.body.append(root);

  let showing = false;

  const say = (text: string, kind?: 'good' | 'bad'): void => {
    const line = document.createElement('div');
    line.className = kind ? `fe-cheat-line ${kind}` : 'fe-cheat-line';
    line.textContent = text;
    output.append(line);
    /*
     * Keep the last stretch only: this is a prompt, not a log.
     *
     * ⚠️ Roomy enough for `help`. The first version kept eight lines, and help
     * prints one per code plus a heading and a footer, so the earliest codes
     * scrolled off the top the moment they were listed.
     */
    while (output.childElementCount > 24) output.firstElementChild?.remove();
    output.scrollTop = output.scrollHeight;
  };

  input.addEventListener('keydown', (e) => {
    // The console owns the keyboard while it is open, or typing "b" would
    // found a city behind it.
    e.stopPropagation();
    if (e.key === 'Escape') {
      hide();
      return;
    }
    if (e.key !== 'Enter') return;
    const code = input.value;
    input.value = '';
    if (code.trim().length === 0) return;
    options.submit(code);
  });

  function hide(): void {
    showing = false;
    root.style.display = 'none';
    input.blur();
  }

  return {
    toggle() {
      showing = !showing;
      root.style.display = showing ? 'block' : 'none';
      if (showing) {
        input.value = '';
        // preventScroll: the console opens over the board, and focusing the
        // input should not move whatever is behind it.
        input.focus({ preventScroll: true });
      } else {
        input.blur();
      }
    },
    hide,
    isOpen: () => showing,
    say,
  };
}
