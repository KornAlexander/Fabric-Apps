import { useEffect, useRef } from 'react';

import { useI18n } from '@/i18n';
import { roseRotationDeg } from '@/twin3d/compass';
import type { Twin3DHandle } from '@/twin3d/scene';

/**
 * A compass, and a way to put the map back the right way up.
 *
 * The valley runs roughly east–west and the camera orbits freely, so it is easy to end up looking
 * upstream from the north bank with the Rhine on the left and no idea of it. The rose says which
 * way the view is pointing; clicking it turns the camera back to north without moving where it is
 * looking or how far away it is.
 *
 * ⚠️ The rotation is written straight to a DOM ref inside the render loop, not held in React
 * state. The place labels already learned this: at 60 fps a state update re-renders the whole
 * twin sixty times a second for a value that only a `transform` cares about.
 */

interface Props {
  handleRef: React.RefObject<Twin3DHandle | null>;
}

export function Compass({ handleRef }: Props) {
  const { t } = useI18n();
  const roseRef = useRef<HTMLSpanElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let raf = 0;
    let lastDeg = Number.NaN;

    const tick = () => {
      const handle = handleRef.current;
      const rose = roseRef.current;
      if (handle && rose) {
        const deg = roseRotationDeg(handle.getHeadingRad());
        // Only touch the DOM when it would actually change, and round to a tenth: the damping on
        // the controls leaves the azimuth drifting by fractions of a degree long after the drag
        // has stopped, which would otherwise mean a style write on every single frame forever.
        if (!Number.isFinite(lastDeg) || Math.abs(deg - lastDeg) > 0.1) {
          rose.style.transform = `rotate(${deg.toFixed(1)}deg)`;
          buttonRef.current?.setAttribute('data-heading', deg.toFixed(0));
          lastDeg = deg;
        }
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [handleRef]);

  return (
    <button
      ref={buttonRef}
      type="button"
      data-testid="twin3d-compass"
      title={t('twin.faceNorth')}
      aria-label={t('twin.faceNorth')}
      onClick={() => handleRef.current?.faceNorth()}
      className="pointer-events-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-stone-300 bg-stone-50/92 text-stone-600 shadow-sm backdrop-blur hover:bg-stone-200 hover:text-stone-900"
    >
      <span
        ref={roseRef}
        aria-hidden="true"
        className="relative block h-8 w-8"
        style={{ transform: 'rotate(0deg)' }}
      >
        {/* North half — the only dark part, so the direction reads at a glance. */}
        <span className="absolute left-1/2 top-1.5 h-[calc(50%-0.375rem)] w-0 -translate-x-1/2 border-x-[5px] border-b-[13px] border-x-transparent border-b-stone-700" />
        {/* South half, muted, so the needle looks like a needle rather than a triangle. */}
        <span className="absolute bottom-1.5 left-1/2 h-[calc(50%-0.375rem)] w-0 -translate-x-1/2 border-x-[5px] border-t-[13px] border-x-transparent border-t-stone-300" />
        <span className="absolute left-1/2 top-[-3px] -translate-x-1/2 text-[0.55rem] font-semibold leading-none text-stone-700">
          {t('twin.north')}
        </span>
      </span>
    </button>
  );
}
