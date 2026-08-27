import { expect, test, type Page } from '@playwright/test';

/**
 * The validation explainer (PLAN §6.5).
 *
 * The panel on the map reports a number that misses its target. These tests defend the part that
 * makes that useful rather than merely honest: that the overlay says what to trust, quantifies how
 * much the error matters, and never quietly softens it.
 */

async function openExplainer(page: Page) {
  await page.getByTestId('validation-explain').click();
  await expect(page.getByTestId('validation-explainer')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page.getByTestId('remembrance-continue').click();
  // The right-hand rail only mounts once the scene is up, and under two workers on one GPU that
  // takes longer than a default expect timeout. Wait on the canvas, not on a fixed delay.
  await expect(page.getByTestId('twin3d-canvas')).toHaveAttribute('data-ready', 'true', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('validation-panel')).toBeVisible();
});

test('the number can be asked what it means', async ({ page }) => {
  await openExplainer(page);
  await expect(page.getByTestId('validation-tldr')).toBeVisible();
  await expect(page.getByTestId('validation-explainer')).toContainText('Was die Validierung');
});

test('the overlay covers the viewport rather than the panel that opened it', async ({ page }) => {
  // Regression guard. The validation panel sits inside a `backdrop-blur` container, and a
  // backdrop-filter makes an ancestor the containing block for `position: fixed` — so the first
  // version rendered as a clipped sliver inside an 18 rem rail. It is portalled to <body> now.
  await openExplainer(page);
  const box = await page.getByTestId('validation-explainer').boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(viewport.width * 0.9);
  expect(box!.height).toBeGreaterThan(viewport.height * 0.9);
});

test('the summary leads with what the model gets right, then what it gets wrong', async ({
  page,
}) => {
  await openExplainer(page);
  const tldr = await page.getByTestId('validation-tldr').innerText();

  // Hit rate first — the model misses almost nothing.
  expect(tldr).toMatch(/88,6 %/);
  // Then the real failure, in area rather than only as a ratio.
  expect(tldr).toMatch(/2,37 km²/);
  // And the usable conclusion.
  expect(tldr).toMatch(/Obergrenzen/);
});

test('it states the practical consequence for every extent-derived figure', async ({ page }) => {
  await openExplainer(page);
  const text = await page.getByTestId('validation-upper-bound').innerText();
  expect(text).toMatch(/Obergrenzen/);
  expect(text).toMatch(/betroffene Gebäude/);
});

test('it does not soften the error into a shallow rim', async ({ page }) => {
  // The comforting version of this story — "the model just paints a thin wet fringe" — is false.
  // The median depth of the disagreement is well over a metre, and the copy has to keep saying so.
  await openExplainer(page);
  const text = await page.getByTestId('validation-explainer').innerText();
  expect(text).toMatch(/1,65 m/);
  expect(text).toMatch(/kein dünner Saum/);
});

test('all four rejected fixes are shown, including the two that made it worse', async ({ page }) => {
  await openExplainer(page);
  const rows = page.getByTestId('validation-probes').locator('tbody tr');
  await expect(rows).toHaveCount(4);

  const table = await page.getByTestId('validation-probes').innerText();
  expect(table).toMatch(/Scheitelabfluss/);
  expect(table).toMatch(/Manning/);
  expect(table).toMatch(/Bebauung/);
  expect(table).toMatch(/Mindesttiefe/);
  // Every IoU quoted to the same precision, so 0.50 does not read as a different measurement.
  expect(table).toMatch(/0,51 → 0,50/);
});

test('it keeps the honesty statement and closes cleanly', async ({ page }) => {
  await openExplainer(page);
  const honesty = await page.getByTestId('validation-explainer-honesty').innerText();
  expect(honesty).toMatch(/0,51/);
  expect(honesty).toMatch(/0,70/);
  expect(honesty).toMatch(/nachjustiert/);

  await page.getByTestId('validation-explainer-close').click();
  await expect(page.getByTestId('validation-explainer')).toHaveCount(0);
});

test('it reads in English too', async ({ page }) => {
  await page.getByTestId('lang-en').click();
  await openExplainer(page);
  const text = await page.getByTestId('validation-explainer').innerText();
  expect(text).toMatch(/What the validation means/);
  expect(text).toMatch(/upper bound/);
});
