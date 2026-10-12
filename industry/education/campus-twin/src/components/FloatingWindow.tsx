import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { WINDOW_MARGIN, clampBox, parseStoredBox, type Box } from '@/components/floatingBox';

/**
 * A small window over the scene: dragged by its title bar, resized from its corner, maximised,
 * closed. The campus stays visible and usable behind it.
 *
 * ⚠️ `fixed`, NOT `absolute`, for the reason `NationalMap` records: whatever opens this lives
 * inside some `relative` wrapper, and `absolute` would be positioned and clipped by that wrapper
 * instead of the viewport.
 *
 * ⚠️ THE CONTENT STOPS TAKING POINTER EVENTS WHILE THE WINDOW MOVES. The content is usually an
 * iframe, and an iframe swallows every pointer event that crosses it: without the shield the drag
 * stops dead the moment the cursor outruns the title bar and enters the frame, and the window is
 * left stuck to nothing.
 */
export interface FloatingWindowProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Labels for the two buttons; passed in so this component carries no strings of its own. */
  closeLabel: string;
  maximiseLabel: string;
  restoreLabel: string;
  initial?: { width: number; height: number };
  testId?: string;
  /**
   * Remember where the window was left, under this key, in this browser. Size and place are a
   * viewer's convenience and nothing else, which is what local storage is for.
   */
  storageKey?: string;
}

/** Storage can be refused outright (a sandboxed iframe, a private window): then nothing is kept. */
function readStored(key: string | undefined): Box | null {
  if (!key) return null;
  try {
    return parseStoredBox(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

const MARGIN = WINDOW_MARGIN;

const viewport = () => ({
  width: typeof window === 'undefined' ? 1280 : window.innerWidth,
  height: typeof window === 'undefined' ? 720 : window.innerHeight,
});

export function FloatingWindow({
  title,
  onClose,
  children,
  closeLabel,
  maximiseLabel,
  restoreLabel,
  initial = { width: 720, height: 480 },
  testId = 'floating-window',
  storageKey,
}: FloatingWindowProps) {
  const [box, setBox] = useState<Box>(() => {
    const view = viewport();
    // Where it was left last time, else towards the upper left of the scene, clear of the panels
    // on the right-hand side and BELOW the row of controls along the scene's top edge: seen live,
    // a window opened at y 72 sat on top of the very button that opens and closes it. Either way
    // it is clamped: the screen may be smaller than it was.
    return clampBox(readStored(storageKey) ?? { x: 96, y: 136, width: initial.width, height: initial.height }, view);
  });
  const [maximised, setMaximised] = useState(false);
  const [moving, setMoving] = useState(false);
  /** Has this viewer dragged or resized the window in this visit? See the save effect below. */
  const touched = useRef(false);
  const gesture = useRef<{ kind: 'move' | 'resize'; startX: number; startY: number; box: Box } | null>(
    null
  );

  const begin = useCallback(
    (kind: 'move' | 'resize') => (event: React.PointerEvent<HTMLElement>) => {
      if (maximised || event.button !== 0) return;
      // A press on a title-bar button is a click on that button, not the start of a drag.
      if ((event.target as HTMLElement).closest('button')) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { kind, startX: event.clientX, startY: event.clientY, box };
      touched.current = true;
      setMoving(true);
    },
    [box, maximised]
  );

  const track = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    const next =
      g.kind === 'move'
        ? { ...g.box, x: g.box.x + dx, y: g.box.y + dy }
        : { ...g.box, width: g.box.width + dx, height: g.box.height + dy };
    setBox(clampBox(next, viewport()));
  }, []);

  const end = useCallback(() => {
    gesture.current = null;
    setMoving(false);
  }, []);

  // Kept once a drag or resize has ended, not on every pointer move: sixty writes a second to
  // storage for a value only the next visit reads.
  //
  // ⚠️ AND ONLY WHAT THE VIEWER DID, NOT WHAT THE SCREEN FORCED. Opening the window on a small
  // laptop clamps the remembered box to fit. Writing that back would quietly replace the place
  // chosen on the large monitor with a cramped one, and the monitor would get it tomorrow. So
  // nothing is written until this viewer has moved or resized the window themselves.
  useEffect(() => {
    if (!storageKey || moving || !touched.current) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(box));
    } catch {
      /* storage refused: the window simply opens in its default place next time */
    }
  }, [storageKey, moving, box]);

  // A window placed for a large screen must still be on screen after the browser is made smaller.
  useEffect(() => {
    const onResize = () => setBox((prev) => clampBox(prev, viewport()));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /*
    ⚠️ ESCAPE CLOSES THIS WINDOW ONLY WHEN THE FOCUS IS IN IT. A listener on `window` that closes
    on every Escape also fires when Escape was meant for a dialog above this one (the sources
    dialog, the guide), so one key press closed two things; and it fired while someone was typing
    in a field elsewhere in the app. Focus inside a cross-origin iframe never reaches this handler
    at all, which is why the title bar keeps a close button rather than relying on the key.
  */
  const root = useRef<HTMLDivElement | null>(null);
  // Focus moves INTO the window when it opens and back where it came from when it closes. Without
  // the first half, someone who opened it from the keyboard is left outside a window whose Escape
  // only works from inside; without the second, closing it drops them at the top of the page.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (root.current?.contains(document.activeElement)) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const style = maximised
    ? { left: MARGIN, top: MARGIN, right: MARGIN, bottom: MARGIN }
    : { left: box.x, top: box.y, width: box.width, height: box.height };

  return (
    <div
      ref={root}
      role="dialog"
      aria-label={title}
      data-testid={testId}
      // Focusable, so a click on the title bar puts the focus in the window and Escape applies.
      tabIndex={-1}
      style={style}
      // z-35: above everything laid over the scene (z-20, z-30), below the site menu and the
      // full-screen panels and dialogs (z-40, z-50). A window that floats over a menu hides it.
      className="fixed z-[35] flex flex-col overflow-hidden rounded border border-stone-600 bg-stone-900 shadow-2xl outline-none"
    >
      <div
        data-testid={`${testId}-titlebar`}
        onPointerDown={begin('move')}
        onPointerMove={track}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onDoubleClick={() => setMaximised((was) => !was)}
        className={`flex shrink-0 touch-none select-none items-center gap-2 border-b border-stone-700 bg-stone-800 px-3 py-1.5 ${
          maximised ? '' : 'cursor-move'
        }`}
      >
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-stone-100">{title}</span>
        <button
          type="button"
          data-testid={`${testId}-maximise`}
          aria-label={maximised ? restoreLabel : maximiseLabel}
          title={maximised ? restoreLabel : maximiseLabel}
          onClick={() => setMaximised((was) => !was)}
          className="rounded px-1.5 text-sm leading-none text-stone-300 hover:bg-stone-700 hover:text-stone-50"
        >
          {maximised ? '❐' : '□'}
        </button>
        <button
          type="button"
          data-testid={`${testId}-close`}
          aria-label={closeLabel}
          title={closeLabel}
          onClick={onClose}
          className="rounded px-1.5 text-sm leading-none text-stone-300 hover:bg-stone-700 hover:text-stone-50"
        >
          ✕
        </button>
      </div>

      <div className={`relative min-h-0 flex-1 ${moving ? 'pointer-events-none' : ''}`}>{children}</div>

      {!maximised && (
        <div
          data-testid={`${testId}-resize`}
          aria-hidden="true"
          onPointerDown={begin('resize')}
          onPointerMove={track}
          onPointerUp={end}
          onPointerCancel={end}
          onLostPointerCapture={end}
          className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize touch-none border-b-2 border-r-2 border-stone-500"
        />
      )}
    </div>
  );
}
