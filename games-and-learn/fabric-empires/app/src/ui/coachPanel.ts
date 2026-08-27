/**
 * The study coach.
 *
 * ⚠️ **The ranked list is always here; the chat is the part that needs
 * capacity.** Both editions can answer "what should I work on next", because
 * that answer is arithmetic over the spaced-repetition data and needs no model
 * at all. What the connected edition adds is being able to ask follow-up
 * questions about it in your own words.
 *
 * Built that way round on purpose. If the advice only existed in the connected
 * edition, the static build would be a worse game rather than the same game
 * without a chat window, and there would be nothing to check the model against.
 */

import {
  buildProgressDigest,
  digestAsPrompt,
  type LibraryModel,
  type ProgressDigest,
  type StudyAdvice,
} from '@fabric-empires/learn';
import { askCoach, edition } from '../coach.js';
import { t } from '../i18n.js';

export interface CoachPanel {
  readonly root: HTMLElement;
  /** Redraw from the current learning state. */
  update(model: LibraryModel): void;
}

const BAND_CLASS: Record<string, string> = {
  unseen: 'unseen',
  learning: 'learning',
  familiar: 'familiar',
  strong: 'strong',
};

export function createCoachPanel(): CoachPanel {
  const root = document.createElement('div');
  root.className = 'fe-coach';

  const headline = document.createElement('div');
  headline.className = 'fe-coach-headline';
  root.append(headline);

  const list = document.createElement('div');
  list.className = 'fe-coach-list';
  root.append(list);

  // The chat, hidden until a coach is known to exist.
  const chat = document.createElement('div');
  chat.className = 'fe-coach-chat';
  chat.hidden = true;

  const thread = document.createElement('div');
  thread.className = 'fe-coach-thread';
  chat.append(thread);

  const row = document.createElement('div');
  row.className = 'fe-coach-ask';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = t('Ask about your progress…');
  const send = document.createElement('button');
  send.type = 'button';
  send.textContent = t('Ask');
  row.append(input, send);
  chat.append(row);
  root.append(chat);

  let digest: ProgressDigest | undefined;
  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  let busy = false;

  function drawAdvice(items: readonly StudyAdvice[]): void {
    list.replaceChildren();
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'fe-coach-empty';
      empty.textContent = t('Answer a few questions and this will fill in.');
      list.append(empty);
      return;
    }

    for (const item of items) {
      const entry = document.createElement('div');
      entry.className = 'fe-coach-item';

      const band = document.createElement('span');
      band.className = `fe-coach-band ${BAND_CLASS[item.band] ?? ''}`;
      band.textContent = t(item.band);
      entry.append(band);

      const text = document.createElement('div');
      const label = document.createElement('b');
      label.textContent = item.label;
      const why = document.createElement('div');
      why.className = 'fe-coach-why';
      why.textContent = item.reason;
      text.append(label, why);
      entry.append(text);

      if (item.due) {
        const flag = document.createElement('span');
        flag.className = 'fe-coach-due';
        flag.textContent = t('due');
        entry.append(flag);
      }

      list.append(entry);
    }
  }

  function addMessage(who: 'you' | 'coach', text: string, tone = ''): HTMLElement {
    const line = document.createElement('div');
    line.className = `fe-coach-msg ${who} ${tone}`;
    line.textContent = text;
    thread.append(line);
    thread.scrollTop = thread.scrollHeight;
    return line;
  }

  async function ask(): Promise<void> {
    const question = input.value.trim();
    if (!question || busy || !digest) return;

    busy = true;
    input.value = '';
    addMessage('you', question);
    const waiting = addMessage('coach', t('Thinking…'), 'waiting');

    // ⚠️ The digest is rebuilt and sent with every question. Progress changes
    // between messages, and a coach quoting a number from two minutes ago is
    // worse than one that admits it does not know.
    const reply = await askCoach(question, digestAsPrompt(digest), history);
    waiting.remove();
    addMessage('coach', reply.text, reply.ok ? '' : 'bad');

    if (reply.ok) {
      history.push({ role: 'user', content: question });
      history.push({ role: 'assistant', content: reply.text });
    }
    busy = false;
    // preventScroll: this fires after a reply arrives, and the reader is
    // most likely partway up the transcript reading it. Do not yank them
    // back down to the input.
    input.focus({ preventScroll: true });
  }

  send.addEventListener('click', () => void ask());
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // ⚠️ Stopped here, or the map's own keys fire behind the modal and typing
    // a question quietly issues orders.
    e.stopPropagation();
    void ask();
  });
  // Same reason: every key typed into this box belongs to the box.
  input.addEventListener('keydown', (e) => e.stopPropagation(), { capture: true });

  return {
    root,
    update(model) {
      digest = buildProgressDigest(model);
      headline.textContent = digest.headline;
      drawAdvice(digest.next);

      const connected = edition() === 'capacity';
      chat.hidden = !connected;
      if (connected && thread.childElementCount === 0) {
        addMessage(
          'coach',
          t('Ask me what to study, or how close you are. I read your progress, not your answers.'),
        );
      }
    },
  };
}
