import { useCallback, useEffect, useRef, useState } from 'react';

import { useI18n } from '@/i18n';

/**
 * The planner's way in: ask in German, watch the solver work.
 *
 * ⚠️ TOOL CALLS ARE SHOWN, NOT HIDDEN BEHIND A SPINNER. This is the whole credibility of the
 * feature. A chat bubble that says "ich habe 5 Termine umgeplant" is indistinguishable from a
 * language model inventing five plausible moves; a visible line saying `propose_repairs` returned
 * "3 Optionen, beste verschiebt 5 Termine (optimal)" is evidence. The backend streams those
 * events for exactly this reason, and throwing them away in the UI would waste the one thing that
 * separates this from a demo of a chatbot.
 *
 * The transport is NDJSON over fetch rather than SSE or a socket: the same shape the wind-farm
 * digital twin uses, so a person who has read one backend can read this one.
 */

interface Step {
  kind: 'status' | 'tool' | 'result' | 'error';
  text: string;
}

/**
 * An absence the planner stated in words, ready to be written into the availability table.
 *
 * ⚠️ `recurring` is not decoration. Availability is keyed on `Do-3` — a day and a block, with no
 * date — so applying this blocks EVERY Thursday, not the next one. The model cannot express a
 * single dated absence, and the chip has to say so rather than let a planner assume otherwise.
 */
interface AvailabilityOffer {
  teacherId: string;
  teacher: string | null;
  day: string | null;
  slotIds: string[];
  state: string;
  recurring: boolean;
  affectedCount?: number;
}

interface Exchange {
  prompt: string;
  steps: Step[];
  answer: string;
  running: boolean;
  /** Offered, not applied — the planner clicks. */
  availability?: AvailabilityOffer;
  availabilityDone?: string;
}

/*
 * ⚠️ THE BACKEND ADDRESS COMES FROM ONE PLACE. This file used to read the environment itself,
 * which was harmless while there was one container and actively dangerous the moment there were
 * two: the calendar would have followed the AOI to LMU's backend while the assistant kept talking
 * to OTH's, and the assistant is the surface that answers confidently rather than emptily. A
 * second copy of "where is the backend" is a second thing that can be wrong.
 */
import { apiBase, apiUrl, API_KEY, setAvailability } from '@/api/scheduler';
import { planStoreIdentity, saveAvailability } from '@/api/planStore';
import { activeAoi } from '@/config/aoi';

/**
 * Questions worth asking, so an empty box is not the first thing a visitor meets.
 *
 * ⚠️ THE FIRST ONE NAMES A PERSON, AND THE NAME MUST COME FROM THE DATA. It used to be hard-coded
 * as "Prof. Hinterberger" — a surname from the OTH pool — and it was still there in the LMU
 * build, where nobody of that name exists. The demo's very first click would have asked the
 * assistant about a teacher it could not find, and the assistant would have been right to say so.
 * The name is fetched from `/api/plan/summary`, which reports whoever is busiest in whichever
 * dataset the backend is serving; until that answers, the question is asked without a name.
 */
function suggestionsFor(teacher: string | null): string[] {
  return [
    teacher
      ? `${teacher} kann freitags nicht mehr. Was ist betroffen und wie planen wir um?`
      : 'Eine Lehrperson kann freitags nicht mehr. Was ist betroffen und wie planen wir um?',
    'Wie stark sind die Hörsäle ausgelastet?',
    'Welche Semestergruppen müssen an einem Tag zwischen den Standorten wechseln?',
  ];
}

export function PlannerChat({
  onMoves,
  onProposal,
}: {
  onMoves?: (roomIds: string[]) => void;
  /** A solver proposal is ready to preview. The id is the server's record of exactly what was
   *  offered, so confirming it later applies THAT and not a fresh solve (PLAN §13.2). */
  onProposal?: (proposalId: string, options: { option: number; sessionsMoved: number }[]) => void;
}) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState('');
  const [history, setHistory] = useState<Exchange[]>([]);
  const [exampleTeacher, setExampleTeacher] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // ⚠️ CLEARING MID-ANSWER WOULD PUT THE OLD ANSWER IN THE NEXT QUESTION. `ask` captures
  // `index = history.length` and writes back with `h.map((e, i) => i === index ? …)`, so after a
  // clear the next question is index 0 — and a still-running stream from the discarded
  // conversation also writes index 0. Its tokens then appear under a question that never asked
  // them: not a crash, just a confident wrong answer in front of whoever is watching.
  // `clearChat.spec.ts` reproduces exactly that and fails when neither defence below is present.
  //
  // Measured: EITHER of the two alone is enough to pass that test, so they are defence in depth
  // rather than two halves of one mechanism. They are both kept because they fail differently —
  // the abort ends the request (and the spend), while the generation counter is what discards
  // anything already decoded before the abort lands, and is the only thing covering the
  // `onMoves` / `onProposal` callbacks, which reach outside this component and would otherwise
  // light up rooms for a conversation that no longer exists. That last part is reasoning, not a
  // measurement: no test currently exercises it.
  const generation = useRef(0);
  const inFlight = useRef(new Set<AbortController>());
  const SUGGESTIONS = suggestionsFor(exampleTeacher);

  const clear = useCallback(() => {    // Stop the stream as well as ignoring it: the assistant bills per token and the backend caps
    // calls per hour, so reading out an answer nobody will see spends both for nothing.
    generation.current += 1;
    for (const controller of inFlight.current) controller.abort();
    inFlight.current.clear();
    setHistory([]);
    setPrompt('');
  }, []);

  /**
   * Write a stated absence into the availability table.
   *
   * ⚠️ REPORTS WHAT IT BROKE, NOT "GESPEICHERT". Blocking a day does not move anything — it makes
   * the sessions already in that day illegal, and that consequence is the only thing the planner
   * actually needs to hear. Same contract as the availability panel, whose endpoint this is.
   *
   * ⚠️ SQL is best-effort and never gates. Fabric SSO resolves only inside the hosted app, so on a
   * laptop the write lands in the running plan and not in the database — and the chip says which,
   * rather than implying a permanence that is not there.
   */
  const applyAvailability = useCallback(
    async (index: number, offer: AvailabilityOffer) => {
      const site = activeAoi().schedulerSite ?? '';
      const entries = offer.slotIds.map((slotId) => ({ slotId, state: offer.state }));
      try {
        const written = await setAvailability(site, offer.teacherId, entries, 'Planer:in (Assistent)');
        const identity = planStoreIdentity();
        if (identity) {
          await saveAvailability(site, offer.teacherId, entries, 'ui', identity).catch(() => null);
        }
        const clashes = written.nowInConflict?.length ?? 0;
        setHistory((h) =>
          h.map((e, i) =>
            i === index
              ? {
                  ...e,
                  availabilityDone: clashes
                    ? t('chat.availabilityClash', { count: String(clashes) })
                    : identity
                      ? t('chat.availabilitySaved')
                      : t('chat.availabilityNotStored'),
                }
              : e
          )
        );
      } catch {
        setHistory((h) =>
          h.map((e, i) => (i === index ? { ...e, availabilityDone: t('chat.availabilityFailed') } : e))
        );
      }
    },
    [t]
  );

  useEffect(() => {
    if (!apiBase()) return;
    let cancelled = false;
    // ⚠️ THIS CALL MUST CARRY THE KEY, and for a while it did not. `/api/plan/summary` used to be
    // open; closing it (it was leaking estate counts, a lecturer's name and the Foundry endpoint to
    // anonymous callers) turned this fetch into a 401 on every load of a site that has a planner.
    // The `.catch` below then swallowed it exactly as designed, so nothing broke visibly — the
    // example question just quietly lost its name, and the only trace was a console error the
    // deploy verifier caught. A silent degrade behind a deliberate catch is the hardest kind of
    // regression to notice, which is why the header is spelled out here rather than assumed.
    //
    // ⚠️ AND IT MUST CARRY THE SITE, which it did not — same shape of failure, one layer along.
    // The URL was built by hand, so it never named a university and the shared container answered
    // with its DEFAULT one. The visible symptom was small and completely misleading: RWTH Aachen's
    // suggested question offered to reschedule "Prof. Dr. F. Frauenberger", who is in OTH's
    // lecturer pool and does not exist at Aachen. `apiUrl` is the one place that knows the site.
    fetch(apiUrl('/api/plan/summary').toString(), {
      headers: API_KEY ? { 'X-App-Key': API_KEY } : {},
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!cancelled && typeof s?.exampleTeacher === 'string') setExampleTeacher(s.exampleTeacher);
      })
      // A failed summary is not worth reporting: the example question simply stays nameless, and
      // the panel's own error handling covers the case where the backend is genuinely down.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const ask = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text) return;
      setPrompt('');

      if (!apiBase()) {
        setHistory((h) => [
          ...h,
          {
            prompt: text,
            steps: [{ kind: 'error', text: t('chat.notConfigured') }],
            answer: '',
            running: false,
          },
        ]);
        return;
      }

      const index = history.length;
      const myGeneration = generation.current;
      setHistory((h) => [...h, { prompt: text, steps: [], answer: '', running: true }]);

      // Every write goes through here, so one check covers the whole exchange — including the
      // error branches, which is why aborting does not paint a failure onto a conversation the
      // planner deliberately threw away.
      const update = (fn: (e: Exchange) => Exchange) => {
        if (myGeneration !== generation.current) return;
        setHistory((h) => h.map((e, i) => (i === index ? fn(e) : e)));
      };

      const controller = new AbortController();
      inFlight.current.add(controller);

      try {
        // ⚠️ THE SITE RIDES IN THE QUERY STRING, and this is the request where getting it wrong
        // matters most. The assistant reads the plan and answers in prose; without a site it reads
        // whichever plan the shared container defaults to and states another university's numbers
        // under this one's heading, fluently and with complete confidence. Every other route in
        // this file goes through the JSON helpers, which name the site for them; this one cannot,
        // because it consumes an NDJSON stream through a `ReadableStream` reader.
        const response = await fetch(apiUrl('/api/assistant/stream').toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-App-Key': API_KEY },
          body: JSON.stringify({ prompt: text }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          update((e) => ({
            ...e,
            running: false,
            steps: [...e.steps, { kind: 'error', text: `HTTP ${response.status}` }],
          }));
          return;
        }

        // NDJSON: one JSON object per line, and a line can arrive split across chunks.
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const touched: string[] = [];

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.trim()) continue;
            let event: Record<string, unknown>;
            try {
              event = JSON.parse(line);
            } catch {
              continue;
            }
            const kind = event.type as string;
            if (kind === 'status') {
              update((e) => ({ ...e, steps: [...e.steps, { kind: 'status', text: String(event.message) }] }));
            } else if (kind === 'tool') {
              update((e) => ({ ...e, steps: [...e.steps, { kind: 'tool', text: String(event.name) }] }));
            } else if (kind === 'tool_result') {
              update((e) => ({
                ...e,
                steps: [...e.steps, { kind: 'result', text: `${event.name}: ${event.summary}` }],
              }));
              // `propose_repairs` streams a proposalId alongside its summary. That id is the
              // handle on a preview: the planner sees the shift in the calendar before anything
              // is written, which is the whole point of the confirm gate.
              if (event.proposalId && onProposal) {
                onProposal(
                  String(event.proposalId),
                  (event.options as { option: number; sessionsMoved: number }[]) ?? []
                );
              }
              // ⚠️ THE STATED ABSENCE ITSELF, not just its consequence. Repairing the plan leaves
              // the CONSTRAINT untouched, so the app forgets by tomorrow that this lecturer said
              // they cannot teach Thursdays. The server attaches the parsed absence only when the
              // planner named a time; it is offered here and written only if they click.
              if (event.availability) {
                update((e) => ({ ...e, availability: event.availability as AvailabilityOffer }));
              }
            } else if (kind === 'delta') {
              update((e) => ({ ...e, answer: e.answer + String(event.text) }));
              // Room codes in the answer are what the 3D view should light up.
              for (const match of String(event.text).matchAll(/\b([A-Za-z]{1,2} ?\d{3})\b/g)) {
                touched.push(match[1]);
              }
            } else if (kind === 'error') {
              // The server's own wording is English and aimed at whoever wrote the server. It goes
              // to the console; the planner reads a sentence in their language.
              console.warn(`agent error: ${String(event.message ?? event.error)}`);
              update((e) => ({
                ...e,
                steps: [...e.steps, { kind: 'error', text: t('chat.errAgent') }],
              }));
            }
            scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
          }
        }

        update((e) => ({ ...e, running: false }));
        if (touched.length && onMoves) onMoves([...new Set(touched)]);
      } catch (error) {
        // An abort is this component asking the request to stop, not a fault. Logging it as one
        // would put a red herring in the console every time somebody clears the chat.
        if ((error as { name?: string })?.name !== 'AbortError') {
          console.error('planner chat failed', error);
        }
        update((e) => ({
          ...e,
          running: false,
          steps: [...e.steps, { kind: 'error', text: t('chat.errRequest') }],
        }));
      }
    },
    [history.length, onMoves, onProposal, t]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="planner-chat">
      {/*
        ⚠️ NOT RENDERED WHEN THERE IS NOTHING TO CLEAR. An empty chat already shows the intro and
        the suggested questions, so a clear button there is a control whose only possible outcome
        is nothing happening — the same rule that hides the lecturer scope on a site whose data can
        only refuse it. It sits ABOVE the scroller rather than inside it so it cannot scroll away
        mid-conversation, which is exactly when it is wanted.
      */}
      {history.length > 0 && (
        <div className="mb-2 flex shrink-0 justify-end">
          <button
            type="button"
            data-testid="planner-clear"
            onClick={clear}
            className="rounded border border-stone-700 px-2 py-1 text-[0.7rem] text-stone-400 hover:border-stone-500 hover:text-stone-200"
          >
            {t('chat.clear')}
          </button>
        </div>
      )}
      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {history.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs leading-relaxed text-stone-400">{t('chat.intro')}</p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void ask(s)}
                className="block w-full rounded border border-stone-700 bg-stone-800/60 px-3 py-2 text-left text-xs leading-relaxed text-stone-300 hover:border-amber-500/60 hover:text-stone-100"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {history.map((exchange, i) => (
          <div key={i} className="space-y-2">
            <p className="rounded bg-stone-800 px-3 py-2 text-xs text-stone-200">{exchange.prompt}</p>

            {exchange.steps.length > 0 && (
              <ul className="space-y-1 border-l border-stone-700 pl-3">
                {exchange.steps.map((step, j) => (
                  <li
                    key={j}
                    className={
                      step.kind === 'error'
                        ? 'text-[0.7rem] text-red-400'
                        : step.kind === 'result'
                          ? 'text-[0.7rem] text-emerald-300'
                          : 'text-[0.7rem] text-stone-500'
                    }
                  >
                    {step.kind === 'tool' ? `→ ${step.text}(…)` : step.text}
                  </li>
                ))}
              </ul>
            )}

            {exchange.answer && (
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-stone-100">
                {exchange.answer}
              </p>
            )}

            {/*
              The absence itself, offered as a change to the CONSTRAINT.

              ⚠️ This sits beside the replan rather than inside it, because they are two different
              decisions: "move these lectures" is about the plan, "he cannot teach Thursdays" is
              about the world. Repairing the plan without recording the second leaves the app
              believing the lecturer is free next time anyone asks.
            */}
            {exchange.availability && !exchange.availabilityDone && (
              <div
                data-testid="chat-availability-offer"
                className="mt-2 rounded border border-amber-500/50 bg-amber-500/10 px-2 py-1.5 text-[0.7rem] text-amber-100"
              >
                <p className="font-medium">
                  {t('chat.availabilityOffer', {
                    teacher: exchange.availability.teacher ?? exchange.availability.teacherId,
                    day: exchange.availability.day ?? '',
                    count: String(exchange.availability.slotIds.length),
                  })}
                </p>
                {/* ⚠️ Says "every" out loud — availability carries no date, so this is permanent. */}
                <p className="mt-0.5 text-amber-200/80">
                  {t('chat.availabilityRecurring', { day: exchange.availability.day ?? '' })}
                </p>
                <button
                  type="button"
                  data-testid="chat-availability-apply"
                  onClick={() => void applyAvailability(i, exchange.availability!)}
                  className="mt-1 rounded bg-amber-600/80 px-2 py-0.5 font-medium text-white hover:bg-amber-600"
                >
                  {t('chat.availabilityApply')}
                </button>
              </div>
            )}
            {exchange.availabilityDone && (
              <p
                data-testid="chat-availability-done"
                className="mt-2 rounded bg-stone-800 px-2 py-1 text-[0.7rem] text-amber-300"
              >
                {exchange.availabilityDone}
              </p>
            )}

            {exchange.running && !exchange.answer && (
              <p className="text-[0.7rem] italic text-stone-500">{t('chat.thinking')}</p>
            )}
          </div>
        ))}
      </div>

      <form
        className="mt-3 flex shrink-0 gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(prompt);
        }}
      >
        <input
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={t('chat.placeholder')}
          data-testid="planner-input"
          className="min-w-0 flex-1 rounded border border-stone-700 bg-stone-950 px-3 py-2 text-xs text-stone-100 placeholder:text-stone-600 focus:border-amber-500/70 focus:outline-none"
        />
        <button
          type="submit"
          data-testid="planner-send"
          className="shrink-0 rounded border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-200 hover:bg-amber-500/20"
        >
          {t('chat.send')}
        </button>
      </form>
    </div>
  );
}
