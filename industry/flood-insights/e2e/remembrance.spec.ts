import { expect, test } from '@playwright/test';

import { FATALITIES_RLP } from '../src/data/facts';

/**
 * Phase 0 gate (PLAN §12): the app is live and cannot be entered without passing the
 * remembrance screen. These tests encode the §2 and §9.0 rules so a later refactor cannot
 * quietly break them.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('opens on the remembrance screen, not on the twin', async ({ page }) => {
  await expect(page.getByTestId('remembrance-screen')).toBeVisible();
  await expect(page.getByTestId('twin-shell')).toHaveCount(0);
});

test('the opening screen fits on one page, in both languages', async ({ page }) => {
  // It is the first thing anyone sees and it is a page about a disaster — having to scroll it
  // to reach "Weiter" reads as an oversight. It used to overflow at every size measured,
  // including 1080p, because the inline citations wrapped so hard that one sentence ran to six
  // lines. 600 px covers the Fabric App frame, which is shorter than the browser window.
  const sizes = [
    { width: 1436, height: 600 },
    { width: 1436, height: 650 },
    { width: 1366, height: 768 },
    { width: 1280, height: 800 },
    { width: 1024, height: 700 },
    { width: 1920, height: 1080 },
  ];

  for (const locale of ['de', 'en'] as const) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId(`lang-${locale}`).click();

    for (const size of sizes) {
      await page.setViewportSize(size);
      await expect(page.getByTestId('remembrance-continue')).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollHeight - window.innerHeight
      );
      expect(
        overflow,
        `${locale} at ${size.width}x${size.height} overflows by ${overflow} px`
      ).toBeLessThanOrEqual(0);
    }
  }
});

test('the disclaimer is shown before the narrative', async ({ page }) => {
  const disclaimer = page.getByTestId('disclaimer');
  await expect(disclaimer).toBeVisible();
  await expect(disclaimer).toContainText('Keine reale Risikobewertung');

  // §9.0 — disclaimer precedes the fatalities sentence in the document, not just visually.
  const order = await page.evaluate(() => {
    const d = document.querySelector('[data-testid="disclaimer"]')!;
    const f = document.querySelector('[data-testid="fatalities-sentence"]')!;
    return d.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING ? 'before' : 'after';
  });
  expect(order).toBe('before');
});

test('the remembrance screen does not skip on a timer', async ({ page }) => {
  await page.waitForTimeout(3000);
  await expect(page.getByTestId('remembrance-screen')).toBeVisible();
  await expect(page.getByTestId('twin-shell')).toHaveCount(0);
});

test('continuing reaches the twin shell', async ({ page }) => {
  await page.getByTestId('remembrance-continue').click();
  await expect(page.getByTestId('twin-shell')).toBeVisible();
  await expect(page.getByTestId('remembrance-screen')).toHaveCount(0);
});

test('German copy uses real umlauts, never ae/oe/ue/ss', async ({ page }) => {
  const text = await page.getByTestId('remembrance-screen').innerText();
  expect(text).toContain('ä');
  // Catches the common ASCII-fold regressions in this specific copy.
  expect(text).not.toMatch(/Schulungszweck fuer|Gebaeude|muesste|grosse/);
});

test('the death toll is never shown without a citation marker', async ({ page }) => {
  // Facts are unsourced until Phase 1 lands the official reports (PLAN §4.8), so the figure must
  // currently render as a visible defect. Once sourced, it renders as a citation instead.
  const unsourced = page.getByTestId('unsourced-figure');
  const sourced = page.getByTestId('sourced-figure');
  const total = (await unsourced.count()) + (await sourced.count());
  expect(total).toBeGreaterThan(0);
});

test('the death toll appears exactly once in the app', async ({ page }) => {
  // PLAN §2.2 rule 1.
  //
  // The number is imported rather than written here. It was hard-coded as 134 and went stale the
  // moment the figure was corrected against the inquiry's report, which is precisely the drift
  // this rule exists to catch.
  const toll = String(FATALITIES_RLP.value);
  const onRemembrance = (await page.getByTestId('remembrance-screen').innerText()).match(
    new RegExp(toll, 'g')
  );
  expect(onRemembrance).toHaveLength(1);

  await page.getByTestId('remembrance-continue').click();
  await expect(page.getByTestId('twin-shell')).toBeVisible();
  expect(await page.getByTestId('twin-shell').innerText()).not.toContain(toll);
});

test('sourced figures carry a visible citation', async ({ page }) => {
  const sourced = page.getByTestId('sourced-figure');
  await expect(sourced.first()).toBeVisible();
  await expect(sourced.first()).toContainText('Quelle:');
  await expect(sourced.first()).toContainText('Landesamt für Umwelt');
});

test('the reconstructed peak is shown as a range, never a single number', async ({ page }) => {
  // PLAN §4.8: the LfU itself states only a range can be given for the 2021 peak, because the
  // reconstruction approaches differ. Showing "1230 m³/s" alone would overstate what is known.
  const peak = page.getByTestId('peak-discharge');
  await expect(peak).toContainText('800');
  await expect(peak).toContainText('1.230');
  await expect(peak).toContainText('rekonstruiert');
});

test('the language switch changes the copy', async ({ page }) => {
  await page.getByTestId('lang-en').click();
  await expect(page.getByTestId('disclaimer')).toContainText('Demonstration and training');
  await page.getByTestId('lang-de').click();
  await expect(page.getByTestId('disclaimer')).toContainText('Schulungszweck');
});

// The switch used to exist only on the opener, so a visitor who continued in German was stuck in
// German. It has to be reachable after entering the twin, and it has to still work there.
test('the language switch stays reachable inside the twin', async ({ page }) => {
  await page.getByTestId('remembrance-continue').click();
  await expect(page.getByTestId('twin-shell')).toBeVisible();

  const toggle = page.getByTestId('language-toggle');
  await expect(toggle).toBeVisible();
  await expect(page.getByTestId('lang-de')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('lang-en').click();
  await expect(page.getByTestId('lang-en')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('attribution')).toContainText('Demonstration and training');

  // The play button only exists once the scene does — the timeline panel is hidden while the
  // ~47 MB load runs, so this has to wait for the canvas rather than assume the controls are up.
  await expect(page.getByTestId('twin3d-canvas')).toHaveAttribute('data-ready', 'true', {
    timeout: 120_000,
  });
  await expect(page.getByTestId('twin3d-play')).toHaveAttribute('aria-label', 'Play the sequence');
});

test('the twin shell carries the attribution register', async ({ page }) => {
  await page.getByTestId('remembrance-continue').click();
  const footer = page.getByTestId('attribution');
  await expect(footer).toContainText('LVermGeoRP');
  await expect(footer).toContainText('Copernicus');
  await expect(footer).toContainText('OpenStreetMap');
});
