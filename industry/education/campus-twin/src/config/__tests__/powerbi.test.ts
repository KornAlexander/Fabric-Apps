import { afterEach, describe, expect, it, vi } from 'vitest';

import { gateReport, type ReportGate, type SiteReport } from '@/config/powerbi';

/** Made-up ids, built from parts so no whole id stands in this file. */
const sentinel = (digit: string): string => [8, 4, 4, 4, 12].map((n) => digit.repeat(n)).join('-');
const REPORT = sentinel('1');
const TENANT = sentinel('a');

const SITE: SiteReport = {
  reportId: REPORT,
  pageName: 'gebaeude',
  filter: { table: 'Building', column: 'building_code' },
  realData: 'navigatum',
};

/** A site that should be offered its report: the mirror every refusal below is measured against. */
const OFFERED: ReportGate = {
  aoiId: 'garching',
  ships: true,
  navigatumMode: 'include',
  tenantId: TENANT,
  site: SITE,
};

describe('report window gate', () => {
  it('offers the report where everything holds', () => {
    // ⚠️ THE MIRROR. Without it, a gate that refuses everything passes every test below.
    expect(gateReport(OFFERED)).toBe(SITE);
  });

  it('offers nothing for a site that has no report', () => {
    expect(gateReport({ ...OFFERED, site: undefined })).toBeNull();
  });

  it('offers nothing when the build does not ship the site', () => {
    expect(gateReport({ ...OFFERED, ships: false })).toBeNull();
  });

  it('offers nothing when an id is missing or malformed', () => {
    expect(gateReport({ ...OFFERED, tenantId: '' })).toBeNull();
    expect(gateReport({ ...OFFERED, site: { ...SITE, reportId: '' } })).toBeNull();
    expect(gateReport({ ...OFFERED, site: { ...SITE, reportId: 'not-a-guid' } })).toBeNull();
  });

  it('withholds a real-data report whenever the scene does not show the real data', () => {
    // The report is loaded from real bookings. Beside a synthetic or absent week it would be a
    // second, different answer about the same room.
    for (const mode of ['synthetic', 'exclude', '', 'Include', 'anything-else']) {
      expect(gateReport({ ...OFFERED, navigatumMode: mode }), mode).toBeNull();
    }
  });

  it('does not apply the TUM switch to a report that is not made of TUM data', () => {
    const { realData: _realData, ...ungoverned } = SITE;
    expect(gateReport({ ...OFFERED, site: ungoverned, navigatumMode: 'exclude' })).toEqual(ungoverned);
  });
});

describe('report window configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /** The module reads its ids when it is first imported, so each case imports it afresh. */
  async function load(env: Record<string, string>) {
    vi.resetModules();
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    const [powerbi, release, aoi] = await Promise.all([
      import('@/config/powerbi'),
      import('@/config/release'),
      import('@/config/aoi'),
    ]);
    return {
      ...powerbi,
      // What THIS checkout's release posture allows: the real data, and the site itself.
      offered: release.NAVIGATUM_MODE === 'include' && release.shipsAoi('garching'),
      ships: release.shipsAoi,
      // ⚠️ THE SITE AS THE APP ACTUALLY HOLDS IT, after `applyRelease`. A hand-built Garching with a
      // `rooms` block would hide exactly the case that went wrong: in `exclude` mode the registry
      // entry has no rooms, and a gate that asks the entry what it is made of gets the wrong answer.
      registered: aoi.AOIS.garching as { id: string } | undefined,
    };
  }

  const EXPECTED =
    `https://app.powerbi.com/reportEmbed?reportId=${REPORT}&autoAuth=true&ctid=${TENANT}` +
    "&pageName=gebaeude&filter=Building%2Fbuilding_code%20eq%20'5606'" +
    '&filterPaneEnabled=false&navContentPaneEnabled=false&language=de&formatLocale=de-DE';

  it('offers the Garching report exactly where this release posture ships the real data', async () => {
    const { buildingReportUrl, buildingReport, offered, registered } = await load({
      VITE_PBI_REPORT_GARCHING: REPORT,
      VITE_PBI_TENANT_ID: TENANT,
    });
    // Asked by id, and with the registry's own entry where the site is registered at all.
    // `npm run test:release-switch` runs both sides of this in every posture.
    for (const site of [{ id: 'garching' }, ...(registered ? [registered] : [])]) {
      if (offered) {
        expect(buildingReportUrl(site, '5606', 'de')).toBe(EXPECTED);
        expect(buildingReportUrl(site, '', 'de')).toBeNull();
      } else {
        expect(buildingReport(site)).toBeNull();
        expect(buildingReportUrl(site, '5606', 'de')).toBeNull();
        expect(buildingReportUrl(site, '5606', 'en')).toBeNull();
      }
    }
  });

  it('offers the demo site its report in every release posture, where the build ships the site', async () => {
    const DEMO = sentinel('9');
    const { buildingReportUrl, buildingReport, ships } = await load({
      VITE_PBI_REPORT_DEMO: DEMO,
      VITE_PBI_REPORT_GARCHING: REPORT,
      VITE_PBI_TENANT_ID: TENANT,
    });
    const demo = { id: 'campus-demo' };
    if (!ships('campus-demo')) {
      expect(buildingReport(demo)).toBeNull();
      return;
    }
    // Nothing in it is anybody's real data, so no lever applies. Case is part of the code: `aa`
    // and `AA` are two buildings there, and the address must carry the letters as they are.
    expect(buildingReportUrl(demo, 'aa', 'de')).toContain(`reportId=${DEMO}`);
    expect(buildingReportUrl(demo, 'aa', 'de')).toContain("building_code%20eq%20'aa'");
    expect(buildingReportUrl(demo, 'AA', 'de')).toContain("building_code%20eq%20'AA'");
    // And Garching's id is not handed to the demo site, or the other way round.
    expect(buildingReportUrl(demo, 'aa', 'de')).not.toContain(REPORT);
    expect(buildingReportUrl({ id: 'garching' }, '5606', 'de') ?? '').not.toContain(DEMO);

    // Without its own id the demo site offers nothing, whatever Garching has configured.
    for (const missing of ['', 'not-a-guid']) {
      const without = await load({
        VITE_PBI_REPORT_DEMO: missing,
        VITE_PBI_REPORT_GARCHING: REPORT,
        VITE_PBI_TENANT_ID: TENANT,
      });
      expect(without.buildingReport(demo), missing).toBeNull();
    }
  });

  it('offers no report without configuration, and none to a site that has no report', async () => {
    const unconfigured = await load({ VITE_PBI_REPORT_GARCHING: '', VITE_PBI_TENANT_ID: '' });
    expect(unconfigured.buildingReport({ id: 'garching' })).toBeNull();

    const configured = await load({ VITE_PBI_REPORT_GARCHING: REPORT, VITE_PBI_TENANT_ID: TENANT });
    expect(configured.buildingReport({ id: 'oth-regensburg' })).toBeNull();
    expect(configured.buildingReportUrl({ id: 'oth-regensburg' }, 'K', 'de')).toBeNull();
  });

  it("opens the report in the reader's language where the site has one, and the site's own otherwise", async () => {
    const DEMO = sentinel('9');
    const DEMO_EN = sentinel('7');
    const env = { VITE_PBI_REPORT_DEMO: DEMO, VITE_PBI_REPORT_GARCHING: REPORT, VITE_PBI_TENANT_ID: TENANT };
    const demo = { id: 'campus-demo' };
    const both = await load({ ...env, VITE_PBI_REPORT_DEMO_EN: DEMO_EN });
    if (!both.ships('campus-demo')) {
      expect(both.buildingReport(demo)).toBeNull();
      return;
    }
    // English reader, English report; German reader, the site's own. Same page, same building.
    const english = both.buildingReportUrl(demo, 'H', 'en') ?? '';
    const german = both.buildingReportUrl(demo, 'H', 'de') ?? '';
    expect(english).toContain(`reportId=${DEMO_EN}`);
    expect(german).toContain(`reportId=${DEMO}`);
    expect(english).not.toContain(DEMO);
    expect(german).not.toContain(DEMO_EN);
    for (const url of [english, german]) {
      expect(url).toContain("&pageName=gebaeude&filter=Building%2Fbuilding_code%20eq%20'H'");
    }
    // The number format follows the reader too, whichever report opens.
    expect(english).toMatch(/&language=en&formatLocale=en-GB$/);
    expect(german).toMatch(/&language=de&formatLocale=de-DE$/);

    // ⚠️ THE MIRROR: NO ENGLISH REPORT MEANS THE SITE'S OWN ONE, NOT NO BUTTON. Checked for an id
    // that is missing and for one that is malformed, and the address still carries English formats.
    for (const missing of ['', 'not-a-guid', `${DEMO_EN}&autoAuth=false`]) {
      const without = await load({ ...env, VITE_PBI_REPORT_DEMO_EN: missing });
      const url = without.buildingReportUrl(demo, 'H', 'en') ?? '';
      expect(url, missing).toContain(`reportId=${DEMO}&`);
      expect(url, missing).toMatch(/&language=en&formatLocale=en-GB$/);
      expect(url, missing).not.toContain('autoAuth=false');
    }

    // A site with one report opens it for every reader, and never another site's English one.
    if (both.offered) {
      const garching = both.buildingReportUrl({ id: 'garching' }, '5606', 'en') ?? '';
      expect(garching).toContain(`reportId=${REPORT}&`);
      expect(garching).not.toContain(DEMO_EN);
    }
  });
});
