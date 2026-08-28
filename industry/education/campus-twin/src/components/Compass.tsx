import { useEffect, useRef } from 'react';

import { useI18n } from '@/i18n';
import { roseRotationDeg } from '@/twin3d/compass';
import type { Campus3DHandle } from '@/twin3d/scene';

/**
 * A compass, and a way to put the map back the right way up.
 *
 * The camera orbits freely and the drone can fly any bearing, so it is easy to end up looking at
 * the campus from the north with every building on the wrong side and no indication of it. Two
 * campuses make it worse: "the other site is over there" is only useful if you know which way
 * you are facing. The rose says where north is; clicking it turns the view back without moving
 * where the camera stands, how far away it is, or how steeply it looks down.
 *
 * ⚠️ The rotation is written straight to a DOM ref inside the render loop, not held in React
 * state. The place labels and the drone HUD both learned this already: at 60 fps a state update
 * re-renders the whole shell sixty times a second for a value only a `transform` cares about.
 */
export function Compass({ handle }: { handle: Campus3DHandle }) {
  const { t } = useI18n();
  const roseRef = useRef<SVGSVGElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let frame = 0;
    let lastDeg = Number.NaN;

    const tick = () => {
      const rose = roseRef.current;
      if (rose) {
        const deg = roseRotationDeg(handle.headingRad());
        // Only touch the DOM when it would actually change, and round to a tenth: the damping on
        // the orbit controls leaves the azimuth drifting by fractions of a degree long after the
        // drag has stopped, which would otherwise mean a style write on every frame forever.
        if (!Number.isFinite(lastDeg) || Math.abs(deg - lastDeg) > 0.1) {
          rose.style.transform = `rotate(${deg.toFixed(1)}deg)`;
          // The heading as a number, for tests and for anyone reading the DOM. Written as the
          // reading a compass gives — clockwise from north — not as the rose's counter-rotation.
          buttonRef.current?.setAttribute(
            'data-heading',
            Math.round((-deg + 360) % 360)
              .toString()
              .padStart(3, '0')
          );
          lastDeg = deg;
        }
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [handle]);

  return (
    <button
      ref={buttonRef}
      type="button"
      data-testid="twin3d-compass"
      title={t('twin.faceNorth')}
      aria-label={t('twin.faceNorth')}
      onClick={() => handle.faceNorth()}
      className="absolute left-4 top-4 flex h-12 w-12 items-center justify-center rounded-full border border-stone-600/70 bg-stone-900/80 backdrop-blur hover:bg-stone-800"
    >
      {/*
        ⚠️ Drawn as an SVG rather than as bordered spans, which is what this was first. CSS
        triangles are made of borders, so the two halves of the needle overlap around the middle
        and the letter has to be positioned against a shape the browser derives rather than one
        you specified — at 44 px the first version put the N on top of its own arrowhead and the
        needle read as a lump. Coordinates are the whole point of a compass, so state them.

        Everything rotates together, letter included: a fixed N over a turning needle would be
        pointing at whatever the screen happened to be showing, which is the one thing a compass
        must never do.
      */}
      <svg
        ref={roseRef}
        viewBox="0 0 34 34"
        aria-hidden="true"
        className="h-[34px] w-[34px]"
        style={{ transform: 'rotate(0deg)' }}
      >
        <text
          x="17"
          y="7.6"
          textAnchor="middle"
          className="fill-stone-200 text-[8px] font-bold"
        >
          {t('twin.north')}
        </text>
        {/* North — the only coloured part, so which end is which reads without reading. */}
        <polygon points="17,9.5 21.5,17 12.5,17" className="fill-amber-400" />
        {/* South, muted. The two meet exactly on the centre line, so the needle is a needle. */}
        <polygon points="17,24.5 21.5,17 12.5,17" className="fill-stone-400" />
      </svg>
    </button>
  );
}
