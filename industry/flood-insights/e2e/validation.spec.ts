import { expect, test } from '@playwright/test';

/**
 * PLAN §6.5 — the validation panel.
 *
 * The point of these tests is that the app must keep telling the truth about its own accuracy.
 * The simulation currently scores below its target, and the UI is required to say so rather than
 * hide the metric or dress it up (§2.3, no precision theatre).
 */
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByTestId('remembrance-continue').click();
  await expect(page.getByTestId('twin3d-canvas')).toHaveAttribute('data-ready', 'true', {
    timeout: 60_000,
  });
});

test('the validation metric is shown, not hidden', async ({ page }) => {
  const panel = page.getByTestId('validation-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('validation-iou')).toContainText('IoU');
});

test('a missed target is stated plainly', async ({ page }) => {
  const iouText = await page.getByTestId('validation-iou').innerText();
  const iou = Number(iouText.replace('IoU', '').trim().replace(',', '.'));
  expect(Number.isFinite(iou)).toBe(true);

  const verdict = page.getByTestId('validation-verdict');
  if (iou < 0.7) {
    // The wording must acknowledge the miss rather than soften it away.
    await expect(verdict).toContainText('nicht erreicht');
  } else {
    await expect(verdict).toContainText('erreicht');
  }
});

test('the caveats that bound the number travel with it', async ({ page }) => {
  await page.getByTestId('validation-toggle').click();
  const caveats = page.getByTestId('validation-caveats');
  await expect(caveats).toBeVisible();
  // The two that materially limit what the IoU means (PLAN §4.1 and §6.5).
  await expect(caveats).toContainText('2024/2025');
  await expect(caveats).toContainText('Flood trace');
  await expect(page.getByTestId('validation-detail')).toContainText('Copernicus');
});
