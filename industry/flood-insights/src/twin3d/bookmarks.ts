/**
 * Saved viewpoints — a story the presenter writes themselves.
 *
 * The scripted tour in `tourSteps.ts` answers "what should everyone be shown". This answers a
 * different question: "what do *I* want to show tonight". So it is user-authored, stored on the
 * machine that will present it, and deliberately dumb — a list of stops, each one a camera
 * placement plus the moment on the clock it belongs to.
 *
 * Keeping the shape and the timing rules here rather than in the component means the story can be
 * tested without a browser or a GPU, same as the tour.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Everything needed to put the map back exactly as it was when the stop was captured. */
export interface Bookmark {
  id: string;
  label: string;
  /** Timeline position in minutes relative to the gauge peak. The whole point of "respect the time". */
  minutes: number;
  /** Camera placement, in world metres. */
  position: Vec3;
  target: Vec3;
  /**
   * Layer state. `exaggerated` is in here for a non-obvious reason: the vertical exaggeration
   * scales terrain geometry, so a camera position captured at true scale frames something else
   * entirely once the landform is stretched. Restoring the toggle keeps the saved coordinates
   * meaningful.
   */
  layers: {
    hazard: boolean;
    landuse: boolean;
    trees: boolean;
    exaggerated: boolean;
  };
}

export const STORAGE_KEY = 'flut-insights.story.v1';

/** How long the camera holds on a stop before moving on, so the moment can actually be read. */
export const HOLD_MS = 2400;

/**
 * How long to spend travelling between two stops.
 *
 * Slower than the 1.5 s village hop on purpose. That one is navigation and wants to feel prompt;
 * this is narration, and the flight between two stops is part of what is being shown — the valley
 * running continuously from one to the next. The floor keeps a short hop from snapping, the cap
 * keeps a valley-length hop from outstaying its welcome.
 */
export function flightMs(distanceM: number): number {
  const travel = 2600 + Math.max(0, distanceM) * 0.4;
  return Math.round(Math.min(travel, 7000));
}

function isVec3(value: unknown): value is Vec3 {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    Number.isFinite(v.x as number) &&
    Number.isFinite(v.y as number) &&
    Number.isFinite(v.z as number)
  );
}

/**
 * Rebuild one stop from whatever was on disk.
 *
 * Returns null rather than throwing: a story that lost a stop to a format change should still
 * play the stops it kept. A story that takes the whole panel down with it is worse than useless
 * five minutes before a demo.
 */
export function parseBookmark(value: unknown): Bookmark | null {
  if (!value || typeof value !== 'object') return null;
  const b = value as Record<string, unknown>;
  if (typeof b.id !== 'string' || typeof b.label !== 'string') return null;
  if (!Number.isFinite(b.minutes as number)) return null;
  if (!isVec3(b.position) || !isVec3(b.target)) return null;
  const layers = (b.layers ?? {}) as Record<string, unknown>;
  return {
    id: b.id,
    label: b.label,
    minutes: b.minutes as number,
    position: b.position,
    target: b.target,
    layers: {
      hazard: layers.hazard === true,
      landuse: layers.landuse !== false,
      trees: layers.trees !== false,
      exaggerated: layers.exaggerated === true,
    },
  };
}

export function loadStory(storage: Pick<Storage, 'getItem'>): Bookmark[] {
  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return []; // Private mode, blocked storage — no story is fine, a crash is not.
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseBookmark).filter((b): b is Bookmark => b !== null);
  } catch {
    return [];
  }
}

export function saveStory(storage: Pick<Storage, 'setItem'>, story: Bookmark[]): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(story));
  } catch {
    // Quota or blocked storage. The in-memory story still works for this session.
  }
}

export function distanceBetween(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
