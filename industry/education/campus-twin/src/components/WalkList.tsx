import { useI18n } from '@/i18n';
import type { TransferVerdict, Walk, WalkRoutes } from '@/planner/walkRoutes';

/**
 * The walks one person makes across their teaching week — the professor's own question.
 *
 * A planner reads a week grid to see whether a room is free. The person *in* that plan reads it to
 * find out whether they can physically get from one room to the next, and the grid alone cannot
 * answer that: two adjacent blocks look identical whether the rooms are next door or on the far
 * campus. This is the gap between them, measured on the real path network.
 *
 * ⚠️ The verdict is stated even when the answer is UNKNOWN. A building with no route (an outlying
 * site, a room that never resolved) must not quietly render as a comfortable transfer — the same
 * failure the site guard was fixed for.
 */

const TONE: Record<TransferVerdict, string> = {
  'same-building': 'border-stone-700 text-stone-400',
  comfortable: 'border-emerald-400/50 bg-emerald-500/10 text-emerald-200',
  tight: 'border-amber-400/60 bg-amber-500/10 text-amber-200',
  impossible: 'border-red-400/70 bg-red-500/15 text-red-200',
  unknown: 'border-stone-600 bg-stone-800/60 text-stone-300',
};

export function WalkList({
  walks,
  routes,
  openWalk,
  onToggle,
  busRide = null,
  crowd = null,
}: {
  walks: Walk[];
  routes: WalkRoutes | null;
  openWalk: string | null;
  onToggle: (walk: Walk) => void;
  /**
   * How the 3D replay of a bus transfer is compressed, when this AOI has a shuttle.
   *
   * ⚠️ PASSED IN AND RENDERED, NOT OPTIONAL IN SPIRIT. Clicking a transit row sends the bus across
   * the map in ten seconds, which is roughly thirty times its real speed. `src/twin3d/shuttle.ts`
   * records at length why a fast bus that does not say it is fast was removed once already for
   * being "a cartoon". The number beside the row is what makes the replay a replay rather than a
   * false claim about how quickly you can get across Regensburg.
   *
   * ⚠️ STATIC, NOT PER FRAME. It is `driveSeconds / shownSeconds` for the AOI's one road leg, so
   * it is computed once. Polling the scene each frame to animate a progress bar would put a 60 Hz
   * React update behind a panel that is often closed.
   */
  busRide?: { realSeconds: number; shownSeconds: number } | null;
  /**
   * How many people the open walking transfer puts on the map, or null when nobody has said.
   *
   * ⚠️ NULL IS A REAL AND FREQUENT ANSWER, NOT AN OVERSIGHT. `expectedAttendance` is the cohort
   * group's size, and OTH's actual Untis export states it for none of its 3 015 sessions, because
   * Untis publishes classes without their sizes. On that site the twin walks a single figure and
   * this badge is absent — which is the point. A badge that fell back to a plausible number would
   * be the one place in the walk lens that made something up.
   */
  crowd?: number | null;
}) {
  const { t } = useI18n();

  // Nothing to say is said by saying nothing: a week spent entirely in one building has no walks,
  // and an empty list with a heading over it would read as a failure to load.
  if (!walks.length) return null;

  const problems = walks.filter((w) => w.verdict === 'impossible' || w.verdict === 'tight').length;

  return (
    <section data-testid="walk-list" className="mt-4 border-t border-stone-700 pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[0.65rem] uppercase tracking-[0.16em] text-stone-400">
          {t('walk.heading')}
        </h3>
        <span data-testid="walk-summary" className="text-[0.65rem] text-stone-500">
          {problems > 0
            ? t('walk.problems', { n: problems, total: walks.length })
            : t('walk.allFine', { total: walks.length })}
        </span>
      </div>

      {!routes && (
        <p data-testid="walk-missing" className="mt-1.5 text-[0.65rem] leading-relaxed text-stone-500">
          {t('walk.noRoutes')}
        </p>
      )}

      <ul className="mt-2 space-y-1.5">
        {walks.map((walk) => {
          const id = `${walk.from.sessionId}->${walk.to.sessionId}`;
          const drawn = openWalk === id;
          return (
            <li key={id}>
              <button
                type="button"
                data-testid={`walk-${id}`}
                data-verdict={walk.verdict}
                aria-pressed={drawn}
                disabled={!walk.route}
                onClick={() => onToggle(walk)}
                className={`w-full rounded border px-2 py-1.5 text-left text-[0.68rem] leading-relaxed transition ${
                  TONE[walk.verdict]
                } ${drawn ? 'ring-1 ring-sky-300' : ''} ${
                  walk.route ? 'hover:brightness-110' : 'cursor-default opacity-80'
                }`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">
                    {walk.day} {walk.leaveAt}–{walk.arriveBy} · {walk.from.roomId} →{' '}
                    {walk.to.roomId}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {walk.route
                      ? t('walk.minutesOf', { walk: walk.travelMin, gap: walk.breakMin })
                      : t('walk.unknownShort')}
                  </span>
                </span>

                <span className="mt-0.5 block opacity-90">
                  {walk.verdict === 'impossible' &&
                    t('walk.impossible', { short: Math.abs(walk.spareMin) })}
                  {walk.verdict === 'tight' && t('walk.tight', { spare: walk.spareMin })}
                  {walk.verdict === 'comfortable' &&
                    t('walk.comfortable', {
                      spare: walk.spareMin,
                      metres: walk.route?.distanceM ?? 0,
                    })}
                  {walk.verdict === 'unknown' && t('walk.unknown')}
                  {/*
                    ⚠️ Between campuses the verdict is about the BUS, and saying so is the whole
                    point: the same gap judged by the 44-minute walk would read as impossible, when
                    the plan has assumed a bus from the start. The walk is still quoted, because it
                    is the reason the bus matters.
                  */}
                  {walk.mode === 'transit' && (
                    <span className="ml-1 font-medium">
                      {t('walk.byBus', { walk: walk.walkMin })}
                    </span>
                  )}
                  {/*
                    ⚠️ NUMERALS AND SYMBOLS ONLY, AND THAT IS DELIBERATE RATHER THAN LAZY.
                    "5,2 min → 10 s · 31×" needs no translation, so it carries no i18n key and
                    cannot drift between the two catalogues. It is also the honest minimum: the
                    replay this row starts is thirty times real speed, and a viewer who sees the
                    bus cross Regensburg in ten seconds has to be told that is a compression and
                    not a bus. Shown only on the row that is open, so the list is not a wall of
                    identical badges.
                  */}
                  {walk.mode === 'transit' && drawn && busRide && (
                    <span
                      data-testid="bus-ride-scale"
                      className="ml-1 rounded bg-sky-500/15 px-1 font-medium tabular-nums text-sky-200"
                      title={`${busRide.realSeconds} s → ${busRide.shownSeconds} s`}
                    >
                      {(busRide.realSeconds / 60).toFixed(1).replace('.', ',')} min →{' '}
                      {busRide.shownSeconds} s · {Math.round(busRide.realSeconds / busRide.shownSeconds)}×
                    </span>
                  )}
                  {walk.mode === 'walk' && walk.route && !walk.route.sameCampus && (
                    <span className="ml-1 font-medium">{t('walk.crossCampus')}</span>
                  )}
                  {/*
                    Who is actually on the path, on the same numerals-only rule as the bus badge
                    above: a figure glyph and a count need no translation and cannot drift between
                    the two catalogues.

                    ⚠️ THE NUMBER IS THE TIMETABLE'S, AND IT IS SHOWN BECAUSE THE PICTURE ASSERTS
                    IT. Two hundred figures crossing a courtyard is a claim about how many people
                    make that transfer; printing the count is what lets a planner check it against
                    the cohort they know rather than take the animation's word for it.
                  */}
                  {walk.mode === 'walk' && drawn && crowd !== null && crowd > 0 && (
                    <span
                      data-testid="walk-crowd-size"
                      className="ml-1 inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1 font-medium tabular-nums text-amber-200"
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 8 12"
                        className="h-3 w-2"
                        fill="currentColor"
                      >
                        <circle cx="4" cy="2" r="1.8" />
                        <path d="M1.2 5.2h5.6v4H5.4v2.6H2.6V9.2H1.2z" />
                      </svg>
                      {crowd}
                    </span>
                  )}
                </span>

                {/*
                  ⚠️ THE STAND-IN IS NAMED WHEREVER IT IS USED. OTH numbers the whole Prüfeninger
                  Straße complex `P …` and no outline carries that letter, so the journey is
                  measured between the two SITES. That is a real answer and a weaker one than the
                  rows above it, and a reader cannot tell the two apart unless the row says so.
                */}
                {walk.precision === 'campus' && (
                  <span
                    data-testid={`walk-campus-level-${id}`}
                    className="mt-0.5 block text-[0.62rem] leading-relaxed opacity-80"
                  >
                    {t('walk.campusLevel')}
                  </span>
                )}

                {walk.route && (
                  <span className="mt-0.5 block text-[0.6rem] uppercase tracking-wider opacity-70">
                    {drawn ? t('walk.hide') : t('walk.show')}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {/*
        The assumption, on screen rather than in a commit message. The path and its length are
        surveyed; the pace and the door are not, and a planner deciding whether fifteen minutes is
        enough deserves to know which part of the answer is measured.
      */}
      <p className="mt-2 text-[0.6rem] leading-relaxed text-stone-500">{t('walk.provenance')}</p>
    </section>
  );
}
