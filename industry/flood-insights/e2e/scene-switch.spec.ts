import { expect, test } from '@playwright/test';

/**
 * The map switch — PLAN §9.x. Selecting a scene replaces the whole view, not the camera.
 *
 * The Steinbach corridor used to be reachable only as a dialog over the Ahr map, with a camera
 * that was set once and never moved. These assert the two things that changed: the scene really
 * swaps, and the corridor can be flown.
 */

async function enter(page: import('@playwright/test').Page, scene?: string) {
  await page.goto(scene ? `/?scene=${scene}` : '/');
  await page.getByTestId('remembrance-continue').click();
}

test('the switch lists four scenes and all of them are selectable', async ({ page }) => {
  await enter(page);
  const options = page.getByTestId('scene-switch').locator('option');
  await expect(options).toHaveCount(4);
  // ⚠️ This test used to assert that the last two were DISABLED. They were, until they had a flow
  // field; both now have terrain, a Manning rating, land cover and an aerial drape, and render as
  // `reach` scenes. The assertion is inverted rather than deleted because "unfinished work looks
  // unfinished" is the guarantee worth keeping either way.
  //
  // `toBeDisabled()` is still not usable here: it resolves the ARIA disabled state, which
  // Playwright does not derive for <option>. The DOM property is what the browser honours.
  for (let i = 0; i < 4; i++) {
    await expect(options.nth(i)).toHaveJSProperty('disabled', false);
  }
});

test('a reach scene renders, with a discharge instead of a clock', async ({ page }) => {
  await enter(page, 'castelbolognese-2023');
  await expect(page.getByTestId('reach-view')).toBeVisible();
  await expect(page.getByTestId('reach-scene-canvas')).toHaveAttribute(
    'data-scene-ready',
    'true',
    { timeout: 90_000 }
  );

  // The control is a discharge, not a timeline — neither of these AOIs has a retrievable gauge
  // record, so a clock would be an invented hydrograph.
  await expect(page.getByTestId('reach-discharge')).toBeVisible();
  await expect(page.getByTestId('twin3d-timeline')).toHaveCount(0);

  // And it says so, in the badge and in the caption, because a steady state that never occurred
  // has to carry that with it into a screenshot.
  await expect(page.getByTestId('reach-scene-badge')).toBeVisible();
  const note = await page.getByTestId('reach-scene-note').innerText();
  expect(note).toMatch(/stationärer Abfluss|steady discharge/i);
  expect(note).toMatch(/keine Uhr|no clock/i);
});

test('choosing the corridor replaces the valley twin', async ({ page }) => {
  await enter(page);
  await expect(page.getByTestId('twin3d-canvas')).toBeVisible();

  await page.getByTestId('scene-switch').selectOption('steinbach-2021');

  // The valley twin is gone, not merely hidden behind an overlay.
  await expect(page.getByTestId('twin3d-canvas')).toHaveCount(0);
  await expect(page.getByTestId('corridor-view')).toBeVisible();
  await expect(page.getByTestId('steinbach-scene-canvas')).toBeVisible();
  // Still badged as a scenario that did not occur — the condition does not lapse because the
  // scene got promoted from a dialog to a map.
  await expect(page.getByTestId('steinbach-scene-badge')).toBeVisible();
});

test('the chosen scene survives a reload via the URL', async ({ page }) => {
  await enter(page);
  await page.getByTestId('scene-switch').selectOption('steinbach-2021');
  await expect(page).toHaveURL(/scene=steinbach-2021/);

  await page.reload();
  await page.getByTestId('remembrance-continue').click();
  await expect(page.getByTestId('corridor-view')).toBeVisible();
});

test('an unknown scene falls back rather than rendering nothing', async ({ page }) => {
  // ⚠️ hortasud used to be the unfinished case this covered. It is finished now, so the fallback
  // needs an id that genuinely does not exist — otherwise the test would pass by rendering a real
  // scene and prove nothing.
  await enter(page, 'faenza-2023');
  await expect(page.getByTestId('twin3d-canvas')).toBeVisible();
  await expect(page.getByTestId('scene-switch')).toHaveValue('ahrtal-2021');
});

test('the corridor camera can be flown to the dam', async ({ page }) => {
  await enter(page, 'steinbach-2021');
  const canvas = page.getByTestId('steinbach-scene-canvas');
  await expect(canvas).toHaveAttribute('data-scene-ready', 'true', { timeout: 30_000 });

  // The scene shipped with a fixed camera. Flying must actually move it, so compare a pixel
  // sample before and after rather than trusting that the click did something.
  const before = await canvas.screenshot();
  await page.getByTestId('steinbach-fly-dam').click();
  await page.waitForTimeout(3_500);
  const after = await canvas.screenshot();
  expect(Buffer.compare(before, after)).not.toBe(0);
});
