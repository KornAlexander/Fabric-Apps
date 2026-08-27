import { expect, test, type Page } from '@playwright/test';

import { flyUntilMoved } from './drone-helpers';

/**
 * Steinbachtalsperre — the companion case.
 *
 * These tests defend the framing as much as the feature. The module shows a catastrophe that did
 * not happen, on real named villages, so the guarantees that keep it honest — that it is labelled
 * a model, that it never appears on the Ahr's map, that it derives no casualty figure — are
 * asserted here rather than left to the copy staying well behaved.
 *
 * ⚠️ One of those guarantees changed on 2026-07-29. The scenario used not to be drawn at all;
 * it now has its own terrain in `SteinbachScene`, under conditions recorded at the top of
 * `src/data/steinbach.ts`. What replaced "draws nothing" is not weaker, it is more specific, and
 * the tests at the end of this file are what make it enforceable: the badge is present, no depth
 * is claimed, and a place the study gave no time for never acquires one.
 */

async function openPanel(page: Page) {
  // The reading lives with the map it describes. Until 2026-07-29 the trigger sat in the header
  // of the Ahr view, labelled the same as the corridor's entry in the scene switch — the header
  // offered the same destination twice, and the button disappeared at exactly the moment you
  // selected the corridor. Selecting the corridor is now the way in.
  await page.getByTestId('scene-switch').selectOption('steinbach-2021');
  await page.getByTestId('steinbach-open').click();
  await expect(page.getByTestId('steinbach-panel')).toBeVisible();
}

/** Warning-time value for a place, in minutes, negative when the water arrived first. */
async function leadTime(page: Page, place: string): Promise<number> {
  const text = await page.getByTestId(`steinbach-lead-${place}`).innerText();
  const match = text.match(/(\d+)/);
  if (!match) throw new Error(`no number in lead time for ${place}: ${text}`);
  return /zu spät|too late/.test(text) ? -Number(match[1]) : Number(match[1]);
}

async function setWarning(page: Page, index: number) {
  await page.evaluate((value) => {
    const el = document.querySelector<HTMLInputElement>('[data-testid="steinbach-warning"]')!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, index);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page.getByTestId('remembrance-continue').click();
});

test('the companion case is reachable from inside the twin', async ({ page }) => {
  // It used to be that the only way to another case study would have been a second deployment.
  // The corridor is now a map in its own right, so the way in is the scene switch, and the
  // reading appears once you are there rather than while you are looking at the Ahr.
  await expect(page.getByTestId('steinbach-open')).toHaveCount(0);
  await openPanel(page);
  await expect(page.getByTestId('steinbach-panel')).toContainText('Die Talsperre, die hielt');
});

test('it says plainly that the dam held, and that the break is a model', async ({ page }) => {
  await openPanel(page);
  const panel = page.getByTestId('steinbach-panel');

  // The outcome is not a twist ending. It is the headline.
  await expect(panel).toContainText('Der Damm hielt.');

  const notice = await page.getByTestId('steinbach-notice').innerText();
  expect(notice).toContain('Der Dammbruch ist nicht eingetreten.');
  expect(notice).toContain('Modellrechnung');
  // The app must not be read as having simulated this itself.
  expect(notice).toMatch(/rechnet keinen Dammbruch selbst/);
});

test('the warning-time arithmetic runs out exactly where the study said it would', async ({
  page,
}) => {
  await openPanel(page);

  // Stop 2 is 18:10, when the civil protection authority was told overtopping was coming.
  await setWarning(page, 2);
  expect(await leadTime(page, 'schweinheim')).toBe(120);

  // Stop 4 is 20:00, the assumed moment of failure. Warn then and only the travel time is left —
  // ten minutes, which is why the authors said the evacuation had to happen beforehand.
  await setWarning(page, 4);
  expect(await leadTime(page, 'schweinheim')).toBe(10);

  // Stop 5 is 21:00, when the evacuation actually began.
  await setWarning(page, 5);
  expect(await leadTime(page, 'schweinheim')).toBe(-50);
});

test('warning time grows downstream, and Heimerzheim is marked out of danger', async ({ page }) => {
  await openPanel(page);
  await setWarning(page, 2);

  expect(await leadTime(page, 'odendorf')).toBeGreaterThan(await leadTime(page, 'schweinheim'));

  const panel = page.getByTestId('steinbach-panel');
  // The model found the A 61 holds the water back. Saying so is the difference between reporting
  // a study and frightening a village with it — and a place in no danger gets no warning time,
  // because a warning time for it would be a category error rather than a number.
  await expect(panel).toContainText('keine Gefährdung');
  await expect(page.getByTestId('steinbach-lead-heimerzheim')).toHaveText('nicht angegeben');

  // Palmersheim has a modelled depth but no published arrival, and the table must say so rather
  // than invent one.
  await expect(page.getByTestId('steinbach-lead-palmersheim')).toHaveText('nicht angegeben');
});

test('the module derives no casualty figure from a flood that did not happen', async ({ page }) => {
  await openPanel(page);
  const text = await page.getByTestId('steinbach-panel').innerText();

  // People appear exactly once, as the number who were evacuated — an event that did happen.
  expect(text).toContain('15.000');
  expect(text).not.toMatch(/Tote|Todesopfer|gestorben|Opfer/);
  // And the panel says outright that it models no evacuation.
  expect(text).toMatch(/kein Evakuierungsmodell/);
});

test('it keeps real umlauts, in both languages', async ({ page }) => {
  await openPanel(page);
  const de = await page.getByTestId('steinbach-panel').innerText();
  expect(de).toMatch(/[äöüß]/);
  expect(de).not.toMatch(/Gefaehrdung|ueber|Damms?bruch\b.*ae/);

  await page.getByTestId('steinbach-close').click();
  await page.getByTestId('lang-en').click();
  await openPanel(page);
  await expect(page.getByTestId('steinbach-panel')).toContainText('The dam that held');
});

test('the trigger does not push the header apart on a short viewport', async ({ page }) => {
  // The Fabric App frame is shorter and narrower than a laptop window, and the header is the one
  // row that has repeatedly overflowed when something new was added to it.
  await page.setViewportSize({ width: 900, height: 650 });
  await page.getByTestId('scene-switch').selectOption('steinbach-2021');
  await expect(page.getByTestId('steinbach-open')).toBeVisible();
  const header = page.locator('header').first();
  const box = await header.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeLessThan(140);
});

/* ------------------------------------------------------------------------------------------- *
 * The scenario terrain.
 *
 * These five tests are the price of drawing the break at all. Each one pins a condition from the
 * clause at the top of `src/data/steinbach.ts`; if one fails, the scene has stopped being a
 * rendering of the Hydrotec study and become an argument of its own.
 * ------------------------------------------------------------------------------------------- */

/** Move the scenario clock, in minutes after the assumed break. */
async function setSceneMinutes(page: Page, minutes: number) {
  await page.evaluate((value) => {
    const el = document.querySelector<HTMLInputElement>('[data-testid="steinbach-scene-time"]')!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, minutes);
}

async function openScene(page: Page) {
  await openPanel(page);
  await expect(page.getByTestId('steinbach-scene')).toBeVisible();
  // The terrain is fetched, so readiness is a signal from the renderer rather than a guess.
  await expect(page.getByTestId('steinbach-scene-canvas')).toHaveAttribute(
    'data-scene-ready',
    'true',
    { timeout: 20_000 },
  );
  await expect(page.getByTestId('steinbach-scene-error')).toHaveCount(0);
}

test('the scenario is drawn, and drawn as something that did not happen', async ({ page }) => {
  await openScene(page);
  // The label is not decoration. It is the reason the scene is permitted to exist, so it must be
  // on screen at the same time as the terrain rather than scrolled away above it.
  await expect(page.getByTestId('steinbach-scene-badge')).toBeVisible();
  await expect(page.getByTestId('steinbach-scene-badge')).toHaveText(
    'Szenario — der Bruch ist nicht eingetreten',
  );
});

test('the front moves with the study, and stops where the study stops', async ({ page }) => {
  await openScene(page);

  // Before the first published arrival, nothing downstream has been reached.
  await setSceneMinutes(page, 5);
  await expect(page.getByTestId('steinbach-scene-place-schweinheim')).toHaveAttribute(
    'data-reached',
    'false',
  );

  // Schweinheim at ten minutes is the study's own figure, not an interpolation.
  await setSceneMinutes(page, 10);
  await expect(page.getByTestId('steinbach-scene-place-schweinheim')).toHaveAttribute(
    'data-reached',
    'true',
  );
  await expect(page.getByTestId('steinbach-scene-place-heimerzheim')).toHaveAttribute(
    'data-reached',
    'false',
  );

  // At 150 minutes the front is at Heimerzheim, which is where the published record ends. It must
  // not run on past the last figure into territory the study never described.
  await setSceneMinutes(page, 150);
  await expect(page.getByTestId('steinbach-scene-place-heimerzheim')).toHaveAttribute(
    'data-reached',
    'true',
  );
});

test('a place the study gave no time for never acquires one from the animation', async ({
  page,
}) => {
  await openScene(page);

  // Palmersheim is the trap. It has a modelled depth, so it looks like a place with a figure, and
  // an earlier draft of the data module duly invented 30 minutes for it. The interpolation will
  // happily sweep the front across it — that is the front's position, which is allowed to move —
  // but the published-arrival column must stay empty while that happens.
  await setSceneMinutes(page, 60);
  await expect(page.getByTestId('steinbach-scene-place-palmersheim')).toHaveAttribute(
    'data-reached',
    'true',
  );
  await expect(page.getByTestId('steinbach-lead-palmersheim')).toHaveText('nicht angegeben');
});

test('the scene draws a modelled depth and says that is what it is', async ({ page }) => {
  await openScene(page);
  const scene = await page.getByTestId('steinbach-scene').innerText();

  // ⚠️ This assertion used to be the opposite one. The caption said "die Lage der Front, keine
  // Wassertiefe", because the study publishes depths for two of its four places and drawing a
  // surface looked like inventing the other two.
  //
  // What changed is not the standard, it is where the missing depths come from. They are no
  // longer absent and no longer invented: they follow from the 1.5 Mm³ the study says was
  // released, routed over cross-sections cut from DGM1 — the same derivation the Ahr uses — and
  // the study's one published depth is held back as a CHECK on the result rather than fed in as
  // an input. So the scene may draw a depth, and must say it is simulated.
  expect(scene).toMatch(/simulierte Wassertiefe, keine Messung/);
  // Still no per-place figure in the copy. A rendered surface is a model of a shape; a number
  // beside a village name is a claim about that village, and the study only made two of them.
  expect(scene).not.toMatch(/\d+(,\d+)?\s*m\s*tief|Wassertiefe\s*\d/);
  // The vertical exaggeration used to be 6x and had to be declared, because at true scale a
  // 16.5 km corridor read as flat paper. The box is now 5.0 x 6.3 km and climbs 225 m across it,
  // so it is drawn undistorted — and the caption has to say *that* instead. A scene that declares
  // an exaggeration it is not applying is as wrong as one that hides the one it is.
  expect(scene).toMatch(/unverzerrt|keine Überhöhung/);
  expect(scene).not.toMatch(/\d+-fach überhöht/);
});

test("the study's own conclusion travels with the worst case", async ({ page }) => {
  await openScene(page);
  // The scenario is the dramatic half of this module and the conclusion is the sober one. They
  // belong in the same view, or the scene becomes an accusation the study did not make.
  //
  // This used to read the dialog, which was only ever the right place because the scene was
  // rendered inside it. Now the corridor is the map and the dialog is background reading beside
  // it, so the conclusion has to be on the scene itself — which is a stricter reading of the
  // condition than the original, not a looser one.
  const scene = await page.getByTestId('steinbach-scene').innerText();
  expect(scene).toMatch(/Evakuierung von Schweinheim, Palmersheim und Flamersheim richtig war/);
  expect(scene).toMatch(/kein Bereich ausgelassen wurde/);
});

/**
 * The drone over the corridor.
 *
 * The corridor has its own renderer, so it did not inherit the Ahr's drone with the port — the
 * scene shipped with orbit controls only. The arithmetic and the latch are covered in
 * `src/twin3d/__tests__/flyControls.test.ts` and the two-cameras-at-once trap in `freefly.spec.ts`;
 * what is asserted here is only that this scene has the control at all and that it drives.
 *
 * ⚠️ `data-cam`, not pixels — the reservoir surface animates, so no two frames are identical.
 * The helpers live in `e2e/drone-helpers.ts` because the valley spec needs the same ones.
 */

/**
 * The corridor MAP, without the reading panel over it.
 *
 * `openScene` goes through `openPanel`, and `steinbach-panel` is a modal: it sits over the map
 * and swallows pointer events, so a control on the scene itself cannot be clicked while it is
 * open. The existing tests read text, which works through an overlay; these drive a camera,
 * which does not.
 */
async function openCorridorMap(page: Page) {
  await page.getByTestId('scene-switch').selectOption('steinbach-2021');
  await expect(page.getByTestId('steinbach-scene-canvas')).toHaveAttribute(
    'data-scene-ready',
    'true',
    { timeout: 60_000 }
  );
}

test('the corridor has a drone, and says which key takes the camera', async ({ page }) => {
  await openCorridorMap(page);
  await expect(page.getByTestId('steinbach-drone-control')).toHaveAttribute('data-flying', 'false');
  await expect(page.getByTestId('steinbach-freefly-help')).toHaveCount(0);
  // The keys are the only control here too, so the corridor has to say so as well.
  await expect(page.getByTestId('steinbach-freefly-hint')).toContainText(/W A S D/);
});

test('W flies the corridor camera, and the control follows it', async ({ page }) => {
  await openCorridorMap(page);
  await expect(page.getByTestId('steinbach-scene-canvas')).toHaveAttribute('data-cam', /.+/, {
    timeout: 120_000,
  });

  // ⚠️ This test used to assert the opposite first half: that W did NOTHING until the drone was
  // switched on. That was the contract of the old two-model camera, where OrbitControls and the
  // drone bound the same inputs and a toggle had to hold them apart. `flyControls.ts` merges them
  // into one control that engages itself from the input, so W flies — and the toggle is gone
  // entirely, replaced by a readout whose job is to *report* flight rather than to permit it.
  //
  // The half worth keeping is the second one: that it actually flies, measured by distance rather
  // than by a stopwatch, because the frame-delta clamp makes a timed press measure the frame rate.
  await flyUntilMoved(page, 'steinbach-scene-canvas', 'w', 240);

  // Engaging from the keyboard has to reach React, or the readout sits idle while the camera is
  // flying and the interface is lying about which behaviour the wheel and the drag currently have.
  await expect(page.getByTestId('steinbach-drone-control')).toHaveAttribute('data-flying', 'true');
  await expect(page.getByTestId('steinbach-freefly-help')).toContainText(/Kollision|collision/i);
});
