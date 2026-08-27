/**
 * Steinbachtalsperre, 14–19 July 2021 — the dam that held.
 *
 * Why this is in an app about the Ahr: it is not on the Ahr at all. The dam stands 13.7 km
 * north-west of Altenahr and drains the other way — Steinbach → Orbach → Jungbach → Swist → Erft
 * → Rhine — so no water from it ever reached the valley this app draws, and it is deliberately
 * absent from the map. It is here because the same night produced a second emergency of an
 * entirely different kind, and because its lesson is the one Act IV lesson 1 is built on: warning
 * time is worth more than any amount of water depth, and it has to exist before the failure.
 *
 * ⚠️ The break did not happen. Everything in `DAM_BREAK_SCENARIO` is a published engineering
 * model of something that did not occur, and it is labelled as such everywhere it is shown. It is
 * included only because an official study exists and was presented publicly — this app computes no
 * dam failure of its own.
 *
 * **Revised 2026-07-29 — the scenario may now be drawn.** This file used to end that sentence with
 * "and it never draws one on a map". It does now, in `SteinbachScene`, under conditions that are
 * enforced in code rather than promised in a comment:
 *
 *   1. **Rendered, not computed.** The front position comes from interpolating the three arrival
 *      times Hydrotec published, along the real flow path. Those three points describe one
 *      coherent wave — the front runs at 5.6 m/s to Schweinheim and decelerates to about 1.5 m/s
 *      by Heimerzheim, which is what a dam-break front does, and stays above the 3 m/s flow
 *      velocity the study gives for Schweinheim itself. No hydraulic result of ours is added.
 *   2. **Interpolation moves the picture and never becomes a figure.** The front sweeps past
 *      Palmersheim because a continuous wave must; Palmersheim's arrival time stays unpublished.
 *      `publishedArrivalMinutes` is the only source of a stated time, and it returns undefined
 *      where the study said nothing. Tests pin both halves.
 *   3. **No depth is drawn.** The scene shows where the front has reached, not how deep the water
 *      would be, because the study gave a depth for two places out of four. A depth surface would
 *      have to invent the other two.
 *   4. **The conclusion travels with the worst case.** The scene carries the study's own finding —
 *      that the evacuation of Schweinheim, Palmersheim and Flamersheim was correct and no area was
 *      left out — in the same view, not on a later screen.
 *   5. **It is never the Ahr map.** The corridor drains away from the valley, and the two are
 *      separate scenes with separate terrain, so no viewer can mistake one for the other.
 *
 * PLAN §2.2 rules 2 and 4 still bind: nothing here attaches money or an insurance decision to a
 * real address, and the whole scene is badged as a scenario that did not occur.
 *
 * The study's own conclusion is the constructive one, and it belongs next to every figure taken
 * from it: it found the evacuation of Schweinheim, Palmersheim and Flamersheim to have been
 * correct, and that no area was left out where a break would have done serious damage.
 */

import type { Fact, Source } from './facts';

/**
 * The operator's own account of the night, published as a FAQ after the event.
 *
 * A primary source: e-regio runs the dam, and these are its figures for its own structure.
 */
const EREGIO_FAQ: Source = {
  title: 'FAQ Steinbachtalsperre nach dem Starkregenereignis am 14.07.2021',
  issuer: 'e-regio GmbH & Co. KG',
  year: 2022,
  url: 'https://www.e-regio.de/aktuelle-informationen/faq-steinbachtalsperre-nach-dem-starkregenereignis-am-14072021/',
};

/**
 * The engineering report published when the rebuilt dam was brought back into service in 1990.
 *
 * The structural figures have not changed since that refurbishment, which is what put the asphalt
 * sealing on the water side and replaced the overflow tower with the spillway that was in place in
 * 2021.
 */
const WES_WIEDERINBETRIEBNAHME: Source = {
  title:
    'Bericht anlässlich der Wiederinbetriebnahme der sanierten Steinbachtalsperre, 27. April 1990',
  issuer: 'Wasserversorgungsverband Euskirchen-Swisttal',
  year: 1990,
  url: 'http://www.wasser-eu-sw.de/pdf/steinbachtalsperre.pdf',
};

/**
 * Contemporary reporting on the night itself, including the stage readings the operator reported
 * to the Bezirksregierung and the sequence in which the authorities were informed.
 */
const KSTA_TALSPERRE: Source = {
  title: '„Geröll blockierte Grundablass — Zukunft der Steinbachtalsperre ungewiss“, 8. August 2021',
  issuer: 'Kölner Stadt-Anzeiger',
  year: 2021,
  url: 'https://www.ksta.de/region/euskirchen-eifel/geroell-blockierte-grundablass-zukunft-der-steinbachtalsperre-ungewiss-38971578',
  status: 'Zeitgenössische Berichterstattung',
};

/**
 * The dam-break study.
 *
 * Commissioned in the course of planning the reconstruction, computed by Hydrotec, and presented
 * on 28 September 2022 to the assembly of the Wasserversorgungsverband — so the figures are public
 * and attributable. They are a model of a failure that did not occur, which is what `status` says
 * wherever they are rendered.
 */
const HYDROTEC_DAMMBRUCH: Source = {
  title:
    'Dammbruchsimulation Steinbachtalsperre, vorgestellt in der Verbandsversammlung des WES am ' +
    '28. September 2022; berichtet von Tom Steinicke, Kölnische Rundschau, 29. September 2022',
  issuer: 'Hydrotec Ingenieurgesellschaft für Wasser und Umwelt mbH',
  year: 2022,
  url: 'https://www.rundschau-online.de/region/euskirchen-eifel/steinbachtalsperre-talsperre-in-euskirchen-soll-nach-flut-wieder-volllaufen-352099',
  status: 'Modellrechnung, kein eingetretenes Ereignis',
};

// ---------------------------------------------------------------------------------------------
// The structure
// ---------------------------------------------------------------------------------------------

/** Crest of the earth-fill dam, m above sea level. The water stood 0.40 m over this on 14 July. */
export const DAM_CREST_M: Fact<number> = {
  value: 281,
  unit: 'm ü. NHN',
  source: WES_WIEDERINBETRIEBNAHME,
};

/** Normal full supply level, m above sea level — 2.3 m below the crest. */
export const DAM_FULL_SUPPLY_M: Fact<number> = {
  value: 278.7,
  unit: 'm ü. NHN',
  source: WES_WIEDERINBETRIEBNAHME,
};

/** Height of the dam above the valley floor. */
export const DAM_HEIGHT_M: Fact<number> = {
  value: 17.7,
  unit: 'm',
  source: WES_WIEDERINBETRIEBNAHME,
};

/** Usable storage at full supply level. */
export const DAM_STORAGE_M3: Fact<number> = {
  value: 1_055_430,
  unit: 'm³',
  source: WES_WIEDERINBETRIEBNAHME,
};

/**
 * The flood the spillway was designed for.
 *
 * This is the number the night turned into a different kind of fact: the structure was sized for
 * 20.3 m³/s and passed roughly 69.
 */
export const DAM_DESIGN_FLOOD_M3S: Fact<number> = {
  value: 20.3,
  unit: 'm³/s',
  source: WES_WIEDERINBETRIEBNAHME,
};

/** Peak outflow over the crest and the spillway on the evening of 14 July 2021. */
export const DAM_PEAK_OUTFLOW_M3S: Fact<number> = {
  value: 69,
  unit: 'm³/s',
  source: EREGIO_FAQ,
};

/** How far the water stood above the crest at the peak. */
export const DAM_OVERTOPPING_M: Fact<number> = {
  value: 0.4,
  unit: 'm',
  source: KSTA_TALSPERRE,
};

/** Width of the erosion channels cut into the air-side slope by the overtopping water. */
export const DAM_EROSION_WIDTH_M: Fact<number> = {
  value: 134,
  unit: 'm',
  source: KSTA_TALSPERRE,
};

/** People evacuated downstream across three municipalities and two districts. */
export const DAM_EVACUATED_PEOPLE: Fact<number> = {
  value: 15_000,
  source: { ...KSTA_TALSPERRE, status: 'Angaben der beteiligten Gebietskörperschaften' },
};

/**
 * How many times the outflow exceeded what the spillway was built to pass.
 *
 * Derived, so it inherits both sources and is never shown as a figure of its own.
 */
export function peakVersusDesignFlood(): number {
  return DAM_PEAK_OUTFLOW_M3S.value / DAM_DESIGN_FLOOD_M3S.value;
}

// ---------------------------------------------------------------------------------------------
// The night
// ---------------------------------------------------------------------------------------------

export interface DamMoment {
  id: string;
  /** Minutes from midnight on 14 July 2021, local time. */
  minute: number;
  /**
   * True where this moment is a point at which a warning could have been issued — those are the
   * stops the lead-time lever offers. The others are context.
   */
  decision: boolean;
}

const at = (hour: number, minute: number) => hour * 60 + minute;

/**
 * The documented sequence of that evening.
 *
 * Every entry is a reported clock time, not a modelled one. The gap between 18:10 — when the
 * operator told the civil protection authority that overtopping was coming — and 21:00, when
 * evacuation began, is the whole subject of this module.
 */
export const DAM_MOMENTS: DamMoment[] = [
  { id: 'fullSupply', minute: at(16, 35), decision: true },
  { id: 'reported', minute: at(17, 0), decision: true },
  { id: 'authorityInformed', minute: at(18, 10), decision: true },
  { id: 'sirens', minute: at(18, 42), decision: true },
  { id: 'overtopping', minute: at(20, 0), decision: true },
  { id: 'evacuation', minute: at(21, 0), decision: true },
  { id: 'overtoppingEnds', minute: at(23, 0), decision: false },
];

/**
 * The moment the break is assumed to happen in the lead-time arithmetic below.
 *
 * 20:00 is when the crest was actually overtopped and the slope began to erode — the point at
 * which the structure was, in the words of the reporting, at acute risk. It is the honest instant
 * to hang a hypothetical failure on, because it is the instant at which one became possible.
 */
export const ASSUMED_BREAK_MINUTE = at(20, 0);

// ---------------------------------------------------------------------------------------------
// The computed break scenario
// ---------------------------------------------------------------------------------------------

export interface DownstreamPlace {
  id: string;
  /**
   * Minutes between the failure and the water arriving, from the Hydrotec model.
   *
   * ⚠️ Optional on purpose. The study published an arrival time for some places and only a depth
   * for others, and the gap must stay a gap: an earlier draft of this file filled Palmersheim in
   * with a plausible-looking 30 minutes, which is exactly the sort of invented figure PLAN §4.8
   * exists to keep out. Where the study gave no time, the table shows none.
   */
  travelMinutes?: number;
  /** Modelled depth range in metres, where the study gave one. */
  depthM?: [number, number];
  /** Modelled flow velocity in m/s, where the study gave one. */
  velocityMs?: number;
  /** The study found no danger here — the A 61 embankment holds the water back. */
  safe?: boolean;
}

/**
 * What the model produced, place by place.
 *
 * Its assumptions, stated by the authors: the reservoir stands full to the crest as it did on
 * 14 July 2021 (1.5 million m³), there is no additional inflow from rain, and the dam fails
 * completely within seconds. Those are deliberately severe, which is what a worst case is for.
 */
export const DAM_BREAK_SCENARIO: DownstreamPlace[] = [
  { id: 'schweinheim', travelMinutes: 10, depthM: [3, 5], velocityMs: 3 },
  // Depth but no arrival time: the study reported "unter einem Meter" for Palmersheim without
  // saying when. Leaving the time out is the honest rendering.
  { id: 'palmersheim', depthM: [0, 1] },
  { id: 'odendorf', travelMinutes: 60 },
  { id: 'heimerzheim', travelMinutes: 150, safe: true },
];

/** Volume assumed to be released, from the study's stated parameters. */
export const DAM_BREAK_VOLUME_M3: Fact<number> = {
  value: 1_500_000,
  unit: 'm³',
  source: HYDROTEC_DAMMBRUCH,
};

/** Water depth modelled for Schweinheim ten minutes after a failure. */
export const DAM_BREAK_SCHWEINHEIM_DEPTH_M: Fact<number> = {
  value: 5,
  range: [3, 5],
  unit: 'm',
  source: HYDROTEC_DAMMBRUCH,
};

/** Modelled flow velocity through Schweinheim. */
export const DAM_BREAK_VELOCITY_MS: Fact<number> = {
  value: 3,
  unit: 'm/s',
  source: HYDROTEC_DAMMBRUCH,
};

/**
 * Warning time left when the water arrives somewhere downstream.
 *
 * Positive means the warning went out that many minutes before the water; negative means the
 * water was already there. This is arithmetic on documented clock times and one published travel
 * time — there is no evacuation model behind it, and deliberately so. How many people can be
 * moved in a given number of minutes is not something this app knows, and inventing a rate would
 * turn a sourced figure into a fabricated casualty estimate.
 */
export function leadTimeMinutes(
  warningMinute: number,
  travelMinutes: number,
  breakMinute: number = ASSUMED_BREAK_MINUTE
): number {
  return breakMinute + travelMinutes - warningMinute;
}

/** Formats a minute-of-day as HH:MM. */
export function formatDamClock(minute: number): string {
  const wrapped = ((minute % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
