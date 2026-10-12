import { expect, test } from '@playwright/test';

import { waitForCampusReady } from './campus';
import { GARCHING_HAS_INTERIORS, NAVIGATUM_MODE, POSTURE } from './release';

/**
 * The Power BI report window: offered for a building where the site has a report AND the scene
 * shows the same data state, addressed to exactly that building, and gone when the building is.
 *
 * ⚠️ POWER BI ITSELF IS BLOCKED. The frame is another origin behind a sign-in; nothing in it can be
 * asserted, and a test that reaches for it becomes a test of somebody's network. What this app
 * controls is the ADDRESS it hands the frame (report, page, building filter), so that is what is
 * pinned. Whether Power BI then renders it is checked signed in, by hand: docs/POWER-BI-EMBED.md.
 *
 * The ids are the sentinels in `reportSentinels.ts`, which the dev server is started with too.
 */
import { DEMO_REPORT, DEMO_REPORT_EN, REPORT, TENANT } from './reportSentinels';

/** The app opens in German (src/i18n), so German formats unless a test switches to English. */
const addressFor = (code: string, report = REPORT, locale = 'language=de&formatLocale=de-DE') =>
  `https://app.powerbi.com/reportEmbed?reportId=${report}&autoAuth=true&ctid=${TENANT}` +
  `&pageName=gebaeude&filter=Building%2Fbuilding_code%20eq%20'${code}'` +
  `&filterPaneEnabled=false&navContentPaneEnabled=false&${locale}`;

test.beforeEach(async ({ page }) => {
  await page.route('https://app.powerbi.com/**', (route) => route.abort());
});

test('Garching: the open building offers its report, filtered to that building', async ({ page }) => {
  test.skip(NAVIGATUM_MODE !== 'include', `the report shows real TUM data, withheld here (${POSTURE})`);

  await page.goto('/?aoi=garching&building=5606');
  await waitForCampusReady(page);

  // The building first: the button lives in its panel, and the deep link opens it a moment after
  // the campus is ready. Looking for the button before that finds nothing and proves nothing.
  await expect(page.getByTestId('collapse-building')).toBeVisible();

  const button = page.getByTestId('open-building-report');
  // ⚠️ THE ONE SKIP IN THIS TEST IS FOR A SERVER THAT DOES NOT CARRY THE SENTINEL IDS, AND IT ASKS
  // THE SERVER RATHER THAN GUESSING. A dev server reused from another run was started without them,
  // so no button can exist there and failing would blame the feature for the harness. The first
  // version guessed from environment variables and therefore also skipped on the ordinary local
  // run, where Playwright starts the server itself WITH the ids and a missing button is a real
  // defect. Vite inlines `import.meta.env` into each module it serves, so the module says which
  // ids this server has.
  const served = await (await page.request.get('/src/config/powerbi.ts')).text();
  test.skip(
    !served.includes(REPORT),
    'this dev server was started without the sentinel report id: set CS_E2E_PORT to give the run its own'
  );
  await expect(button).toBeVisible();
  await expect(page.getByTestId('building-report')).toHaveCount(0);

  await button.click();
  await expect(page.getByTestId('building-report')).toBeVisible();
  await expect(page.getByTestId('building-report-frame')).toHaveAttribute('src', addressFor('5606'));
  await expect(button).toHaveAttribute('aria-pressed', 'true');

  // It closes with the building, and does not come back by itself with the next one.
  await page.getByTestId('collapse-building').click();
  await expect(page.getByTestId('building-report')).toHaveCount(0);
  await page.getByTestId('explode-5501').click();
  await expect(page.getByTestId('collapse-building')).toBeVisible();
  await expect(page.getByTestId('building-report')).toHaveCount(0);

  await page.getByTestId('open-building-report').click();
  await expect(page.getByTestId('building-report-frame')).toHaveAttribute('src', addressFor('5501'));
});

test('Garching: no report is offered beside a week that is not the real one', async ({ page }) => {
  test.skip(NAVIGATUM_MODE === 'include', `the real data ships here, so the report is offered (${POSTURE})`);
  test.skip(!GARCHING_HAS_INTERIORS, `Garching has no interiors to open in this posture (${POSTURE})`);

  await page.goto('/?aoi=garching&building=5606');
  await waitForCampusReady(page);
  await expect(page.getByTestId('collapse-building')).toBeVisible();
  await expect(page.getByTestId('open-building-report')).toHaveCount(0);
});

test('Beispiel-Universität: its own report, and letter case is part of the building', async ({ page }) => {
  // No release posture withholds this site: nothing in it is real. So this test never skips for
  // the posture, only for a server without the sentinel ids.
  await page.goto('/?aoi=campus-demo&building=H');
  await waitForCampusReady(page);
  await expect(page.getByTestId('collapse-building')).toBeVisible();

  const served = await (await page.request.get('/src/config/powerbi.ts')).text();
  test.skip(
    !served.includes(DEMO_REPORT),
    'this dev server was started without the sentinel report id: set CS_E2E_PORT to give the run its own'
  );

  await page.getByTestId('open-building-report').click();
  await expect(page.getByTestId('building-report-frame')).toHaveAttribute('src', addressFor('H', DEMO_REPORT));

  // ⚠️ `H` AND `h` ARE TWO BUILDINGS ON THIS SITE. The address must carry the code exactly as the
  // scene has it; folding the case anywhere on the way would open the other building's report.
  await page.getByTestId('collapse-building').click();
  await page.getByTestId('explode-h').click();
  await expect(page.getByTestId('collapse-building')).toBeVisible();
  await page.getByTestId('open-building-report').click();
  await expect(page.getByTestId('building-report-frame')).toHaveAttribute('src', addressFor('h', DEMO_REPORT));
});

test('Beispiel-Universität: an English reader gets the English report, a German reader the German one', async ({
  page,
}) => {
  const english = 'language=en&formatLocale=en-GB';
  await page.goto('/?aoi=campus-demo&building=H&report=1');
  await waitForCampusReady(page);
  await expect(page.getByTestId('collapse-building')).toBeVisible();
  const served = await (await page.request.get('/src/config/powerbi.ts')).text();
  test.skip(
    !served.includes(DEMO_REPORT_EN),
    'this dev server was started without the sentinel report id: set CS_E2E_PORT to give the run its own'
  );
  const frame = page.getByTestId('building-report-frame');
  await expect(frame).toHaveAttribute('src', addressFor('H', DEMO_REPORT));

  // The language is chosen on the toggle, and the open window follows it without a reload.
  await page.getByTestId('lang-en').click();
  await expect(frame).toHaveAttribute('src', addressFor('H', DEMO_REPORT_EN, english));

  // ⚠️ THE MIRROR, IN THE SAME SESSION. Switching back must swap the report again; an address that
  // kept the English id would pass every single-language test.
  await page.getByTestId('lang-de').click();
  await expect(frame).toHaveAttribute('src', addressFor('H', DEMO_REPORT));
});

test('a link can open the report, and the window reopens where it was left', async ({ page }) => {
  // The remembered box is written before the app loads, as a previous visit would have left it.
  const left = { x: 300, y: 180, width: 520, height: 400 };
  await page.addInitScript((box) => {
    window.localStorage.setItem('campus.reportWindow', JSON.stringify(box));
  }, left);

  await page.goto('/?aoi=campus-demo&building=H&report=1');
  await waitForCampusReady(page);
  await expect(page.getByTestId('collapse-building')).toBeVisible();
  const served = await (await page.request.get('/src/config/powerbi.ts')).text();
  test.skip(
    !served.includes(DEMO_REPORT),
    'this dev server was started without the sentinel report id: set CS_E2E_PORT to give the run its own'
  );

  // `report=1` opened it without a click, on the linked building, and the address still says so.
  const frame = page.getByTestId('building-report-frame');
  await expect(frame).toHaveAttribute('src', addressFor('H', DEMO_REPORT));
  await expect(page).toHaveURL(/[?&]report=1/);
  const box = await page.getByTestId('building-report').boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box!.x)).toBe(left.x);
  expect(Math.round(box!.y)).toBe(left.y);
  expect(Math.round(box!.width)).toBe(left.width);
  expect(Math.round(box!.height)).toBe(left.height);

  // The button on the scene and the one in the panel are one switch.
  const onScene = page.getByTestId('scene-building-report');
  await expect(onScene).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('open-building-report')).toHaveAttribute('aria-pressed', 'true');
  await onScene.click();
  await expect(page.getByTestId('building-report')).toHaveCount(0);
  await expect(page.getByTestId('open-building-report')).toHaveAttribute('aria-pressed', 'false');
  // Closed means the link no longer asks for it.
  await expect(page).not.toHaveURL(/[?&]report=1/);
});

test('report=1 without a building that exists opens nothing', async ({ page }) => {
  await page.goto('/?aoi=campus-demo&building=NO-SUCH-BUILDING&report=1');
  await waitForCampusReady(page);
  await expect(page.getByTestId('building-report')).toHaveCount(0);
  await expect(page.getByTestId('scene-building-report')).toHaveCount(0);
  // And it does not lie in wait for the next building that is opened.
  await page.locator('[data-testid^="explode-"]').first().click();
  await expect(page.getByTestId('collapse-building')).toBeVisible();
  await expect(page.getByTestId('building-report')).toHaveCount(0);
});

test('a site without a report offers none', async ({ page }) => {
  // The mirror of the first test: same panel, same open building, and no button, because OTH has
  // no report configured. Without it, a button rendered everywhere would pass the Garching test.
  await page.goto('/?scheduler=oth&aoi=oth-regensburg&lens=occupancy');
  await waitForCampusReady(page);
  await page.locator('[data-testid^="explode-"]').first().click();
  await expect(page.getByTestId('collapse-building')).toBeVisible();
  await expect(page.getByTestId('open-building-report')).toHaveCount(0);
  await expect(page.getByTestId('scene-building-report')).toHaveCount(0);
});
