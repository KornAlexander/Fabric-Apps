import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';

import { useI18n } from '@/i18n';
import { MeterList, ProgressRing } from '@/guidelines/charts';
import { MAX_TEXT, NO_CONVENTIONS, cleanAnswers, progressOf, sameAnswers, summaryText, type Conventions } from '@/guidelines/conventions';
import { GUIDELINE_QUESTIONS, QUESTION_CATEGORIES, formatAnswerValue, type Answer, type GuidelineQuestion } from '@/guidelines/questions';
import { MAX_IMPORT_BYTES, downloadText, exportFileName, exportText, parseImport, readFileText, readLocal, toSaved } from '@/guidelines/store';
import { useConventions, useStore } from '@/guidelines/useConventions';
import { categoryLabel, questionWords } from '@/guidelines/words';
import { PATHS } from '@/paths';

import { Button, Notice, Pill } from './parts';

type Category = (typeof QUESTION_CATEGORIES)[number];

const chip =
  'inline-flex cursor-pointer rounded-full px-3 py-1.5 text-sm text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 peer-checked:bg-blue-600 peer-checked:font-medium peer-checked:text-white peer-checked:ring-blue-600 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-600';
const field = 'block w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-800';

export const DRAFT_KEY = 'power-bi-guidelines.draft';

/** The unsaved answers of this browser tab, or `null`. Cleaned like everything that is read. */
function readDraft(): Record<string, Answer> | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    return raw ? cleanAnswers(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function keepDraft(draft: Record<string, Answer> | null) {
  try {
    if (draft) window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage can be blocked; the answers then live in the form only */
  }
}

/** Copies text, also where the clipboard permission is withheld (an embedded frame). */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the older way */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

function QuestionCard({ q, answer, disabled, onChange, onClear }: { q: GuidelineQuestion; answer: Answer | undefined; disabled: boolean; onChange: (patch: Partial<Answer>) => void; onClear: () => void }) {
  const { t, locale } = useI18n();
  const words = questionWords(q, locale);
  const answered = formatAnswerValue(q, answer) !== null;
  const otherId = `glq-${q.id}-other`;
  return (
    <fieldset disabled={disabled} className={`rounded-2xl bg-white p-5 shadow-sm ring-1 disabled:opacity-60 ${answered ? 'ring-blue-600/40' : 'ring-slate-200'}`}>
      <legend className="sr-only">{words.question}</legend>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">{words.label}</p>
          <p className="mt-1 text-sm font-medium text-slate-900" aria-hidden="true">
            {words.question}
          </p>
          {words.help && <p className="mt-1 text-xs text-slate-500">{words.help}</p>}
        </div>
        {answered && (
          <button type="button" onClick={onClear} disabled={disabled} className="shrink-0 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-800" aria-label={`${t('glq.clear')}: ${words.label}`}>
            {t('glq.clear')}
          </button>
        )}
      </div>

      <div className="mt-3 space-y-3">
        {q.type === 'text' && (
          <textarea
            aria-label={words.question}
            value={answer?.text ?? ''}
            maxLength={MAX_TEXT}
            rows={2}
            placeholder={words.placeholder}
            onChange={(e) => onChange({ text: e.target.value })}
            className={field}
          />
        )}
        {q.type !== 'text' && (
          <div className="flex flex-wrap gap-2">
            {(q.options ?? []).map((option, optionIndex) => {
              const checked = q.type === 'single' ? answer?.choice === option : (answer?.choices ?? []).includes(option);
              return (
                <label key={option}>
                  <input
                    type={q.type === 'single' ? 'radio' : 'checkbox'}
                    name={`glq-${q.id}`}
                    className="peer sr-only"
                    checked={checked}
                    onChange={(e) => {
                      if (q.type === 'single') return onChange({ choice: option });
                      const rest = (answer?.choices ?? []).filter((c) => c !== option);
                      onChange({ choices: e.target.checked ? [...rest, option] : rest });
                    }}
                  />
                  <span className={chip}>{words.options?.[optionIndex] ?? option}</span>
                </label>
              );
            })}
          </div>
        )}
        {q.type !== 'text' && q.allowOther && (
          <div>
            <label htmlFor={otherId} className="sr-only">
              {`${t('glq.other')}: ${words.label}`}
            </label>
            <input
              id={otherId}
              type="text"
              value={answer?.other ?? ''}
              maxLength={MAX_TEXT}
              placeholder={words.placeholder ?? t('glq.other')}
              onChange={(e) => onChange({ other: e.target.value })}
              className={`${field} max-w-md`}
            />
          </div>
        )}
      </div>
    </fieldset>
  );
}

/** The questionnaire that tailors the guide. Answers are kept in this browser and travel as a file. */
export function GuidelinesSetupPage() {
  const { t, locale } = useI18n();
  const store = useStore();
  const { conventions, loaded } = useConventions();
  /** What the form started from; a save is refused when the stored answers moved on since. */
  const [base, setBase] = useState<Conventions>(NO_CONVENTIONS);
  const [draft, setDraft] = useState<Record<string, Answer>>({});
  const [category, setCategory] = useState<Category>(QUESTION_CATEGORIES[0]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  /** Stored answers that differ from what the form started from. `'unreadable'`: they were there and cannot be read now. */
  const [conflict, setConflict] = useState<Conventions | 'unreadable' | null>(null);
  const [message, setMessage] = useState<{ tone: 'info' | 'alert'; text: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [restored, setRestored] = useState(false);
  const [canKeep] = useState(() => store.available());
  const fileInput = useRef<HTMLInputElement>(null);

  const dirty = !sameAnswers(draft, base.answers);
  const dirtyNow = useRef(dirty);
  dirtyNow.current = dirty;
  const started = useRef(false);

  useEffect(() => {
    if (!loaded) return;
    if (started.current) {
      // Another tab saved. A form without changes follows it; a form with
      // changes keeps them and its starting point, so saving asks first.
      if (!dirtyNow.current) {
        setBase(conventions);
        setDraft(conventions.answers);
      }
      return;
    }
    started.current = true;
    setBase(conventions);
    // Answers that were not saved before this page was left come back.
    const kept = readDraft();
    if (kept && !sameAnswers(kept, conventions.answers)) {
      setDraft(kept);
      setRestored(true);
    } else {
      setDraft(conventions.answers);
    }
    setReady(true);
  }, [loaded, conventions]);

  const progress = useMemo(() => progressOf(draft, locale), [draft, locale]);

  // Unsaved answers survive a change of page inside the app, for this browser tab only.
  useEffect(() => {
    if (ready) keepDraft(dirty ? draft : null);
  }, [ready, dirty, draft]);

  // Closing or reloading the page with unsaved answers asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const when = (iso: string | undefined) => (iso ? new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const index = QUESTION_CATEGORIES.indexOf(category);
  const questions = GUIDELINE_QUESTIONS.filter((q) => q.category === category);

  const change = (id: string, patch: Partial<Answer>) => {
    setMessage(null);
    setDraft((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  };
  const clear = (id: string) => {
    setMessage(null);
    setDraft((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
  };
  const adopt = (stored: Conventions) => {
    setBase(stored);
    setDraft(stored.answers);
    setConflict(null);
    setRestored(false);
  };

  const save = async (overwrite: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      if (!overwrite) {
        const current = readLocal(await store.read());
        // Answers that were there and cannot be read now (removed or damaged):
        // not written over without being asked.
        if (base.updatedAt && !current.updatedAt) return setConflict('unreadable');
        // Another tab saved in the meantime. The answers are compared too, in
        // case what is stored carries no time.
        if ((current.updatedAt ?? '') !== (base.updatedAt ?? '') || !sameAnswers(current.answers, base.answers)) return setConflict(current);
      }
      const stored = toSaved(draft, new Date());
      if (!(await store.write(stored))) return setMessage({ tone: 'alert', text: t('glq.failed') });
      // Read back: only what the store returns counts as saved.
      const after = readLocal(await store.read());
      if (after.updatedAt === stored.updatedAt && sameAnswers(after.answers, stored.answers)) {
        adopt(after);
        setMessage({ tone: 'info', text: t('glq.saved') });
      } else {
        // Written, but what is stored now is something else.
        setMessage({ tone: 'alert', text: t('glq.unconfirmed') });
      }
    } catch {
      setMessage({ tone: 'alert', text: t('glq.failed') });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (await copyText(summaryText(draft, locale))) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  };

  const exportFile = () => {
    const now = new Date();
    downloadText(exportText(draft, now), exportFileName(now));
  };

  /** An imported file fills the form. Nothing is saved until Save. */
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setMessage(null);
    if (file.size > MAX_IMPORT_BYTES) return setMessage({ tone: 'alert', text: t('glq.import.tooLarge') });
    let text: string;
    try {
      text = await readFileText(file);
    } catch {
      return setMessage({ tone: 'alert', text: t('glq.import.notJson') });
    }
    const result = parseImport(text);
    if (!result.ok) return setMessage({ tone: 'alert', text: t(`glq.import.${result.reason}`) });
    setDraft(result.conventions.answers);
    setConflict(null);
    setMessage({ tone: 'info', text: t('glq.imported', { count: Object.keys(result.conventions.answers).length }) });
  };

  return (
    <div className="space-y-6">
      <div>
        <Link to={PATHS.guide} className="text-sm text-blue-700 underline underline-offset-2">
          {`← ${t('glq.back')}`}
        </Link>
        <h2 className="mt-2 text-xl font-semibold text-gray-900">{t('glq.title')}</h2>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">{t('glq.intro')}</p>
        <p className="mt-1 max-w-3xl text-xs text-gray-500">{t('glq.advisory')}</p>
      </div>

      {!canKeep && <Notice tone="warn">{t('glq.storage')}</Notice>}

      {!loaded ? (
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      ) : (
        <div className="grid items-start gap-6 md:grid-cols-[16rem_minmax(0,1fr)]">
          <aside className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 md:sticky md:top-4">
            <div className="flex items-center gap-3">
              <ProgressRing answered={progress.answered} total={progress.total} size={72} label={t('glq.ring', { answered: progress.answered, total: progress.total })} />
              <p className="text-sm text-slate-600">{t('glq.answered', { answered: progress.answered, total: progress.total })}</p>
            </div>
            <nav aria-label={t('glq.categories')}>
              <ul className="space-y-1">
                {progress.byCategory.map((c) => {
                  const active = c.category === category;
                  return (
                    <li key={c.category}>
                      <button
                        type="button"
                        aria-current={active ? 'true' : undefined}
                        onClick={() => setCategory(c.category as Category)}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${active ? 'bg-blue-50 font-medium text-blue-800 ring-1 ring-inset ring-blue-600/20' : 'text-slate-700 hover:bg-slate-50'}`}
                      >
                        <span className="min-w-0">{c.label}</span>
                        <span className="shrink-0 text-xs tabular-nums text-slate-500">{`${c.answered} / ${c.total}`}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
            <MeterList rows={progress.byCategory.map((c) => ({ name: c.label, value: c.answered, of: c.total, text: `${c.answered} / ${c.total}` }))} />
          </aside>

          <div className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-base font-semibold text-gray-900">{categoryLabel(category, locale)}</h3>
              <span className="text-xs text-gray-500">{`${index + 1} / ${QUESTION_CATEGORIES.length}`}</span>
            </div>
            {questions.map((q) => (
              <QuestionCard key={q.id} q={q} answer={draft[q.id]} disabled={busy} onChange={(patch) => change(q.id, patch)} onClear={() => clear(q.id)} />
            ))}
            <div className="flex flex-wrap justify-between gap-2">
              <Button onClick={() => setCategory(QUESTION_CATEGORIES[index - 1])} disabled={index === 0}>
                {`← ${t('glq.prev')}`}
              </Button>
              <Button onClick={() => setCategory(QUESTION_CATEGORIES[index + 1])} disabled={index === QUESTION_CATEGORIES.length - 1}>
                {`${t('glq.next')} →`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {loaded && (
        <div className="sticky bottom-3 z-10 space-y-3 rounded-2xl bg-white/95 p-4 shadow-lg ring-1 ring-slate-200 backdrop-blur">
          {conflict && (
            <Notice
              tone="alert"
              action={
                <span className="flex flex-wrap gap-2">
                  {conflict !== 'unreadable' && (
                    <Button onClick={() => adopt(conflict)} disabled={busy}>
                      {t('glq.conflict.load')}
                    </Button>
                  )}
                  <Button onClick={() => void save(true)} disabled={busy}>
                    {t('glq.conflict.overwrite')}
                  </Button>
                </span>
              }
            >
              {conflict === 'unreadable' ? t('glq.unreadable') : conflict.updatedAt ? t('glq.conflict', { at: when(conflict.updatedAt) }) : t('glq.conflict.unknown')}
            </Notice>
          )}
          {restored && dirty && !message && <Notice tone="info">{t('glq.restored')}</Notice>}
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          <div className="flex flex-wrap items-center gap-3">
            <Pill tone={dirty ? 'warn' : progress.answered > 0 ? 'good' : 'neutral'}>{t(dirty ? 'glq.dirty' : progress.answered > 0 ? 'glq.clean' : 'glq.empty')}</Pill>
            {base.updatedAt && <span className="text-xs text-gray-500">{t('glq.lastSavedAt', { at: when(base.updatedAt) })}</span>}
            <span className="ml-auto flex flex-wrap gap-2">
              <input ref={fileInput} type="file" accept="application/json,.json" className="sr-only" aria-label={t('glq.import.label')} tabIndex={-1} onChange={(e) => void importFile(e)} />
              <Button onClick={() => fileInput.current?.click()} disabled={busy}>
                {t('glq.import')}
              </Button>
              <Button onClick={exportFile} disabled={progress.answered === 0}>
                {t('glq.export')}
              </Button>
              <Button onClick={() => void copy()} disabled={progress.answered === 0}>
                {t(copied ? 'glq.copied' : 'glq.copy')}
              </Button>
              <Button onClick={() => setDraft({})} disabled={busy || Object.keys(draft).length === 0}>
                {t('glq.clearAll')}
              </Button>
              <Button onClick={() => adopt(base)} disabled={busy || !dirty}>
                {t('glq.discard')}
              </Button>
              <Button primary onClick={() => void save(false)} disabled={busy || !dirty || !canKeep}>
                {t(busy ? 'glq.saving' : 'glq.save')}
              </Button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
