/**
 * The address of one Power BI report page, filtered to one building, as a pure function.
 *
 * This is the "secure embed" form (`app.powerbi.com/reportEmbed`): the report is shown in an iframe
 * and Power BI signs the viewer in itself (`autoAuth`). The app never holds a Power BI token, which
 * is the point of choosing it: there is no app registration, no secret and nothing to refresh. What
 * the viewer may see is decided by Power BI from their own account, exactly as if they had opened
 * the report in the service.
 *
 * ⚠️ THE FILTER IS A REQUEST, NOT A PERMISSION. A URL filter narrows what the page shows; anyone who
 * can open the report can remove it. It selects a building, it does not protect one. Restricting
 * data needs row-level security in the semantic model, not this file.
 *
 * See docs/POWER-BI-EMBED.md for the whole process this is one step of.
 */

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isGuid = (value: string | null | undefined): value is string =>
  typeof value === 'string' && GUID.test(value);

export interface ColumnFilter {
  /** The table as the SEMANTIC MODEL names it (`Building`, `Room Hour`), not the Delta table. */
  table: string;
  column: string;
  value: string;
}

export interface EmbedTarget {
  reportId: string;
  /** The Entra tenant the report lives in (`ctid`). Lets Power BI sign in without asking where. */
  tenantId: string;
  /** The page's NAME (the folder name in a PBIR definition), not its display name. */
  pageName?: string;
  filter?: ColumnFilter;
  /** Hide the filter pane and the page tabs: in a small window they cost a third of the space. */
  chromeless?: boolean;
  /**
   * `filter` is what the service documents for report URLs; some embed hosts want `$filter`.
   * Settable so the spike can prove which one this tenant honours instead of assuming.
   */
  filterParam?: 'filter' | '$filter';
  /**
   * The language of Power BI's own texts and the locale numbers and dates are written in.
   *
   * Without it both follow the viewer's Power BI settings, so an English app could show `1.165`
   * rooms in the window beside `1,165` in its own panel. Measured 2026-10-12 on the secure embed
   * address: `language=en` with `formatLocale=en-GB` (what the app sends) and with `en-US` both
   * gave `1,165`, `language=de&formatLocale=de-DE` gave `1.165`, for the same report and viewer.
   *
   * ⚠️ IT DOES NOT TRANSLATE THE REPORT. Titles, headers and what a measure answers in words are
   * the report's own; a report in another language is another report (`src/config/powerbi.ts`).
   */
  locale?: { language: string; formatLocale: string };
}

/** A language or locale tag (`en`, `de-DE`), and nothing that could add a parameter of its own. */
const LOCALE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/**
 * A table or column name as a URL filter wants it.
 *
 * ⚠️ SPACES AND SPECIAL CHARACTERS ARE NOT URL-ENCODED HERE, THEY ARE RENAMED. Power BI's filter
 * syntax has its own escape, `_xHHHH_` with the UTF-16 code unit, and applies it BEFORE URL
 * decoding: `Room Hour` must arrive as `Room_x0020_Hour`. Percent-encoding the space instead gives
 * a filter that is silently ignored: the page loads unfiltered and looks like it worked.
 */
export function odataName(name: string): string {
  return name.replace(
    /[^A-Za-z0-9_]/g,
    (ch) => `_x${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`
  );
}

/**
 * ⚠️ ALWAYS A QUOTED STRING, EVEN WHEN THE VALUE LOOKS LIKE A NUMBER. Garching's building codes are
 * `5606`, `5501`: digits, in a column typed as text. `eq 5606` compares a number with a string
 * column and matches nothing. A single quote inside a value is doubled, which is OData's escape.
 */
export function filterExpression(filter: ColumnFilter): string {
  const value = filter.value.replace(/'/g, "''");
  return `${odataName(filter.table)}/${odataName(filter.column)} eq '${value}'`;
}

/**
 * The embed URL, or `null` when the target is not a real report.
 *
 * ⚠️ `null` RATHER THAN A BEST-EFFORT URL. The ids arrive from build configuration, and a missing
 * one must end in "no report here" (a button that is not offered) rather than an iframe showing
 * Power BI's own error page inside this app, which reads as this app being broken.
 *
 * Built by hand rather than with `URLSearchParams` because that encodes a space as `+`, and Power
 * BI reads a `+` inside a filter expression as a literal plus.
 */
export function embedUrl(target: EmbedTarget): string | null {
  if (!isGuid(target.reportId) || !isGuid(target.tenantId)) return null;
  const parts = [
    `reportId=${target.reportId}`,
    'autoAuth=true',
    `ctid=${target.tenantId}`,
  ];
  if (target.pageName) parts.push(`pageName=${encodeURIComponent(target.pageName)}`);
  if (target.filter && target.filter.value.length > 0) {
    const name = target.filterParam === '$filter' ? '$filter' : 'filter';
    parts.push(`${name}=${encodeURIComponent(filterExpression(target.filter))}`);
  }
  if (target.chromeless) parts.push('filterPaneEnabled=false', 'navContentPaneEnabled=false');
  // Both or neither: a language without its number format is half a switch, and a malformed tag
  // is left out rather than sent, so the page falls back to the viewer's own settings.
  if (target.locale && LOCALE_TAG.test(target.locale.language) && LOCALE_TAG.test(target.locale.formatLocale)) {
    parts.push(`language=${target.locale.language}`, `formatLocale=${target.locale.formatLocale}`);
  }
  return `https://app.powerbi.com/reportEmbed?${parts.join('&')}`;
}
