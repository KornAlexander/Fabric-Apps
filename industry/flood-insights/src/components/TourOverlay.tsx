import { useI18n } from '@/i18n';
import { STORIES, type Story } from '@/twin3d/stories';

/**
 * The tour card (PLAN §12 Phase 8).
 *
 * A caption with controls, not a spotlight cut-out. The map is doing the showing; this says what
 * to look at and why it matters. It sits in the bottom-left, the one corner nothing else claims —
 * Act IV holds the top-left, Copernicus and the village rail the right, the timeline the bottom
 * strip.
 *
 * Deliberately not modal. A presenter is talking over this, and being unable to touch the map
 * mid-sentence because a tour is running would be worse than no tour.
 *
 * The card now drives whichever story is selected rather than the single hard-coded one. Swapping
 * story mid-run restarts at its first step, which is the honest behaviour: the stories do not
 * share a step index and pretending otherwise would land the viewer somewhere arbitrary.
 */

interface Props {
  story: Story;
  index: number;
  onNext: () => void;
  onBack: () => void;
  onEnd: () => void;
  onPickStory: (story: Story) => void;
}

export function TourOverlay({ story, index, onNext, onBack, onEnd, onPickStory }: Props) {
  const { t } = useI18n();
  const steps = story.steps;
  const step = steps[index];
  if (!step) return null;

  const isLast = index === steps.length - 1;

  return (
    <div
      data-testid="tour-card"
      className="pointer-events-auto mx-auto mb-1.5 max-w-3xl rounded border border-stone-300 bg-stone-50/95 p-4 text-xs shadow-sm backdrop-blur"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[0.7rem] uppercase tracking-[0.15em] text-stone-500">
          {t(`tour.act${step.act}`)}
        </span>
        <span data-testid="tour-progress" className="tabular-nums text-stone-500">
          {t('tour.progress', { step: index + 1, of: steps.length })}
        </span>
      </div>

      <h3 data-testid="tour-title" className="mt-1.5 text-sm font-semibold text-stone-900">
        {t(`tour.step.${step.id}.title`)}
      </h3>
      <p className="mt-1.5 leading-relaxed text-stone-600">{t(`tour.step.${step.id}.body`)}</p>

      {/* Progress ticks — cheaper to read at a glance than "3 von 11" alone. */}
      <div className="mt-3 flex gap-1" aria-hidden="true">
        {steps.map((s, i) => (
          <span
            key={s.id}
            className={`h-1 flex-1 rounded-full ${i <= index ? 'bg-stone-600' : 'bg-stone-300'}`}
          />
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        {/* Which story. Changing it restarts — see the note at the top of the file. */}
        <select
          data-testid="tour-story"
          aria-label={t('tour.storyLabel')}
          value={story.id}
          onChange={(e) => {
            const next = STORIES.find((s) => s.id === e.target.value);
            if (next) onPickStory(next);
          }}
          className="rounded border border-stone-300 bg-stone-100 px-1.5 py-1 text-[0.7rem] text-stone-700 hover:bg-stone-200"
        >
          {STORIES.map((s) => (
            <option key={s.id} value={s.id}>
              {t(s.labelKey)}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="tour-back"
          onClick={onBack}
          disabled={index === 0}
          className="rounded border border-stone-300 bg-stone-100 px-2 py-1 text-stone-600 disabled:opacity-40 hover:bg-stone-200 hover:text-stone-900"
        >
          {t('tour.back')}
        </button>
        <button
          type="button"
          data-testid="tour-next"
          onClick={onNext}
          className="rounded border border-stone-400 bg-stone-200 px-2 py-1 font-medium text-stone-900 hover:bg-stone-300"
        >
          {isLast ? t('tour.finish') : t('tour.next')}
        </button>
        <button
          type="button"
          data-testid="tour-end"
          onClick={onEnd}
          className="ml-auto text-stone-500 underline decoration-stone-400 underline-offset-2 hover:text-stone-900"
        >
          {t('tour.end')}
        </button>
      </div>
    </div>
  );
}
