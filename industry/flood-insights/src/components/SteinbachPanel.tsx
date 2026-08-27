import { useMemo, useState } from 'react';

import { SourcedFigure } from './SourcedFigure';
import { useI18n } from '@/i18n';
import {
  ASSUMED_BREAK_MINUTE,
  DAM_BREAK_SCENARIO,
  DAM_BREAK_SCHWEINHEIM_DEPTH_M,
  DAM_BREAK_VELOCITY_MS,
  DAM_BREAK_VOLUME_M3,
  DAM_CREST_M,
  DAM_DESIGN_FLOOD_M3S,
  DAM_EROSION_WIDTH_M,
  DAM_EVACUATED_PEOPLE,
  DAM_FULL_SUPPLY_M,
  DAM_HEIGHT_M,
  DAM_MOMENTS,
  DAM_OVERTOPPING_M,
  DAM_PEAK_OUTFLOW_M3S,
  DAM_STORAGE_M3,
  formatDamClock,
  leadTimeMinutes,
  peakVersusDesignFlood,
} from '@/data/steinbach';

/**
 * Steinbachtalsperre — "Die Talsperre, die hielt".
 *
 * A companion case to the Ahr, deliberately kept off the Ahr's map. The dam is 13.7 km from
 * Altenahr but in another catchment entirely, draining away from the valley, so it has no place in
 * the terrain this app draws; putting it there would assert a hydraulic connection that does not
 * exist. It lives in its own panel, and since 2026-07-29 on its own terrain — see `SteinbachScene`
 * and the conditions recorded at the top of `src/data/steinbach.ts`. Two scenes, two catchments,
 * no chance of reading one as the other.
 *
 * The module shows three things in order: what the structure was, what happened to it that night,
 * and what a published study later calculated would have followed had it failed. The interactive
 * part is the only one that matters — how much warning time remained downstream — because that is
 * the study's own conclusion and Act IV lesson 1 in the same breath.
 *
 * Tone (PLAN §2.3): the break did not happen and the copy never lets that slip. No casualty
 * figure is derived from the scenario, no building is drawn under it, and the study's finding that
 * the evacuation was correct is stated alongside its worst case rather than buried under it.
 */

function Figure({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-stone-200 py-1.5">
      <span className="text-stone-500">{label}</span>
      <span className="tabular-nums font-medium text-stone-900">
        {value}
        {unit ? <span className="ml-1 font-normal text-stone-500">{unit}</span> : null}
      </span>
    </div>
  );
}

export function SteinbachPanel() {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);

  const decisions = useMemo(() => DAM_MOMENTS.filter((m) => m.decision), []);
  // Opens on the moment the civil protection authority was told overtopping was coming — the last
  // point at which the chain still had hours in hand.
  const [warningIndex, setWarningIndex] = useState(() =>
    Math.max(0, decisions.findIndex((m) => m.id === 'authorityInformed'))
  );

  const nf = useMemo(() => new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB'), [locale]);
  // One decimal, localised. "3.4-fache" with a full stop is not German, and this is the one
  // number in the panel that is computed rather than quoted.
  const nf1 = useMemo(
    () =>
      new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    [locale]
  );
  const warning = decisions[warningIndex] ?? decisions[0];

  if (!open) {
    return (
      <button
        type="button"
        data-testid="steinbach-open"
        onClick={() => setOpen(true)}
        className="rounded border border-stone-300 bg-stone-50 px-2 py-1 text-[0.7rem] text-stone-600 hover:bg-stone-200 hover:text-stone-900"
      >
        {t('steinbach.open')}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        data-testid="steinbach-open"
        onClick={() => setOpen(false)}
        className="rounded border border-stone-400 bg-stone-200 px-2 py-1 text-[0.7rem] text-stone-900"
      >
        {t('steinbach.open')}
      </button>

      <div
        data-testid="steinbach-panel"
        role="dialog"
        aria-label={t('steinbach.title')}
        className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-stone-900/30 p-6 backdrop-blur-sm"
      >
        <div className="w-full max-w-3xl rounded border border-stone-300 bg-stone-50 p-6 text-xs leading-relaxed shadow-lg">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-stone-900">{t('steinbach.title')}</h2>
              <p className="mt-0.5 text-[0.7rem] uppercase tracking-[0.15em] text-stone-500">
                {t('steinbach.subtitle')}
              </p>
            </div>
            <button
              type="button"
              data-testid="steinbach-close"
              onClick={() => setOpen(false)}
              className="rounded border border-stone-300 bg-stone-100 px-2 py-1 text-stone-600 hover:bg-stone-200 hover:text-stone-900"
            >
              {t('steinbach.close')}
            </button>
          </div>

          <p className="mt-4 text-stone-600">{t('steinbach.intro')}</p>
          <p className="mt-2 text-stone-600">{t('steinbach.notOnMap')}</p>

          {/* The structure ------------------------------------------------------------------ */}
          <h3 className="mt-6 text-[0.7rem] uppercase tracking-[0.15em] text-stone-500">
            {t('steinbach.structureHeading')}
          </h3>
          <div className="mt-2">
            <Figure
              label={t('steinbach.crest')}
              value={nf.format(DAM_CREST_M.value)}
              unit={DAM_CREST_M.unit}
            />
            <Figure
              label={t('steinbach.fullSupply')}
              value={nf.format(DAM_FULL_SUPPLY_M.value)}
              unit={DAM_FULL_SUPPLY_M.unit}
            />
            <Figure
              label={t('steinbach.height')}
              value={nf.format(DAM_HEIGHT_M.value)}
              unit={DAM_HEIGHT_M.unit}
            />
            <Figure
              label={t('steinbach.storage')}
              value={nf.format(DAM_STORAGE_M3.value)}
              unit={DAM_STORAGE_M3.unit}
            />
          </div>
          <p className="mt-2 text-[0.65rem] text-stone-500">
            {t('remembrance.sourceLabel')}: {DAM_CREST_M.source?.issuer} · {DAM_CREST_M.source?.year}
          </p>

          <p className="mt-3 text-stone-600">
            {t('steinbach.designFlood')}{' '}
            <SourcedFigure fact={DAM_DESIGN_FLOOD_M3S} />. {t('steinbach.actualOutflow')}{' '}
            <SourcedFigure fact={DAM_PEAK_OUTFLOW_M3S} />
            {' — '}
            {t('steinbach.multiple', { factor: nf1.format(peakVersusDesignFlood()) })}
          </p>

          {/* The night ---------------------------------------------------------------------- */}
          <h3 className="mt-6 text-[0.7rem] uppercase tracking-[0.15em] text-stone-500">
            {t('steinbach.nightHeading')}
          </h3>
          <ol data-testid="steinbach-timeline" className="mt-2 space-y-1">
            {DAM_MOMENTS.map((m) => (
              <li key={m.id} className="flex gap-3">
                <span className="w-11 shrink-0 tabular-nums text-stone-500">
                  {formatDamClock(m.minute)}
                </span>
                <span className="text-stone-700">{t(`steinbach.moment.${m.id}`)}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-stone-600">
            {t('steinbach.nightSummary', {
              overtopping: nf.format(DAM_OVERTOPPING_M.value),
              erosion: nf.format(DAM_EROSION_WIDTH_M.value),
              people: nf.format(DAM_EVACUATED_PEOPLE.value),
            })}
          </p>
          <p className="mt-2 font-medium text-stone-900">{t('steinbach.held')}</p>

          {/* The scenario ------------------------------------------------------------------- */}
          <h3 className="mt-6 text-[0.7rem] uppercase tracking-[0.15em] text-stone-500">
            {t('steinbach.scenarioHeading')}
          </h3>
          <p className="mt-2 text-stone-600">{t('steinbach.scenarioIntro')}</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-stone-600">
            <li>{t('steinbach.assumption1')}</li>
            <li>{t('steinbach.assumption2')}</li>
            <li>{t('steinbach.assumption3')}</li>
          </ul>
          <p className="mt-3 text-stone-600">{t('steinbach.scenarioResult')}</p>
          {/*
            A figure list rather than three inline citations. Cited inline, this source rendered
            its full name, year and "Modellrechnung" qualifier three times inside one sentence and
            buried the numbers under three lines of provenance — the same failure that once made
            the opening screen overflow. One shared citation under the block says the same thing.
          */}
          <div className="mt-2">
            <Figure
              label={t('steinbach.depthAtSchweinheim')}
              value={`${nf.format(DAM_BREAK_SCHWEINHEIM_DEPTH_M.range?.[0] ?? 0)}–${nf.format(
                DAM_BREAK_SCHWEINHEIM_DEPTH_M.range?.[1] ?? DAM_BREAK_SCHWEINHEIM_DEPTH_M.value
              )}`}
              unit={DAM_BREAK_SCHWEINHEIM_DEPTH_M.unit}
            />
            <Figure
              label={t('steinbach.velocity')}
              value={nf.format(DAM_BREAK_VELOCITY_MS.value)}
              unit={DAM_BREAK_VELOCITY_MS.unit}
            />
            <Figure
              label={t('steinbach.volume')}
              value={nf.format(DAM_BREAK_VOLUME_M3.value)}
              unit={DAM_BREAK_VOLUME_M3.unit}
            />
          </div>
          <p className="mt-2 text-[0.65rem] text-stone-500">
            {t('remembrance.sourceLabel')}: {DAM_BREAK_VOLUME_M3.source?.issuer} ·{' '}
            {DAM_BREAK_VOLUME_M3.source?.year} · {DAM_BREAK_VOLUME_M3.source?.status}
          </p>

          {/*
            The corridor is NOT drawn here any more.

            It used to be, because this panel was the only place the Steinbach material existed.
            Once the corridor became a selectable map, the panel was rendering a second copy of
            the scene that was already filling the frame behind it — two WebGL contexts drawing
            the same terrain, one on top of the other. The map is the map; this panel is the
            reading that goes with it.
          */}

          {/* The lever ---------------------------------------------------------------------- */}
          <h3 className="mt-6 text-[0.7rem] uppercase tracking-[0.15em] text-stone-500">
            {t('steinbach.leverHeading')}
          </h3>
          <p className="mt-2 text-stone-600">{t('steinbach.leverIntro')}</p>

          <div className="mt-3">
            <span className="text-stone-500">{t('steinbach.warningAt')}</span>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="tabular-nums text-sm font-medium text-stone-900">
                {formatDamClock(warning.minute)}
              </span>
              <span className="text-stone-600">{t(`steinbach.moment.${warning.id}`)}</span>
            </div>
          </div>
          <input
            type="range"
            data-testid="steinbach-warning"
            min={0}
            max={decisions.length - 1}
            step={1}
            value={warningIndex}
            onChange={(e) => setWarningIndex(Number(e.target.value))}
            aria-label={t('steinbach.warningAt')}
            className="mt-1 w-full accent-stone-700"
          />

          <table className="mt-3 w-full">
            <thead>
              <tr className="text-left text-[0.65rem] uppercase tracking-wider text-stone-500">
                <th className="py-1 font-normal">{t('steinbach.placeColumn')}</th>
                <th className="py-1 text-right font-normal">{t('steinbach.arrival')}</th>
                <th className="py-1 text-right font-normal">{t('steinbach.leadTime')}</th>
              </tr>
            </thead>
            <tbody>
              {DAM_BREAK_SCENARIO.map((p) => {
                // No published arrival time means no row of numbers invented to fill the gap, and
                // no warning time for a place the study puts out of danger.
                const lead =
                  p.travelMinutes === undefined || p.safe
                    ? null
                    : leadTimeMinutes(warning.minute, p.travelMinutes);
                return (
                  <tr key={p.id} className="border-t border-stone-200">
                    <td className="py-1.5 text-stone-700">
                      {t(`steinbach.places.${p.id}`)}
                      {p.safe && (
                        <span className="ml-2 text-[0.65rem] text-stone-500">
                          {t('steinbach.noDanger')}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-stone-500">
                      {p.travelMinutes === undefined
                        ? t('steinbach.notPublished')
                        : formatDamClock(ASSUMED_BREAK_MINUTE + p.travelMinutes)}
                    </td>
                    <td
                      data-testid={`steinbach-lead-${p.id}`}
                      className={`py-1.5 text-right tabular-nums font-medium ${
                        lead !== null && lead < 0 ? 'text-amber-700' : 'text-stone-900'
                      }`}
                    >
                      {lead === null
                        ? t('steinbach.notPublished')
                        : lead < 0
                          ? t('steinbach.tooLate', { minutes: nf.format(Math.abs(lead)) })
                          : t('steinbach.minutes', { minutes: nf.format(lead) })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p className="mt-3 text-stone-600">{t('steinbach.conclusion')}</p>
          <p className="mt-2 text-stone-600">{t('steinbach.evacuationRight')}</p>

          <p
            data-testid="steinbach-notice"
            className="mt-5 border-t border-stone-300 pt-3 text-[0.65rem] leading-relaxed text-stone-500"
          >
            {t('steinbach.notice')}
          </p>
        </div>
      </div>
    </>
  );
}
