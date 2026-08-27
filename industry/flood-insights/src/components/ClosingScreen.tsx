import { useMemo } from 'react';
import { createPortal } from 'react-dom';

import { useI18n } from '@/i18n';
import { useClosing } from '@/state/closing';
import { peakDischargeForScenario } from '@/twin3d/hydrograph';
import { hazardVersusEvent } from '@/twin3d/hazardVersusEvent';
import type { FlowFieldMeta } from '@/twin3d/terrainLoader';
import { DEFAULT_LEVERS, runWhatIf, type Levers, type PortfolioBundle } from '@/twin3d/whatif';

/**
 * "Lehren und Quellen" — the closing screen (PLAN §9.0).
 *
 * The bookend to the remembrance screen, and held to the same rules: it ends on the source list,
 * and there is **no product logo, no call to action and no contact form** anywhere on it. The app
 * opens on what happened and closes on where the data came from; the technology sits in the
 * middle, where it belongs.
 *
 * The six lessons are not decorative text. Three of them carry a number, and those numbers are
 * recomputed here from the same `runWhatIf` engine the Act IV levers use — so the closing screen
 * cannot drift away from the panel it summarises, and a lesson whose claim stopped being true
 * would visibly stop being true here too.
 *
 * ⚠️ The three without a number are deliberate. "A hazard class is a frequency statement, not a
 * safety guarantee" and "nobody writes SQL at two in the morning" are not quantities, and giving
 * them a made-up figure to match the others would be precision theatre (§2.3).
 */

interface Props {
  portfolio: PortfolioBundle;
  flow: FlowFieldMeta;
}

/** Each layer, its authority and its licence — the "all of this was public" point, made concrete. */
const PROVENANCE: { layer: string; issuer: string; licence: string }[] = [
  { layer: 'DGM1, DOM1, LoD2', issuer: 'LVermGeo Rheinland-Pfalz', licence: 'dl-de/by-2-0' },
  { layer: 'Copernicus EMS EMSR517', issuer: 'European Union', licence: 'Copernicus EMS' },
  { layer: 'Pegel- und Hauptwerte', issuer: 'Landesamt für Umwelt Rheinland-Pfalz', licence: 'HVZ / LfU' },
  { layer: 'Niederschlagsradar', issuer: 'Deutscher Wetterdienst', licence: 'GeoNutzV' },
  { layer: 'Gebäude, Straßen, Landnutzung', issuer: 'OpenStreetMap', licence: 'ODbL' },
  { layer: 'Schadenfunktionen', issuer: 'Joint Research Centre (JRC)', licence: 'EU open' },
];

/** Official accounts of the night, and where the region turned afterwards. */
const REPORTS: { label: string; issuer: string; url: string }[] = [
  {
    label: 'Bericht des Untersuchungsausschusses 18/1 „Flutkatastrophe“, Drucksache 18/10000',
    issuer: 'Landtag Rheinland-Pfalz, 2024',
    url: 'https://dokumente.landtag.rlp.de/landtag/drucksachen/10000-18.pdf',
  },
  {
    label: 'Hochwassergefahren- und Risikokarten Rheinland-Pfalz',
    issuer: 'Landesamt für Umwelt Rheinland-Pfalz',
    url: 'https://hochwassermanagement.rlp.de/',
  },
  {
    label: 'Wiederaufbau Ahrtal — Informationen des Landes',
    issuer: 'Land Rheinland-Pfalz',
    url: 'https://wiederaufbau.rlp.de/',
  },
  {
    label: 'Copernicus Emergency Management Service, Aktivierung EMSR517',
    issuer: 'European Commission',
    url: 'https://mapping.emergency.copernicus.eu/activations/EMSR517',
  },
];

export function ClosingScreen({ portfolio, flow }: Props) {
  const { t, locale } = useI18n();
  const { open, setOpen } = useClosing();
  const tag = locale === 'de' ? 'de-DE' : 'en-GB';

  const lessons = useMemo(() => {
    const common = {
      portfolio,
      bedProfileM: flow.bedProfileM,
      ratingDischargeM3s: flow.ratingDischargeM3s,
      ratingStageM: flow.ratingStageM,
      basePeakM3s: peakDischargeForScenario(),
      reachLengthM: flow.riverLengthKm * 1000,
    };
    const base = runWhatIf({ ...common, levers: DEFAULT_LEVERS });
    const withLever = (over: Partial<Levers>) =>
      runWhatIf({ ...common, levers: { ...DEFAULT_LEVERS, ...over } });

    const nf = new Intl.NumberFormat(tag);
    const eur = (v: number) =>
      new Intl.NumberFormat(tag, {
        notation: 'compact',
        maximumFractionDigits: 1,
        style: 'currency',
        currency: 'EUR',
      }).format(v);
    const pct = (now: number, before: number) =>
      before === 0 ? '0' : new Intl.NumberFormat(tag, { maximumFractionDigits: 0 }).format(
        Math.abs(((now - before) / before) * 100)
      );

    const warned = withLever({ warningHours: 6 });
    const covered = withLever({ elementarShare: 1 });
    const resilient = withLever({ resilientShare: 1 });

    // Lesson 2 used to carry no number, on the reasoning that "a hazard class is a frequency
    // statement, not a guarantee" is not a quantity. That was half right: the statement is not,
    // but the evidence for it is, and leaving it out invited the fair suspicion that the hazard
    // overlay is just the flood in different colours. It is not, and this is the proof.
    const hazard = hazardVersusEvent({
      portfolio,
      bedProfileM: flow.bedProfileM,
      ratingDischargeM3s: flow.ratingDischargeM3s,
      ratingStageM: flow.ratingStageM,
      basePeakM3s: peakDischargeForScenario(),
      reachLengthM: flow.riverLengthKm * 1000,
    });

    return [
      {
        id: 'warning',
        text: t('closing.lesson1'),
        result: t('closing.result1', {
          before: nf.format(base.peopleInAffectedArea),
          after: nf.format(warned.peopleInAffectedArea),
          pct: pct(warned.peopleInAffectedArea, base.peopleInAffectedArea),
        }),
      },
      { id: 'hazard', text: t('closing.lesson2'), result: t('closing.result2', {
          share: new Intl.NumberFormat(tag, { maximumFractionDigits: 0 }).format(
            hazard.shareBelowHq100Pct
          ),
          low: nf.format(hazard.floodedBelowHq100Class),
          flooded: nf.format(hazard.flooded),
          hq100: nf.format(hazard.floodedAtHq100),
        }) },
      {
        id: 'elementar',
        text: t('closing.lesson3'),
        result: t('closing.result3', {
          before: eur(base.uncoveredEur),
          after: eur(covered.uncoveredEur),
          pct: pct(covered.uncoveredEur, base.uncoveredEur),
        }),
      },
      { id: 'silos', text: t('closing.lesson4'), result: null },
      {
        id: 'resilient',
        text: t('closing.lesson5'),
        result: t('closing.result5', {
          before: eur(base.estimatedLossEur),
          after: eur(resilient.estimatedLossEur),
          pct: pct(resilient.estimatedLossEur, base.estimatedLossEur),
        }),
      },
      { id: 'assistant', text: t('closing.lesson6'), result: null },
    ];
  }, [portfolio, flow, t, tag]);

  if (!open) return null;

  return createPortal(
    <div
      data-testid="closing-screen"
      role="dialog"
      aria-label={t('closing.title')}
      className="fixed inset-0 z-40 overflow-y-auto bg-stone-100"
    >
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[0.7rem] uppercase tracking-[0.15em] text-stone-500">
              {t('closing.eyebrow')}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-stone-900">{t('closing.title')}</h2>
          </div>
          <button
            type="button"
            data-testid="closing-close"
            onClick={() => setOpen(false)}
            className="rounded border border-stone-300 bg-stone-50 px-3 py-1 text-xs text-stone-600 hover:bg-stone-200 hover:text-stone-900"
          >
            {t('closing.back')}
          </button>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-stone-600">{t('closing.intro')}</p>

        {/* The six lessons ------------------------------------------------------------------- */}
        <h3 className="mt-8 text-[0.7rem] uppercase tracking-[0.15em] text-stone-500">
          {t('closing.lessonsHeading')}
        </h3>
        <ol data-testid="closing-lessons" className="mt-3 space-y-3">
          {lessons.map((lesson, i) => (
            <li
              key={lesson.id}
              data-testid={`closing-lesson-${lesson.id}`}
              className="border-l-2 border-stone-300 pl-4"
            >
              <div className="text-sm text-stone-800">
                <span className="mr-2 tabular-nums text-stone-400">{i + 1}</span>
                {lesson.text}
              </div>
              {lesson.result && (
                <div className="mt-1 text-xs text-stone-600">{lesson.result}</div>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs leading-relaxed text-stone-500">{t('closing.lessonsNote')}</p>

        {/* Provenance ------------------------------------------------------------------------ */}
        <h3 className="mt-8 text-[0.7rem] uppercase tracking-[0.15em] text-stone-500">
          {t('closing.provenanceHeading')}
        </h3>
        <p className="mt-2 text-xs leading-relaxed text-stone-600">{t('closing.provenanceIntro')}</p>
        <table data-testid="closing-provenance" className="mt-3 w-full text-xs">
          <thead>
            <tr className="text-left text-[0.65rem] uppercase tracking-wider text-stone-500">
              <th className="py-1 font-normal">{t('closing.colLayer')}</th>
              <th className="py-1 font-normal">{t('closing.colIssuer')}</th>
              <th className="py-1 font-normal">{t('closing.colLicence')}</th>
            </tr>
          </thead>
          <tbody className="text-stone-700">
            {PROVENANCE.map((row) => (
              <tr key={row.layer} className="border-t border-stone-200">
                <td className="py-1.5 pr-3">{row.layer}</td>
                <td className="py-1.5 pr-3 text-stone-600">{row.issuer}</td>
                <td className="py-1.5 tabular-nums text-stone-500">{row.licence}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/*
          The source list is the last element on the screen, and nothing follows it. PLAN §9.0 is
          explicit: no logo, no call to action, no "contact us". The app ends on where the data
          came from.
        */}
        <h3 className="mt-8 text-[0.7rem] uppercase tracking-[0.15em] text-stone-500">
          {t('closing.reportsHeading')}
        </h3>
        <ul data-testid="closing-reports" className="mt-3 space-y-2 text-xs">
          {REPORTS.map((r) => (
            <li key={r.url}>
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="text-stone-800 underline decoration-stone-400 underline-offset-2 hover:text-stone-950"
              >
                {r.label}
              </a>
              <span className="ml-2 text-stone-500">{r.issuer}</span>
            </li>
          ))}
        </ul>

        <p className="mt-8 border-t border-stone-300 pt-4 text-[0.65rem] leading-relaxed text-stone-500">
          {t('disclaimer.full')} {t('synthetic.notice')}
        </p>
      </div>
    </div>,
    document.body
  );
}
