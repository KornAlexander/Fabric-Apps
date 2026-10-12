/** Where a floating window sits, and the rule that keeps it reachable. Pure, so it can be tested. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A box read back from storage, or `null` when what is there is not one.
 *
 * ⚠️ STORED VALUES ARE INPUT, NOT STATE. They were written by an earlier version of this app, on
 * another screen, or by somebody with the developer tools open. Anything that is not four finite
 * numbers is ignored, and what passes is still clamped to the viewport by the caller: a window
 * remembered from a large monitor must not open off the edge of a laptop.
 */
export function parseStoredBox(raw: string | null | undefined): Box | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof Box, unknown>> | null;
    if (!value || typeof value !== 'object') return null;
    const box = { x: value.x, y: value.y, width: value.width, height: value.height };
    return Object.values(box).every((n) => typeof n === 'number' && Number.isFinite(n)) ? (box as Box) : null;
  } catch {
    return null;
  }
}

export const WINDOW_MARGIN = 8;
const MIN = { width: 320, height: 240 };

/**
 * Keep the box on screen: a window dragged past the edge, or left behind when the browser is made
 * smaller, must stay reachable: its title bar is the only way to move it back.
 */
export function clampBox(box: Box, view: { width: number; height: number }): Box {
  // The viewport wins over the minimum: on a 320 px screen a 320 px minimum plus two margins
  // would hang the window 8 px off the edge.
  const room = { width: view.width - 2 * WINDOW_MARGIN, height: view.height - 2 * WINDOW_MARGIN };
  const width = Math.min(room.width, Math.max(MIN.width, box.width));
  const height = Math.min(room.height, Math.max(MIN.height, box.height));
  const x = Math.max(WINDOW_MARGIN, Math.min(box.x, view.width - width - WINDOW_MARGIN));
  const y = Math.max(WINDOW_MARGIN, Math.min(box.y, view.height - height - WINDOW_MARGIN));
  return { x, y, width, height };
}
