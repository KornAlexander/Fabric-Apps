/**
 * The consumer chat. Deliberately small, and deliberately not a fork of `PlannerChat.tsx`.
 *
 * ⚠️ NOT A FORK, FOR TWO REASONS. The first is practical: `PlannerChat.tsx` is being edited by
 * another task, so a fork would be a copy of a moving file. The second matters more: that
 * component knows how to render a *proposal*, a set of moves with an "übernehmen" button that
 * posts to `/api/draft/apply`. None of that has any meaning here, because a consumer cannot change
 * a plan, and shipping the affordance while the server refuses it produces a button that fails.
 *
 * ⚠️ A TOOL REFUSAL IS SHOWN, NOT SWALLOWED. When the server declines a call because it was about
 * somebody else, that event is surfaced in the transcript. Hiding it would leave the user watching
 * the model apologise vaguely for something the system did on purpose.
 */

import { useRef, useState } from 'react';

import { ApiError, askAssistant, NotSignedIn, type StreamEvent } from './api';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  notes: string[];
}

const REFUSAL_TEXT: Record<string, string> = {
  other_person_not_visible:
    'Hinweis: In dieser Ansicht ist ausschließlich der eigene Stundenplan sichtbar.',
  scope_not_available: 'Hinweis: Diese Auswertung steht nur der Planung zur Verfügung.',
  tool_not_available: 'Hinweis: Diese Auswertung steht nur der Planung zur Verfügung.',
};

export function ConsumerChat({ site }: { site?: string }): React.ReactElement {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  async function send(): Promise<void> {
    const prompt = draft.trim();
    if (!prompt || busy) return;
    setDraft('');
    setBusy(true);
    setTurns((t) => [...t, { role: 'user', text: prompt, notes: [] }, { role: 'assistant', text: '', notes: [] }]);

    const controller = new AbortController();
    abort.current = controller;

    const patch = (fn: (turn: Turn) => Turn): void =>
      setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? fn(turn) : turn)));

    try {
      for await (const event of askAssistant(prompt, site, controller.signal)) {
        applyEvent(event, patch);
      }
    } catch (err) {
      const message =
        err instanceof NotSignedIn
          ? err.message
          : err instanceof ApiError
            ? err.message
            : 'Die Assistenz ist derzeit nicht erreichbar.';
      patch((turn) => ({ ...turn, text: turn.text || message }));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  return (
    <section className="flex min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {turns.length === 0 && (
          <p className="text-sm opacity-70">
            Fragen zum eigenen Stundenplan, zum Beispiel: „Wann unterrichte ich am Donnerstag?“
          </p>
        )}
        {turns.map((turn, i) => (
          <article key={i} className={turn.role === 'user' ? 'text-right' : ''}>
            <div
              className={
                turn.role === 'user'
                  ? 'inline-block rounded-lg bg-[color-mix(in_srgb,currentColor_12%,transparent)] px-3 py-2 text-sm'
                  : 'text-sm whitespace-pre-wrap'
              }
            >
              {turn.text || (turn.role === 'assistant' && busy ? '…' : '')}
            </div>
            {turn.notes.map((note, n) => (
              <p key={n} className="mt-1 text-xs italic opacity-60">
                {note}
              </p>
            ))}
          </article>
        ))}
      </div>

      <form
        className="flex gap-2 border-t border-black/10 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          className="min-w-0 flex-1 rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm"
          placeholder="Frage zum eigenen Stundenplan"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
          aria-label="Frage zum eigenen Stundenplan"
        />
        <button
          type="submit"
          className="rounded-md border border-black/15 px-3 py-2 text-sm disabled:opacity-50"
          disabled={busy || !draft.trim()}
        >
          Senden
        </button>
      </form>
    </section>
  );
}

function applyEvent(event: StreamEvent, patch: (fn: (turn: Turn) => Turn) => void): void {
  if (event.type === 'delta' && typeof event.text === 'string') {
    const text = event.text;
    patch((turn) => ({ ...turn, text: turn.text + text }));
    return;
  }
  if (event.type === 'tool_result') {
    // ⚠️ The refusal codes come from `server/consumer.py._clamp`. Mapping them here keeps the
    // German phrasing in one place and out of the server, which answers agents as well as people.
    const summary = String(event.summary ?? '');
    for (const [code, note] of Object.entries(REFUSAL_TEXT)) {
      if (summary.includes(code)) {
        patch((turn) => ({ ...turn, notes: [...turn.notes, note] }));
        return;
      }
    }
    return;
  }
  if (event.type === 'error') {
    const message = String(event.message ?? 'Es ist ein Fehler aufgetreten.');
    patch((turn) => ({ ...turn, text: turn.text || message }));
  }
}
