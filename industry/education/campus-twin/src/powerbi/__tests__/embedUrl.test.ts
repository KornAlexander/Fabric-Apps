import { describe, expect, it } from 'vitest';

import { embedUrl, filterExpression, isGuid, odataName } from '@/powerbi/embedUrl';

/** Made-up ids, built from parts so no whole id stands in this file. */
const sentinel = (digit: string): string => [8, 4, 4, 4, 12].map((n) => digit.repeat(n)).join('-');
const REPORT = sentinel('1');
const TENANT = sentinel('a');

describe('Power BI embed URL', () => {
  it('renames spaces and special characters the way the filter syntax wants', () => {
    expect(odataName('Building')).toBe('Building');
    expect(odataName('building_code')).toBe('building_code');
    expect(odataName('Room Hour')).toBe('Room_x0020_Hour');
    expect(odataName('Gebäude')).toBe('Geb_x00E4_ude');
  });

  it('quotes the value even when it is all digits, and doubles a quote inside it', () => {
    const expr = filterExpression({ table: 'Building', column: 'building_code', value: '5606' });
    expect(expr).toBe("Building/building_code eq '5606'");
    expect(filterExpression({ table: 'Room', column: 'room_name', value: "O'Brien" })).toBe(
      "Room/room_name eq 'O''Brien'"
    );
  });

  it('builds a secure-embed URL with page and filter', () => {
    const url = embedUrl({
      reportId: REPORT,
      tenantId: TENANT,
      pageName: 'building',
      filter: { table: 'Building', column: 'building_code', value: '5606' },
      chromeless: true,
    });
    expect(url).toBe(
      `https://app.powerbi.com/reportEmbed?reportId=${REPORT}&autoAuth=true&ctid=${TENANT}` +
        "&pageName=building&filter=Building%2Fbuilding_code%20eq%20'5606'" +
        '&filterPaneEnabled=false&navContentPaneEnabled=false'
    );
    // A space must never travel as `+`: Power BI reads that as a literal plus inside a filter.
    expect(url).not.toContain('+');
  });

  it('leaves the filter off when there is no value, rather than filtering to nothing', () => {
    const url = embedUrl({
      reportId: REPORT,
      tenantId: TENANT,
      filter: { table: 'Building', column: 'building_code', value: '' },
    });
    expect(url).toBe(
      `https://app.powerbi.com/reportEmbed?reportId=${REPORT}&autoAuth=true&ctid=${TENANT}`
    );
  });

  it('can address the filter as $filter', () => {
    const url = embedUrl({
      reportId: REPORT,
      tenantId: TENANT,
      filter: { table: 'Building', column: 'building_code', value: '5606' },
      filterParam: '$filter',
    });
    expect(url).toContain("&$filter=Building%2Fbuilding_code%20eq%20'5606'");
  });

  it('carries language and number format together, and drops a tag that is not one', () => {
    const base = { reportId: REPORT, tenantId: TENANT, chromeless: true };
    expect(embedUrl({ ...base, locale: { language: 'en', formatLocale: 'en-GB' } })).toBe(
      `https://app.powerbi.com/reportEmbed?reportId=${REPORT}&autoAuth=true&ctid=${TENANT}` +
        '&filterPaneEnabled=false&navContentPaneEnabled=false&language=en&formatLocale=en-GB'
    );
    // Without a locale the address is what it always was: the viewer's own settings apply.
    expect(embedUrl(base)).not.toContain('language=');
    // A tag is build-time text like the ids, and must not be able to add a parameter either.
    for (const bad of ['', 'en&autoAuth=false', 'en US', 'x']) {
      const url = embedUrl({ ...base, locale: { language: bad, formatLocale: 'en-GB' } }) ?? '';
      expect(url, bad).not.toContain('language=');
      expect(url, bad).not.toContain('formatLocale=');
      expect(embedUrl({ ...base, locale: { language: 'en', formatLocale: bad } }) ?? '', bad).not.toContain('language=');
    }
  });

  it('offers nothing when an id is not a GUID', () => {
    expect(isGuid(REPORT)).toBe(true);
    expect(isGuid('')).toBe(false);
    expect(isGuid(undefined)).toBe(false);
    expect(isGuid(`${REPORT}&x=1`)).toBe(false);
    expect(embedUrl({ reportId: '', tenantId: TENANT })).toBeNull();
    expect(embedUrl({ reportId: REPORT, tenantId: 'not-a-tenant' })).toBeNull();
    // An id that carries extra query text must not be able to rewrite the address.
    expect(embedUrl({ reportId: `${REPORT}&autoAuth=false`, tenantId: TENANT })).toBeNull();
  });
});
