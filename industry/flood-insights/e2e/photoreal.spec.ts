import { expect, test, type Page } from '@playwright/test';

import { hoverMap } from './drone-helpers';

/**
 * Photorealistic rendering — the high-resolution aerial windows.
 *
 * The claim this makes is a claim about SHARPNESS, so it is tested as one. Asserting that the
 * uniform was set, or that a request went out, or even that the picture changed, would all pass
 * with the tile blended in at the wrong place, upside down, or over the wrong village — this
 * project has shipped a north-south mirrored drape while every check it had stayed green.
 *
 * So there are three independent assertions here:
 *  - the right tile is requested (the URL names the village the camera flew to),
 *  - the picture gets measurably sharper (mean gradient across the canvas rises),
 *  - and nothing is fetched at all until the switch is on.
 *
 * Serial, like twin3d.spec.ts: every test builds a WebGL2 context over a ~97 MB scene, and the
 * detail tiles add a 4096 px texture on top.
 */
test.describe.configure({ mode: 'serial' });

/**
 * Mean absolute luminance gradient over the middle of the canvas, in levels per pixel.
 *
 * This is the measurement the feature exists to move: a sharper photograph has more energy at the
 * pixel scale. It is deliberately NOT a comparison against a stored reference image — the water
 * animates every frame, so any whole-frame comparison can prove that something changed and never
 * what. Gradient magnitude does not care that the water shimmered; it cares how much detail there
 * is per pixel.
 *
 * Sampled from the centre half, away from the panels, so a UI change cannot move it.
 */
async function detailEnergy(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="twin3d-canvas"]')!;
    const gl = canvas.getContext('webgl2')!;
    const { width, height } = canvas;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const x0 = Math.floor(width * 0.25);
    const x1 = Math.floor(width * 0.75);
    const y0 = Math.floor(height * 0.25);
    const y1 = Math.floor(height * 0.75);

    const luma = (x: number, y: number): number => {
      const i = (y * width + x) * 4;
      return 0.3 * pixels[i] + 0.59 * pixels[i + 1] + 0.11 * pixels[i + 2];
    };

    let total = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1 - 1; x++) {
        total += Math.abs(luma(x + 1, y) - luma(x, y));
        n++;
      }
    }
    return n ? total / n : 0;
  });
}

/** Let the scene settle: a tile has to arrive, decode and upload before it is on screen. */
async function settle(page: Page, ms = 2500): Promise<void> {
  await page.waitForTimeout(ms);
}

/**
 * Bring the camera down to roughly village height.
 *
 * ⚠️ Necessary, not incidental. The opening framing is 3.4 km up, where one screen pixel covers
 * about 3.3 m of ground — finer than the 2.878 m/px base drape, so at that distance a detail tile
 * cannot make anything sharper and measuring here would test nothing. A first version of this
 * spec did exactly that and reported a 14 % LOSS, which looked like a broken shader and was not.
 */
async function zoomToVillage(page: Page): Promise<void> {
  await hoverMap(page, 'twin3d-canvas');
  // Measured rather than estimated: from the opening 3.4 km these take the camera to about 510 m,
  // where the visible ground is ~740 m across. The window spans 1024 m, so it covers the view and
  // is the limiting factor — at 930 m it does not cover it yet and nothing loads, by design.
  for (let i = 0; i < 14; i++) await page.mouse.wheel(0, -420);
  await settle(page, 1500);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByTestId('remembrance-continue').click();
  await expect(page.getByTestId('twin3d-canvas')).toHaveAttribute('data-ready', 'true', {
    timeout: 60_000,
  });
});

test('the switch is offered, and off, and has downloaded nothing', async ({ page }) => {
  const toggle = page.getByTestId('twin3d-photoreal-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  // The whole point of the design: 154 MB of tiles exist on the server and a visitor who does not
  // ask for them pays nothing. A regression here would be invisible on screen and expensive.
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/drape_detail/')) requests.push(r.url());
  });
  await settle(page, 1500);
  expect(requests).toEqual([]);
});

test('switching it on fetches the window for the village in view, and only that one', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/drape_detail/')) requests.push(r.url());
  });

  // Fly somewhere named, so the expected tile is known rather than whatever the opening shot found,
  // and come down to where a window is the limiting factor — from 3.4 km nothing is fetched at all,
  // by design, because the base drape is already finer than the screen.
  await page.getByTestId('twin3d-place-dernau').click();
  await settle(page, 2000);
  await zoomToVillage(page);

  await page.getByTestId('twin3d-photoreal-toggle').click();
  await settle(page, 8000);

  expect(requests.length).toBeGreaterThan(0);
  // Every tile fetched must be Dernau's. One at a time is the memory budget the cache exists to
  // hold: two 4096 px textures resident is 134 MB of video memory on top of the building mesh.
  for (const url of requests) expect(url).toContain('dernau_');
  expect(new Set(requests).size).toBeLessThanOrEqual(2);

  // ⚠️ And the one that ARRIVED is the one on screen. Watching requests alone cannot tell a tile
  // that loaded from a tile that loaded and was then discarded by a newer one — which is exactly
  // what the cache's token guard exists to do when the camera moves during a fetch.
  await expect(page.getByTestId('twin3d-canvas')).toHaveAttribute('data-detail', /^dernau:/);
});

test('the picture actually gets sharper, which is the only claim being made', async ({ page }) => {
  await page.getByTestId('twin3d-place-dernau').click();
  await settle(page, 2000);
  await zoomToVillage(page);

  // Against the aerial photo alone, not against the cartographic palette — otherwise this would
  // measure "a photo has more detail than a tint", which was already true before any of this.
  await page.getByTestId('twin3d-drape-toggle').click();
  await settle(page, 1500);
  const base = await detailEnergy(page);

  await page.getByTestId('twin3d-photoreal-toggle').click();
  await settle(page, 8000);
  const sharp = await detailEnergy(page);

  // At this range a screen pixel covers ~0.7 m and the base drape is 2.878 m/px, so the window is
  // the limiting factor by a factor of four. Measured on a settled camera: **1.44x**. Asserting a
  // healthy margin rather than "greater than" keeps a tile that silently failed to load from
  // passing on frame noise.
  expect(sharp).toBeGreaterThan(base * 1.15);
});

test('it moves the layers it is made of, so no switch says the wrong thing', async ({ page }) => {
  const photoreal = page.getByTestId('twin3d-photoreal-toggle');
  const drape = page.getByTestId('twin3d-drape-toggle');
  const landuse = page.getByTestId('twin3d-landuse-toggle');

  await expect(landuse).toHaveAttribute('aria-pressed', 'true');

  await photoreal.click();
  await expect(photoreal).toHaveAttribute('aria-pressed', 'true');
  await expect(drape).toHaveAttribute('aria-pressed', 'true');
  await expect(landuse).toHaveAttribute('aria-pressed', 'false');

  await photoreal.click();
  await expect(drape).toHaveAttribute('aria-pressed', 'false');
  await expect(landuse).toHaveAttribute('aria-pressed', 'true');
});

test('turning the photograph off takes the mode with it', async ({ page }) => {
  const photoreal = page.getByTestId('twin3d-photoreal-toggle');
  const drape = page.getByTestId('twin3d-drape-toggle');

  await photoreal.click();
  await expect(drape).toHaveAttribute('aria-pressed', 'true');

  // Photorealistic rendering is made OF the photograph. Left out of step, the detail tiles would
  // keep loading megabytes for a surface that is not being drawn.
  await drape.click();
  await expect(drape).toHaveAttribute('aria-pressed', 'false');
  await expect(photoreal).toHaveAttribute('aria-pressed', 'false');
});

test('the caveat says the photograph is current, not 2021', async ({ page }) => {
  const notice = page.getByTestId('twin3d-model-notice');
  await expect(notice).not.toContainText('Fotorealistisch:');

  await page.getByTestId('twin3d-photoreal-toggle').click();
  // PLAN §2.2 rule 3: the caveat travels with the picture. At 25 cm the rebuilt houses are
  // individually legible, so "this is not July 2021" stops being a footnote and starts being the
  // difference between a record and a photograph of somewhere that has since been repaired.
  await expect(notice).toContainText('nicht von 2021');
  await expect(notice).toContainText('Kennzahlen bleiben unber\u00fchrt');
});
