/**
 * Which Power BI report a site's buildings open, and whether this build may offer it at all.
 *
 * The report window is the app pointing at a second system and saying "this is the same building".
 * That is only true while three things hold, and each is checked here rather than assumed:
 *
 *  1. the site HAS a report, built for it (`tools/fabric/build_report.py`);
 *  2. this build ships the site;
 *  3. the report shows the SAME data state the scene does.
 *
 * ⚠️ THE THIRD ONE IS THE POINT. Garching's report is loaded from real TUMonline bookings and says
 * so on the page. A build whose release switch replaces those bookings with a synthetic week
 * (`navigatumData: "synthetic"`) would put a real utilisation figure in a window beside an invented
 * one in the panel, about the same room, with nothing on screen to explain the difference. So the
 * button is offered only where the scene itself shows the real data. `verify_model_agreement.py`
 * checks the other direction: that the model is still the load the stamp on the report claims.
 *
 * ⚠️ THE IDS ARE CONFIGURATION, THE PAGE AND THE FILTER COLUMN ARE CODE. A report id belongs to
 * one tenant and arrives through `VITE_PBI_*`; the page name and the filter column are an interface
 * with `build_report.py` and are true in every tenant, so they live here where a rename shows up in
 * a diff next to the code that depends on it.
 *
 * See docs/POWER-BI-EMBED.md.
 */
import { NAVIGATUM_MODE, shipsAoi } from '@/config/release';
import { intlTag, type Locale } from '@/i18n';
import { embedUrl, isGuid, type ColumnFilter } from '@/powerbi/embedUrl';

export interface SiteReport {
  /** From the build environment. Empty when this deployment has no report for the site. */
  reportId: string;
  /**
   * The same report in another language, where the site has one: another report item over the same
   * model, with the same page name and the same filter column (`--lang` in build_report.py).
   *
   * ⚠️ A LANGUAGE WITHOUT A REPORT OPENS THE SITE'S OWN ONE, IT DOES NOT LOSE THE BUTTON. Garching
   * has a German report only, and an English reader of a German page is better served than one
   * with no page. The numbers are the same measures either way.
   *
   * ⚠️ EACH ID SITS UNDER A KEY NAMED `reportId`, DIRECTLY AFTER THE SITE'S OWN. That is the shape
   * `tools/check_release.mjs` looks for in the built bundle; an id under another name would be one
   * the release gate cannot see.
   */
  variants?: Partial<Record<Locale, { reportId: string }>>;
  /** The page's name in the PBIR definition (`PAGE` in build_report.py), not its display name. */
  pageName: string;
  /** The model column that holds the building code the 3D scene emits. */
  filter: Pick<ColumnFilter, 'table' | 'column'>;
  /**
   * Set when the report is loaded from data a release lever governs. `navigatum`: real TUMonline
   * bookings, which the scene shows only while `navigatumData` is `include`.
   *
   * ⚠️ STATED ON THE REPORT, NOT DERIVED FROM THE SITE. The first version asked the AOI whether its
   * interiors come from TUM (`usesNavigatum`). But `applyRelease` strips the `rooms` block in
   * `exclude` mode, so there the question came back "no" and the gate let the real-data report
   * through: it was safe only because nothing opens a building in that mode. What a report is
   * made of is a fact about the report, and it does not change when the site is stripped.
   */
  realData?: 'navigatum';
}

const SITE_REPORTS: Record<string, SiteReport> = {
  garching: {
    reportId: (import.meta.env.VITE_PBI_REPORT_GARCHING as string | undefined) ?? '',
    pageName: 'gebaeude',
    filter: { table: 'Building', column: 'building_code' },
    realData: 'navigatum',
  },
  /*
    The demo site: an invented university, generated rooms, a generated week, and a report that
    says so on the page. No `realData`, so no release lever withholds it: there is nothing real in
    it to withhold, which is the reason it exists.

    ⚠️ ITS BUILDING CODES DIFFER ONLY BY LETTER CASE (`AA` and `aa` are two buildings), and Power BI
    compares text without regard to case unless the model says otherwise. The demo model is created
    with a case-sensitive collation (`tools/fabric/sites.py`) for exactly this filter: without it,
    opening `aa` would show `AA` and `aa` added together under one title.
  */
  'campus-demo': {
    reportId: (import.meta.env.VITE_PBI_REPORT_DEMO as string | undefined) ?? '',
    variants: { en: { reportId: (import.meta.env.VITE_PBI_REPORT_DEMO_EN as string | undefined) ?? '' } },
    pageName: 'gebaeude',
    filter: { table: 'Building', column: 'building_code' },
  },
};

const TENANT_ID = (import.meta.env.VITE_PBI_TENANT_ID as string | undefined) ?? '';

export interface ReportGate {
  aoiId: string;
  ships: boolean;
  navigatumMode: string;
  tenantId: string;
  site: SiteReport | undefined;
}

/**
 * The decision, as a pure function of its inputs so every branch can be tested without a build.
 *
 * ⚠️ EVERY UNKNOWN IS "NO". A missing id, an id that is not a GUID, a site with no entry, a mode
 * that is not exactly `include`: each ends in no button. A button that opens Power BI's own error
 * page inside this app reads as this app being broken, and one that opens the wrong data state is
 * worse than none.
 */
export function gateReport(gate: ReportGate): SiteReport | null {
  if (!gate.site || !gate.ships) return null;
  if (!isGuid(gate.site.reportId) || !isGuid(gate.tenantId)) return null;
  if (gate.site.realData === 'navigatum' && gate.navigatumMode !== 'include') return null;
  return gate.site;
}

interface ReportAoi {
  id: string;
}

/** The report this site's buildings open in THIS build, or `null` when none may be offered. */
export function buildingReport(aoi: ReportAoi): SiteReport | null {
  return gateReport({
    aoiId: aoi.id,
    ships: shipsAoi(aoi.id),
    navigatumMode: NAVIGATUM_MODE,
    tenantId: TENANT_ID,
    site: SITE_REPORTS[aoi.id],
  });
}

/**
 * The report a site opens for a reader of `locale`: that language's, else the site's own.
 *
 * ⚠️ A VARIANT THAT IS NOT A WELL-FORMED ID IS "NOT CONFIGURED", NOT "NO REPORT". The site's own
 * report passed the gate; a missing or mistyped id for a second language must not take the button
 * away from the readers of that language.
 */
export function reportIdFor(report: SiteReport, locale: Locale): string {
  const variant = report.variants?.[locale]?.reportId;
  return isGuid(variant) ? variant : report.reportId;
}

/**
 * The address of the site's report page, filtered to one building, for a reader of `locale`.
 *
 * The language does two things, and they are independent: it picks the report (where the site has
 * one in that language), and it sets the number format of whichever report opens, so the window
 * writes `1,165` where the panel beside it does.
 */
export function buildingReportUrl(aoi: ReportAoi, buildingCode: string, locale: Locale): string | null {
  const report = buildingReport(aoi);
  if (!report || buildingCode.length === 0) return null;
  return embedUrl({
    reportId: reportIdFor(report, locale),
    tenantId: TENANT_ID,
    pageName: report.pageName,
    filter: { ...report.filter, value: buildingCode },
    chromeless: true,
    locale: { language: locale, formatLocale: intlTag(locale) },
  });
}
