import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  canAct,
  summariseTasks,
  taskQueue,
  templateFor,
  type GovernanceTask,
  type TaskStatus,
} from '@/domain/tasks';
import { useAuth } from '@/hooks/AuthContext';
import { useT } from '@/i18n';
import { loadTasks, updateTask } from '@/services/tasks';

const STATUS_STYLE: Record<TaskStatus, string> = {
  Open: 'bg-blue-50 text-blue-800 ring-blue-600/20',
  InProgress: 'bg-amber-50 text-amber-900 ring-amber-600/20',
  // Deliberately not green. A claim must not look like a proof.
  Attested: 'bg-gray-100 text-gray-700 ring-gray-500/20',
  Verified: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  Cancelled: 'bg-gray-100 text-gray-500 ring-gray-400/20',
};

/**
 * The manual task queue (PLAN.md §13 page 10, Phase 11).
 *
 * This is the honest half of the product. Five binding kinds have no write API,
 * so the tool hands each one to a human with the exact click-path — and is
 * explicit about what can be proven afterwards.
 *
 * The distinction the page exists to protect: **Attested** is a person's claim,
 * **Verified** is a machine check. They are styled differently and counted
 * separately, because a queue that lets a click become governance evidence is
 * worse than no queue at all.
 */
export function TasksPage() {
  const t = useT();
  const { user } = useAuth();

  const [tasks, setTasks] = useState<GovernanceTask[]>([]);
  const [reachable, setReachable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [openSteps, setOpenSteps] = useState<string | null>(null);

  const actor = user?.email ?? user?.name ?? 'unknown';

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await loadTasks();
    setTasks(result.tasks);
    setReachable(result.backendReachable);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const queue = useMemo(() => taskQueue(tasks), [tasks]);
  const summary = useMemo(() => summariseTasks(tasks), [tasks]);
  const completed = useMemo(
    () => tasks.filter((task) => !['Open', 'InProgress'].includes(task.status)),
    [tasks]
  );

  async function act(task: GovernanceTask, action: 'claim' | 'attest' | 'cancel' | 'reopen') {
    const decision = canAct(task, action);
    if (!decision.allowed) {
      setError(decision.reason ?? t('tasks.actionFailed'));
      return;
    }
    setBusy(task.id);
    setError(null);

    const patch =
      action === 'claim'
        ? { status: 'InProgress' as TaskStatus, assignee: actor }
        : action === 'attest'
          ? {
              status: 'Attested' as TaskStatus,
              completedBy: actor,
              // The claim is stored as the claim it is, attributed by name.
              evidence: `attested by ${actor}: ${notes[task.id] || 'no detail given'}`,
            }
          : action === 'cancel'
            ? {
                status: 'Cancelled' as TaskStatus,
                completedBy: actor,
                evidence: `cancelled by ${actor}: ${notes[task.id] || 'no reason given'}`,
              }
            : { status: 'Open' as TaskStatus };

    const ok = await updateTask(task.id, patch);
    setBusy(null);
    if (!ok) setError(t('tasks.actionFailed'));
    await refresh();
  }

  function renderTask(task: GovernanceTask) {
    const template = templateFor(task.bindingKind);
    const stepsOpen = openSteps === task.id;
    const isOpen = task.status === 'Open' || task.status === 'InProgress';

    return (
      <li key={task.id} className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${STATUS_STYLE[task.status]}`}
              >
                {t(`tasks.status.${task.status}`)}
              </span>
              <span className="font-medium text-gray-900">
                {template ? t(template.titleKey) : task.bindingKind}
              </span>
              <span className="font-mono text-xs text-gray-500">{task.bindingKind}</span>
            </div>
            <p className="mt-1 text-sm text-gray-700">{task.detail}</p>
            <p className="mt-0.5 text-xs text-gray-500">
              {task.scopeType} · {task.scopeName}
              {task.assignee ? ` · ${task.assignee}` : ''}
            </p>

            {/* The honesty line: what can actually be proven here. */}
            {template && (
              <p
                className={`mt-1 text-xs ${
                  template.verification === 'machine' ? 'text-emerald-700' : 'text-amber-800'
                }`}
              >
                {t(`tasks.verification.${template.verification}`)}
              </p>
            )}
            {task.evidence && (
              <p className="mt-1 text-xs text-gray-600 italic">{task.evidence}</p>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {template && (
              <a
                href={template.portal({ scopeId: task.scopeId, scopeType: task.scopeType })}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs text-blue-700 hover:bg-gray-50"
              >
                {t('tasks.openPortal')}
              </a>
            )}
            <button
              type="button"
              onClick={() => setOpenSteps(stepsOpen ? null : task.id)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
            >
              {t('tasks.steps')}
            </button>
          </div>
        </div>

        {stepsOpen && template && (
          <ol className="mt-3 space-y-1 border-t border-gray-100 pt-3">
            {template.steps.map((step, index) => (
              <li key={index} className="text-xs text-gray-700">
                {index + 1}. {step}
              </li>
            ))}
            <li className="pt-1 text-xs text-gray-500">{template.verificationNote}</li>
          </ol>
        )}

        {isOpen && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
            {canAct(task, 'claim').allowed && (
              <button
                type="button"
                disabled={busy === task.id}
                onClick={() => void act(task, 'claim')}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                {t('tasks.claim')}
              </button>
            )}
            {canAct(task, 'attest').allowed && (
              <>
                <input
                  value={notes[task.id] ?? ''}
                  onChange={(e) => setNotes((n) => ({ ...n, [task.id]: e.target.value }))}
                  placeholder={t('tasks.attestPrompt')}
                  className="w-72 rounded-lg border border-gray-200 px-3 py-1 text-xs"
                />
                <button
                  type="button"
                  disabled={busy === task.id}
                  onClick={() => void act(task, 'attest')}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                >
                  {t('tasks.attest')}
                </button>
              </>
            )}
            <button
              type="button"
              disabled={busy === task.id}
              onClick={() => void act(task, 'cancel')}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-40"
            >
              {t('tasks.cancel')}
            </button>
            {template?.verification === 'attestation' && (
              <span className="text-xs text-amber-800">{t('tasks.attestationWarning')}</span>
            )}
          </div>
        )}

        {task.status === 'Attested' && canAct(task, 'reopen').allowed && (
          <div className="mt-2 border-t border-gray-100 pt-2">
            <button
              type="button"
              disabled={busy === task.id}
              onClick={() => void act(task, 'reopen')}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              {t('tasks.reopen')}
            </button>
          </div>
        )}
      </li>
    );
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{t('tasks.title')}</h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">{t('tasks.intro')}</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? t('common.loading') : t('inventory.refresh')}
        </button>
      </section>

      {!reachable && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-600/20 ring-inset">
          {t('tasks.storeUnavailable')}
        </p>
      )}
      {error && (
        <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-900 ring-1 ring-rose-600/20 ring-inset">
          {error}
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs tracking-wide text-gray-500 uppercase">{t('tasks.stat.open')}</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{summary.open}</p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs tracking-wide text-gray-500 uppercase">
            {t('tasks.stat.overdue')}
          </p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{summary.overdue}</p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs tracking-wide text-gray-500 uppercase">
            {t('tasks.stat.attestationOnly')}
          </p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{summary.attestationOnly}</p>
        </div>
      </section>

      {summary.attestationOnly > 0 && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-600/20 ring-inset">
          {t('tasks.honesty', { count: String(summary.attestationOnly) })}
        </p>
      )}

      <section>
        <h3 className="text-sm font-semibold text-gray-900">{t('tasks.queue')}</h3>
        {loading ? (
          <p className="mt-2 text-sm text-gray-500">{t('common.loading')}</p>
        ) : queue.length === 0 ? (
          <p className="mt-2 rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm ring-1 ring-gray-200">
            {tasks.length === 0 ? t('tasks.none') : t('tasks.queueEmpty')}
          </p>
        ) : (
          <ul className="mt-2 space-y-2">{queue.map(renderTask)}</ul>
        )}
      </section>

      {completed.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-gray-900">{t('tasks.done')}</h3>
          <ul className="mt-2 space-y-2">{completed.map(renderTask)}</ul>
        </section>
      )}
    </div>
  );
}

export default TasksPage;
