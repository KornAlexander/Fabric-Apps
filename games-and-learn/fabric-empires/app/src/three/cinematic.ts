import { Vector3 } from 'three';

/**
 * Cinematics: the camera as a storyteller.
 *
 * ⚠️ **These are rendered live, not played back.** "A video before the first
 * fight" could have meant shipping video files, and this repository has
 * deliberately shipped no assets at all: the terrain material, the water and
 * every surface detail are generated at runtime (D59). A pre-rendered clip
 * would also be wrong on its own terms, because it would show a battlefield
 * that is not the player's. Everything below moves the real camera through the
 * real, seed-generated world, so the establishing shot of a city is a shot of
 * *that* city, on *that* hill, at the hour the game is currently lit for.
 *
 * A shot is a pure function of normalised time, which keeps it testable
 * without a renderer and means a skip is just a jump to t = 1.
 */

export interface CinematicFrame {
  readonly position: Vector3;
  readonly target: Vector3;
}

export interface CinematicShot {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly durationMs: number;
  /** Where the camera is at normalised time t, 0 to 1. */
  frame(t: number): CinematicFrame;
}

/**
 * Ease in and out.
 *
 * A camera that starts and stops abruptly reads as a bug rather than a shot.
 * Every move here is eased, which is the single largest difference between
 * "the camera moved" and "that was a cut".
 */
function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

/**
 * A slow arc around a point, rising as it goes.
 *
 * The establishing shot: used when something has appeared in the world and the
 * player should see where it sits in the landscape rather than just that it
 * exists.
 */
export function orbitShot(options: {
  id: string;
  title: string;
  subtitle: string;
  centre: Vector3;
  radius: number;
  fromHeight: number;
  toHeight: number;
  sweepRad: number;
  startAngleRad?: number;
  durationMs?: number;
}): CinematicShot {
  const {
    id,
    title,
    subtitle,
    centre,
    radius,
    fromHeight,
    toHeight,
    sweepRad,
    startAngleRad = 0,
    durationMs = 4200,
  } = options;

  return {
    id,
    title,
    subtitle,
    durationMs,
    frame(t) {
      const e = ease(clamp01(t));
      const angle = startAngleRad + sweepRad * e;
      const height = fromHeight + (toHeight - fromHeight) * e;
      return {
        position: new Vector3(
          centre.x + Math.cos(angle) * radius,
          centre.y + height,
          centre.z + Math.sin(angle) * radius,
        ),
        target: centre.clone(),
      };
    },
  };
}

/**
 * A low approach that closes on the subject.
 *
 * Used for the fight: coming in fast and low over the ground sells the
 * distance between two units far better than looking down at them from the
 * map camera, which is the view the player already has.
 */
export function approachShot(options: {
  id: string;
  title: string;
  subtitle: string;
  /** What the camera looks at throughout. */
  focus: Vector3;
  /** Direction the camera comes in from, normalised on the ground plane. */
  from: Vector3;
  startDistance: number;
  endDistance: number;
  startHeight: number;
  endHeight: number;
  durationMs?: number;
}): CinematicShot {
  const {
    id,
    title,
    subtitle,
    focus,
    from,
    startDistance,
    endDistance,
    startHeight,
    endHeight,
    durationMs = 3800,
  } = options;

  const direction = new Vector3(from.x, 0, from.z);
  if (direction.lengthSq() < 1e-6) direction.set(1, 0, 0);
  direction.normalize();

  return {
    id,
    title,
    subtitle,
    durationMs,
    frame(t) {
      const e = ease(clamp01(t));
      const distance = startDistance + (endDistance - startDistance) * e;
      const height = startHeight + (endHeight - startHeight) * e;
      return {
        position: new Vector3(
          focus.x + direction.x * distance,
          focus.y + height,
          focus.z + direction.z * distance,
        ),
        target: focus.clone(),
      };
    },
  };
}

/**
 * A fall from high above onto the subject.
 *
 * Reserved for the moments that are meant to feel like consequences rather
 * than events: a city changing hands, and the Proctor arriving.
 */
export function descendShot(options: {
  id: string;
  title: string;
  subtitle: string;
  centre: Vector3;
  startHeight: number;
  endHeight: number;
  radius: number;
  sweepRad?: number;
  durationMs?: number;
}): CinematicShot {
  const {
    id,
    title,
    subtitle,
    centre,
    startHeight,
    endHeight,
    radius,
    sweepRad = 0.5,
    durationMs = 4000,
  } = options;

  return {
    id,
    title,
    subtitle,
    durationMs,
    frame(t) {
      const e = ease(clamp01(t));
      // The radius closes as the camera drops, so the subject grows in frame
      // rather than merely getting closer to the lens.
      const r = radius * (1 - 0.55 * e);
      const angle = sweepRad * e;
      return {
        position: new Vector3(
          centre.x + Math.cos(angle) * r,
          centre.y + startHeight + (endHeight - startHeight) * e,
          centre.z + Math.sin(angle) * r,
        ),
        target: centre.clone(),
      };
    },
  };
}
