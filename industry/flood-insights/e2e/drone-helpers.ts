import { expect, type Page } from '@playwright/test';

/**
 * Drone assertions that do not depend on the frame rate.
 *
 * ⚠️ Both render loops clamp their frame delta to 0.1 s, so one frame advances the camera by at
 * most `cruise * boost * 0.1`. That clamp is right — it stops a backgrounded tab resuming with
 * the camera outside the AOI — but it means a *time-based* press measures the frame rate as much
 * as the speed. A fixed 1.2 s hold that travelled 146 m on a warm GPU travelled 23 m right after
 * the 97 MB valley spec had run, and failed an assertion that had nothing wrong with it.
 *
 * So: hold the key and wait for the camera to actually travel, rather than for a stopwatch.
 */

function metresBetween(a: number[], b: number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export async function cameraAt(page: Page, canvasTestId: string): Promise<number[]> {
  const raw = await page.getByTestId(canvasTestId).getAttribute('data-cam');
  expect(raw, `${canvasTestId} publishes no camera position`).not.toBeNull();
  return raw!.split(',').map(Number);
}

/**
 * Put the mouse somewhere the map will actually receive it, and say where that was.
 *
 * ⚠️ The obvious `getByTestId(canvas).hover()` aims at the canvas CENTRE, and the canvas is
 * full-bleed while the timeline panel is a ~500 px card anchored to the bottom of it. At 1600x900
 * the panel's top edge is at y 417 and the centre is y 450, so the hover lands on the panel and
 * Playwright retries until it times out — which reads as the drone ignoring the mouse.
 *
 * ⚠️ A fixed fraction is not enough either. 30 % of the height clears the panel at 1600x900 and
 * lands ON it at 1280x800, where the canvas is shorter but the panel is not: the wheel then went
 * to the panel, the camera never moved, and the failure surfaced two assertions later as "no tile
 * was fetched". So the fraction is searched rather than assumed, and the result is asserted.
 */
export async function hoverMap(page: Page, canvasTestId: string): Promise<{ x: number; y: number }> {
  const box = (await page.getByTestId(canvasTestId).boundingBox())!;
  const x = box.x + box.width / 2;
  for (const fraction of [0.3, 0.24, 0.18, 0.12]) {
    const y = box.y + box.height * fraction;
    const onMap = await page.evaluate(
      ([px, py, id]) =>
        document.elementFromPoint(px as number, py as number)?.getAttribute('data-testid') === id,
      [x, y, canvasTestId] as const
    );
    if (onMap) {
      await page.mouse.move(x, y);
      return { x, y };
    }
  }
  throw new Error(`no point on ${canvasTestId} is uncovered — every candidate hit a panel`);
}

/** Hold a key the way a person does. A press/release pair only advances a single frame. */
export async function holdKey(page: Page, key: string, ms: number): Promise<void> {
  await page.evaluate(
    async ([k, duration]) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: k as string, bubbles: true }));
      await new Promise((r) => setTimeout(r, duration as number));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: k as string, bubbles: true }));
    },
    [key, ms]
  );
}

/**
 * Hold `key` until the camera has moved further than `minMetres`, then let go.
 *
 * Fails the test if it never gets there, which is the real assertion: the drone flies. How many
 * frames that took is the machine's business.
 *
 * ⚠️ The key is re-asserted on every poll rather than pressed once, and that is not
 * belt-and-braces. The controls clear every held key on `blur` — they have to, or a key held while
 * the window loses focus leaves the camera drifting away on its own for ever — and a synthetic
 * keydown does not need focus to be delivered, so a suite tearing down the previous browser
 * context can steal focus between the press and the first poll. The camera then never moves at
 * all, which is exactly how this failed in a full run while passing on its own. `held` is a Set,
 * so repeating the press is free.
 */
export async function flyUntilMoved(
  page: Page,
  canvasTestId: string,
  key: string,
  minMetres: number
): Promise<void> {
  const start = await cameraAt(page, canvasTestId);
  const press = () =>
    page.evaluate(
      (k) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })),
      key
    );
  await press();
  try {
    await expect
      .poll(
        async () => {
          await press();
          return metresBetween(start, await cameraAt(page, canvasTestId));
        },
        {
          timeout: 30_000,
          message: `the drone never travelled ${minMetres} m with ${key} held`,
        }
      )
      .toBeGreaterThan(minMetres);
  } finally {
    // Always release, even when the assertion failed: a stuck key would drift the camera through
    // every test that follows in this file.
    await page.evaluate(
      (k) => window.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true })),
      key
    );
  }
}
