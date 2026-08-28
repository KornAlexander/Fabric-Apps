import { useI18n } from '@/i18n';

/**
 * Says, plainly, that the planner backend is still waking up — TASK 2 of the 2026-08-19 handoff.
 *
 * ⚠️ THE WEEK DRAWER AND THE ASSISTANT ALREADY GET A WARM-UP CALL FOR FREE. `TwinShell` calls
 * `backendSite()` on mount for every planner site, which hits `/api/health` and starts the
 * Container App scaling up from zero the moment the page loads — nothing here adds a second ping.
 * What was missing is not the wake-up, it is the app SAYING SO: until `siteKnown` turns true, the
 * week grid rendered with an empty subject list and the assistant column simply sat there, and on
 * a customer call a cold-but-honest "not yet" and a broken feature look identical.
 *
 * ⚠️ `failed` MUST COME FROM THE SAME CALL, NOT A GUESS. `getJson` throws nothing for a slow
 * container — the promise just stays pending, which is the right behaviour, so there is nothing
 * to catch here. What CAN happen is the request answering back with a genuine error (a non-200,
 * a network drop, a CORS failure), and that is a different fact from "still cold": one clears
 * itself given enough time, the other will not. `backendHealthFailed()` in `src/api/scheduler.ts`
 * reads that fact off the side of the one `/api/health` call `backendSite()` already made and
 * cached — it does not fire a second request to find out.
 */
export function PlannerWakingNotice({ failed = false }: { failed?: boolean }) {
  const { t } = useI18n();

  return (
    <div
      data-testid="planner-waking"
      data-failed={failed}
      role="status"
      className={
        failed
          ? 'flex min-h-0 flex-1 flex-col justify-center gap-2 overflow-auto rounded-lg border border-rose-500/40 bg-rose-500/10 p-4'
          : 'flex min-h-0 flex-1 flex-col justify-center gap-2 overflow-auto rounded-lg border border-sky-500/40 bg-sky-500/10 p-4'
      }
    >
      <p className="text-sm font-semibold text-stone-100">
        {t(failed ? 'backend.wakeFailedTitle' : 'backend.wakingTitle')}
      </p>
      <p className="text-xs leading-relaxed text-stone-300">
        {t(failed ? 'backend.wakeFailed' : 'backend.waking')}
      </p>
    </div>
  );
}
