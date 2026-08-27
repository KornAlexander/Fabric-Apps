import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 4 — the 3D flood twin.
 *
 * The water is the product, so these tests assert on actual rendered pixels rather than on DOM
 * state. The renderer keeps its drawing buffer (see scene.ts) specifically so `readPixels` works
 * here; without that every sample comes back as zeroes.
 *
 * Serial on purpose: each test creates a WebGL2 context and loads a 14 MB heightmap. Run in
 * parallel, Chromium starts refusing contexts and `getContext('webgl2')` returns null, which shows
 * up as unrelated-looking failures.
 */
test.describe.configure({ mode: 'serial' });

/**
 * Share of the canvas that has darkened since the dry frame, as a percentage.
 *
 * The first call in a test captures the baseline and returns 0.
 */
async function floodedPercent(page: Page, tMinutes: number): Promise<number> {
  return page.evaluate(async (minutes) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="twin3d-canvas"]')!;
    const slider = document.querySelector<HTMLInputElement>('[data-testid="twin3d-scrubber"]')!;

    // React owns the input's value, so set it through the native setter and fire a real event.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )!.set!;
    setter.call(slider, String(minutes));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 700));

    const gl = canvas.getContext('webgl2')!;
    const { width, height } = canvas;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const store = window as unknown as { __dryFrame?: Float32Array };
    const luminance = new Float32Array(width * height);
    for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
      luminance[p] = 0.3 * pixels[i] + 0.59 * pixels[i + 1] + 0.11 * pixels[i + 2];
    }

    // Capture the dry frame the first time, then measure every later frame against it.
    //
    // This used to classify pixels by absolute colour — "turbid brown" meant red leading the other
    // channels. That test broke every time the scene got more realistic, because sunlit canopy is
    // reddish and vineyards are literally ochre, so more and more dry ground matched the water
    // rule. Measuring the difference from the dry frame instead is immune to the palette: the
    // camera has not moved and nothing else in the scene animates, so the only thing that can
    // darken a pixel between two points on the timeline is water arriving on it.
    if (!store.__dryFrame) {
      store.__dryFrame = luminance;
      return 0;
    }

    const dry = store.__dryFrame;
    let darkened = 0;
    for (let p = 0; p < luminance.length; p++) {
      if (dry[p] - luminance[p] > 20) darkened++;
    }
    return (darkened / (width * height)) * 100;
  }, tMinutes);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByTestId('remembrance-continue').click();
  await expect(page.getByTestId('twin3d-canvas')).toHaveAttribute('data-ready', 'true', {
    timeout: 60_000,
  });
});

test('the twin renders and reports no load error', async ({ page }) => {
  await expect(page.getByTestId('twin3d-error')).toHaveCount(0);
  await expect(page.getByTestId('twin3d-view')).toBeVisible();
});

test('the flood rises to a peak and then recedes', async ({ page }) => {
  // The first call establishes the dry frame; everything after is measured against it.
  await floodedPercent(page, -720);
  const stillDry = await floodedPercent(page, -690);
  const peak = await floodedPercent(page, 0);
  const later = await floodedPercent(page, 1440);

  // Before the event there is a river, not a flood: half an hour on, almost nothing has changed.
  expect(stillDry).toBeLessThan(1.5);
  // At the peak a materially larger area is under water.
  expect(peak).toBeGreaterThan(stillDry * 3);
  expect(peak).toBeGreaterThan(2);
  // A day later it has fallen back, without returning all the way to base flow.
  expect(later).toBeLessThan(peak);
  expect(later).toBeGreaterThan(stillDry);
});

test('the clock and discharge follow the scrubber', async ({ page }) => {
  await page.getByTestId('twin3d-scrubber').fill('0');
  await expect(page.getByTestId('twin3d-clock')).toContainText('14.07., 22:00');

  const discharge = await page.getByTestId('twin3d-discharge').innerText();
  // German thousands separator is a dot, so strip it before parsing.
  const match = discharge.match(/([\d.]+)\s*m³\/s/);
  expect(match).not.toBeNull();
  const value = Number(match![1].replace(/\./g, ''));
  // The peak must sit inside the officially sourced range of 800–1230 m³/s (PLAN §4.4).
  expect(value).toBeGreaterThanOrEqual(800);
  expect(value).toBeLessThanOrEqual(1230);
  await expect(page.getByTestId('twin3d-discharge')).toContainText('HQ100');
});

test('the timeline plays, pauses, and yields to the scrubber', async ({ page }) => {
  const play = page.getByTestId('twin3d-play');
  const clock = page.getByTestId('twin3d-clock');

  await page.getByTestId('twin3d-scrubber').fill('-720');
  const before = await clock.innerText();

  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  // Polled rather than given a fixed span. The clock only advances when requestAnimationFrame
  // fires, and in a full-suite run two GPU-heavy contexts share one card, so frames can arrive far
  // apart — a flat 1.2 s wait passed alone and failed intermittently alongside the other specs.
  await expect.poll(async () => clock.innerText(), { timeout: 30_000 }).not.toBe(before);
  const running = await clock.innerText();
  expect(running).not.toBe(before);

  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  const paused = await clock.innerText();
  await page.waitForTimeout(700);
  expect(await clock.innerText()).toBe(paused);

  // Taking hold of the scrubber has to win over playback, not fight it.
  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('twin3d-scrubber').fill('0');
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  await expect(clock).toContainText('14.07., 22:00');
});

test('playback stops at the end of the record instead of looping', async ({ page }) => {
  // The flood was not a loop. Running it back round to the beginning would make it one (§2.3).
  const play = page.getByTestId('twin3d-play');
  await page.getByTestId('twin3d-scrubber').fill('1425');

  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'false', { timeout: 10_000 });
  await expect(page.getByTestId('twin3d-clock')).toContainText('15.07., 22:00');
});

/**
 * Capture the canvas into a browser-side slot, or compare it against one already captured.
 *
 * The pixels stay in the page on purpose. Returning a 1280x800 frame to the test process means
 * serialising three million numbers over CDP, which cost more than a minute across the suite;
 * doing the comparison in the browser and returning one number is effectively free.
 */
async function frameDelta(page: Page, slot: string, threshold = 24): Promise<number> {
  return page.evaluate(
    ({ slot, threshold }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="twin3d-canvas"]')!;
      const gl = canvas.getContext('webgl2')!;
      const { width, height } = canvas;
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      const store = (window as unknown as { __frames?: Record<string, Uint8Array> }).__frames ?? {};
      (window as unknown as { __frames: Record<string, Uint8Array> }).__frames = store;

      const previous = store[slot];
      if (!previous) {
        store[slot] = pixels;
        return -1;
      }

      let changed = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const d =
          Math.abs(pixels[i] - previous[i]) +
          Math.abs(pixels[i + 1] - previous[i + 1]) +
          Math.abs(pixels[i + 2] - previous[i + 2]);
        if (d > threshold) changed++;
      }
      return (changed / (width * height)) * 100;
    },
    { slot, threshold }
  );
}

/** Share of the canvas that is bright enough to be lit ground rather than sky. */
async function litPercent(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="twin3d-canvas"]')!;
    const gl = canvas.getContext('webgl2')!;
    const { width, height } = canvas;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let lit = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 90) lit++;
    }
    return (lit / (width * height)) * 100;
  });
}

test('the vegetation is drawn, and can be switched off', async ({ page }) => {
  // The trees come from the surface model, so this checks rendered pixels rather than DOM state.
  //
  // It compares frames rather than counting green, because the ground is now tinted by land cover
  // and forest tint is also green: an absolute green count would stay high even if the tree layer
  // silently failed to load. Toggling with the camera held still isolates the trees exactly.
  const toggle = page.getByTestId('twin3d-trees-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(700);
  expect(await frameDelta(page, 'trees')).toBe(-1);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(700);
  // Nearly 400,000 trees cover a lot of hillside; if the layer is missing this collapses to noise.
  expect(await frameDelta(page, 'trees')).toBeGreaterThan(5);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(700);
  expect(await frameDelta(page, 'trees')).toBeLessThan(1);
});

test('the land cover is drawn, and can be switched off', async ({ page }) => {
  // Land cover is colour only, so the check is that it changes the surface and nothing else: the
  // terrain must still be there with the tint off, just shaded by elevation alone.
  const toggle = page.getByTestId('twin3d-landuse-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(700);
  const litTinted = await litPercent(page);
  expect(await frameDelta(page, 'cover', 20)).toBe(-1);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(700);

  // Most of the AOI is mapped, so most of the visible ground should change colour.
  expect(await frameDelta(page, 'cover', 20)).toBeGreaterThan(20);
  // ...but the landform itself must survive: roughly as much ground is lit either way.
  const litPlain = await litPercent(page);
  expect(Math.abs(litTinted - litPlain) / litPlain).toBeLessThan(0.1);
});

test('both measured crown forms are drawn', async ({ page }) => {
  // Crown form comes out of the surface model, so a build that lost it would still render a wood
  // — just one made entirely of the same tree. Check the layer actually carries both.
  const forms = await page.evaluate(async () => {
    const meta = await (await fetch('/terrain/ahrtal-2021/vegetation.json')).json();
    const buffer = await (await fetch('/terrain/ahrtal-2021/vegetation.bin')).arrayBuffer();
    const view = new DataView(buffer);
    const count = Math.min(meta.count, Math.floor(buffer.byteLength / meta.stride));
    const cut = (meta.coniferShapeMax ?? 0.62) * 255;
    let conifer = 0;
    for (let i = 0; i < count; i++) {
      if (view.getUint8(i * meta.stride + 8) < cut) conifer++;
    }
    return { stride: meta.stride, count, coniferShare: conifer / count };
  });

  expect(forms.stride).toBeGreaterThanOrEqual(9);
  // Neither form may vanish: a wood of one shape means the measurement stopped discriminating.
  expect(forms.coniferShare).toBeGreaterThan(0.05);
  expect(forms.coniferShare).toBeLessThan(0.6);
});

test('the model notice is always visible and says the depth is simulated', async ({ page }) => {
  // PLAN §2.2 rule 3 and §2.3: never "Haus zerstört", always "simulierte Wassertiefe", and the
  // post-flood terrain caveat travels with the picture.
  const notice = page.getByTestId('twin3d-model-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Simulierte Wassertiefe');
  await expect(notice).toContainText('keine Messung');
  await expect(notice).toContainText('2024/2025');
});

test('the terrain is drawn at true scale, and says so', async ({ page }) => {
  // The default has to be undistorted: the whole argument of this app is that its numbers are
  // real, and a stretched landform is a claim the survey does not make.
  const toggle = page.getByTestId('twin3d-exaggeration-toggle');
  const notice = page.getByTestId('twin3d-model-notice');

  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(notice).toContainText('unverzerrt');
  await expect(notice).not.toContainText('1,5-fach');

  await page.waitForTimeout(700);
  expect(await frameDelta(page, 'scale')).toBe(-1);

  // Turning it on must actually move the geometry, and must say so.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(notice).toContainText('1,5-fach überhöht');
  await page.waitForTimeout(900);
  expect(await frameDelta(page, 'scale')).toBeGreaterThan(5);

  await toggle.click();
  await expect(notice).toContainText('unverzerrt');
  await page.waitForTimeout(900);
  expect(await frameDelta(page, 'scale')).toBeLessThan(2);
});

test('the timeline panel collapses to the play axis, keeping the caveat', async ({ page }) => {
  const toggle = page.getByTestId('twin3d-timeline-toggle');
  const notice = page.getByTestId('twin3d-model-notice');

  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('twin3d-layers')).toBeVisible();
  await expect(page.getByTestId('twin3d-places')).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // What remains is the axis itself: clock, play, scrubber.
  await expect(page.getByTestId('twin3d-clock')).toBeVisible();
  await expect(page.getByTestId('twin3d-play')).toBeVisible();
  await expect(page.getByTestId('twin3d-scrubber')).toBeVisible();

  // The secondary controls in the panel are gone. The village rail is NOT: it folds on its own
  // control now, because where you are and when you are looking are different questions.
  await expect(page.getByTestId('twin3d-layers')).toBeHidden();
  await expect(page.getByTestId('twin3d-places')).toBeVisible();
  await expect(page.getByTestId('twin3d-discharge')).toHaveCount(0);

  // ...but the caveat never goes away, only shortens. PLAN §2.2 rule 3.
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Simulierte Wassertiefe');
  await expect(notice).toContainText('keine Messung');

  // The axis still works while collapsed.
  await page.getByTestId('twin3d-scrubber').fill('0');
  await expect(page.getByTestId('twin3d-clock')).toContainText('14.07., 22:00');

  await toggle.click();
  await expect(page.getByTestId('twin3d-layers')).toBeVisible();
  await expect(page.getByTestId('twin3d-places')).toBeVisible();
  await expect(notice).toContainText('2024/2025');
});

test('switching focus village changes the view', async ({ page }) => {
  const target = page.getByTestId('twin3d-place-ahrweiler');
  await expect(target).toBeVisible();

  const before = await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 600 } });
  await target.click();
  await page.waitForTimeout(700);
  const after = await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 600 } });
  expect(Buffer.compare(before, after)).not.toBe(0);
  await expect(target).toHaveAttribute('aria-pressed', 'true');
});

test('the map can be orbited and zoomed', async ({ page }) => {
  const canvas = page.getByTestId('twin3d-canvas');
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const initial = await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 560 } });

  // Left-drag orbits.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(cx + step * 20, cy + step * 5);
  }
  await page.mouse.up();
  await page.waitForTimeout(700);
  const orbited = await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 560 } });
  expect(Buffer.compare(initial, orbited)).not.toBe(0);

  // Wheel zooms.
  await page.mouse.move(cx, cy);
  for (let step = 0; step < 5; step++) {
    await page.mouse.wheel(0, -240);
  }
  await page.waitForTimeout(700);
  const zoomed = await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 560 } });
  expect(Buffer.compare(orbited, zoomed)).not.toBe(0);
});

test('the camera cannot drop below the terrain', async ({ page }) => {
  // maxPolarAngle stops just short of the horizon. Going under the surface and looking up through
  // it reads as a rendering fault rather than a viewpoint.
  const canvas = page.getByTestId('twin3d-canvas');
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Dragging DOWNWARD is what raises the polar angle towards the horizon and, unclamped, past it.
  // Kept to a handful of moves: every move forces a render of a 14 MB scene, and sixty of them
  // blew the test timeout without testing anything extra — OrbitControls clamps on the total
  // rotation, not on the number of events.
  await page.mouse.move(cx, cy - 200);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(cx, cy - 200 + step * 90);
  }
  await page.mouse.up();
  await page.waitForTimeout(700);

  const skyShare = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid="twin3d-canvas"]')!;
    const gl = c.getContext('webgl2')!;
    const pixels = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    // The clear colour is stone-100 (245,245,244); terrain is materially darker.
    let sky = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 240 && pixels[i + 1] > 240 && pixels[i + 2] > 238) sky++;
    }
    return sky / (c.width * c.height);
  });

  // Some background above the horizon is expected; a view from underneath would be nearly all
  // background or nearly all terrain with no horizon at all.
  expect(skyShare).toBeLessThan(0.9);
});

/** Move a range input the way a user would: React owns the value, so go through the native setter. */
async function setRange(page: Page, testid: string, value: number): Promise<void> {
  await page.evaluate(
    ({ id, next }) => {
      const slider = document.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)!;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )!.set!;
      setter.call(slider, String(next));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    },
    { id: testid, next: value }
  );
}

/** Move the scrubber to a given minute, the way a user would. */
async function setMinutes(page: Page, tMinutes: number): Promise<void> {
  await setRange(page, 'twin3d-scrubber', tMinutes);
  await page.waitForTimeout(700);
}

/** Where the clock currently stands, read off the scrubber. */
async function currentMinutes(page: Page): Promise<number> {
  return Number(await page.getByTestId('twin3d-scrubber').inputValue());
}

/**
 * Share of the canvas carrying a hazard tint, split by class.
 *
 * Classified by the ratio between channels rather than by absolute colour: the shader multiplies
 * each class by the hillshade, so brightness swings enormously across a slope while the hue does
 * not. Matching on RGB values directly finds almost nothing on a shaded hillside.
 */
async function hazardShares(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="twin3d-canvas"]')!;
    const gl = canvas.getContext('webgl2')!;
    const { width, height } = canvas;
    const px = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);

    const out = { gk4: 0, gk3: 0, gk2: 0, gk1: 0, untinted: 0 };
    const total = width * height;
    for (let i = 0; i < total; i++) {
      const r = px[i * 4] / 255;
      const g = px[i * 4 + 1] / 255;
      const b = px[i * 4 + 2] / 255;
      if (Math.max(r, g, b) < 0.04 || b / Math.max(r, 1e-4) > 0.72) out.untinted++;
      else if (g / Math.max(r, 1e-4) < 0.42) out.gk4++;
      else if (g / Math.max(r, 1e-4) < 0.62) out.gk3++;
      else if (g / Math.max(r, 1e-4) < 0.85) out.gk2++;
      else out.gk1++;
    }
    return {
      gk4: (out.gk4 / total) * 100,
      gk3: (out.gk3 / total) * 100,
      gk2: (out.gk2 / total) * 100,
      gk1: (out.gk1 / total) * 100,
      untinted: (out.untinted / total) * 100,
    };
  });
}

test('the speed control actually changes how fast the clock runs', async ({ page }) => {
  // Measured rather than trusted: a speed control that only relabels itself looks identical from
  // the outside. Each run plays for a fixed wall-clock interval and the simulated minutes covered
  // are compared, so the assertion is on the thing the control is supposed to do.
  const playFor = async (speedIndex: number, ms: number): Promise<number> => {
    await setMinutes(page, -720);
    await setRange(page, 'twin3d-speed', speedIndex);
    const from = await currentMinutes(page);
    await page.getByTestId('twin3d-play').click();
    await page.waitForTimeout(ms);
    await page.getByTestId('twin3d-play').click();
    return (await currentMinutes(page)) - from;
  };

  const slow = await playFor(0, 1500); // 0.25x
  const fast = await playFor(4, 1500); // 4x

  expect(slow).toBeGreaterThan(0);
  // Nominally sixteen times apart. The tolerance is wide because frame delivery under a headless
  // renderer is not metronomic, but the two rates must not be anywhere near each other.
  expect(fast).toBeGreaterThan(slow * 6);
});

test('the speed control says which speed it is on, and stays out of the collapsed axis', async ({
  page,
}) => {
  await expect(page.getByTestId('twin3d-speed-value')).toHaveText('1×');

  await setRange(page, 'twin3d-speed', 0);
  await expect(page.getByTestId('twin3d-speed-value')).toHaveText('0,25×');
  await setRange(page, 'twin3d-speed', 4);
  await expect(page.getByTestId('twin3d-speed-value')).toHaveText('4×');

  // Collapsed means "just the play axis" — the speed control is not part of the axis.
  await page.getByTestId('twin3d-timeline-toggle').click();
  await expect(page.getByTestId('twin3d-speed')).toHaveCount(0);
  await expect(page.getByTestId('twin3d-scrubber')).toBeVisible();
  await expect(page.getByTestId('twin3d-play')).toBeVisible();

  await page.getByTestId('twin3d-timeline-toggle').click();
  await expect(page.getByTestId('twin3d-speed')).toBeVisible();
});

/** Village names currently drawn over the map, with their opacity. */
async function visibleLabels(page: Page): Promise<{ name: string; opacity: number }[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="twin3d-label-"]'))
      .filter((span) => span.style.visibility === 'visible' && Number(span.style.opacity) > 0.01)
      .map((span) => ({
        name: span.textContent ?? '',
        opacity: Number(span.style.opacity),
      }))
  );
}

test('village names are drawn over the map, and only where they mean something', async ({
  page,
}) => {
  // A map names its places. But thirteen names spread over the whole reach would be words lying
  // across a valley with nothing legible under them, so they belong to the zoom level at which a
  // village is a village.
  const opening = await visibleLabels(page);
  expect(opening.length).toBeGreaterThan(0);
  for (const label of opening) {
    expect(label.name.length, 'a label with no text').toBeGreaterThan(0);
    // Nothing is drawn so faintly that it reads as a smudge rather than a word.
    expect(label.opacity).toBeGreaterThanOrEqual(0.24);
  }

  // ⚠️ Not the centre of the canvas: the timeline panel covers it at this height, and wheel
  // events aimed there land on the panel rather than the map. That mistake made an earlier
  // version of this check pass against a camera that never moved.
  const box = (await page.getByTestId('twin3d-canvas').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.3;
  const under = await page.evaluate(
    ([px, py]) => document.elementFromPoint(px, py)?.getAttribute('data-testid') ?? '',
    [x, y]
  );
  expect(under, 'the wheel target must be bare canvas').toBe('twin3d-canvas');

  for (let i = 0; i < 10; i++) {
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(700);

  // Pulled back to the whole reach, the names are gone.
  expect(await visibleLabels(page)).toHaveLength(0);
});

test('the village names follow the map', async ({ page }) => {
  // The labels are positioned by projecting each village through the camera every frame. If that
  // ever stopped — a dead animation frame, a stale camera — they would sit still over a moving
  // map, which is the failure worth catching rather than "is a label present".
  const rechAt = async () =>
    page.evaluate(() => {
      const span = document.querySelector<HTMLElement>('[data-testid="twin3d-label-rech"]');
      return span?.style.transform ?? '';
    });

  const before = await rechAt();

  // Fly to a village at the other end of the valley.
  await page.getByTestId('twin3d-place-altenahr').click();
  await page.waitForTimeout(2500);

  const after = await rechAt();
  expect(after).not.toBe(before);

  // And the village that was flown to is named, near the middle of the view it was framed in.
  const altenahr = await page.evaluate(() => {
    const span = document.querySelector<HTMLElement>('[data-testid="twin3d-label-altenahr"]')!;
    const rect = span.getBoundingClientRect();
    return {
      visible: span.style.visibility === 'visible',
      centreX: rect.left + rect.width / 2,
      viewportWidth: window.innerWidth,
    };
  });
  expect(altenahr.visible).toBe(true);
  expect(Math.abs(altenahr.centreX - altenahr.viewportWidth / 2)).toBeLessThan(
    altenahr.viewportWidth * 0.35
  );
});

test('the place list folds on its own control, and still drives the clock', async ({ page }) => {
  const railToggle = page.getByTestId('twin3d-places-toggle');
  const timelineToggle = page.getByTestId('twin3d-timeline-toggle');

  await expect(railToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('twin3d-place-dernau')).toBeVisible();

  // Folding the list leaves its heading and takes the villages away, and leaves the timeline
  // entirely alone.
  await railToggle.click();
  await expect(railToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('twin3d-place-dernau')).toHaveCount(0);
  await expect(timelineToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('twin3d-scrubber')).toBeVisible();

  await railToggle.click();
  await expect(page.getByTestId('twin3d-place-dernau')).toBeVisible();

  // And the other way round: folding the timeline must not fold the list.
  await timelineToggle.click();
  await expect(timelineToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(railToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('twin3d-place-dernau')).toBeVisible();

  // The one place the two are meant to meet: a village's peak still moves the scrubber, even
  // with the timeline panel collapsed to the axis.
  const label = (await page.getByTestId('twin3d-peak-dernau').innerText()).trim();
  await page.getByTestId('twin3d-peak-dernau').click();
  await expect(page.getByTestId('twin3d-clock')).toContainText(label);
});

test('every valley village is listed, in the order the wave reaches them', async ({ page }) => {
  // The map draws the whole valley, so the places you can see houses for and the places you can
  // navigate to have to be the same set. It used to draw thirteen settlements and offer four.
  const rail = page.getByTestId('twin3d-places');
  await expect(rail).toBeVisible();

  const entries = await page.evaluate(() => {
    const items = Array.from(
      document.querySelectorAll('[data-testid="twin3d-places"] li')
    );
    return items.map((li) => ({
      name: li.querySelector('button')?.textContent?.trim() ?? '',
      time: li.querySelectorAll('button')[1]?.textContent?.trim() ?? '',
    }));
  });

  expect(entries.length).toBeGreaterThanOrEqual(10);
  for (const entry of entries) {
    expect(entry.name.length, 'a village with no name').toBeGreaterThan(0);
    expect(entry.time, `no peak time for ${entry.name}`).toMatch(/^\d{2}:\d{2}$/);
  }

  // Downstream order, allowing exactly one wrap past midnight — the reach takes about two hours
  // and the peak is late in the evening, so the last few villages fall on the next day. If the
  // sign of the wave lag ever flipped, this is where it would show.
  //
  // The offset accumulates: once the list has crossed midnight every later village is on the next
  // day too. Comparing each entry against the already-shifted previous value counted a fresh wrap
  // for every one of them.
  let previousClock = -1;
  let previousAbsolute = -1;
  let dayOffset = 0;
  let wraps = 0;
  for (const entry of entries) {
    const [hours, mins] = entry.time.split(':').map(Number);
    const clock = hours * 60 + mins;
    if (clock < previousClock) {
      dayOffset += 24 * 60;
      wraps++;
    }
    const absolute = clock + dayOffset;
    expect(absolute, `${entry.name} is not downstream of the one before it`).toBeGreaterThan(
      previousAbsolute
    );
    previousClock = clock;
    previousAbsolute = absolute;
  }
  expect(wraps, 'the peak should cross midnight at most once').toBeLessThanOrEqual(1);
});

test('the list states how long the peak takes to cross the whole valley', async ({ page }) => {
  // The one number the rail holds and never said. Every row answers "when did it reach here"; the
  // distance between the first and the last answers "how much time did the valley have", which is
  // what Act IV is built on — and it only became legible once the reach ran to the mouth.
  const span = page.getByTestId('twin3d-places-span');
  await expect(span).toBeVisible();

  const { text, first, last, spanBox, listBox } = await page.evaluate(() => {
    const rail = document.querySelector('[data-testid="twin3d-places"]')!;
    const rows = Array.from(rail.querySelectorAll('li'));
    const timeOf = (li: Element) => li.querySelectorAll('button')[1]?.textContent?.trim() ?? '';
    const el = document.querySelector('[data-testid="twin3d-places-span"]')!;
    return {
      text: (el as HTMLElement).innerText,
      first: timeOf(rows[0]),
      last: timeOf(rows[rows.length - 1]),
      spanBox: el.getBoundingClientRect().top,
      listBox: rail.querySelector('ul')!.getBoundingClientRect().top,
    };
  });

  // It has to agree with the two times it summarises, to the minute. The modelled peaks are
  // fractional, so a naive subtraction produced both "3 Std. 8,58 Min." and, once rounded, a span
  // that could disagree by a minute with the rows directly beneath it.
  const toMinutes = (clock: string) => {
    const [h, m] = clock.split(':').map(Number);
    return h * 60 + m;
  };
  let expected = toMinutes(last) - toMinutes(first);
  if (expected < 0) expected += 24 * 60;
  const match = text.match(/(\d+)\s*(?:Std\.|h)\s*(\d+)/);
  expect(match, `no duration in "${text}"`).not.toBeNull();
  expect(Number(match![1]) * 60 + Number(match![2])).toBe(expected);

  // Above the scrolling list, not inside it. Buried under twenty rows it was visible only to a
  // reader who had already scrolled to the mouth of the river.
  expect(spanBox).toBeLessThan(listBox);
});

test('the village rail keeps clear of the panels it shares the edge with', async ({ page }) => {
  // Both the Copernicus panel and this rail want the right edge. They are in one column for that
  // reason; before, each positioned itself against the viewport, which was survivable at four
  // villages and would not have been at thirteen.
  await expect(page.getByTestId('twin3d-places')).toBeVisible();
  // The Copernicus panel fills in once its metrics load, so wait for it rather than measuring
  // against something that has not rendered yet.
  await expect(page.getByTestId('validation-panel')).toBeVisible();
  await expect(page.getByTestId('act4-panel')).toBeVisible();

  const geometry = await page.evaluate(() => {
    const rail = document
      .querySelector('[data-testid="twin3d-places"]')!
      .getBoundingClientRect();
    let worst = 0;
    for (const id of ['validation-panel', 'act4-panel']) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) throw new Error(`panel ${id} not found — the check would silently pass`);
      const other = el.getBoundingClientRect();
      const w = Math.max(0, Math.min(rail.right, other.right) - Math.max(rail.left, other.left));
      const h = Math.max(0, Math.min(rail.bottom, other.bottom) - Math.max(rail.top, other.top));
      worst = Math.max(worst, w * h);
    }
    return { worst, left: rail.left, viewportWidth: window.innerWidth, bottom: rail.bottom, viewportHeight: window.innerHeight };
  });

  expect(geometry.worst).toBe(0);
  // On the right, which is where it was asked to be.
  expect(geometry.left).toBeGreaterThan(geometry.viewportWidth / 2);
  // And it scrolls rather than running off the bottom of the map.
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
});

test('the hazard layer shades the valley by how often it floods', async ({ page }) => {
  await setMinutes(page, -720); // dry, so the classes are not hidden under the flood

  const before = await hazardShares(page);
  await page.getByTestId('twin3d-hazard-toggle').click();
  await page.waitForTimeout(700);
  const after = await hazardShares(page);

  // Off by default, so nothing should be tinted before the click.
  expect(before.gk4 + before.gk3).toBeLessThan(1);

  // All four classes have to be present, or the overlay is not saying anything. The frequent
  // classes are narrow ribbons along the channel and the rare ones broad, which is the shape of a
  // floodplain — if GK4 ever came out larger than GK3 the boundaries would be inverted.
  expect(after.gk4).toBeGreaterThan(0.05);
  expect(after.gk3).toBeGreaterThan(after.gk4);
  expect(after.gk1).toBeGreaterThan(after.gk2);

  // Most of the frame is hillside the river cannot reach at any discharge, and it stays unshaded.
  expect(after.untinted).toBeGreaterThan(50);
});

test('the hazard layer explains itself while it is on', async ({ page }) => {
  // Four unexplained colours are worse than no overlay, and PLAN §2.2 rule 3 wants the caveat to
  // travel with the picture rather than sit in a tooltip.
  await expect(page.getByTestId('twin3d-hazard-legend')).toHaveCount(0);

  await page.getByTestId('twin3d-hazard-toggle').click();
  const legend = page.getByTestId('twin3d-hazard-legend');
  await expect(legend).toBeVisible();
  for (const code of ['GK1', 'GK2', 'GK3', 'GK4']) {
    await expect(legend).toContainText(code);
  }

  // Not ZÜRS, and the 200-year boundary is extrapolated — both have to be on screen, not implied.
  const notice = page.getByTestId('twin3d-model-notice');
  await expect(notice).toContainText('ZÜRS');
  await expect(notice).toContainText('HQ200');

  await page.getByTestId('twin3d-hazard-toggle').click();
  await expect(page.getByTestId('twin3d-hazard-legend')).toHaveCount(0);
  await expect(notice).not.toContainText('ZÜRS');
});

test('the hazard layer does not cover the panels it shares the screen with', async ({ page }) => {
  // An earlier version floated this legend in the top-left corner, where it covered the Act IV
  // figures completely (116x41 px) and clipped the Copernicus panel (84x26 px). Both panels carry
  // numbers, so anything that hides them is a defect rather than a cosmetic complaint.
  await page.getByTestId('twin3d-hazard-toggle').click();
  await expect(page.getByTestId('twin3d-hazard-legend')).toBeVisible();

  const worst = await page.evaluate(() => {
    const legend = document
      .querySelector('[data-testid="twin3d-hazard-legend"]')!
      .getBoundingClientRect();
    let worstArea = 0;
    for (const testid of ['act4-panel', 'validation-panel']) {
      const el = document.querySelector(`[data-testid="${testid}"]`);
      if (!el) throw new Error(`panel ${testid} not found — the check would silently pass`);
      const r = el.getBoundingClientRect();
      const w = Math.max(0, Math.min(legend.right, r.right) - Math.max(legend.left, r.left));
      const h = Math.max(0, Math.min(legend.bottom, r.bottom) - Math.max(legend.top, r.top));
      worstArea = Math.max(worstArea, w * h);
    }
    return worstArea;
  });

  expect(worst).toBe(0);
});

test('the aerial photo is offered, off by default, and changes the surface', async ({ page }) => {
  // The photograph lies OVER the land cover rather than replacing it, so the check is that the
  // surface changes when it comes on and changes back when it goes off. `frameDelta` returning
  // -1 means "different from the stored frame", which is what a repaint looks like.
  const toggle = page.getByTestId('twin3d-drape-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(700);
  expect(await frameDelta(page, 'drape-off', 20)).toBe(-1);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(900);
  // A photograph is not the palette: turning it on must move a lot of pixels, not a few.
  expect(await frameDelta(page, 'drape-off', 20)).toBeGreaterThan(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(900);
  expect(await frameDelta(page, 'drape-off', 20)).toBe(0);
});
