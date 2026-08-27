import { useI18n } from '@/i18n';
import { SourcedFigure } from '@/components/SourcedFigure';
import { PEAK_BEAT_SOURCES, type StoryBeat } from '@/twin3d/storyBeats';

interface Props {
  beats: StoryBeat[];
  active: StoryBeat | null;
  tMin: number;
  tMax: number;
  onJump: (tMinutes: number) => void;
}

/**
 * Annotations along the timeline (PLAN §3 Act II).
 *
 * Split into two pieces so the marker rail can sit inside the same column as the scrubber. Sharing
 * a container is what makes a marker land on the moment it refers to: rendered across the whole
 * panel it would be offset by the width of the play button, skewing every position.
 *
 * Every caption states whether it is modelled or officially sourced. That distinction is the whole
 * reason this is safe to show: the app derives most of these moments from its own simulation, and
 * saying so is what keeps them from reading as a record of the night.
 */
export function StoryCaption({ beat }: { beat: StoryBeat }) {
  const { t, locale } = useI18n();
  const number = new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB');

  return (
    <div
      data-testid="twin3d-story-caption"
      className="mb-3 rounded border border-stone-300 bg-stone-100/80 px-3 py-2"
    >
      <div className="flex items-baseline gap-2">
        <span
          data-testid="twin3d-story-kind"
          className={
            beat.kind === 'sourced'
              ? 'rounded bg-stone-700 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wider text-stone-50'
              : 'rounded border border-stone-400 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wider text-stone-500'
          }
        >
          {beat.kind === 'sourced' ? t('story.sourced') : t('story.modelled')}
        </span>
        <span className="text-sm font-semibold text-stone-900">
          {t(`story.beats.${beat.id}.title`)}
        </span>
      </div>

      <p className="mt-1 text-xs leading-relaxed text-stone-600">
        {t(`story.beats.${beat.id}.body`, {
          count: number.format(beat.buildingsInWater),
          total: number.format(beat.totalAffected),
          places: number.format(beat.villagesInWater),
          totalPlaces: number.format(beat.totalVillages),
        })}
      </p>

      {beat.kind === 'sourced' && (
        <div className="mt-2 flex flex-col gap-1">
          {PEAK_BEAT_SOURCES.map((fact, index) => (
            <span key={index} className="text-xs">
              <SourcedFigure fact={fact} />
            </span>
          ))}
          <p className="mt-1 text-[0.7rem] leading-relaxed text-stone-500">
            {t('story.peakTimeNote')}
          </p>
        </div>
      )}
    </div>
  );
}

export function StoryMarkers({ beats, active, tMin, tMax, onJump }: Props) {
  const { t } = useI18n();

  return (
    <div data-testid="twin3d-story" className="relative mb-1 h-4">
      {beats.map((beat) => {
        const isActive = active?.id === beat.id;
        return (
          <button
            key={beat.id}
            type="button"
            data-testid={`twin3d-story-marker-${beat.id}`}
            aria-label={`${t(`story.beats.${beat.id}.title`)} — ${t('story.jumpTo')}`}
            onClick={() => onJump(beat.tMinutes)}
            style={{ left: `${((beat.tMinutes - tMin) / (tMax - tMin)) * 100}%` }}
            className="absolute bottom-0 -translate-x-1/2 px-1"
          >
            <span
              className={
                isActive
                  ? 'block h-3.5 w-0.5 bg-stone-800'
                  : 'block h-2.5 w-0.5 bg-stone-400 hover:bg-stone-700'
              }
            />
          </button>
        );
      })}
    </div>
  );
}
