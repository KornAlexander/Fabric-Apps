import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ask, publishDraft, type AgentEvent, type NoteDraft } from '../agent/client';
import { categoryLabel, later, show, t, type MessageKey, type Text } from '../i18n';
import { useLanguage } from '../i18n/useLanguage';

/**
 * The assistant panel.
 *
 * ⚠️ TOOL CALLS ARE SHOWN, NOT HIDDEN BEHIND A SPINNER. "The assistant said so" is worth nothing
 * to the organisations that own this data; "the assistant asked the city's roadworks service and
 * got 14 rows" is worth something. Every tool the model invokes appears in the transcript with its
 * result summary, and each one can be repeated without the model via `POST /api/tools/{name}`.
 *
 * ⚠️ EVERYTHING IS RENDERED AS TEXT. Model output and open-data fields are untrusted input here:
 * a Baustelle whose description contains a tag must render as that text, not as markup. React
 * escapes it; nothing in this file may use `dangerouslySetInnerHTML`.
 */

type LineKind = 'you' | 'status' | 'meta' | 'tool' | 'tool-result' | 'answer' | 'error';

type DraftState = 'open' | 'saving' | 'saved' | 'discarded' | 'failed';

type Item =
  | { id: number; kind: LineKind; text: Text }
  | { id: number; kind: 'draft'; draft: NoteDraft; state: DraftState; message: Text };

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

/** An item before it has an id. Distributes over the union, which a plain `Omit` does not. */
type NewItem = WithoutId<Item>;

const EXAMPLES = [1, 2, 3] as const;

export interface AssistantProps {
  /** Called after a draft was published, so the notes layer can reload. */
  onNoteSaved(): void;
  /**
   * Ask Fabric who is signed in. Invoked directly from the click, never after an await, because
   * the broker opens a popup and a browser only allows that inside a live user gesture.
   */
  onSignIn(): Promise<string | null>;
  /** The author line the host worked out, or null when there is nothing to say. */
  authorNote: Text | null;
  /** Offer the sign-in button only when there is no name and signing in could produce one. */
  offerSignIn: boolean;
}

export function Assistant({ onNoteSaved, onSignIn, authorNote, offerSignIn }: AssistantProps) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [signInFailed, setSignInFailed] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const running = useRef<AbortController | null>(null);
  const nextId = useRef(0);

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [items]);

  useEffect(() => () => running.current?.abort(), []);

  // Opening puts the cursor in the question field, as before. Without it the next keystrokes go
  // to the page, where W, A, S and D steer the free-flight camera instead of typing.
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  const push = (item: NewItem): number => {
    const id = nextId.current++;
    setItems((all) => [...all, { ...item, id } as Item]);
    return id;
  };

  const patchDraft = (id: number, patch: Partial<Extract<Item, { kind: 'draft' }>>) => {
    setItems((all) => all.map((item) => (item.id === id && item.kind === 'draft' ? { ...item, ...patch } : item)));
  };

  const render = (event: AgentEvent, answer: { id: number | null }) => {
    switch (event.type) {
      case 'status':
        push({ kind: 'status', text: event.message });
        break;
      case 'metadata':
        // Named rather than implied: a viewer should be able to see which model answered.
        push({ kind: 'meta', text: later('assistant.model', event.model) });
        break;
      case 'tool':
        push({ kind: 'tool', text: later('assistant.tool', event.name) });
        break;
      case 'tool_result':
        push({ kind: 'tool-result', text: `↳ ${event.summary}` });
        if (event.entwurf) {
          push({ kind: 'draft', draft: event.entwurf, state: 'open', message: later('draft.warn') });
        }
        break;
      case 'delta': {
        if (answer.id === null) {
          answer.id = push({ kind: 'answer', text: event.text });
        } else {
          const id = answer.id;
          setItems((all) => all.map((item) =>
            item.id === id && item.kind === 'answer' ? { ...item, text: `${show(item.text)}${event.text}` } : item));
        }
        break;
      }
      case 'done':
        break;
      case 'error':
        push({ kind: 'error', text: event.message });
        break;
    }
  };

  const submit = async (prompt: string) => {
    // ⚠️ ONE CONTROLLER PER REQUEST, CAPTURED LOCALLY. A shared mutable controller let a second
    // question's request state be cleared by the first request's `finally`, re-enabling the
    // button mid-flight.
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    setInput('');
    setBusy(true);
    push({ kind: 'you', text: prompt });
    const answer: { id: number | null } = { id: null };
    try {
      for await (const event of ask(prompt, controller.signal)) render(event, answer);
    } catch (error) {
      if (!controller.signal.aborted) {
        push({ kind: 'error', text: error instanceof Error ? error.message : later('assistant.unreachable') });
      }
    } finally {
      // Only the request that is still the current one may hand the input back.
      if (running.current === controller) {
        running.current = null;
        setBusy(false);
        field.current?.focus();
      }
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const prompt = input.trim();
    if (prompt) void submit(prompt);
  };

  const save = (id: number, draft: NoteDraft) => {
    patchDraft(id, { state: 'saving' });
    void publishDraft(draft.entwurfId)
      .then(() => {
        patchDraft(id, { state: 'saved', message: later('draft.saved') });
        onNoteSaved();
      })
      .catch((error: unknown) => {
        // ⚠️ THE ACTIONS STAY. A temporary failure must not cost the user the ability to retry a
        // draft that is still perfectly valid on the server.
        const why = error instanceof Error ? error.message : t('error.unknown');
        patchDraft(id, { state: 'failed', message: later('draft.notPublished', why) });
      });
  };

  const signIn = () => {
    setSigningIn(true);
    // ⚠️ No await before this call: the popup depends on the gesture that is still live here.
    void onSignIn()
      .then((name) => setSignInFailed(!name))
      .finally(() => setSigningIn(false));
  };

  const authorLine: Text | null = signInFailed ? later('author.signInFailed') : authorNote;

  return (
    <>
      <button
        id="assistant-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="assistant"
        // Hidden while open: the panel sits on top of it, and a covered button that keyboard
        // focus can still reach is worse than none. The panel's own close button reopens it.
        hidden={open}
        onClick={() => setOpen(true)}
      >
        {t('assistant.toggle')}
      </button>
      <aside id="assistant" aria-label={t('assistant.title')} hidden={!open}>
        <button
          id="assistant-close"
          type="button"
          aria-label={t('assistant.close')}
          title={t('detail.closeShort')}
          onClick={() => setOpen(false)}
        >
          ✕
        </button>
        <h2>{t('assistant.title')}</h2>
        <p className="assistant-note">{t('assistant.note')}</p>
        {authorLine ? <p id="assistant-author" className="assistant-author">{show(authorLine)}</p> : null}
        {offerSignIn ? (
          <button id="assistant-signin" type="button" className="assistant-signin" disabled={signingIn} onClick={signIn}>
            {t('assistant.signIn')}
          </button>
        ) : null}
        <div id="assistant-log" ref={log} role="log" aria-live="polite">
          {items.map((item) => (item.kind === 'draft'
            ? <Draft key={item.id} item={item} onSave={() => save(item.id, item.draft)} onDiscard={() => patchDraft(item.id, { state: 'discarded', message: later('draft.discarded') })} />
            : <p key={item.id} className={`chat-line chat-${item.kind}`}>{show(item.text)}</p>))}
        </div>
        <div className="assistant-examples">
          {EXAMPLES.map((n) => (
            <button
              key={n}
              type="button"
              className="assistant-example"
              onClick={() => { void submit(t(`assistant.example${n}.prompt` as MessageKey as 'assistant.example1.prompt')); }}
            >
              {t(`assistant.example${n}.label` as MessageKey as 'assistant.example1.label')}
            </button>
          ))}
        </div>
        <form id="assistant-form" onSubmit={onSubmit}>
          <input
            id="assistant-input"
            ref={field}
            type="text"
            autoComplete="off"
            maxLength={400}
            placeholder={t('assistant.placeholder')}
            value={input}
            onChange={(event) => setInput(event.currentTarget.value)}
          />
          <button id="assistant-send" type="submit" disabled={busy}>{t('assistant.send')}</button>
        </form>
      </aside>
    </>
  );
}

function Draft({ item, onSave, onDiscard }: {
  item: Extract<Item, { kind: 'draft' }>;
  onSave(): void;
  onDiscard(): void;
}) {
  const { draft, state, message } = item;
  const settled = state === 'saved' || state === 'discarded';
  return (
    <div className="chat-draft">
      <p className="chat-draft-head">{t('draft.head', categoryLabel(draft.kategorie))}</p>
      {draft.baustelle?.ort ? <p className="chat-draft-where">{draft.baustelle.ort}</p> : null}
      <p className="chat-draft-text">{draft.text}</p>
      <p className={settled ? 'chat-draft-ok' : 'chat-draft-warn'}>{show(message)}</p>
      {settled ? null : (
        <div className="chat-draft-actions">
          <button type="button" className="chat-save" disabled={state === 'saving'} onClick={onSave}>{t('draft.save')}</button>
          <button type="button" className="chat-discard" disabled={state === 'saving'} onClick={onDiscard}>{t('draft.discard')}</button>
        </div>
      )}
    </div>
  );
}
