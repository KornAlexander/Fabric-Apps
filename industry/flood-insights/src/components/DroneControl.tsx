import { useEffect, useRef } from 'react';

import { useI18n } from '@/i18n';

/**
 * What the camera is doing, top right over the map.
 *
 * ⚠️ **This used to be a button and deliberately is not one any more.** Once W A S D took the
 * camera by itself and a second of stillness gave it back, the toggle was a second way to say
 * something the keys already said — and a worse one, because it could disagree with them: click it
 * mid-drag and the controls defer the flip to the end of the gesture, leaving a button claiming a
 * state the camera is not in. So this is a *readout* now, not a control.
 *
 * It still has to exist, for three reasons that are easy to lose:
 *
 * 1. **The contested inputs change meaning.** While flying, the wheel is a throttle rather than
 *    the map zoom and a drag looks rather than orbits. A mode nothing on screen mentions is a mode
 *    the viewer discovers by being confused.
 * 2. **The keys have to be discoverable.** Nothing else on the page says W A S D does anything, so
 *    the idle line is the whole of the affordance the button used to be.
 * 3. **The speed is shown.** A throttle with no readout leaves the viewer guessing why the camera
 *    suddenly feels wrong.
 *
 * ⚠️ The speed is written straight into the DOM from a requestAnimationFrame loop rather than
 * held in React state. The wheel can fire dozens of times a second and each event would otherwise
 * re-render this component — and its parent — while the scene is already busy rendering terrain.
 */
export function DroneControl({
  on,
  getCruiseMs,
  testIdPrefix,
}: {
  on: boolean;
  /** Current cruise speed, or null when the scene is not built yet. */
  getCruiseMs: () => number | null;
  /** `twin3d` for the valley, `steinbach` for the corridor — the ids the e2e specs use. */
  testIdPrefix: string;
}) {
  const { t } = useI18n();
  const speedRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!on) return;
    let frame = 0;
    let shown = -1;
    const poll = () => {
      frame = requestAnimationFrame(poll);
      const cruise = getCruiseMs();
      if (cruise === null) return;
      const rounded = Math.round(cruise);
      // Only touch the DOM when the number actually changes, which is on wheel events rather
      // than on every one of the sixty frames a second this runs at.
      if (rounded !== shown && speedRef.current) {
        shown = rounded;
        speedRef.current.textContent = String(rounded);
      }
    };
    poll();
    return () => cancelAnimationFrame(frame);
  }, [on, getCruiseMs]);

  return (
    <div
      data-testid={`${testIdPrefix}-drone-control`}
      // The state as an attribute rather than as `aria-pressed`, which belonged to the button and
      // would now be a lie: nothing here is pressable. This is what the e2e specs assert on.
      data-flying={on ? 'true' : 'false'}
      className="pointer-events-none rounded border border-stone-300 bg-stone-50/92 px-2 py-1 text-xs shadow-sm backdrop-blur"
      role="status"
      aria-live="off"
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={
            on
              ? 'rounded bg-stone-700 px-2 py-1 text-[0.7rem] text-stone-50'
              : 'rounded px-2 py-1 text-[0.7rem] text-stone-600'
          }
        >
          {t('twin.freeFly')}
        </span>

        {on && (
          <span className="text-[0.7rem] tabular-nums text-stone-600">
            {t('twin.freeFlySpeedLabel')}{' '}
            <span
              ref={speedRef}
              data-testid={`${testIdPrefix}-freefly-speed`}
              className="font-medium text-stone-900"
            >
              —
            </span>{' '}
            m/s
          </span>
        )}

        {/*
          ⚠️ The keys are the only control now, so this line is the only thing that says they exist.

          It shares the row with the speed readout rather than sitting under it, and that is not a
          layout preference. This card is the top of the right-hand rail; one extra line here pushes
          `validation-panel` down by about twenty pixels, far enough to collide with the hazard
          legend in the bottom strip — which `twin3d.spec.ts` asserts against, and which it caught
          the first time this was a block of its own.
        */}
        {!on && (
          <span
            data-testid={`${testIdPrefix}-freefly-hint`}
            className="whitespace-nowrap text-[0.7rem] text-stone-500"
          >
            {t('twin.freeFlyIdleHint')}
          </span>
        )}
      </div>

      {on && (
        <p
          data-testid={`${testIdPrefix}-freefly-help`}
          className="mt-1 max-w-[16rem] text-[0.7rem] leading-snug text-stone-500"
        >
          {t('twin.freeFlyHelp')}
        </p>
      )}
    </div>
  );
}
