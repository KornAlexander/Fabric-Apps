import { expect, test, type Page } from '@playwright/test';

/**
 * The closing screen and the guided tour (PLAN §9.0, §12 Phase 8).
 *
 * These two carry the framing, so the tests are about the framing as much as the mechanics: the
 * app must close on its sources rather than on a rendered flood, and the tour must end on Act IV
 * rather than on the water. §13 names the failure mode they guard against — a presenter who skips
 * the framing and turns the evening into a technology show.
 */

async function enter(page: Page) {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page.getByTestId('remembrance-continue').click();
  await expect(page.getByTestId('twin3d-canvas')).toHaveAttribute('data-ready', 'true', {
    timeout: 60_000,
  });
}

test.beforeEach(async ({ page }) => {
  await enter(page);
});

test('the closing screen is reachable from the header, as the bookend to the opening', async ({
  page,
}) => {
  await page.getByTestId('closing-open').click();
  await expect(page.getByTestId('closing-screen')).toBeVisible();
  await expect(page.getByTestId('closing-screen')).toContainText('Lehren und Quellen');
});

test('it ends on the sources — no logo, no call to action after them', async ({ page }) => {
  await page.getByTestId('closing-open').click();

  // PLAN §9.0: "Last element on screen is the source list. No product logo, no CTA, no contact."
  const { reportsBottom, lastBottom, text } = await page.evaluate(() => {
    const screen = document.querySelector('[data-testid="closing-screen"]')!;
    const reports = document.querySelector('[data-testid="closing-reports"]')!;
    const children = Array.from(screen.querySelectorAll('h2, h3, table, ul, ol'));
    const last = children[children.length - 1];
    return {
      reportsBottom: reports.getBoundingClientRect().bottom,
      lastBottom: last.getBoundingClientRect().bottom,
      text: (screen as HTMLElement).innerText,
    };
  });

  // Nothing structural sits below the source list.
  expect(reportsBottom).toBeGreaterThanOrEqual(lastBottom - 1);
  // And nothing sells anything.
  expect(text).not.toMatch(/kontakt|contact us|jetzt starten|mehr erfahren|demo buchen/i);
});

test('the six lessons carry live numbers from the same engine as the levers', async ({ page }) => {
  await page.getByTestId('closing-open').click();
  const lessons = page.getByTestId('closing-lessons').locator('li');
  await expect(lessons).toHaveCount(6);

  // Warning time moves people and not damage; cover moves who pays and not how much. If those
  // two claims ever stopped being true, the closing screen would be stating something false.
  await expect(page.getByTestId('closing-lesson-warning')).toContainText('%');
  await expect(page.getByTestId('closing-lesson-elementar')).toContainText('%');
  await expect(page.getByTestId('closing-lesson-resilient')).toContainText('%');

  // Lesson 2 carries evidence rather than a claim: the share of flooded buildings that sat in the
  // rare classes. Without it, the hazard overlay looks like the flood in different colours and
  // the lesson is contradicted by the app's own data.
  await expect(page.getByTestId('closing-lesson-hazard')).toContainText('GK1');
  await expect(page.getByTestId('closing-lesson-hazard')).toContainText('%');

  // The two that genuinely are not quantities must not be given invented figures.
  for (const id of ['silos', 'assistant']) {
    await expect(page.getByTestId(`closing-lesson-${id}`)).not.toContainText('%');
  }
});

test('the provenance table names an issuer and a licence for every layer', async ({ page }) => {
  await page.getByTestId('closing-open').click();
  const rows = page.getByTestId('closing-provenance').locator('tbody tr');
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(5);
  for (let i = 0; i < count; i += 1) {
    const cells = rows.nth(i).locator('td');
    for (let c = 0; c < 3; c += 1) {
      expect((await cells.nth(c).innerText()).trim().length).toBeGreaterThan(0);
    }
  }
});

test('the tour runs its whole story and ends on Act IV', async ({ page }) => {
  await page.getByTestId('tour-start').click();
  await expect(page.getByTestId('tour-card')).toBeVisible();

  // The count comes from the story rather than a literal. Pinning it at eight made this test
  // fail for the one change it should not object to — adding story points — while saying nothing
  // about whether the tour still ends where it must.
  const total = await page.getByTestId('tour-card').locator('[aria-hidden="true"] > span').count();
  expect(total).toBeGreaterThanOrEqual(8);
  await expect(page.getByTestId('tour-progress')).toHaveText(`1 von ${total}`);

  for (let step = 1; step < total; step += 1) {
    await page.getByTestId('tour-next').click();
    await expect(page.getByTestId('tour-progress')).toHaveText(`${step + 1} von ${total}`);
  }

  // The last step is the one the whole tour exists to reach.
  await expect(page.getByTestId('tour-card')).toContainText('Was hätte geholfen?');
});

test('finishing the tour hands over to the closing screen, not back to the flood', async ({
  page,
}) => {
  await page.getByTestId('tour-start').click();
  const total = await page.getByTestId('tour-card').locator('[aria-hidden="true"] > span').count();
  for (let step = 0; step < total; step += 1) await page.getByTestId('tour-next').click();

  await expect(page.getByTestId('closing-screen')).toBeVisible();
  await expect(page.getByTestId('tour-card')).toHaveCount(0);
});

test('the tour drives the map rather than just talking about it', async ({ page }) => {
  const clock = () => page.getByTestId('twin3d-clock').innerText();
  await page.getByTestId('tour-start').click();
  const first = await clock();

  // Step 2 is the Ahr loop at Altenahr; step 3 pins the clock an hour before the peak.
  await page.getByTestId('tour-next').click();
  await page.getByTestId('tour-next').click();
  const second = await clock();
  expect(second).not.toBe(first);

  // Step 6 is Dernau at its own modelled peak. The village rail is one of the panels that steps
  // aside for the duration of a tour, so the chip cannot be read while the card is up — end the
  // tour first and assert the state it left behind, which is the thing being claimed anyway:
  // the tour moved the map, not just the words.
  await page.getByTestId('tour-next').click();
  await page.getByTestId('tour-next').click();
  await page.getByTestId('tour-next').click();
  const third = await clock();
  expect(third).not.toBe(second);

  await page.getByTestId('tour-end').click();
  await expect(page.getByTestId('twin3d-place-dernau')).toHaveAttribute('aria-pressed', 'true');
});

test('the tour card shares the timeline column instead of floating over it', async ({ page }) => {
  // It used to be anchored bottom-left, which cleared the timeline panel by 12 px at 1600 wide
  // and covered it completely at 940, because the panel is centred and moves inward as the
  // viewport narrows while a corner-anchored card does not.
  for (const width of [1600, 1280, 940]) {
    await page.setViewportSize({ width, height: 800 });
    if (!(await page.getByTestId('tour-card').isVisible())) {
      await page.getByTestId('tour-start').click();
    }
    const overlap = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="tour-card"]')!.getBoundingClientRect();
      const play = document.querySelector('[data-testid="twin3d-play"]')!;
      const panel = play.closest('.max-w-3xl')!.getBoundingClientRect();
      const w = Math.max(0, Math.min(card.right, panel.right) - Math.max(card.left, panel.left));
      const h = Math.max(0, Math.min(card.bottom, panel.bottom) - Math.max(card.top, panel.top));
      return Math.round(w * h);
    });
    expect(overlap, `tour card covers the timeline panel at ${width} px`).toBe(0);
  }
});

test('both screens read in English too', async ({ page }) => {
  await page.getByTestId('lang-en').click();
  await page.getByTestId('closing-open').click();
  await expect(page.getByTestId('closing-screen')).toContainText('Lessons and sources');
  await page.getByTestId('closing-close').click();

  await page.getByTestId('tour-start').click();
  const total = await page.getByTestId('tour-card').locator('[aria-hidden="true"] > span').count();
  await expect(page.getByTestId('tour-progress')).toHaveText(`1 of ${total}`);
});
