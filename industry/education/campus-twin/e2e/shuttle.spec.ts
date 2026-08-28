import { expect, test } from '@playwright/test';

import { waitForCampusReady } from './campus';

/**
 * The played week, and the shuttle between the two campuses.
 *
 * Two claims worth a test, and neither is "a button exists":
 *
 *   * pressing play MOVES THE WEEK — the hour advances on its own, which is the whole point of a
 *     transport control and the thing a wired-up-but-dead button would fail
 *   * the shuttle MOVES ALONG THE ROAD — a vehicle that renders but never leaves the kerb looks
 *     identical to a working one in a screenshot, and only differs over time
 */

async function openOccupancy(page: import('@playwright/test').Page) {
  await page.goto('/?scheduler=oth&aoi=oth-regensburg');
  await waitForCampusReady(page);
  await page.waitForFunction(() => Boolean(window.__campus?.rooms), null, { timeout: 60_000 });
  // The occupancy lens owns the clock, and it is the lens the app opens on.
  await expect(page.getByTestId('week-play')).toBeVisible({ timeout: 30_000 });
}

test.describe('Playing the week', () => {
  test('play advances the hour on its own, and pause stops it', async ({ page }) => {
    test.setTimeout(180_000);
    await openOccupancy(page);

    const readHour = () => page.getByTestId('hour-slider').inputValue();

    await page.getByTestId('week-play').click();
    await expect(page.getByTestId('week-play')).toHaveAttribute('aria-pressed', 'true');

    // One teaching hour per second, so a few seconds must move it. Polling rather than sleeping a
    // fixed time keeps this honest on a slow machine.
    const started = await readHour();
    await expect
      .poll(async () => readHour(), { timeout: 20_000 })
      .not.toBe(started);

    await page.getByTestId('week-play').click();
    await expect(page.getByTestId('week-play')).toHaveAttribute('aria-pressed', 'false');

    // ⚠️ THE POINT OF THIS HALF. A pause that only greys the button leaves the clock running, and
    // the bug is invisible until someone watches the panel for a few seconds.
    const paused = await readHour();
    await page.waitForTimeout(3000);
    expect(await readHour(), 'the clock kept running after pause').toBe(paused);
  });

  test('dragging the slider takes over from the playback', async ({ page }) => {
    test.setTimeout(180_000);
    await openOccupancy(page);

    await page.getByTestId('week-play').click();
    await expect(page.getByTestId('week-play')).toHaveAttribute('aria-pressed', 'true');

    // Scrubbing by hand while the loop is running used to fight it: the drag moved the hour and
    // the next frame moved it back.
    await page.getByTestId('hour-slider').fill('14');
    await expect(page.getByTestId('week-play')).toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(2000);
    expect(await page.getByTestId('hour-slider').inputValue()).toBe('14');
  });

  test('the shuttle drives the road between the campuses', async ({ page }) => {
    test.setTimeout(180_000);
    await openOccupancy(page);

    // Hidden until the week is playing: a bus parked in the road reads as one that has broken down.
    expect(
      await page.evaluate(() => window.__campus.shuttlePosition()),
      'the shuttle was on screen before anyone pressed play'
    ).toBeNull();

    await page.getByTestId('week-play').click();

    const first = await page.evaluate(() => window.__campus.shuttlePosition());
    expect(first, 'no shuttle after play — is drive-route.json built?').not.toBeNull();

    // It has to actually travel, not merely exist. The route is ~3 km, so a couple of seconds of
    // driving is tens of metres — far outside any jitter.
    await expect
      .poll(
        async () => {
          const now = await page.evaluate(() => window.__campus.shuttlePosition());
          if (!now || !first) return 0;
          return Math.hypot(now.x - first.x, now.z - first.z);
        },
        { timeout: 20_000 }
      )
      .toBeGreaterThan(25);
  });

  /**
   * The on-demand replay: the whole 3 km crossing, watchable in ten seconds.
   *
   * ⚠️ THE UNIT TESTS CANNOT PROVE THIS ONE. `shuttleJourney.test.ts` drives `tick()` by hand with
   * a synthetic straight road, so it proves the arithmetic and nothing about whether the real
   * `drive-route.json` is loaded, whether the animation frame actually runs, or whether the bus is
   * visible when nobody has pressed play. This is the only check that the thing a user clicks
   * produces a bus moving across the real road.
   */
  test('a requested journey crosses the whole road in about ten seconds', async ({ page }) => {
    test.setTimeout(180_000);
    await openOccupancy(page);

    const leg = await page.evaluate(() => window.__campus.shuttleLeg());
    expect(leg, 'no drive leg — is drive-route.json built for this AOI?').not.toBeNull();
    // The road really is long: the point of compressing it is that this cannot be watched live.
    expect(leg!.driveSeconds).toBeGreaterThan(120);

    // ⚠️ NO `week-play` FIRST, DELIBERATELY. A replay must bring the bus on screen by itself, or
    // clicking a transfer from a paused week does nothing and looks broken.
    expect(await page.evaluate(() => window.__campus.shuttlePosition())).toBeNull();

    await page.evaluate(() => window.__campus.playShuttleJourney(10));
    const start = await page.evaluate(() => window.__campus.shuttlePosition());
    expect(start, 'the replay did not make the shuttle visible').not.toBeNull();

    // The compression is reported, because the interface is required to show it.
    const journey = await page.evaluate(() => window.__campus.shuttleJourney());
    expect(journey).not.toBeNull();
    expect(journey!.shownSeconds).toBe(10);
    expect(journey!.factor).toBeGreaterThan(10);

    // Within about ten seconds it must have covered most of a 3 km road. Polling rather than
    // sleeping keeps this honest on a slow machine, and the bound is deliberately well below the
    // full length so a frame-rate wobble cannot fail it.
    await expect
      .poll(
        async () => {
          const now = await page.evaluate(() => window.__campus.shuttlePosition());
          if (!now || !start) return 0;
          return Math.hypot(now.x - start.x, now.z - start.z);
        },
        { timeout: 30_000 }
      )
      .toBeGreaterThan(1000);

    // And it ends: the replay hands back rather than looping for ever.
    await expect
      .poll(async () => page.evaluate(() => window.__campus.shuttleJourney()), { timeout: 20_000 })
      .toBeNull();
  });

  /**
   * The cheat word.
   *
   * ⚠️ TESTED BECAUSE IT IS HIDDEN. Nothing in the interface offers this, so nobody will notice it
   * rotting: a broken button gets reported, a broken easter egg does not. The two things worth
   * pinning are that it takes effect at all, and that it does NOT fire from ordinary typing.
   */
  test('typing the cheat word swaps the bus for a sports car', async ({ page }) => {
    test.setTimeout(180_000);
    await openOccupancy(page);

    expect(await page.evaluate(() => window.__campus.shuttleVehicle())).toBe('bus');

    // ⚠️ The negative case first, while the state is known: the word typed into a text field must
    // do nothing. The assistant box is real, and "Lambo" is a plausible thing to write in it.
    const chat = page.getByTestId('planner-input');
    if (await chat.count()) {
      await chat.first().fill('lambo');
      expect(
        await page.evaluate(() => window.__campus.shuttleVehicle()),
        'the cheat fired from inside a text field'
      ).toBe('bus');
    }

    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.type('lambo');

    await expect
      .poll(async () => page.evaluate(() => window.__campus.shuttleVehicle()), { timeout: 10_000 })
      .toBe('sportscar');

    // The car drives the same road, and the compression it reports follows the duration it is
    // actually given rather than a number baked in beside it.
    await page.evaluate(() => window.__campus.playShuttleJourney(4));
    const journey = await page.evaluate(() => window.__campus.shuttleJourney());
    expect(journey!.shownSeconds).toBe(4);
    expect(journey!.realSeconds).toBeGreaterThan(120);
  });
});
