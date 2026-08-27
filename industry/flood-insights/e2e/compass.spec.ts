import { expect, test, type Page } from '@playwright/test';

/**
 * The compass (`twin3d-compass`).
 *
 * The valley runs roughly east–west and the camera orbits freely, so it is easy to end up looking
 * upstream from the wrong bank without noticing. These tests check the two things that make the
 * control worth having: that the rose tracks the view, and that clicking it actually puts north
 * back at the top — verified against the geography rather than against the number the app reports
 * about itself.
 */

async function heading(page: Page): Promise<number> {
  const value = await page.getByTestId('twin3d-compass').getAttribute('data-heading');
  return Number(value ?? Number.NaN);
}

/**
 * The heading, once the compass has actually published one.
 *
 * `data-heading` is written from a requestAnimationFrame loop and only when the rose moves, so
 * there is a window after `data-ready` in which the attribute is still absent and `heading()`
 * returns NaN. A NaN baseline poisons every later comparison — `Math.abs(now - NaN) > 5` is false
 * whatever the camera does — so the drag tests would report "the view never turned" when the view
 * had turned perfectly well.
 */
async function settledHeading(page: Page): Promise<number> {
  await expect
    .poll(async () => Number.isFinite(await heading(page)), { timeout: 20_000 })
    .toBe(true);
  return heading(page);
}

async function orbit(page: Page, dx: number) {
  // Drag on bare canvas, not through a panel. The timeline covers the centre at this size, which
  // is the trap the label tests already document.
  const box = (await page.getByTestId('twin3d-canvas').boundingBox())!;
  const y = box.y + box.height * 0.3;
  const x = box.x + box.width * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) await page.mouse.move(x + (dx * i) / 8, y);
  await page.mouse.up();
}

/**
 * Orbit until the heading actually moves.
 *
 * One drag is enough when the suite runs alone and not always when it runs with everything else:
 * two workers share one GPU, each `mouse.move` forces a render of a heavy scene, and the moves can
 * coalesce into almost no rotation. Retrying keeps the test about whether the compass tracks the
 * view rather than about whether a single drag happened to land.
 */
async function orbitUntilTurned(page: Page, from: number, minDelta = 5) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await orbit(page, 260);
    const moved = await page
      .waitForFunction(
        ([start, min]) => {
          const el = document.querySelector('[data-testid="twin3d-compass"]');
          const now = Number(el?.getAttribute('data-heading') ?? Number.NaN);
          return Number.isFinite(now) && Math.abs(now - (start as number)) > (min as number);
        },
        [from, minDelta] as const,
        { timeout: 5_000 }
      )
      .then(() => true)
      .catch(() => false);
    if (moved) return;
  }
  throw new Error('the view never turned, after four drags');
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByTestId('remembrance-continue').click();
  await expect(page.getByTestId('twin3d-canvas')).toHaveAttribute('data-ready', 'true', {
    timeout: 60_000,
  });
});

test('the compass is visible and clear of the panels it shares the screen with', async ({
  page,
}) => {
  await expect(page.getByTestId('twin3d-compass')).toBeVisible();

  // The village rail used to run the full height of the right edge and sat straight on top of it.
  const worst = await page.evaluate(() => {
    const compass = document.querySelector('[data-testid="twin3d-compass"]')!.getBoundingClientRect();
    const others = ['twin3d-places', 'validation-panel', 'act4-panel']
      .map((id) => document.querySelector(`[data-testid="${id}"]`))
      .filter(Boolean)
      .map((el) => el!.getBoundingClientRect());
    const play = document.querySelector('[data-testid="twin3d-play"]');
    if (play) others.push(play.closest('.max-w-3xl')!.getBoundingClientRect());
    let area = 0;
    for (const r of others) {
      const w = Math.max(0, Math.min(compass.right, r.right) - Math.max(compass.left, r.left));
      const h = Math.max(0, Math.min(compass.bottom, r.bottom) - Math.max(compass.top, r.top));
      area = Math.max(area, w * h);
    }
    return Math.round(area);
  });
  expect(worst).toBe(0);
});

test('the rose follows the view', async ({ page }) => {
  const before = await settledHeading(page);
  await orbitUntilTurned(page, before);
  expect(Math.abs((await heading(page)) - before)).toBeGreaterThan(5);
});

test('clicking it puts north back at the top', async ({ page }) => {
  await orbitUntilTurned(page, 0);
  expect(Math.abs(await heading(page))).toBeGreaterThan(5);

  await page.getByTestId('twin3d-compass').click();
  await expect.poll(async () => Math.abs(await heading(page)), { timeout: 20_000 }).toBeLessThan(2);
});

test('north really is north, checked against the valley rather than the readout', async ({
  page,
}) => {
  // The app could report a heading of zero while pointing anywhere. The Ahr runs west to east, so
  // with the map northed an upstream village must sit to the left of a downstream one on screen.
  await page.getByTestId('twin3d-compass').click();
  await expect.poll(async () => Math.abs(await heading(page)), { timeout: 20_000 }).toBeLessThan(2);

  const xs = await page.evaluate(() => {
    const out: Record<string, number> = {};
    document.querySelectorAll('[data-testid^="twin3d-label-"]').forEach((el) => {
      const id = el.getAttribute('data-testid')!.replace('twin3d-label-', '');
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      // Labels for villages off the current view stay in the DOM parked at the origin, so width
      // alone is not enough to tell "on screen" from "hidden at left: 0".
      const shown =
        box.width > 0 &&
        box.left > 0 &&
        box.right < window.innerWidth &&
        style.visibility !== 'hidden' &&
        Number.parseFloat(style.opacity || '1') > 0.05;
      if (shown) out[id] = box.left;
    });
    return out;
  });

  // Whichever labels happen to be on screen, their left-to-right order must match the order the
  // river reaches them.
  const downstream = [
    'kreuzberg', 'altenburg', 'altenahr', 'reimerzhoven', 'laach', 'mayschoss', 'rech', 'dernau',
    'marienthal', 'walporzheim', 'ahrweiler', 'bachem', 'badneuenahr', 'heppingen', 'heimersheim',
    'lohrsdorf', 'ehlingen', 'badbodendorf', 'sinzig', 'kripp',
  ];
  const visible = downstream.filter((id) => id in xs);
  expect(visible.length, 'no village labels on screen to check against').toBeGreaterThanOrEqual(2);
  for (let i = 1; i < visible.length; i += 1) {
    expect(
      xs[visible[i]],
      `${visible[i]} should be east (right) of ${visible[i - 1]} when the map faces north`
    ).toBeGreaterThan(xs[visible[i - 1]]);
  }
});

test('grabbing the map cancels the turn rather than fighting it', async ({ page }) => {
  await orbitUntilTurned(page, 0);
  const turned = await heading(page);
  await page.getByTestId('twin3d-compass').click();
  // Interrupt immediately; the turn takes 700 ms.
  await orbit(page, -60);
  await page.waitForTimeout(900);
  const after = await heading(page);
  // It must not have completed the turn to north behind the user's back.
  expect(Math.abs(after)).toBeGreaterThan(0);
  expect(after).not.toBe(turned);
});
