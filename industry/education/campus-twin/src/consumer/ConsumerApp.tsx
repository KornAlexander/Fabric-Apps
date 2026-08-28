/**
 * The whole consumer app: who you are, your week, and a chat about it.
 *
 * ⚠️ THERE IS NO NAVIGATION, AND THAT IS THE DESIGN. The planner shell carries a nav rail, three
 * main views, five lenses, a lower pane with three tabs and a 3D twin. A lecturer opening this on
 * a phone between two lectures wants one answer. Every control that is not on this screen is a
 * control somebody would otherwise have to decide to ignore.
 */

import { useEffect, useState } from 'react';

import { ApiError, getMe, getMyWeek, NotSignedIn, type Me, type Week } from './api';
import { ConsumerChat } from './ConsumerChat';
import { WeekGrid } from './WeekGrid';

type Load<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'failed'; why: string };

export function ConsumerApp(): React.ReactElement {
  const [me, setMe] = useState<Load<Me>>({ state: 'loading' });
  const [week, setWeek] = useState<Load<Week>>({ state: 'loading' });
  const [showChat, setShowChat] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const identity = await getMe();
        if (!live) return;
        setMe({ state: 'ready', value: identity });
        try {
          const w = await getMyWeek(identity.site);
          if (live) setWeek({ state: 'ready', value: w });
        } catch (err) {
          if (live) setWeek({ state: 'failed', why: describe(err) });
        }
      } catch (err) {
        if (live) {
          setMe({ state: 'failed', why: describe(err) });
          setWeek({ state: 'failed', why: describe(err) });
        }
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="mx-auto flex h-dvh max-w-3xl flex-col">
      <header className="flex items-baseline justify-between gap-3 border-b border-black/10 p-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">Mein Stundenplan</h1>
          {me.state === 'ready' && (
            <p className="truncate text-xs opacity-70">
              {me.value.displayName} · {me.value.siteLabel}
            </p>
          )}
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md border border-black/15 px-3 py-1.5 text-sm"
          onClick={() => setShowChat((v) => !v)}
          aria-pressed={showChat}
        >
          {showChat ? 'Plan' : 'Fragen'}
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {me.state === 'failed' && <Problem why={me.why} />}

        {me.state === 'loading' && <p className="p-4 text-sm opacity-70">Wird geladen …</p>}

        {me.state === 'ready' && !showChat && (
          <>
            {week.state === 'loading' && <p className="p-4 text-sm opacity-70">Wird geladen …</p>}
            {week.state === 'failed' && <Problem why={week.why} />}
            {week.state === 'ready' && <WeekGrid week={week.value} />}
          </>
        )}

        {me.state === 'ready' && showChat && <ConsumerChat site={me.value.site} />}
      </main>

      {/*
        ⚠️ THE SCOPE IS STATED ON SCREEN, not only enforced in the server. A person looking at a
        timetable cannot tell from the pixels whether it is filtered, and "why can I not see my
        colleague" is a support call unless the answer is already visible.
      */}
      <footer className="border-t border-black/10 p-2 text-center text-xs opacity-60">
        Diese Ansicht zeigt ausschließlich den eigenen Stundenplan.
      </footer>
    </div>
  );
}

function Problem({ why }: { why: string }): React.ReactElement {
  return (
    <div className="p-4">
      <p className="text-sm">{why}</p>
    </div>
  );
}

function describe(err: unknown): string {
  if (err instanceof NotSignedIn) return err.message;
  if (err instanceof ApiError) {
    // The two refusals a real person will actually hit, phrased as situations rather than codes.
    if (err.code === 'no_own_timetable' || err.status === 403) return err.message;
    if (err.code === 'own_timetable_not_found') return err.message;
    return err.message;
  }
  return 'Die Verbindung zum Stundenplan ist fehlgeschlagen.';
}
