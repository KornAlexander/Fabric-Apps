/**
 * Every factual figure shown in the UI lives here, and every figure carries its source.
 *
 * PLAN §2.2 rule 1 — the death toll appears exactly once in the whole app (the remembrance
 * screen), with a citation.
 * PLAN §4.8 — "If a claim cannot be sourced, it does not go in the app. No exceptions."
 *
 * That rule is enforced in code: a fact with no `source` renders as a visible defect
 * (see `SourcedFigure`), it does not silently render as a bare number.
 */

export interface Source {
  /** Title of the document or dataset, as published. */
  title: string;
  /** Issuing body. */
  issuer: string;
  year: number;
  url?: string;
  /** True when the figure is a post-event reconstruction rather than a measurement. */
  reconstruction?: boolean;
  /**
   * Status note where the figure is provisional or has changed since the event — PLAN §4.8
   * requires the current status *and its date* to be stated.
   */
  status?: string;
}

export interface Fact<T> {
  value: T;
  source: Source | null;
  /** Uncertainty range. Required whenever `source.reconstruction` is true. */
  range?: [T, T];
  unit?: string;
}

/**
 * The LfU publishes these under "Hauptwerte" and "Jährlichkeiten" for Pegel Altenahr
 * (Messstellen-Nr. 2718040300). Retrieved via tools/geodata/fetch_lfu_reference.py.
 */
const LFU_HAUPTWERTE: Source = {
  // The yearbook is the publication, not the issuer. It used to be appended to `issuer`, which put
  // it in every inline citation on the opening screen and cost several wrapped lines there.
  title:
    'Deutsches Gewässerkundliches Jahrbuch — Hauptwerte Abfluss, Pegel Altenahr (2718040300), ' +
    'Reihe 1947–2022',
  issuer: 'Landesamt für Umwelt Rheinland-Pfalz',
  year: 2022,
  url: 'https://geodaten-wasser.rlp-umwelt.de/wasserstand/2718040300/hauptwerte',
};

const LFU_JAEHRLICHKEITEN: Source = {
  title:
    'Jährlichkeiten Abfluss, Pegel Altenahr (2718040300), Reihe 1947–2021 — vorläufige ' +
    'Neuberechnung unter Berücksichtigung historischer Hochwasser, Stand 10/2024',
  issuer: 'Landesamt für Umwelt Rheinland-Pfalz',
  year: 2024,
  url: 'https://geodaten-wasser.rlp-umwelt.de/wasserstand/2718040300/jaehrlichkeiten',
  // Short enough to sit inside a sentence. The qualifier that matters is "vorläufig"; the grounds
  // for it are in the title, which is the tooltip.
  status: 'Vorläufige Neuberechnung, Stand 10/2024',
};

/**
 * The gauge record itself, released by the LfU on request and published in the WDR chronicle and
 * the SWR protocol of the night.
 */
const LFU_PEGELAUFZEICHNUNG: Source = {
  title: 'Messwerte Pegel Altenahr, 14./15. Juli 2021 — Aufzeichnung endet 20:45 Uhr',
  issuer: 'Landesamt für Umwelt Rheinland-Pfalz, veröffentlicht in der WDR-Chronik und im SWR-Protokoll',
  year: 2024,
  url: 'https://reportage.wdr.de/chronik-ahrtal-hochwasser-katastrophe',
  status: 'Letzter Messwert vor der Zerstörung des Pegels',
};

/**
 * The last stage actually measured at Altenahr, at 20:45 on 14 July 2021.
 *
 * Everything after this point in the record is reconstruction. The gauge house and its staff gauge
 * were torn away by the water, so the peak — which the LfU later reconstructed at 980 cm — was
 * never measured, and neither was the time at which it arrived. That gap is why the app's clock is
 * an assumption rather than a record, and it is stated wherever the clock is shown.
 */
export const LAST_MEASURED_STAGE_CM: Fact<number> = {
  value: 575,
  unit: 'cm',
  source: LFU_PEGELAUFZEICHNUNG,
};

/**
 * Peak discharge at Altenahr, 14/15 July 2021.
 *
 * The LfU states plainly that only a *range* can be given: "Wegen unterschiedlicher
 * Rekonstruktionsansätze können für das Hochwasser 2021 nur Wertebereiche angegeben werden."
 * Its own two tables differ — the Hauptwerte give 1 230 m³/s for 14.07.2021, the top-ten event
 * table gives 800 m³/s for 15.07.2021. We show the range, never a single confident number.
 */
export const PEAK_DISCHARGE_2021: Fact<number> = {
  value: 1230,
  range: [800, 1230],
  unit: 'm³/s',
  source: { ...LFU_HAUPTWERTE, reconstruction: true },
};

/** Reconstructed peak stage at Altenahr. The gauge itself failed well below this. */
export const PEAK_STAGE_2021_CM: Fact<number> = {
  value: 980,
  unit: 'cm',
  source: { ...LFU_HAUPTWERTE, reconstruction: true },
};

/** Previous record flood at this gauge — the yardstick 2021 broke. */
export const PREVIOUS_RECORD_DISCHARGE: Fact<number> = {
  value: 236,
  unit: 'm³/s',
  source: LFU_HAUPTWERTE,
};

/** Mean discharge (MQ), Abflussjahr. Puts the peak in proportion. */
export const MEAN_DISCHARGE: Fact<number> = {
  value: 6.75,
  unit: 'm³/s',
  source: LFU_HAUPTWERTE,
};

/** 100-year flood at Altenahr — the reference the hazard classes are built on (PLAN §5). */
export const HQ100: Fact<number> = {
  value: 500,
  unit: 'm³/s',
  source: LFU_JAEHRLICHKEITEN,
};

/** 10-year flood at Altenahr. */
export const HQ10: Fact<number> = {
  value: 175,
  unit: 'm³/s',
  source: LFU_JAEHRLICHKEITEN,
};

/** 50-year flood at Altenahr. Published, and the second anchor the HQ200 extrapolation needs. */
export const HQ50: Fact<number> = {
  value: 367,
  unit: 'm³/s',
  source: LFU_JAEHRLICHKEITEN,
};

/**
 * Discharge for a return period, log-extrapolated beyond the published HQ100.
 *
 * Gumbel behaviour is close to linear in ln(T), so the last two published points are extended.
 * This mirrors `extrapolated_hq()` in tools/geodata/build_portfolio.py exactly, and it has to:
 * the map and the portfolio figures are built from the same boundaries, and if the two drifted
 * apart the app would shade a building one class on the terrain and count it as another in the
 * KPIs. A unit test pins them together.
 */
export function extrapolatedHq(periodYears: number): number {
  const slope = (HQ100.value - HQ50.value) / (Math.log(100) - Math.log(50));
  return HQ100.value + slope * (Math.log(periodYears) - Math.log(100));
}

/**
 * 200-year flood at Altenahr — the GK1/GK2 boundary.
 *
 * ⚠️ This one is **not published**. The LfU Jährlichkeiten table stops at HQ100, but the ZÜRS
 * class boundaries need a 200-year event, so it is extrapolated from HQ50 and HQ100 and marked as
 * a reconstruction wherever it is shown. Because the two anchors are exactly a doubling apart, the
 * extrapolation is a clean 500 + (500 − 367) = 633 m³/s.
 *
 * Rounded to whole m³/s, which is the precision the published table itself uses. The unrounded
 * log-extrapolation lands on 632.999999999999… — carrying that would be false precision on a
 * figure that is an estimate to begin with.
 */
export const HQ200_EXTRAPOLATED: Fact<number> = {
  value: Math.round(extrapolatedHq(200)),
  unit: 'm³/s',
  source: { ...LFU_JAEHRLICHKEITEN, reconstruction: true },
};

/**
 * The final report of the parliamentary committee of inquiry into the flood.
 *
 * This is the definitive public account: 2 141 pages, adopted 2 August 2024 after three years of
 * evidence. The figure below is quoted from section D, "Würdigung der Beweisaufnahme und Ergebnis
 * der Untersuchung" — the committee's own findings, not one of the dissenting annexes that follow
 * it. Those annexes say 135, and they are opinions of individual factions rather than the result
 * of the inquiry, so they are not what this app cites.
 */
const UA_FLUTKATASTROPHE: Source = {
  title:
    'Bericht des Untersuchungsausschusses 18/1 „Flutkatastrophe“, Drucksache 18/10000, ' +
    'Abschlussbericht vom 2. August 2024, Abschnitt D ' +
    '(Würdigung der Beweisaufnahme und Ergebnis der Untersuchung)',
  issuer: 'Landtag Rheinland-Pfalz',
  year: 2024,
  url: 'https://dokumente.landtag.rlp.de/landtag/drucksachen/10000-18.pdf',
  // Deliberately no `status`. On the other facts here that field carries a caveat about how far
  // the number can be trusted — "rekonstruiert", "Vorläufige Neuberechnung". This figure is an
  // adopted final finding with no such caveat, and putting the publication date there would
  // dress plain metadata up as a qualifier. The full reference lives in the title tooltip.
};

/**
 * People killed by the flood in Rheinland-Pfalz, 14–15 July 2021.
 *
 * ⚠️ The scope matters and was previously wrong. This app used to state 134 deaths "im Landkreis
 * Ahrweiler", unsourced. 134 was the count reported in October 2021, and it is not what the
 * inquiry concluded: its findings section says plainly "136 Menschen mussten ihr Leben in dieser
 * Katastrophe lassen", and it states that for the *Land*, giving no district figure at all. A
 * number cannot be quietly re-labelled onto a smaller area than its source measured, so the app
 * now reports what the report reports, and says which area that is.
 *
 * Almost all of these deaths were on the Ahr. The same report records 82 of them — about 61 % —
 * on the lower reach at Bad Neuenahr-Ahrweiler and Sinzig alone.
 */
export const FATALITIES_RLP: Fact<number> = {
  value: 136,
  source: UA_FLUTKATASTROPHE,
};

/** All facts that must be sourced before the app is shown outside the team. */
const RELEASE_GATING_FACTS: Fact<number>[] = [
  FATALITIES_RLP,
  PEAK_DISCHARGE_2021,
  PEAK_STAGE_2021_CM,
  HQ100,
  HQ10,
];

export function isReleaseReady(): boolean {
  return RELEASE_GATING_FACTS.every((fact) => fact.source !== null);
}

/** How many times the 2021 peak exceeded the 100-year flood. Derived, so it inherits both sources. */
export function peakVersusHq100(): { low: number; high: number } {
  const [low, high] = PEAK_DISCHARGE_2021.range ?? [
    PEAK_DISCHARGE_2021.value,
    PEAK_DISCHARGE_2021.value,
  ];
  return { low: low / HQ100.value, high: high / HQ100.value };
}
