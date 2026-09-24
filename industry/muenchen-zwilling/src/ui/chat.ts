import { ask, publishDraft, type AgentEvent, type NoteDraft } from '../agent/client';

/**
 * The assistant panel.
 *
 * ⚠️ TOOL CALLS ARE SHOWN, NOT HIDDEN BEHIND A SPINNER. In front of the organisations that own
 * this data, "the assistant said so" is worth nothing; "the assistant asked the city's roadworks
 * service and got 14 rows" is worth something. Every tool the model invokes appears in the
 * transcript with its result summary, and each one can be repeated without the model at all via
 * `POST /api/tools/{name}`.
 *
 * ⚠️ TEXT IS WRITTEN WITH `textContent`, NEVER `innerHTML`. Everything here is either model
 * output or an open-data field, and both are untrusted input for this purpose: a Baustelle whose
 * description contains a tag must render as that text, not as markup.
 */

export interface ChatHost {
  /** Called after a note has been saved, so the map layer can reload. */
  onNoteSaved: () => void;
  /**
   * Ask Fabric who is signed in. Invoked directly from the click, never after an await, because
   * the broker opens a popup and a browser only allows that inside a live user gesture.
   */
  onSignIn: () => Promise<string | null>;
}

export interface ChatHandle {
  setAuthorNote(text: string | null): void;
  /** Offer the sign-in button only when there is no name and signing in could produce one. */
  offerSignIn(offer: boolean): void;
}

export function wireChat(host: ChatHost): ChatHandle {
  const panel = document.querySelector<HTMLElement>('#assistant')!;
  const log = document.querySelector<HTMLElement>('#assistant-log')!;
  const form = document.querySelector<HTMLFormElement>('#assistant-form')!;
  const input = document.querySelector<HTMLInputElement>('#assistant-input')!;
  const send = document.querySelector<HTMLButtonElement>('#assistant-send')!;
  const toggle = document.querySelector<HTMLButtonElement>('#assistant-toggle')!;
  const close = document.querySelector<HTMLButtonElement>('#assistant-close')!;
  const authorNote = document.querySelector<HTMLElement>('#assistant-author')!;
  const signIn = document.querySelector<HTMLButtonElement>('#assistant-signin')!;

  signIn.addEventListener('click', () => {
    signIn.disabled = true;
    // ⚠️ No await before this call: the popup depends on the gesture that is still live here.
    void host.onSignIn().then((name) => {
      if (name) {
        signIn.hidden = true;
        // ⚠️ THE HOST WRITES THE MESSAGE, NOT THIS HANDLER. It used to claim "gemeldet, nicht
        // serverseitig geprüft" unconditionally, overwriting the host's own wording, so a
        // successful sign-in and a reload could state opposite things about the same account.
        // Only the host knows whether a token was actually obtained.
      } else {
        authorNote.textContent = 'Anmeldung nicht möglich. Notizen werden ohne Namen gespeichert.';
        authorNote.hidden = false;
      }
    }).finally(() => { signIn.disabled = false; });
  });

  let running: AbortController | null = null;

  const scroll = () => { log.scrollTop = log.scrollHeight; };

  const line = (kind: string, text: string): HTMLElement => {
    const element = document.createElement('p');
    element.className = `chat-line chat-${kind}`;
    element.textContent = text;
    log.append(element);
    scroll();
    return element;
  };

  const showDraft = (draft: NoteDraft) => {
    const box = document.createElement('div');
    box.className = 'chat-draft';

    const head = document.createElement('p');
    head.className = 'chat-draft-head';
    head.textContent = `Entwurf · ${draft.kategorie}`;
    box.append(head);

    if (draft.baustelle?.ort) {
      const where = document.createElement('p');
      where.className = 'chat-draft-where';
      where.textContent = draft.baustelle.ort;
      box.append(where);
    }

    const body = document.createElement('p');
    body.className = 'chat-draft-text';
    body.textContent = draft.text;
    box.append(body);

    const warn = document.createElement('p');
    warn.className = 'chat-draft-warn';
    // ⚠️ "noch nicht veröffentlicht", NOT "nichts gespeichert". The draft IS written to SQL the
    // moment the assistant proposes it; what has not happened is publication as a coordination
    // note. The earlier wording was simply untrue and would not have survived a question.
    warn.textContent = 'Entwurf, noch nicht veröffentlicht. Erst mit Ihrer Bestätigung entsteht eine Koordinationsnotiz.';
    box.append(warn);

    const actions = document.createElement('div');
    actions.className = 'chat-draft-actions';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'chat-save';
    save.textContent = 'Notiz speichern';
    const discard = document.createElement('button');
    discard.type = 'button';
    discard.className = 'chat-discard';
    discard.textContent = 'Verwerfen';
    actions.append(save, discard);
    box.append(actions);

    const settle = (text: string, ok: boolean) => {
      actions.remove();
      warn.textContent = text;
      warn.className = ok ? 'chat-draft-ok' : 'chat-draft-warn';
    };

    save.addEventListener('click', () => {
      save.disabled = true;
      discard.disabled = true;
      void publishDraft(draft.entwurfId)
        .then(() => {
          settle('Gespeichert. Die Notiz erscheint in der Ebene „Koordinationsnotizen".', true);
          host.onNoteSaved();
        })
        .catch((error: unknown) => {
          // ⚠️ THE ACTIONS STAY. A temporary failure used to remove the buttons along with the
          // message, so a network blip permanently cost the user the ability to retry a draft
          // that is still perfectly valid on the server.
          save.disabled = false;
          discard.disabled = false;
          warn.textContent =
            `Nicht veröffentlicht: ${error instanceof Error ? error.message : 'unbekannter Fehler'}. Sie können es erneut versuchen.`;
        });
    });
    discard.addEventListener('click', () => settle('Entwurf verworfen. Es entsteht keine Koordinationsnotiz.', true));

    log.append(box);
    scroll();
  };

  const render = (event: AgentEvent, answer: { element: HTMLElement | null }) => {
    switch (event.type) {
      case 'status':
        line('status', event.message);
        break;
      case 'metadata':
        // Named rather than implied: a viewer should be able to see which model answered.
        line('meta', `Modell: ${event.model}`);
        break;
      case 'tool':
        line('tool', `Werkzeug: ${event.name}`);
        break;
      case 'tool_result':
        line('tool-result', `↳ ${event.summary}`);
        if (event.entwurf) showDraft(event.entwurf);
        break;
      case 'delta':
        if (!answer.element) answer.element = line('answer', '');
        answer.element.textContent = (answer.element.textContent ?? '') + event.text;
        scroll();
        break;
      case 'done':
        break;
      case 'error':
        line('error', event.message);
        break;
    }
  };

  const submit = async (prompt: string) => {
    // ⚠️ ONE CONTROLLER PER REQUEST, CAPTURED LOCALLY. Sharing a single mutable `running` meant a
    // second question aborted the first, and then the first request's `catch` and `finally` read
    // and cleared the SECOND request's state — re-enabling the button mid-flight and, once the
    // variable had been nulled, dereferencing null in the error path.
    if (running) running.abort();
    const controller = new AbortController();
    running = controller;
    input.value = '';
    send.disabled = true;
    line('you', prompt);
    const answer: { element: HTMLElement | null } = { element: null };
    try {
      for await (const event of ask(prompt, controller.signal)) {
        render(event, answer);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        line('error', error instanceof Error ? error.message : 'Assistent nicht erreichbar');
      }
    } finally {
      // Only the request that is still the current one may hand the input back.
      if (running === controller) {
        send.disabled = false;
        running = null;
        input.focus();
      }
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const prompt = input.value.trim();
    if (prompt) void submit(prompt);
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>('.assistant-example')) {
    button.addEventListener('click', () => {
      const prompt = button.dataset.prompt ?? button.textContent ?? '';
      if (prompt.trim()) void submit(prompt.trim());
    });
  }

  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) input.focus();
  };
  toggle.addEventListener('click', () => setOpen(panel.hidden));
  close.addEventListener('click', () => setOpen(false));

  return {
    setAuthorNote(text: string | null) {
      authorNote.textContent = text ?? '';
      authorNote.hidden = !text;
    },
    /** Offer the sign-in button only when there is no name and signing in could produce one. */
    offerSignIn(offer: boolean) {
      signIn.hidden = !offer;
    },
  };
}
