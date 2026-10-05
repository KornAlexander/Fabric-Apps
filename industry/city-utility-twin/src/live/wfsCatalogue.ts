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

import { both, later, type Text } from '../i18n';

export interface WfsLayerSpec {
  /** Layer id, unique across the app. Also the `data-layer` value and the pick detail's source. */
  id: string;
  /** Label in the panel, German or English with the app. */
  label: Text;
  /** Panel group heading. Shared objects from `GROUP`, so grouping can compare by identity. */
  group: Text;
  /** Full OWS endpoint, including the GeoServer workspace. */
  endpoint: string;
  typeName: string;
  /** As published by the city for this layer. Not a constant: both 1.0.0 and 1.1.0 occur. */
  version: string;
  geometry: 'point' | 'line' | 'polygon';
  colour: number;
  /** Attribution shown in the detail panel footer. */
  source: Text;
  /** Short noun for the status line, e.g. "Anlagen" / "signals". */
  unit?: Text;
  /** First non-empty property becomes the detail panel's title. */
  titleFields?: string[];
  /** Explicit panel rows. When omitted every non-empty published property is listed. */
  fields?: { label: Text; key: string }[];
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

const LHM = (typeName: string) => later('wfs.source', typeName);

/** Panel groups. One object each, so `groupedLayers` can group by identity in either language. */
export const GROUP = {
  charging: both('Ladeinfrastruktur', 'Charging infrastructure'),
  traffic: both('Verkehr und Parken', 'Traffic and parking'),
  access: both('Barrierefreiheit', 'Accessibility'),
  city: both('Stadtstruktur und Versorgung', 'City structure and amenities'),
  lines: both('Liniennetz', 'Transit lines'),
} as const;

const MOR = 'https://geoportal.muenchen.de/geoserver/mor_wfs/ows';
const BAUT = 'https://geoportal.muenchen.de/geoserver/baut_wfs/ows';
const BAUG = 'https://geoportal.muenchen.de/geoserver/baug_wfs/ows';
const GSM = 'https://geoportal.muenchen.de/geoserver/gsm_wfs/ows';

export const WFS_LAYERS: WfsLayerSpec[] = [
  // ── Ladeinfrastruktur ────────────────────────────────────────────────────────────────────
  {
    id: 'ladeeinrichtungen',
    label: both('Ladeeinrichtungen', 'Charging points'),
    group: GROUP.charging,
    endpoint: MOR,
    typeName: 'mor_wfs:ruhver_els_saeule_point',
    version: '1.0.0',
    geometry: 'point',
    colour: 0x1a7f37,
    unit: both('Ladeeinrichtungen', 'charging points'),
    titleFields: ['standort'],
    source: LHM('mor_wfs:ruhver_els_saeule_point'),
    measuredCount: 121,
    measuredOn: '2026-09-22',
  },
  {
    id: 'ladestandorte',
    label: both('Standorte der Ladeinfrastruktur', 'Charging sites'),
    group: GROUP.charging,
    endpoint: MOR,
    typeName: 'mor_wfs:ruhver_els_standort_point',
    version: '1.0.0',
    geometry: 'point',
    colour: 0x0f5c28,
    unit: both('Standorte', 'sites'),
    titleFields: ['standort', 'betreiber'],
    source: LHM('mor_wfs:ruhver_els_standort_point'),
    measuredCount: 72,
    measuredOn: '2026-09-22',
  },

  // ── Verkehr und Parken ───────────────────────────────────────────────────────────────────
  {
    id: 'lichtsignalanlagen',
    label: both('Lichtsignalanlagen', 'Traffic signals'),
    group: GROUP.traffic,
    endpoint: MOR,
    typeName: 'mor_wfs:lsa_opendata',
    version: '1.0.0',
    geometry: 'point',
    colour: 0xf0b323,
    unit: both('Anlagen', 'signals'),
    titleFields: ['standort'],
    source: LHM('mor_wfs:lsa_opendata'),
    measuredCount: 182,
    measuredOn: '2026-09-22',
  },
  {
    id: 'parkraumgebiete',
    label: both('Parkraummanagementgebiete', 'Parking management areas'),
    group: GROUP.traffic,
    endpoint: MOR,
    typeName: 'mor_wfs:ruhver_prm_gebiete_poly',
    version: '1.0.0',
    geometry: 'polygon',
    colour: 0x7a5cc4,
    unit: both('Gebiete', 'areas'),
    titleFields: ['name'],
    source: LHM('mor_wfs:ruhver_prm_gebiete_poly'),
    measuredCount: 35,
    measuredOn: '2026-09-22',
  },
  {
    id: 'parkseiten',
    label: both('Parkseiten', 'Kerbside parking'),
    group: GROUP.traffic,
    endpoint: MOR,
    typeName: 'mor_wfs:ruhver_parkseiten_line',
    version: '1.0.0',
    geometry: 'line',
    colour: 0x6b7f9e,
    unit: both('Parkseiten', 'kerbside sections'),
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
    label: both('Laden, Liefern, Leisten', 'Loading and delivery zones'),
    group: GROUP.traffic,
    endpoint: MOR,
    typeName: 'mor_wfs:ruhver_laden_liefern_line',
    version: '1.0.0',
    geometry: 'line',
    colour: 0xd06010,
    unit: both('Zonen', 'zones'),
    titleFields: ['angebot', 'parkregel_beschreibung'],
    widthM: 2.5,
    source: LHM('mor_wfs:ruhver_laden_liefern_line'),
    measuredCount: 266,
    measuredOn: '2026-09-22',
  },
  {
    id: 'radwege',
    label: both('Radwege (Radlstadtplan)', 'Cycle routes (Radlstadtplan)'),
    group: GROUP.traffic,
    endpoint: MOR,
    typeName: 'mor_wfs:rad_rsp_radwege_line',
    version: '1.0.0',
    geometry: 'line',
    colour: 0x1668c1,
    unit: both('Abschnitte', 'sections'),
    titleFields: ['legende'],
    widthM: 2.5,
    source: LHM('mor_wfs:rad_rsp_radwege_line'),
    measuredCount: 556,
    measuredOn: '2026-09-22',
  },
  {
    id: 'strassennetz',
    label: both('Straßennetz Baureferat Tiefbau', 'Street network, civil engineering department'),
    group: GROUP.traffic,
    endpoint: BAUT,
    typeName: 'baut_wfs:strassenabschnitte_wu',
    version: '1.0.0',
    geometry: 'line',
    colour: 0x8a8f94,
    unit: both('Abschnitte', 'sections'),
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
    label: both('Behindertenparkplätze', 'Disabled parking'),
    group: GROUP.access,
    endpoint: MOR,
    typeName: 'mor_wfs:behindertenparkplaetze',
    version: '1.0.0',
    geometry: 'point',
    colour: 0x0a63c2,
    unit: both('Standorte', 'sites'),
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
    label: both('Blindenleitsystem Altstadt', 'Tactile paving, old town'),
    group: GROUP.access,
    endpoint: BAUT,
    typeName: 'baut_wfs:blindenleitsystem_altstadt',
    version: '1.1.0',
    geometry: 'line',
    colour: 0xffd400,
    unit: both('Abschnitte', 'sections'),
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
    label: both('Stadtbezirksviertel', 'District quarters'),
    group: GROUP.city,
    endpoint: GSM,
    typeName: 'gsm_wfs:vablock_viertel',
    version: '1.0.0',
    geometry: 'polygon',
    colour: 0x5b6770,
    unit: both('Viertel', 'quarters'),
    titleFields: ['vi_nummer'],
    source: LHM('gsm_wfs:vablock_viertel'),
    measuredCount: 91,
    measuredOn: '2026-09-22',
  },
  {
    id: 'trinkbrunnen',
    label: both('Trinkbrunnen', 'Drinking fountains'),
    group: GROUP.city,
    endpoint: BAUG,
    typeName: 'baug_wfs:trinkwasserbrunnen',
    version: '1.0.0',
    geometry: 'point',
    colour: 0x00a4d6,
    unit: both('Brunnen', 'fountains'),
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
    label: both('Tram- und U-Bahn-Linien', 'Tram and U-Bahn lines'),
    group: GROUP.lines,
    endpoint: MOR,
    typeName: 'mor_wfs:mvg_fahrplan_solldaten_line',
    version: '1.1.0',
    geometry: 'line',
    colour: 0x005a9c,
    unit: both('Linien', 'lines'),
    titleFields: ['route_short_name'],
    fields: [
      { label: both('Linie', 'Line'), key: 'route_short_name' },
      { label: both('Verkehrsmittel', 'Mode'), key: 'art' },
      { label: both('Linienweg', 'Route'), key: 'route_long_name' },
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
    label: both('Bus- und SEV-Linien', 'Bus and replacement bus lines'),
    group: GROUP.lines,
    endpoint: MOR,
    typeName: 'mor_wfs:mvg_fahrplan_solldaten_line',
    version: '1.1.0',
    geometry: 'line',
    colour: 0x9a6a00,
    unit: both('Linien', 'lines'),
    titleFields: ['route_short_name'],
    fields: [
      { label: both('Linie', 'Line'), key: 'route_short_name' },
      { label: both('Verkehrsmittel', 'Mode'), key: 'art' },
      { label: both('Linienweg', 'Route'), key: 'route_long_name' },
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
    label: both('S-Bahn-Linien', 'S-Bahn lines'),
    group: GROUP.lines,
    endpoint: MOR,
    typeName: 'mor_wfs:mvv_sbahn_line',
    version: '1.1.0',
    geometry: 'line',
    colour: 0x008d4f,
    unit: both('Linien', 'lines'),
    titleFields: ['short_name'],
    fields: [
      { label: both('Linie', 'Line'), key: 'short_name' },
      { label: both('Typ', 'Type'), key: 'typ' },
    ],
    widthM: 7,
    maxBytes: 20_000_000,
    source: LHM('mor_wfs:mvv_sbahn_line'),
    measuredCount: 7,
    measuredOn: '2026-09-22',
  },
];

/** Catalogue layers in panel order, grouped by their `group`. */
export function groupedLayers(): { group: Text; layers: WfsLayerSpec[] }[] {
  const groups: { group: Text; layers: WfsLayerSpec[] }[] = [];
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
