import { useI18n } from '@/i18n';
import type { Bookmark } from '@/twin3d/bookmarks';

interface Props {
  story: Bookmark[];
  /** Index currently being played, or -1 when the story is not running. */
  playingIndex: number;
  open: boolean;
  onToggleOpen: () => void;
  onCapture: () => void;
  onJump: (index: number) => void;
  onRemove: (id: string) => void;
  onPlay: () => void;
  onStop: () => void;
  /** Renders the stop's timeline position as a clock, so the saved moment is visible. */
  formatMinutes: (minutes: number) => string;
}

/**
 * The presenter's own story: a list of saved stops, and a play button that flies between them.
 *
 * Presentational on purpose — `Twin3DView` owns the map state, so it owns capture and playback.
 * This renders the list and reports intent, exactly as the village rail does.
 */
export function BookmarkStory({
  story,
  playingIndex,
  open,
  onToggleOpen,
  onCapture,
  onJump,
  onRemove,
  onPlay,
  onStop,
  formatMinutes,
}: Props) {
  const { t } = useI18n();
  const running = playingIndex >= 0;

  return (
    <div
      data-testid="twin3d-bookmarks"
      className="pointer-events-auto flex shrink-0 flex-col rounded border border-stone-300 bg-stone-50/92 p-3 text-xs shadow-sm backdrop-blur"
    >
      <button
        type="button"
        data-testid="twin3d-bookmarks-toggle"
        aria-expanded={open}
        aria-label={open ? t('bookmarks.collapse') : t('bookmarks.expand')}
        onClick={onToggleOpen}
        className="flex w-full items-baseline justify-between gap-3 text-left"
      >
        <span className="font-semibold text-stone-800">{t('bookmarks.title')}</span>
        <span className="text-stone-500">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              data-testid="twin3d-bookmarks-capture"
              onClick={onCapture}
              disabled={running}
              className="flex-1 rounded border border-stone-300 bg-white px-2 py-1 text-stone-700 hover:bg-stone-200 hover:text-stone-900 disabled:opacity-40"
            >
              {t('bookmarks.capture')}
            </button>
            <button
              type="button"
              data-testid="twin3d-bookmarks-play"
              onClick={running ? onStop : onPlay}
              disabled={story.length < 1}
              className="flex-1 rounded border border-stone-300 bg-white px-2 py-1 text-stone-700 hover:bg-stone-200 hover:text-stone-900 disabled:opacity-40"
            >
              {running ? t('bookmarks.stop') : t('bookmarks.play')}
            </button>
          </div>

          {story.length === 0 ? (
            <p className="mt-2 leading-relaxed text-stone-500">{t('bookmarks.empty')}</p>
          ) : (
            /*
              Capped rather than flexible. The village rail underneath is twenty rows long and wins
              every fight for space in a shared column, which left this list showing a single stop
              and a scrollbar. A fixed ceiling keeps a handful of stops visible and hands the rest
              of the column back to the rail.
            */
            <div className="mt-2 max-h-44 overflow-y-auto">
              <ol className="space-y-1">
                {story.map((stop, index) => {
                  const isPlaying = index === playingIndex;
                  return (
                    <li
                      key={stop.id}
                      className={
                        isPlaying
                          ? 'flex overflow-hidden rounded border border-stone-400'
                          : 'flex overflow-hidden rounded border border-stone-200'
                      }
                    >
                      <button
                        type="button"
                        data-testid={`twin3d-bookmarks-stop-${index}`}
                        aria-current={isPlaying}
                        onClick={() => onJump(index)}
                        className={
                          isPlaying
                            ? 'flex-1 bg-stone-200 px-2.5 py-1 text-left text-stone-800'
                            : 'flex-1 px-2.5 py-1 text-left text-stone-600 hover:bg-stone-100 hover:text-stone-900'
                        }
                      >
                        <span className="tabular-nums text-stone-500">{index + 1}.</span>{' '}
                        {stop.label}
                      </button>

                      {/* The saved moment, shown for the same reason the village rail shows a peak
                          time: a stop that does not say when it is cannot be trusted to restore it. */}
                      <span className="shrink-0 border-l border-stone-200 bg-stone-50 px-2 py-1 text-[0.65rem] tabular-nums text-stone-500">
                        {formatMinutes(stop.minutes)}
                      </span>
                      <button
                        type="button"
                        data-testid={`twin3d-bookmarks-remove-${index}`}
                        aria-label={`${t('bookmarks.remove')} ${stop.label}`}
                        onClick={() => onRemove(stop.id)}
                        disabled={running}
                        className="shrink-0 border-l border-stone-200 bg-stone-50 px-2 py-1 text-stone-400 hover:bg-stone-200 hover:text-stone-900 disabled:opacity-40"
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-2 leading-relaxed text-stone-500">{t('bookmarks.note')}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
