import { expect, test, type Page } from '@playwright/test';

/**
 * Act IV — "Was hätte geholfen?" (PLAN §3, §7.4).
 *
 * These tests assert the *arguments*, not just that sliders move. Each lesson makes a specific
 * claim about what changes and — just as importantly — what does not. If a future refactor breaks
 * the distinction between "damage is physics" and "casualties are logistics", the act stops being
 * true and these fail.
 */
test.describe.configure({ mode: 'serial' });

async function setLever(page: Page, id: string, value: number) {
  await page.evaluate(
    ({ id, value }) => {
      const el = document.querySelector<HTMLInputElement>(`[data-testid="act4-lever-${id}"]`)!;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )!.set!;
      setter.call(el, String(value));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    { id, value }
  );
  await page.waitForTimeout(350);
}

/** Numeric value of a KPI, stripping German formatting and the compact-notation suffix. */
async function kpi(page: Page, id: string): Promise<number> {
  const text = await page.getByTestId(`act4-kpi-${id}`).innerText();
  const value = text.split('\n')[1] ?? text;
  const match = value.match(/([\d.,]+)/);
  if (!match) throw new Error(`no number in KPI ${id}: ${text}`);
  let n = Number(match[1].replace(/\./g, '').replace(',', '.'));
  if (/Mio/.test(value)) n *= 1e6;
  if (/Mrd/.test(value)) n *= 1e9;
  return n;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page.getByTestId('remembrance-continue').click();
  await expect(page.getByTestId('twin3d-canvas')).toHaveAttribute('data-ready', 'true', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('act4-panel')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('act4-toggle').click();
  await expect(page.getByTestId('act4-levers')).toBeVisible();
});

test('lesson 1 — warning time moves people, not damage', async ({ page }) => {
  const peopleBefore = await kpi(page, 'people');
  const lossBefore = await kpi(page, 'loss');
  const buildingsBefore = await kpi(page, 'buildings');

  await setLever(page, 'warning', 6);

  const peopleAfter = await kpi(page, 'people');
  const lossAfter = await kpi(page, 'loss');
  const buildingsAfter = await kpi(page, 'buildings');

  // People fall substantially...
  expect(peopleAfter).toBeLessThan(peopleBefore * 0.5);
  // ...while the water does exactly what it was always going to do.
  expect(lossAfter).toBeCloseTo(lossBefore, -3);
  expect(buildingsAfter).toBe(buildingsBefore);
});

test('lesson 3 — cover shifts who carries the loss, not its size', async ({ page }) => {
  const lossBefore = await kpi(page, 'loss');
  const uncoveredBefore = await kpi(page, 'uncovered');

  await setLever(page, 'elementar', 1);

  expect(await kpi(page, 'loss')).toBeCloseTo(lossBefore, -3);
  expect(await kpi(page, 'uncovered')).toBeLessThan(uncoveredBefore * 0.25);
});

test('lesson 5 — flood-adapted building lowers damage at the same depth', async ({ page }) => {
  const lossBefore = await kpi(page, 'loss');
  const buildingsBefore = await kpi(page, 'buildings');

  await setLever(page, 'resilient', 1);

  // Same water, same buildings in it, materially less damage.
  expect(await kpi(page, 'buildings')).toBe(buildingsBefore);
  expect(await kpi(page, 'loss')).toBeLessThan(lossBefore * 0.75);
});

test('every lever names the lesson it belongs to', async ({ page }) => {
  // PLAN §7.4: "the levers are the argument, not a sandbox".
  const panel = page.getByTestId('act4-levers');
  await expect(panel).toContainText('Lektion 1');
  await expect(panel).toContainText('Lektion 2');
  await expect(panel).toContainText('Lektion 3');
  await expect(panel).toContainText('Lektion 5');
});

test('the copy stays descriptive and never recommends', async ({ page }) => {
  // PLAN §14 Q8: descriptive, not normative. No advocacy, no imperative mood.
  const text = await page.getByTestId('act4-panel').innerText();
  expect(text).toContain('keine Empfehlung');
  expect(text).toMatch(/simuliert/);
  expect(text).not.toMatch(/Pflichtversicherung|sollte|müssen Sie|fordern/i);
});

test('reset returns the levers to the 2021 baseline', async ({ page }) => {
  const peopleBefore = await kpi(page, 'people');
  await setLever(page, 'warning', 9);
  expect(await kpi(page, 'people')).toBeLessThan(peopleBefore);

  await page.getByTestId('act4-reset').click();
  await page.waitForTimeout(350);
  expect(await kpi(page, 'people')).toBe(peopleBefore);
});

test('every lever explains itself in its own words', async ({ page }) => {
  // Retention and flood-adapted building both belong to lesson 5, and both were showing the same
  // sentence — three identical lines printed twice in a row, which reads as a rendering fault
  // rather than as two halves of one lesson. Each lever now carries the half about itself.
  const lessons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="act4-levers"] p')).map((p) =>
      (p as HTMLElement).innerText.trim()
    )
  );

  expect(lessons.length).toBeGreaterThanOrEqual(5);
  const lessonLines = lessons.filter((l) => /Lektion|Lesson/.test(l));
  expect(new Set(lessonLines).size, `a lesson is repeated: ${JSON.stringify(lessonLines)}`).toBe(
    lessonLines.length
  );
});

test('a lever at rest does not read as minus zero', async ({ page }) => {
  // The retention readout hard-coded its minus sign, so "no retention" printed as "−0 %".
  const text = await page.getByTestId('act4-levers').innerText();
  expect(text).not.toMatch(/[−-]0\s*%/);
  expect(text).toMatch(/\b0 %/);

  // And the sign must come back as soon as the lever actually does something.
  await setLever(page, 'retention', 0.2);
  await expect(page.getByTestId('act4-levers')).toContainText('−20 %');
});
