import { expect, test, type Page } from '@playwright/test';

/**
 * The presenter's own saved story.
 *
 * The scripted tour is fixed; this is the one a presenter writes on the night. Two things make it
 * worth having and are what these tests are about: a stop restores the *moment* as well as the
 * view, and moving between stops is a flight rather than a cut.
 */

async function enter(page: Page) {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page.getByTestId('remembrance-continue').click();
  await expect(page.getByTestId('twin3d-canvas')).toHaveAttribute('data-ready', 'true', {
    timeout: 60_000,
  });
}

async function heading(page: Page): Promise<number> {
  const value = await page.getByTestId('twin3d-compass').getAttribute('data-heading');
  return Number(value ?? Number.NaN);
}

/** The heading, once the compass has actually published one (see compass.spec.ts). */
async function settledHeading(page: Page): Promise<number> {
  await expect
    .poll(async () => Number.isFinite(await heading(page)), { timeout: 20_000 })
    .toBe(true);
  return heading(page);
}

async function clock(page: Page): Promise<string> {
  return (await page.getByTestId('twin3d-clock').textContent())?.trim() ?? '';
}

/** Move the clock by dragging a village's peak button, which also moves the camera. */
async function goToVillage(page: Page, id: string) {
  await page.getByTestId(`twin3d-peak-${id}`).click();
}

/** Drag on bare canvas to turn the view (see compass.spec.ts for why not through a panel). */
async function orbit(page: Page, dx: number) {
  const box = (await page.getByTestId('twin3d-canvas').boundingBox())!;
  const y = box.y + box.height * 0.3;
  const x = box.x + box.width * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) await page.mouse.move(x + (dx * i) / 8, y);
  await page.mouse.up();
}

/**
 * Turn the view until the heading has actually moved.
 *
 * Two workers share one GPU and mouse moves can coalesce into almost no rotation, so one drag is
 * not reliably enough — the same trap compass.spec.ts documents.
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

// Each test gets its own browser context, so the saved story starts empty without any help.
test.beforeEach(async ({ page }) => {
  await enter(page);
});

test('starts empty and says so rather than showing a bare panel', async ({ page }) => {
  await expect(page.getByTestId('twin3d-bookmarks')).toBeVisible();
  await expect(page.getByTestId('twin3d-bookmarks-stop-0')).toHaveCount(0);
  await expect(page.getByTestId('twin3d-bookmarks-play')).toBeDisabled();
});

test('a saved stop records the moment on the clock, not just the camera', async ({ page }) => {
  await goToVillage(page, 'altenahr');
  const saved = await clock(page);

  await page.getByTestId('twin3d-bookmarks-capture').click();
  await expect(page.getByTestId('twin3d-bookmarks-stop-0')).toBeVisible();

  // Move the clock well away from where the stop was taken.
  await goToVillage(page, 'sinzig');
  expect(await clock(page)).not.toBe(saved);

  await page.getByTestId('twin3d-bookmarks-stop-0').click();
  await expect.poll(async () => clock(page), { timeout: 20_000 }).toBe(saved);
});

test('moving to a stop is a flight, not a cut', async ({ page }) => {
  // Every village is framed from the same relative offset, so travelling between them does not
  // change the azimuth at all. Turning the view does, which makes the compass a usable witness to
  // the camera being somewhere in between.
  const saved = await settledHeading(page);
  await page.getByTestId('twin3d-bookmarks-capture').click();

  await orbitUntilTurned(page, saved);
  const turned = await heading(page);
  expect(Math.abs(turned - saved)).toBeGreaterThan(5);

  await page.getByTestId('twin3d-bookmarks-stop-0').click();

  // Shortly after the click the camera must still be on its way. A cut would already have landed.
  await page.waitForTimeout(400);
  expect(Math.abs((await heading(page)) - saved)).toBeGreaterThan(0.5);

  // And it must arrive back on the saved framing rather than stopping somewhere near it.
  await expect
    .poll(async () => Math.abs((await heading(page)) - saved), { timeout: 20_000 })
    .toBeLessThan(1);
});

test('plays the whole story and stops on its own at the end', async ({ page }) => {
  await goToVillage(page, 'altenahr');
  const first = await clock(page);
  await page.getByTestId('twin3d-bookmarks-capture').click();

  await goToVillage(page, 'sinzig');
  await page.getByTestId('twin3d-bookmarks-capture').click();

  await expect(page.getByTestId('twin3d-bookmarks-stop-1')).toBeVisible();

  await page.getByTestId('twin3d-bookmarks-play').click();
  // Playback begins at the first stop, so the clock goes back to where that stop was taken.
  await expect.poll(async () => clock(page), { timeout: 20_000 }).toBe(first);

  // It reaches the last stop and then ends, rather than looping forever.
  await expect(page.getByTestId('twin3d-bookmarks-stop-1')).toHaveAttribute('aria-current', 'true', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('twin3d-bookmarks-play')).toHaveText(/Abspielen|Play/, {
    timeout: 30_000,
  });
});

test('a story survives a reload, because it is written the evening before', async ({ page }) => {
  await goToVillage(page, 'dernau');
  await page.getByTestId('twin3d-bookmarks-capture').click();
  const label = await page.getByTestId('twin3d-bookmarks-stop-0').textContent();

  await page.reload();
  await page.getByTestId('remembrance-continue').click();
  await expect(page.getByTestId('twin3d-canvas')).toHaveAttribute('data-ready', 'true', {
    timeout: 60_000,
  });

  await expect(page.getByTestId('twin3d-bookmarks-stop-0')).toHaveText(label ?? '');
});

test('a stop can be removed', async ({ page }) => {
  await page.getByTestId('twin3d-bookmarks-capture').click();
  await expect(page.getByTestId('twin3d-bookmarks-stop-0')).toBeVisible();

  await page.getByTestId('twin3d-bookmarks-remove-0').click();
  await expect(page.getByTestId('twin3d-bookmarks-stop-0')).toHaveCount(0);
  await expect(page.getByTestId('twin3d-bookmarks-play')).toBeDisabled();
});

test('the story panel does not cover the panels it shares the column with', async ({ page }) => {
  await page.getByTestId('twin3d-bookmarks-capture').click();

  const worst = await page.evaluate(() => {
    const story = document.querySelector('[data-testid="twin3d-bookmarks"]')!.getBoundingClientRect();
    const others = [
      'twin3d-places',
      'validation-panel',
      'act4-panel',
      'twin3d-compass',
      // The event annotations own `twin3d-story`. Two different features nearly shared that id,
      // which is exactly why this list names it explicitly.
      'twin3d-story',
    ]
      .map((id) => document.querySelector(`[data-testid="${id}"]`))
      .filter(Boolean)
      .map((el) => el!.getBoundingClientRect());
    let area = 0;
    for (const r of others) {
      const w = Math.max(0, Math.min(story.right, r.right) - Math.max(story.left, r.left));
      const h = Math.max(0, Math.min(story.bottom, r.bottom) - Math.max(story.top, r.top));
      area = Math.max(area, w * h);
    }
    return Math.round(area);
  });
  expect(worst).toBe(0);
});
