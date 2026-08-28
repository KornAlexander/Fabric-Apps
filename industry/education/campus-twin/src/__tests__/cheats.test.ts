import { afterEach, describe, expect, it, vi } from 'vitest';

import { watchForCheat } from '@/cheats';

/**
 * The cheat word.
 *
 * ⚠️ THE CHECKS THAT MATTER ARE THE ONES WHERE IT MUST NOT FIRE. A matcher that triggers on
 * "lambo" is trivial; one that also triggers while somebody types "Vorlesung im Lambo-Saal" into
 * the assistant is a booby trap, and this app has a chat box, a room search and a free-text rule
 * editor for it to go off in.
 */

function press(key: string, target?: EventTarget, modifiers: Partial<KeyboardEvent> = {}): void {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers });
  if (target) {
    Object.defineProperty(event, 'target', { value: target });
  }
  window.dispatchEvent(event);
}

function type(text: string, target?: EventTarget): void {
  for (const ch of text) press(ch, target);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the cheat word', () => {
  it('fires when the word is typed', () => {
    const hit = vi.fn();
    const off = watchForCheat('lambo', hit);
    type('lambo');
    expect(hit).toHaveBeenCalledTimes(1);
    off();
  });

  it('is case-insensitive', () => {
    const hit = vi.fn();
    const off = watchForCheat('lambo', hit);
    type('LaMbO');
    expect(hit).toHaveBeenCalledTimes(1);
    off();
  });

  it('tolerates a false start, because people mistype the first letter', () => {
    const hit = vi.fn();
    const off = watchForCheat('lambo', hit);
    // A strict reset-on-miss state machine would refuse both of these.
    type('llambo');
    type('xxlambo');
    expect(hit).toHaveBeenCalledTimes(2);
    off();
  });

  it('does not fire on a prefix or a near miss', () => {
    const hit = vi.fn();
    const off = watchForCheat('lambo', hit);
    type('lamb');
    type('lamba');
    type('ambo');
    expect(hit).not.toHaveBeenCalled();
    off();
  });

  it('⚠️ ignores typing inside a text field', () => {
    const hit = vi.fn();
    const off = watchForCheat('lambo', hit);

    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    Object.defineProperty(editable, 'isContentEditable', { value: true });

    type('lambo', input);
    type('lambo', textarea);
    type('lambo', editable);
    expect(hit, 'the cheat fired while somebody was writing a sentence').not.toHaveBeenCalled();

    // And still works immediately afterwards outside a field, so the guard is a filter and not a
    // latch that gets stuck.
    type('lambo');
    expect(hit).toHaveBeenCalledTimes(1);
    off();
  });

  it('⚠️ ignores keys held with a modifier', () => {
    const hit = vi.fn();
    const off = watchForCheat('lambo', hit);
    // Ctrl+L is a browser shortcut. Letting it contribute an "l" means a keyboard user drifts
    // into the cheat while never typing a word at all.
    press('l', undefined, { ctrlKey: true });
    type('ambo');
    expect(hit).not.toHaveBeenCalled();
    off();
  });

  it('ignores non-character keys', () => {
    const hit = vi.fn();
    const off = watchForCheat('lambo', hit);
    type('lam');
    press('ArrowLeft');
    press('Shift');
    type('bo');
    // The window is rolling, so the arrow keys simply contribute nothing.
    expect(hit).toHaveBeenCalledTimes(1);
    off();
  });

  it('stops listening once unsubscribed', () => {
    const hit = vi.fn();
    const off = watchForCheat('lambo', hit);
    off();
    type('lambo');
    expect(hit).not.toHaveBeenCalled();
  });
});
