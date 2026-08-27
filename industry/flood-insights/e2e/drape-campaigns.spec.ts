import { expect, test, type Page } from '@playwright/test';

/**
 * The per-flight exposure match.
 *
 * The Ahr's orthophoto is a mosaic of two 2023 campaigns that meet at a tile column just west of
 * Altenahr, and they disagree by 20 % in brightness. On the cartographic surface that was
 * invisible; once the photograph became the whole surface it read as two datasets, which is how it
 * was reported.
 *
 * The correction is an exponent per campaign, measured offline and composed with the AOI-wide one.
 * Two things have to be true and neither is visible in a single screenshot:
 *
 *   * the REFERENCE campaign is untouched - the whole point of choosing one is that its pixels are
 *     left exactly as the survey delivered them;
 *   * the other campaign, and only it, is lifted.
 *
 * So this renders the same view twice, once with the correction blocked at the network, and diffs
 * the two frames column by column. A working correction shows up as a step: flat to one side,
 * lifted to the other. Asserting on one frame could not tell that from a global exposure change.
 */
test.describe.configure({ mode: 'serial' });

/** Mean luma per column over the band of the frame that is terrain rather than sky or panel. */
async function columnProfile(page: Page, blocked: boolean): Promise<number[]> {
  if (blocked) await page.route('**/drape_campaigns.json', (route) => route.abort());
  else await page.unroute('**/drape_campaigns.json');

  await page.goto('/');
  await page.getByTestId('remembrance-continue').click();
  await expect(page.getByTestId('twin3d-canvas')).toHaveAttribute('data-ready', 'true', {
    timeout: 60_000,
  });

  // Mayschoss frames the campaign boundary 377 m to its east, so both flights are on screen.
  await page.getByTestId('twin3d-place-mayschoss').click();
  await page.waitForTimeout(2500);

  // Dry ground and the bare photograph: the flood and the land-cover tint would each swamp a 20 %
  // exposure step. React owns the scrubber, so it is set through the native setter.
  await page.evaluate(() => {
    const slider = document.querySelector<HTMLInputElement>('[data-testid="twin3d-scrubber"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(slider, '-720');
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByTestId('twin3d-drape-toggle').click();
  await page.getByTestId('twin3d-landuse-toggle').click();
  await page.getByTestId('twin3d-trees-toggle').click();
  await page.waitForTimeout(3000);

  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="twin3d-canvas"]')!;
    const gl = canvas.getContext('webgl2')!;
    const { width, height } = canvas;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const columns: number[] = [];
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let n = 0;
      for (let y = Math.floor(height * 0.35); y < Math.floor(height * 0.75); y++) {
        const i = (y * width + x) * 4;
        sum += 0.3 * pixels[i] + 0.59 * pixels[i + 1] + 0.11 * pixels[i + 2];
        n++;
      }
      columns.push(sum / n);
    }
    return columns;
  });
}

test('the two flights are matched, and the reference one is left alone', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const uncorrected = await columnProfile(page, true);
  const corrected = await columnProfile(page, false);
  expect(corrected.length).toBe(uncorrected.length);

  const change = corrected.map((v, i) => v - uncorrected[i]);
  const width = change.length;

  // Where the correction starts biting. A run of 20 columns keeps a single noisy column from
  // being mistaken for the boundary.
  let boundary = -1;
  for (let x = 0; x < width - 20; x++) {
    if (change.slice(x, x + 20).every((d) => d > 1)) {
      boundary = x;
      break;
    }
  }
  expect(boundary, 'no boundary found — the correction reached nothing').toBeGreaterThan(0);
  expect(boundary, 'the boundary should be on screen, not at its very edge').toBeLessThan(
    width - 40
  );

  const west = change.slice(0, boundary);
  const east = change.slice(boundary);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / (a.length || 1);

  // The reference flight is untouched. Measured at 0.02 levels mean and 1.03 peak, which is
  // rounding; anything approaching the size of the correction itself would mean the reference is
  // being adjusted too, and then there is no anchor.
  expect(Math.max(...west.map(Math.abs))).toBeLessThan(3);
  // ...and the other flight is genuinely lifted. Measured at 9.5 levels.
  expect(mean(east)).toBeGreaterThan(4);
});
