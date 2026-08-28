import { expect, test, type Page } from '@playwright/test';

import { waitForCampusReady } from './campus';

/**
 * The compass, and putting the map back the right way up.
 *
 * ⚠️ EVERY CASE ASSERTS THE VIEW WAS OFF NORTH FIRST. A test that only checks the heading is zero
 * after the click passes just as happily on a camera that was already facing north — which is
 * exactly the state a broken `faceNorth()` would leave, since doing nothing is indistinguishable
 * from doing the right thing when there was nothing to do. The landing shot looks in from the
 * south-east on purpose (`frame()` in `scene.ts`), so there is always a turn to make.
 *
 * The other half of the promise is what is NOT allowed to move. A compass turns the view; it does
 * not fly anywhere. Reusing the camera flight would have re-framed the shot as well, and that
 * would be invisible in a heading assertion — hence the distance and target checks.
 */

type CompassApi = {
  headingRad(): number;
  faceNorth(): void;
  focusPlace(id: string): void;
  cameraDebug(): { pos: [number, number, number]; target: [number, number, number] };
};

/**
 * ⚠️ Written out at every call site on purpose. A `const api = () => window.__campus` helper up
 * here reads better and does not work: the body of a `page.evaluate` is serialised and run in the
 * BROWSER, where nothing this file declares exists. The first version of this spec failed six for
 * six with `ReferenceError: api is not defined`.
 */
declare const window: { __campus: CompassApi };

/** The heading the rose is reporting, read off the DOM the way a viewer reads the picture. */
async function roseHeading(page: Page): Promise<number> {
  const raw = await page.getByTestId('twin3d-compass').getAttribute('data-heading');
  expect(raw, 'the rose publishes its heading').not.toBeNull();
  return Number(raw);
}

/** The scene's own heading, in degrees clockwise from north. */
async function sceneHeading(page: Page): Promise<number> {
  const rad = await page.evaluate(() => window.__campus.headingRad());
  return ((rad * 180) / Math.PI + 360) % 360;
}

/** How far two bearings are apart, allowing for the wrap at north. */
function bearingGap(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

async function openCampus(page: Page, aoi: string) {
  await page.goto(`/?aoi=${aoi}`);
  await waitForCampusReady(page);
  // The landing flight has to finish before the heading means anything — mid-flight the camera is
  // somewhere between two bearings and every reading below would be of a moment, not a state.
  await page.waitForTimeout(4000);
}

for (const site of [
  { aoi: 'oth-regensburg', label: 'OTH Regensburg' },
  { aoi: 'lmu-muenchen', label: 'LMU München' },
]) {
  test.describe(`Compass — ${site.label}`, () => {
    test('says which way the view is pointing, and the rose agrees with the scene', async ({
      page,
    }) => {
      await openCampus(page, site.aoi);

      const compass = page.getByTestId('twin3d-compass');
      await expect(compass).toBeVisible();

      const scene = await sceneHeading(page);
      // The precondition every other case rests on: the twin does not land facing north.
      expect(bearingGap(scene, 0)).toBeGreaterThan(5);

      // ⚠️ The rose is the only thing a viewer sees, so it — not the handle — has to be right.
      // These are computed by different code (`roseRotationDeg` counter-rotates), so agreement
      // here is a real cross-check rather than one value read twice.
      expect(bearingGap(await roseHeading(page), scene)).toBeLessThan(2);
    });

    test('clicking it turns to north without moving the camera', async ({ page }) => {
      await openCampus(page, site.aoi);

      const before = await page.evaluate(() => window.__campus.cameraDebug());
      const startHeading = await sceneHeading(page);
      expect(bearingGap(startHeading, 0)).toBeGreaterThan(5);

      await page.getByTestId('twin3d-compass').click();

      await page.waitForFunction(() => Math.abs(window.__campus.headingRad()) < 0.02, null, {
        timeout: 15_000,
      });

      const after = await page.evaluate(() => window.__campus.cameraDebug());
      const distance = (c: { pos: number[]; target: number[] }) =>
        Math.hypot(c.pos[0] - c.target[0], c.pos[1] - c.target[1], c.pos[2] - c.target[2]);

      // What a compass promises: the bearing changed and nothing else did.
      const targetMoved = Math.hypot(
        after.target[0] - before.target[0],
        after.target[1] - before.target[1],
        after.target[2] - before.target[2]
      );
      expect(targetMoved, 'it still looks at the same place').toBeLessThan(1);
      expect(
        Math.abs(distance(after) - distance(before)),
        'from the same distance'
      ).toBeLessThan(1);
      // Same height above the target ⇒ the same tilt, since the distance is unchanged too.
      expect(
        Math.abs(after.pos[1] - before.pos[1]),
        'at the same angle'
      ).toBeLessThan(1);

      // And the rose followed the camera round rather than being left where it started.
      // ⚠️ Through `bearingGap`, not `< 2`: settling a degree short of north reads as **359**, and
      // a bare comparison fails a compass that is working. The wrap is the whole reason
      // `compass.ts` exists, and the first draft of this line walked straight into it.
      expect(bearingGap(await roseHeading(page), 0)).toBeLessThan(2);
    });

    test('the rose follows the camera when something else turns it', async ({ page }) => {
      await openCampus(page, site.aoi);

      // ⚠️ THE MIRROR CONTROL. Without it, a rose hard-wired to point up would pass the case
      // above perfectly — click, camera turns north, rose reads north, everything green over an
      // instrument that never moves.
      await page.getByTestId('twin3d-compass').click();
      await page.waitForFunction(() => Math.abs(window.__campus.headingRad()) < 0.02, null, {
        timeout: 15_000,
      });
      expect(bearingGap(await roseHeading(page), 0)).toBeLessThan(2);

      // Fly to a place: the framing shot comes in from the south-east, so the bearing changes.
      await page.evaluate(() => {
        const label = document.querySelector('[data-testid^="map-label-"]');
        const id = label?.getAttribute('data-testid')?.replace('map-label-', '');
        if (id) window.__campus.focusPlace(id);
      });
      await page.waitForTimeout(3000);

      const scene = await sceneHeading(page);
      expect(bearingGap(scene, 0), 'the camera really did turn off north').toBeGreaterThan(5);
      expect(
        bearingGap(await roseHeading(page), scene),
        'and the rose went with it'
      ).toBeLessThan(3);
    });
  });
}
