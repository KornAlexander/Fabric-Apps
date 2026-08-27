import { expect, test } from '@playwright/test';

import { cameraAt, flyUntilMoved, holdKey, hoverMap } from './drone-helpers';

/**
 * The merged camera — the map and the drone as one mode.
 *
 * The arithmetic and the latch are covered in `src/twin3d/__tests__/flyControls.test.ts`. What
 * only a real browser can show is the two things that involve a live OrbitControls:
 *
 *   **Two camera models being live at once.** OrbitControls rewrites the camera from its own
 *   target every frame, so if it is not disabled the drone is dragged back as fast as the keys
 *   push it away — and the symptom is not an error, it is a camera that feels sticky.
 *
 *   **The hand-back.** `OrbitControls.update()` enforces its polar and distance limits by *moving
 *   the camera*, unconditionally, on the frame after it gets the target back. A stub cannot show
 *   that; the real class can, and did — for as long as free flight existed.
 *
 * ⚠️ These assert on `data-cam`, not on pixels. The terrain shader animates `uTime`, so two
 * consecutive frames are never byte-identical: a screenshot comparison can show that something
 * changed but never that nothing did. The first version of this file asserted frame equality
 * while the camera was parked, and failed against the water shimmer.
 */

const CANVAS = 'twin3d-canvas';

/** Comfortably longer than the module's two-second grace window. */
const HAND_BACK_MS = 4_000;

function distance(a: number[], b: number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * The camera-state readout, which is what is left where the toggle used to be.
 *
 * ⚠️ `data-flying`, not `aria-pressed`. There is no button any more — the keys are the whole
 * control — so nothing here is pressable and a pressed state would be a lie.
 */
const state = (page: import('@playwright/test').Page) => page.getByTestId('twin3d-drone-control');

/** The mouse has to be over the MAP for the wheel to reach it. See `hoverMap` for why. */
async function hoverTheMap(page: import('@playwright/test').Page): Promise<void> {
  await hoverMap(page, CANVAS);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/?scene=ahrtal-2021');
  await page.getByTestId('remembrance-continue').click();
  await expect(page.getByTestId(CANVAS)).toHaveAttribute('data-ready', 'true', {
    timeout: 120_000,
  });
});

test('the map has the camera to begin with, and says which key takes it', async ({ page }) => {
  await expect(state(page)).toHaveAttribute('data-flying', 'false');
  await expect(page.getByTestId('twin3d-freefly-help')).toHaveCount(0);
  // ⚠️ The keys are the real control; the button is only the way in for people who do not know
  // that yet. With no hint the merge is invisible and the keys may as well not exist.
  await expect(page.getByTestId('twin3d-freefly-hint')).toContainText(/W A S D/);
});

/** The merge, in one test: the key you were going to press is the mode switch. */
test('W takes the camera, without anyone pressing a button', async ({ page }) => {
  await flyUntilMoved(page, CANVAS, 'w', 240);
  await expect(state(page)).toHaveAttribute('data-flying', 'true');
  // Saying it has no collision is the point of the help text, not decoration: flying through a
  // hillside otherwise reads as a bug rather than a deliberate simplification.
  await expect(page.getByTestId('twin3d-freefly-help')).toContainText(/Kollision|collision/i);
  await expect(page.getByTestId('twin3d-freefly-hint')).toHaveCount(0);
});

/**
 * ⚠️ The way out for anyone who does not want to wait out the grace window. It matters more than
 * it looks now that the toggle is gone: without it the only way to give the map back is to stop
 * touching anything and wait it out.
 */
test('Escape gives the map back at once', async ({ page }) => {
  await flyUntilMoved(page, CANVAS, 'w', 240);
  await expect(state(page)).toHaveAttribute('data-flying', 'true');

  await page.keyboard.press('Escape');
  // At once, rather than at the end of the grace window.
  await expect(state(page)).toHaveAttribute('data-flying', 'false', { timeout: 900 });
});

test('the orbit camera does not drag the drone back', async ({ page }) => {
  await flyUntilMoved(page, CANVAS, 'w', 240);

  // ⚠️ An arrow key, held, to keep the camera from being handed back while this is measured. It
  // turns the view and moves the camera not at all, which is exactly the property under test — and
  // it is what makes the test independent of the grace window, which is a second now and could be
  // shorter tomorrow. Without it the wait below straddles the hand-back and measures OrbitControls.
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  );
  try {
    const flown = await cameraAt(page, CANVAS);
    // With OrbitControls still live this creeps back towards its target over the next second, with
    // nothing pushing it.
    await page.waitForTimeout(1_000);
    expect(
      distance(flown, await cameraAt(page, CANVAS)),
      'the camera drifted with nothing pushing it'
    ).toBe(0);
    await expect(state(page)).toHaveAttribute('data-flying', 'true');
  } finally {
    await page.evaluate(() =>
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true }))
    );
  }
});

test('Q and E move in world up and down', async ({ page }) => {
  await flyUntilMoved(page, CANVAS, 'w', 100);
  const before = await cameraAt(page, CANVAS);
  await holdKey(page, 'e', 900);
  const up = await cameraAt(page, CANVAS);
  expect(up[1]).toBeGreaterThan(before[1]);

  await holdKey(page, 'q', 900);
  expect((await cameraAt(page, CANVAS))[1]).toBeLessThan(up[1]);
});

// ── The hand-back ──────────────────────────────────────────────────────────

test('the map takes the camera back on its own once the keys stop', async ({ page }) => {
  await flyUntilMoved(page, CANVAS, 'w', 240);
  await expect(state(page)).toHaveAttribute('data-flying', 'true');

  // ⚠️ The grace window is the design, not a delay to be tuned away: handing back the moment the
  // key comes up would change what the wheel does while the viewer is still flying.
  await expect(state(page)).toHaveAttribute('data-flying', 'false', { timeout: HAND_BACK_MS });
});

/**
 * ⚠️ The regression this whole module exists to fix.
 *
 * `OrbitControls.update()` clamps the polar angle every frame whether or not anything rotated, so
 * an orbit centre derived from a level or upward view is out of bounds the instant it is handed
 * over and the camera is *moved* to satisfy the limit. With `maxPolarAngle` at 0.48π that fired
 * for any view pitched up by more than −3.6°, which is nearly all of them: fly, stop, and the
 * valley jumps sideways for no reason the viewer can see.
 */
test('handing back does not move the camera', async ({ page }) => {
  await flyUntilMoved(page, CANVAS, 'w', 240);
  const flown = await cameraAt(page, CANVAS);

  await expect(state(page)).toHaveAttribute('data-flying', 'false', { timeout: HAND_BACK_MS });
  // A full second past the hand-back, so the orbit camera has had many frames to enforce its
  // limits. Metres, not exactness: damping settles a residual of well under one.
  await page.waitForTimeout(1_000);
  expect(
    distance(flown, await cameraAt(page, CANVAS)),
    'the camera jumped when the map took it back'
  ).toBeLessThan(1);
});

test('the map orbits its own centre after the hand-back, not the one it started with', async ({
  page,
}) => {
  await flyUntilMoved(page, CANVAS, 'w', 600);
  await expect(state(page)).toHaveAttribute('data-flying', 'false', { timeout: HAND_BACK_MS });
  const parked = await cameraAt(page, CANVAS);

  // ⚠️ Without a derived target the orbit centre is still wherever it was before the flight, and
  // the first drag swings the camera the whole way back across the valley to get to it. A drag
  // that moves the camera further than it flew is that bug.
  const box = (await page.getByTestId(CANVAS).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();

  await expect
    .poll(async () => distance(parked, await cameraAt(page, CANVAS)), {
      message: 'the first drag after the hand-back swung the camera away',
    })
    .toBeLessThan(600);
});

// ── The contested inputs ───────────────────────────────────────────────────

test('the wheel is the throttle while flying, and the map zoom when not', async ({ page }) => {
  // There is no readout at all while the map has the camera: a throttle nobody is holding needs
  // no dial.
  await expect(page.getByTestId('twin3d-freefly-speed')).toHaveCount(0);

  // ⚠️ The drone must not claim the wheel globally. Everyone who never flies still expects to zoom
  // the map, and OrbitControls owns the wheel to do it.
  const parked = await cameraAt(page, CANVAS);
  await hoverTheMap(page);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -120);
  await expect
    .poll(async () => distance(parked, await cameraAt(page, CANVAS)), {
      message: 'the wheel no longer zooms the map',
    })
    .toBeGreaterThan(0);

  // Take the camera the only way there is now.
  await flyUntilMoved(page, CANVAS, 'w', 100);
  const speed = page.getByTestId('twin3d-freefly-speed');
  // Filled from a requestAnimationFrame loop rather than React state, so it starts as a dash.
  await expect.poll(async () => await speed.textContent()).toBe('200');

  await hoverTheMap(page);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -120);
  await expect
    .poll(async () => Number(await speed.textContent()), {
      message: 'scrolling up did not speed up',
    })
    .toBeGreaterThan(200);

  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 120);
  await expect
    .poll(async () => Number(await speed.textContent()), { message: 'scrolling down did not slow' })
    .toBeLessThan(200);
});

test('touching the throttle keeps the camera, because that is flying too', async ({ page }) => {
  await flyUntilMoved(page, CANVAS, 'w', 100);
  await hoverTheMap(page);

  // Nudge the throttle repeatedly, holding no key at all. Each nudge has to restart the grace
  // window, or the camera would be handed back in the middle of an adjustment — which is the one
  // case the window exists to protect, and the reason it can be short rather than absent.
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(700);
  }
  await expect(state(page)).toHaveAttribute('data-flying', 'true');
});

test('a drag looks around while flying, rather than orbiting', async ({ page }) => {
  await flyUntilMoved(page, CANVAS, 'w', 100);
  const before = await cameraAt(page, CANVAS);

  const box = (await page.getByTestId(CANVAS).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, { steps: 20 });
  await page.mouse.up();

  // ⚠️ Looking is not moving. An orbit would have swung the camera around a centre; the gimbal
  // turns it where it stands, so the position is untouched.
  expect(distance(before, await cameraAt(page, CANVAS)), 'the drag moved the camera').toBe(0);
});

test('starting a tour takes the camera back', async ({ page }) => {
  await flyUntilMoved(page, CANVAS, 'w', 100);
  await expect(state(page)).toHaveAttribute('data-flying', 'true');

  // A tour drives the camera. Leaving the drone engaged would mean each step flew somewhere and
  // the viewer's keys immediately pulled the camera off it.
  await page.getByTestId('tour-start').click();
  await expect(page.getByTestId('tour-card')).toBeVisible();
  await expect(state(page)).toHaveAttribute('data-flying', 'false');
  await page.getByTestId('tour-end').click();
});

test('the drone control stays on screen while a tour runs', async ({ page }) => {
  // It sits in the top-right rail, whose reading panels are hidden during a tour. The control is
  // not a reading panel — a tour is exactly when you want to see the camera handed back — so only
  // the panels are gated.
  await page.getByTestId('tour-start').click();
  await expect(page.getByTestId('tour-card')).toBeVisible();
  await expect(page.getByTestId('twin3d-drone-control')).toBeVisible();
  await expect(page.getByTestId('twin3d-places')).toHaveCount(0);
});
