import { expect, test } from '@playwright/test';

/**
 * Smoke test against the deployed Fabric App. Skipped unless FLUT_DEPLOYED_URL is set, so the
 * normal `npm run test:e2e` stays offline and fast.
 *
 *   $env:FLUT_DEPLOYED_URL = 'https://<host>.webapp.fabricapps.net'; npx playwright test deployed
 *
 * The URL is not hard-coded: Rayfin issues a new host per project and it lives in the
 * (gitignored) rayfin/.deployments.json.
 */
const deployedUrl = process.env.FLUT_DEPLOYED_URL;

test.describe('deployed Fabric App', () => {
  test.skip(!deployedUrl, 'set FLUT_DEPLOYED_URL to run');

  test('serves the remembrance screen and reaches the shell', async ({ page }) => {
    await page.goto(deployedUrl!);

    await expect(page.getByTestId('remembrance-screen')).toBeVisible();
    await expect(page.getByTestId('disclaimer')).toContainText('Keine reale Risikobewertung');

    await page.getByTestId('remembrance-continue').click();
    await expect(page.getByTestId('twin-shell')).toBeVisible();
    await expect(page.getByTestId('attribution')).toContainText('LVermGeoRP');
  });
});
