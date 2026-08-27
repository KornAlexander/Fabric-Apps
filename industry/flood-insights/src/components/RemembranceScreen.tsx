import {
  FATALITIES_RLP,
  HQ100,
  PEAK_DISCHARGE_2021,
  PREVIOUS_RECORD_DISCHARGE,
} from '@/data/facts';
import { useI18n } from '@/i18n';

import { LanguageToggle } from './LanguageToggle';
import { SourcedFigure } from './SourcedFigure';

/**
 * PLAN §9.0 — "Vor dem Start", the remembrance screen.
 *
 * Binding constraints from the plan, do not "improve" these away:
 *   - full-bleed, muted, no 3D, no KPI, no logo
 *   - the disclaimer and the synthetic-data notice come FIRST, before the narrative
 *   - a single quiet "Weiter" — no skip-on-timer, no autoplay, no animation
 *   - the app cannot be entered without passing this screen (Phase 4 gate)
 */
export function RemembranceScreen({ onContinue }: { onContinue: () => void }) {
  const { t } = useI18n();

  // The sentence carries the figure inline, so it is split around the placeholder rather than
  // interpolated — the number has to render through SourcedFigure to keep its citation attached.
  const [before, after] = t('remembrance.paragraph2').split('{{fatalities}}');

  return (
    <main
      data-testid="remembrance-screen"
      className="flex min-h-screen w-full items-center justify-center bg-stone-100 px-6 py-6 text-stone-700 [@media(max-height:700px)]:py-3 [@media(min-height:820px)]:py-12"
    >
      {/*
        Wider measure than the 42rem this used to be. The figures carry their citations inline, and
        at 42rem those citations wrapped so hard that one sentence ran to six lines — the screen
        did not fit any viewport that was measured, not even 1080p. Width is the cheapest fix:
        fewer wrapped lines cost nothing and read better than squeezing the type.
      */}
      <div className="w-full max-w-4xl">
        <div className="mb-4 flex items-start justify-between gap-6 [@media(max-height:700px)]:mb-2">
          <p className="text-xs uppercase tracking-[0.2em] text-stone-500">
            {t('remembrance.eyebrow')}
          </p>
          <LanguageToggle />
        </div>

        {/* Disclaimer and synthetic notice come before the narrative — §9.0. */}
        <div className="mb-5 space-y-2 border-l border-stone-300 pl-5 text-sm leading-relaxed text-stone-500 [@media(max-height:700px)]:mb-3">
          <p data-testid="disclaimer">{t('disclaimer.full')}</p>
          <p>{t('synthetic.notice')}</p>
        </div>

        <h1 className="mb-3 text-2xl font-semibold text-stone-900 [@media(max-height:700px)]:mb-2 [@media(min-height:820px)]:text-3xl">
          {t('remembrance.heading')}
        </h1>

        <div className="space-y-3 text-base leading-relaxed [@media(max-height:700px)]:space-y-2">
          <p>{t('remembrance.paragraph1')}</p>
          <p data-testid="peak-discharge" className="pl-5">
            <SourcedFigure fact={PEAK_DISCHARGE_2021} />
          </p>
          <p className="text-stone-500">
            {t('remembrance.paragraph1b')} <SourcedFigure fact={PREVIOUS_RECORD_DISCHARGE} />,{' '}
            {t('remembrance.paragraph1c')} <SourcedFigure fact={HQ100} />.
          </p>
          <p data-testid="fatalities-sentence">
            {before}
            <SourcedFigure fact={FATALITIES_RLP} />
            {after}
          </p>
        </div>

        <p className="mt-5 border-t border-stone-300 pt-4 text-base leading-relaxed text-stone-600 [@media(max-height:700px)]:mt-3 [@media(max-height:700px)]:pt-3">
          {t('remembrance.purpose')}
        </p>

        <button
          type="button"
          data-testid="remembrance-continue"
          onClick={onContinue}
          className="mt-5 rounded border border-stone-400 px-6 py-2.5 text-sm text-stone-700 hover:border-stone-600 hover:text-stone-900 focus:outline-none focus-visible:ring-1 focus-visible:ring-stone-500 [@media(max-height:700px)]:mt-3"
        >
          {t('remembrance.continue')}
        </button>
      </div>
    </main>
  );
}
