import { useEffect, useRef } from 'react';

import type { ProjectedPlace, Twin3DHandle } from '@/twin3d/scene';

/**
 * Place names drawn over the map, the way any map draws them.
 *
 * Two things decide whether a name is shown, and both are about not lying to the eye:
 *
 *   - **Distance.** A name belongs to a place you can actually see the shape of. Zoomed out over
 *     the whole reach, thirteen names would be a list of words lying across a valley, none of them
 *     attached to anything legible. They fade in as the village becomes a village rather than a
 *     smudge.
 *   - **Crowding.** Two names a few pixels apart read as one unplaceable label. The nearer village
 *     wins and the further one drops out, which is what a cartographer would do.
 *
 * The positions are written straight to the DOM inside an animation frame. Routing them through
 * React state would re-render the whole twin sixty times a second to move thirteen spans.
 */

/** Fully drawn at this range or nearer — roughly the distance the camera frames a village from. */
const NEAR_M = 3800;
/** Gone by this range. Between the two the name fades, so it arrives rather than blinks on. */
const FAR_M = 7000;
/** Names closer together than this on screen collide; the further village gives way. */
const MIN_SEPARATION_PX = 90;
/** Fainter than this and the name is no longer a word, so it is not drawn at all. */
const MIN_LEGIBLE_OPACITY = 0.25;

export function PlaceLabels({ getHandle }: { getHandle: () => Twin3DHandle | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef(new Map<string, HTMLSpanElement>());

  useEffect(() => {
    let frame = 0;

    const paint = () => {
      frame = requestAnimationFrame(paint);
      const handle = getHandle();
      const container = containerRef.current;
      if (!handle || !container) return;

      const projected = handle.projectPlaces();

      // Nearest first, so that when two names collide the one whose village is more legible is
      // the one that survives.
      const ordered = [...projected].sort((a, b) => a.distanceM - b.distanceM);
      const placed: ProjectedPlace[] = [];

      for (const place of ordered) {
        const node = nodesRef.current.get(place.id);
        if (!node) continue;

        let opacity = 0;
        if (place.onScreen && place.distanceM < FAR_M) {
          opacity =
            place.distanceM <= NEAR_M
              ? 1
              : 1 - (place.distanceM - NEAR_M) / (FAR_M - NEAR_M);

          // Below this a name is a grey smudge that reads as dirt on the screen rather than as a
          // word. Better absent than almost legible.
          if (opacity < MIN_LEGIBLE_OPACITY) opacity = 0;

          const collides = placed.some(
            (other) => Math.hypot(other.x - place.x, other.y - place.y) < MIN_SEPARATION_PX
          );
          if (collides) opacity = 0;
        }

        if (opacity > 0) placed.push(place);

        // `visibility` as well as opacity: a fully transparent label still answers hit tests in
        // some browsers, and these must never sit between the pointer and the map.
        node.style.opacity = opacity.toFixed(2);
        node.style.visibility = opacity > 0 ? 'visible' : 'hidden';
        if (opacity > 0) {
          node.style.transform = `translate(-50%, -100%) translate(${place.x.toFixed(1)}px, ${(
            place.y - 10
          ).toFixed(1)}px)`;
        }
      }
    };

    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [getHandle]);

  const places = getHandle()?.assets.terrain.focusPlaces ?? [];

  return (
    <div
      ref={containerRef}
      data-testid="twin3d-labels"
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      {places.map((place) => (
        <span
          key={place.id}
          data-testid={`twin3d-label-${place.id}`}
          ref={(node) => {
            if (node) nodesRef.current.set(place.id, node);
            else nodesRef.current.delete(place.id);
          }}
          // White, with a dark halo rather than a box. The terrain runs from pale limestone to
          // near-black flood water, and a name has to stay readable over both without putting a
          // panel on top of the map.
          className="absolute left-0 top-0 whitespace-nowrap text-[0.8rem] font-semibold uppercase tracking-[0.12em] text-white"
          style={{
            visibility: 'hidden',
            textShadow:
              '0 1px 2px rgba(28,25,23,0.95), 0 0 6px rgba(28,25,23,0.85), 0 0 14px rgba(28,25,23,0.6)',
          }}
        >
          {place.name}
        </span>
      ))}
    </div>
  );
}
