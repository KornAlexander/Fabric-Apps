import { expect, test } from '@playwright/test';

import { waitForCampusReady } from './campus';

/**
 * The planner backend has a cold-start and no way to say so — TASK 2 of the 2026-08-19 handoff.
 *
 * ⚠️ THE WARM-UP CALL ALREADY EXISTS. `TwinShell` calls `backendSite()` on mount, which hits
 * `/api/health` the moment the page loads — the Container App is already waking up before anyone
 * asks it anything. What was missing was the app SAYING SO: `getJson` has no timeout (correctly —
 * turning slowness into an error would be worse), so while a cold container takes up to two minutes
 * the week drawer and the assistant panel simply had nothing on screen. This file proves the notice
 * appears while that wait is real, disappears the moment it is not, and says something different
 * when the wait ends in a genuine failure — the exact "unknown vs fine" conflation this repo has
 * already had to fix once, in `siteKnown` itself.
 *
 * Stubbed rather than left to a live cold start: this repo cannot make Azure choose to be cold on
 * demand, and a test that only sometimes has a container to catch mid-wake is a test that only
 * sometimes runs.
 */

test.describe('planner waking notice', () => {
  test('says the planner is waking up, in the drawer AND the assistant, while /api/health hangs', async ({
    page,
  }) => {
    // Never fulfilled, never aborted — exactly what a scale-to-zero cold start looks like from the
    // browser's side: the request is genuinely in flight, not failed.
    await page.route('**/api/health*', () => {});

    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForCampusReady(page);

    // The assistant panel: PlannerChat must NOT be what is on screen while the site is unknown.
    const assistantWaking = page.getByTestId('planner-waking');
    await expect(assistantWaking).toBeVisible({ timeout: 15_000 });
    await expect(assistantWaking).toHaveAttribute('data-failed', 'false');
    await expect(page.getByTestId('planner-input')).toHaveCount(0);

    // The week drawer: opened by the same button a planner would press, not a deep link, so this
    // proves the button itself leads somewhere truthful rather than to a blank grid.
    await page.getByTestId('calendar-open').click();
    const drawer = page.getByTestId('calendar-panel');
    await expect(drawer).toBeVisible({ timeout: 15_000 });
    await expect(drawer.getByTestId('planner-waking')).toBeVisible();
  });

  test('says the planner did not answer, not that it is still waking, on a genuine failure', async ({
    page,
  }) => {
    // A real refusal — the case `backendHealthFailed()` exists to tell apart from "still cold".
    await page.route('**/api/health*', (route) => route.fulfill({ status: 500, body: 'nope' }));

    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForCampusReady(page);

    const assistantNotice = page.getByTestId('planner-waking');
    await expect(assistantNotice).toBeVisible({ timeout: 15_000 });
    await expect(assistantNotice).toHaveAttribute('data-failed', 'true');
  });

  test('MIRROR: says nothing at all once the backend answers quickly', async ({ page }) => {
    // ⚠️ THE CONTROL THE BRIEF ASKS FOR BY NAME. Without this, a waking notice that is simply
    // ALWAYS rendered — a bug, not a feature — would pass the two tests above too.
    await page.goto('/?scheduler=oth&aoi=oth-regensburg');
    await waitForCampusReady(page);

    await expect(page.getByTestId('planner-input')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('planner-waking')).toHaveCount(0);

    await page.getByTestId('calendar-open').click();
    await expect(page.getByTestId('calendar-panel')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('planner-waking')).toHaveCount(0);
  });
});
