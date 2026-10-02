/**
 * Open datasets of the Landeshauptstadt that this twin can actually draw.
 *
 * ⚠️ EVERY NUMBER AND KEY IN THIS FILE WAS MEASURED, NOT RECALLED. On 2026-09-22 all 337
 * datasets in the portal were read from the CKAN API, the 76 with a WFS GeoJSON resource were
 * requested against the real modelled bounding box (E 689916–693170, N 5333514–5337456), and
 * `endpoint`, `version`, `typeName`, the feature counts and the property keys below are what
 * came back. Script and raw results: temp/mz-open-data/.
 *
 * Two things that pass a plausibility check and are still wrong:
 *
 *   1. ⚠️ THE ENDPOINT IS NOT ALWAYS `mor_wfs`. The city spreads layers over several GeoServer
 *      workspaces. A first inventory pass hardcoded the mobility workspace and reported 32 live
 *      datasets as dead, because asking the wrong workspace returns a `ServiceException` that is
 *      indistinguishable from a retired layer.
 *   2. ⚠️ A CATALOGUE ENTRY DOES NOT MEAN A SERVED LAYER. `opendata_ruhver_els_point` is still
 *      published with seven resources and answers `Feature type unknown`. It is deliberately
 *      absent below; `ruhver_els_saeule_point` is its live successor.
 *
 * `measuredCount` is kept so a layer that suddenly draws nothing is recognisable as a change at
 * the source rather than as a bug here.
 */

export interface WfsLayerSpec {
  /** Layer id, unique across the app. Also the `data-layer` value and the pick detail's source. */
  id: string;
  /** German label in the panel. */
  label: string;
  /** Panel group heading. */
  group: string;
  /** Full OWS endpoint, including the GeoServer workspace. */
  endpoint: string;
  typeName: string;
  /** As published by the city for this layer. Not a constant: both 1.0.0 and 1.1.0 occur. */
  version: string;
  geometry: 'point' | 'line' | 'polygon';
  colour: number;
  /** Attribution shown in the detail panel footer. */
  source: string;
  /** Short German noun for the status line, e.g. "Anlagen". */
  unit?: string;
  /** First non-empty property becomes the detail panel's title. */
  titleFields?: string[];
  /** Explicit panel rows. When omitted every non-empty published property is listed. */
  fields?: { label: string; key: string }[];
  /** Real-world ribbon width in metres for line layers. */
  widthM?: number;
  /**
   * Property holding the feature's published width in CENTIMETRES, where the dataset has one.
   *
   * ⚠️ PREFERRED OVER `widthM` WHENEVER IT EXISTS. The tactile guidance layer was drawn at a
   * hard-coded 0.9 m while the city publishes 50 cm for 30 of its 32 features, and a comment
   * called that "the real width". A width the viewer can measure off the map must come from the
   * data, not from a plausible-sounding constant.
   */
  widthField?: string;
  /**
   * GeoServer CQL filter, applied server side.
   *
   * ⚠️ THIS IS A TRANSFER BUDGET, NOT A PREFERENCE. A WFS bbox selects features that INTERSECT
   * the box and then returns each one WHOLE, so a city-wide bus route that clips the corner of
   * the core arrives in full. Measured on 2026-09-22: 49 route lines came to 10.5 MB.
   *
   * ⚠️ REQUIRES `geometryField`, because the extent must travel inside the filter: GeoServer
   * refuses `bbox` and `cql_filter` in the same request.
   */
  cqlFilter?: string;
  /** Geometry column, needed only with `cqlFilter`. Read from DescribeFeatureType, not guessed. */
  geometryField?: string;
  /** Response size ceiling in bytes. Raise only where the payload is known to be large. */
  maxBytes?: number;
  /** Cap on drawn features. Set only where the count would cost frame rate. */
  maxFeatures?: number;
  /** What the probe measured inside the Munich core on `measuredOn`. */
  measuredCount: number;
  measuredOn: string;
}

const LHM = (typeName: string) =>
  `Landeshauptstadt München, offene Daten (${typeName}), dl-de/by-2-0`;

const MOR = 'https://geoportal.muenchen.de/geoserver/mor_wfs/ows';
const BAUT = 'https://geoportal.muenchen.de/geoserver/baut_wfs/ows';
const BAUG = 'https://geoportal.muenchen.de/geoserver/baug_wfs/ows';
const GSM = 'https://geoportal.muenchen.de/geoserver/gsm_wfs/ows';

export const WFS_LAYERS: WfsLayerSpec[] = [
  // ── Ladeinfrastruktur ────────────────────────────────────────────────────────────────────
  {
    id: 'ladeeinrichtungen',
    label: 'Ladeeinrichtungen',
    group: 'Ladeinfrastruktur',
    endpoint: MOR,
    typeName: 'mor_wfs:ruhver_els_saeule_point',
    version: '1.0.0',
    geometry: 'point',
    colour: 0x1a7f37,
    unit: 'Ladeeinrichtungen',
    titleFields: ['standort'],
    source: LHM('mor_wfs:ruhver_els_saeule_point'),
    measuredCount: 121,
    measuredOn: '2026-09-22',
  },
  {
    id: 'ladestandorte',
    label: 'Standorte der Ladeinfrastruktur',
    group: 'Ladeinfrastruktur',
    endpoint: MOR,
    typeName: 'mor_wfs:ruhver_els_standort_point',
    version: '1.0.0',
    geometry: 'point',
    colour: 0x0f5c28,
    unit: 'Standorte',
    titleFields: ['standort', 'betreiber'],
    source: LHM('mor_wfs:ruhver_els_standort_point'),
    measuredCount: 72,
    measuredOn: '2026-09-22',
  },

  // ── Verkehr und Parken ───────────────────────────────────────────────────────────────────
  {
    id: 'lichtsignalanlagen',
    label: 'Lichtsignalanlagen',
    group: 'Verkehr und Parken',
    endpoint: MOR,
    typeName: 'mor_wfs:lsa_opendata',
    version: '1.0.0',
    geometry: 'point',
    colour: 0xf0b323,
    unit: 'Anlagen',
    titleFields: ['standort'],
    source: LHM('mor_wfs:lsa_opendata'),
    measuredCount: 182,
    measuredOn: '2026-09-22',
  },
  {
    id: 'parkraumgebiete',
    label: 'Parkraummanagementgebiete',
    group: 'Verkehr und Parken',
    endpoint: MOR,
    typeName: 'mor_wfs:ruhver_prm_gebiete_poly',
    version: '1.0.0',
    geometry: 'polygon',
    colour: 0x7a5cc4,
    unit: 'Gebiete',
    titleFields: ['name'],
    source: LHM('mor_wfs:ruhver_prm_gebiete_poly'),
    measuredCount: 35,
    measuredOn: '2026-09-22',
  },
  {
    id: 'parkseiten',
    label: 'Parkseiten',
    group: 'Verkehr und Parken',
    endpoint: MOR,
    typeName: 'mor_wfs:ruhver_parkseiten_line',
    version: '1.0.0',
    geometry: 'line',
    colour: 0x6b7f9e,
    unit: 'Parkseiten',
    titleFields: ['strasse', 'parkregel_name'],
    widthM: 2.2,
    // ⚠️ CAPPED, AND THE PANEL SAYS SO. This layer alone fills the core: the probe returned the
    // full 3000 it was allowed to. Each feature is its own mesh so it can be picked, and several
    // thousand draw calls is exactly the kind of thing that turns a smooth demo into a slideshow.
    maxFeatures: 1500,
    source: LHM('mor_wfs:ruhver_parkseiten_line'),
    measuredCount: 3000,
    measuredOn: '2026-09-22',
  },
  {
    id: 'laden-liefern',
    label: 'Laden, Liefern, Leisten',
    group: 'Verkehr und Parken',
    endpoint: MOR,
    typeName: 'mor_wfs:ruhver_laden_liefern_line',
    version: '1.0.0',
    geometry: 'line',
    colour: 0xd06010,
    unit: 'Zonen',
    titleFields: ['angebot', 'parkregel_beschreibung'],
    widthM: 2.5,
    source: LHM('mor_wfs:ruhver_laden_liefern_line'),
    measuredCount: 266,
    measuredOn: '2026-09-22',
  },
  {
    id: 'radwege',
    label: 'Radwege (Radlstadtplan)',
    group: 'Verkehr und Parken',
    endpoint: MOR,
    typeName: 'mor_wfs:rad_rsp_radwege_line',
    version: '1.0.0',
    geometry: 'line',
    colour: 0x1668c1,
    unit: 'Abschnitte',
    titleFields: ['legende'],
    widthM: 2.5,
    source: LHM('mor_wfs:rad_rsp_radwege_line'),
    measuredCount: 556,
    measuredOn: '2026-09-22',
  },
  {
    id: 'strassennetz',
    label: 'Straßennetz Baureferat Tiefbau',
    group: 'Verkehr und Parken',
    endpoint: BAUT,
    typeName: 'baut_wfs:strassenabschnitte_wu',
    version: '1.0.0',
    geometry: 'line',
    colour: 0x8a8f94,
    unit: 'Abschnitte',
    titleFields: ['nr', 'str_nr'],
    widthM: 3,
    maxFeatures: 1200,
    source: LHM('baut_wfs:strassenabschnitte_wu'),
    measuredCount: 1817,
    measuredOn: '2026-09-22',
  },

  // ── Barrierefreiheit ─────────────────────────────────────────────────────────────────────
  {
    id: 'behindertenparkplaetze',
    label: 'Behindertenparkplätze',
    group: 'Barrierefreiheit',
    endpoint: MOR,
    typeName: 'mor_wfs:behindertenparkplaetze',
    version: '1.0.0',
    geometry: 'point',
    colour: 0x0a63c2,
    unit: 'Standorte',
    titleFields: ['bezeichnung', 'detail'],
    // ⚠️ "Standorte", NOT "Stellplätze". The layer counts FEATURES, and a feature carries
    // `anzahl_stellplaetze`, which is 2 at Damenstiftstraße 4. Labelling the feature count as a
    // space count understates the provision at every multi-space location.
    source: LHM('mor_wfs:behindertenparkplaetze'),
    measuredCount: 171,
    measuredOn: '2026-09-22',
  },
  {
    id: 'blindenleitsystem',
    label: 'Blindenleitsystem Altstadt',
    group: 'Barrierefreiheit',
    endpoint: BAUT,
    typeName: 'baut_wfs:blindenleitsystem_altstadt',
    version: '1.1.0',
    geometry: 'line',
    colour: 0xffd400,
    unit: 'Abschnitte',
    titleFields: ['art'],
    // Measured 2026-09-22: `breite_cm` is 50 on 30 of the 32 features, 70 on one and 40 on one.
    // The width is therefore read per feature; this fallback only applies if it goes missing.
    widthM: 0.5,
    widthField: 'breite_cm',
    source: LHM('baut_wfs:blindenleitsystem_altstadt'),
    measuredCount: 32,
    measuredOn: '2026-09-22',
  },

  // ── Stadtstruktur und Versorgung ─────────────────────────────────────────────────────────
  {
    id: 'stadtbezirksviertel',
    label: 'Stadtbezirksviertel',
    group: 'Stadtstruktur und Versorgung',
    endpoint: GSM,
    typeName: 'gsm_wfs:vablock_viertel',
    version: '1.0.0',
    geometry: 'polygon',
    colour: 0x5b6770,
    unit: 'Viertel',
    titleFields: ['vi_nummer'],
    source: LHM('gsm_wfs:vablock_viertel'),
    measuredCount: 91,
    measuredOn: '2026-09-22',
  },
  {
    id: 'trinkbrunnen',
    label: 'Trinkbrunnen',
    group: 'Stadtstruktur und Versorgung',
    endpoint: BAUG,
    typeName: 'baug_wfs:trinkwasserbrunnen',
    version: '1.0.0',
    geometry: 'point',
    colour: 0x00a4d6,
    unit: 'Brunnen',
    titleFields: ['bezeichnung', 'objekt'],
    source: LHM('baug_wfs:trinkwasserbrunnen'),
    measuredCount: 28,
    measuredOn: '2026-09-22',
  },

  // ── Liniennetz ───────────────────────────────────────────────────────────────────────────
  //
  // ⚠️ THESE ARE ROUTE SHAPES, NOT DEPARTURE TIMES. The layer is named "Fahrplan Solldaten",
  // which sounds like it carries times; measured on 2026-09-22 its only attributes are
  // `route_short_name`, `art` and `route_long_name`. It can show where a line runs and must
  // never be presented as when anything departs.
  {
    id: 'liniennetz-bahn',
    label: 'Tram- und U-Bahn-Linien',
    group: 'Liniennetz',
    endpoint: MOR,
    typeName: 'mor_wfs:mvg_fahrplan_solldaten_line',
    version: '1.1.0',
    geometry: 'line',
    colour: 0x005a9c,
    unit: 'Linien',
    titleFields: ['route_short_name'],
    fields: [
      { label: 'Linie', key: 'route_short_name' },
      { label: 'Verkehrsmittel', key: 'art' },
      { label: 'Linienweg', key: 'route_long_name' },
    ],
    widthM: 6,
    cqlFilter: "art IN ('Tram','U-Bahn')",
    geometryField: 'shape',
    // The unfiltered layer measured 10.5 MB, because each route arrives whole.
    maxBytes: 20_000_000,
    source: LHM('mor_wfs:mvg_fahrplan_solldaten_line'),
    measuredCount: 49,
    measuredOn: '2026-09-22',
  },
  {
    id: 'liniennetz-bus',
    label: 'Bus- und SEV-Linien',
    group: 'Liniennetz',
    endpoint: MOR,
    typeName: 'mor_wfs:mvg_fahrplan_solldaten_line',
    version: '1.1.0',
    geometry: 'line',
    colour: 0x9a6a00,
    unit: 'Linien',
    titleFields: ['route_short_name'],
    fields: [
      { label: 'Linie', key: 'route_short_name' },
      { label: 'Verkehrsmittel', key: 'art' },
      { label: 'Linienweg', key: 'route_long_name' },
    ],
    widthM: 5,
    cqlFilter: "art IN ('Bus','SEV')",
    geometryField: 'shape',
    maxBytes: 20_000_000,
    source: LHM('mor_wfs:mvg_fahrplan_solldaten_line'),
    measuredCount: 49,
    measuredOn: '2026-09-22',
  },
  {
    id: 'liniennetz-sbahn',
    label: 'S-Bahn-Linien',
    group: 'Liniennetz',
    endpoint: MOR,
    typeName: 'mor_wfs:mvv_sbahn_line',
    version: '1.1.0',
    geometry: 'line',
    colour: 0x008d4f,
    unit: 'Linien',
    titleFields: ['short_name'],
    fields: [
      { label: 'Linie', key: 'short_name' },
      { label: 'Typ', key: 'typ' },
    ],
    widthM: 7,
    maxBytes: 20_000_000,
    source: LHM('mor_wfs:mvv_sbahn_line'),
    measuredCount: 7,
    measuredOn: '2026-09-22',
  },
];

/** Catalogue layers in panel order, grouped by their `group`. */
export function groupedLayers(): { group: string; layers: WfsLayerSpec[] }[] {
  const groups: { group: string; layers: WfsLayerSpec[] }[] = [];
  for (const spec of WFS_LAYERS) {
    let entry = groups.find((candidate) => candidate.group === spec.group);
    if (!entry) {
      entry = { group: spec.group, layers: [] };
      groups.push(entry);
    }
    entry.layers.push(spec);
  }
  return groups;
}
