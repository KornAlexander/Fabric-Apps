import { expect, test } from '@playwright/test';

import { waitForCampusReady } from './campus';

/**
 * The person on the walking route.
 *
 * The dashed ribbon already shows WHERE the walk goes. The figure exists to show how LONG it
 * takes, which is the question the walk lens is for — so the test that matters is not "a figure
 * appears" but "it moves at the speed the printed minutes were derived from".
 */

async function openWalks(page: import('@playwright/test').Page) {
  await page.goto('/?scheduler=oth&aoi=oth-regensburg');
  await waitForCampusReady(page);
  await page.waitForFunction(() => Boolean(window.__campus?.rooms), null, { timeout: 60_000 });
  await page.getByTestId('rail-walks').click();
}

test.describe('Walking the route', () => {
  test('a figure walks the drawn route at the dataset’s own speed', async ({ page }) => {
    test.setTimeout(180_000);
    await openWalks(page);

    // Nothing drawn yet means nobody walking: the layer draws one route on demand.
    expect(await page.evaluate(() => window.__campus.walker())).toBeNull();

    // ⚠️ NOT `[data-testid^="walk-"]`. That also matches `walk-list` and `walk-summary`, and the
    // container comes first in the DOM — so `.first()` clicked a div and nothing was ever drawn.
    // A walk row is keyed by the transition it represents, so the arrow identifies it.
    const firstWalk = page.locator('[data-testid*="->"]').first();
    await expect(firstWalk).toBeVisible({ timeout: 30_000 });
    await firstWalk.click();

    await expect
      .poll(async () => page.evaluate(() => window.__campus.walkRoutePoints()), { timeout: 30_000 })
      .toBeGreaterThan(1);

    const start = await page.evaluate(() => window.__campus.walker());
    expect(start, 'a route is drawn but nobody is walking it').not.toBeNull();

    // ⚠️ THE CLAIM UNDER TEST. `walk-routes.json` records walkSpeedMs 1.35 and every "x Minuten"
    // in the panel is derived from it. A figure moving at any other speed contradicts the number
    // printed beside it, and the moving thing is the one people believe.
    await page.waitForTimeout(4000);
    const later = await page.evaluate(() => window.__campus.walker());
    expect(later).not.toBeNull();

    const covered = Math.abs(later!.progress - start!.progress) * start!.seconds * 1.35;
    const speed = covered / 4;
    expect(speed, `walked at ${speed.toFixed(2)} m/s, expected about 1.35`).toBeGreaterThan(1.0);
    expect(speed).toBeLessThan(1.7);
  });

  test('clearing the route takes the walker with it', async ({ page }) => {
    test.setTimeout(180_000);
    await openWalks(page);

    const firstWalk = page.locator('[data-testid*="->"]').first();
    await expect(firstWalk).toBeVisible({ timeout: 30_000 });
    await firstWalk.click();
    await expect
      .poll(async () => page.evaluate(() => window.__campus.walkRoutePoints()), { timeout: 30_000 })
      .toBeGreaterThan(1);

    // Clicking the same walk again puts it away — and a figure left striding across a campus with
    // no route under it would be the obvious way for this to go wrong.
    await firstWalk.click();
    await expect
      .poll(async () => page.evaluate(() => window.__campus.walkRoutePoints()), { timeout: 15_000 })
      .toBe(0);
    expect(await page.evaluate(() => window.__campus.walker())).toBeNull();
  });

  test('the cohort that leaves the lecture walks it, not one stand-in', async ({ page }) => {
    test.setTimeout(180_000);
    await openWalks(page);

    const firstWalk = page.locator('[data-testid*="->"]').first();
    await expect(firstWalk).toBeVisible({ timeout: 30_000 });
    await firstWalk.click();
    await expect
      .poll(async () => page.evaluate(() => window.__campus.walkRoutePoints()), { timeout: 30_000 })
      .toBeGreaterThan(1);

    const crowd = await page.evaluate(() => window.__campus.walkCrowd());
    expect(crowd, 'this site states cohort sizes, so a crowd is expected').not.toBeNull();

    /*
      Bracketed against the dataset rather than merely "more than one". `data/synthetic` states an
      `expectedAttendance` for all 955 of its sessions and they run from 14 to 240, so a count
      outside that band means the number came from somewhere other than the timetable.
    */
    expect(crowd!.people).toBeGreaterThanOrEqual(14);
    expect(crowd!.people).toBeLessThanOrEqual(240);
    expect(crowd!.drawn).toBe(crowd!.people);

    // The leader still walks at the dataset's speed, so the printed minutes stay checkable.
    expect(await page.evaluate(() => window.__campus.walker())).not.toBeNull();
  });

  test('the row states the headcount the map is drawing', async ({ page }) => {
    /*
      The picture asserts a number — two hundred figures crossing a courtyard is a claim about how
      many people make that transfer. This checks the claim is written down next to the row, and
      that the written number is the SAME one the scene used. A badge that drifted from the layer
      would be worse than no badge, because it would look like corroboration.
    */
    test.setTimeout(180_000);
    await openWalks(page);

    const firstWalk = page.locator('[data-testid*="->"]').first();
    await expect(firstWalk).toBeVisible({ timeout: 30_000 });
    await firstWalk.click();
    await expect
      .poll(async () => page.evaluate(() => window.__campus.walkRoutePoints()), { timeout: 30_000 })
      .toBeGreaterThan(1);

    const crowd = await page.evaluate(() => window.__campus.walkCrowd());
    expect(crowd, 'this site states cohort sizes').not.toBeNull();

    const badge = page.getByTestId('walk-crowd-size');
    await expect(badge).toBeVisible({ timeout: 15_000 });
    // Numerals only — no translated word to drift between the two catalogues.
    await expect(badge).toHaveText(String(crowd!.people));

    // Closing the row puts the badge away with the route.
    await firstWalk.click();
    await expect(badge).toHaveCount(0);
  });

  test('a real timetable that omits class sizes gets one figure, not an invented crowd', async ({
    page,
  }) => {
    /*
      ⚠️ THE HONESTY CASE, AND IT IS PROVEN AGAINST A REAL EXPORT RATHER THAN A FIXTURE. `oth-real`
      is OTH Regensburg's actual Untis data: 3 015 sessions, and `expectedAttendance` is null on
      every single one of them, because Untis publishes classes without their sizes. A crowd asserts
      a headcount, so on this site there must not be one — the walk falls back to the single figure
      it has always used. Any change that starts guessing a plausible number will fail here.
    */
    test.setTimeout(180_000);
    await page.goto('/?scheduler=oth-real&aoi=oth-regensburg');
    await waitForCampusReady(page);
    await page.waitForFunction(() => Boolean(window.__campus?.rooms), null, { timeout: 60_000 });
    await page.getByTestId('rail-walks').click();

    const firstWalk = page.locator('[data-testid*="->"]').first();
    await expect(firstWalk).toBeVisible({ timeout: 30_000 });
    await firstWalk.click();
    await expect
      .poll(async () => page.evaluate(() => window.__campus.walkRoutePoints()), { timeout: 30_000 })
      .toBeGreaterThan(1);

    expect(await page.evaluate(() => window.__campus.walkCrowd())).toBeNull();
    expect(await page.evaluate(() => window.__campus.walker())).not.toBeNull();
    // ...and nothing claims a headcount in the panel either.
    await expect(page.getByTestId('walk-crowd-size')).toHaveCount(0);
  });
});
