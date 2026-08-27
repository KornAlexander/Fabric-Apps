import { expect, test } from '@playwright/test';

/**
 * Timeline annotations (PLAN §3 Act II).
 *
 * The point of these tests is not that captions appear — it is that they stay honest. Every beat
 * declares whether it is modelled or sourced, and the one beat presented as fact carries its
 * citation. If that separation ever breaks, the app is asserting a timeline for the night of
 * 14 July that it has no source for, which §2.2 forbids.
 */
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page.getByTestId('remembrance-continue').click();
  await expect(page.getByTestId('twin3d-canvas')).toHaveAttribute('data-ready', 'true', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('twin3d-story-toggle')).toBeVisible({ timeout: 30_000 });
});

test('the timeline is annotated, and the markers are navigable', async ({ page }) => {
  // The beats are derived by walking the simulation, so their number is an output, not a
  // constant: when the building set grew, the half-extent moment slid inside the minimum gap
  // around the peak and was collapsed into it, exactly as the collision rule intends. Pinning an
  // exact count would only have recorded which run happened to come first.
  //
  // What must hold is that the timeline is annotated at all, that the anchors survive, and that
  // every marker is a distinct moment in order.
  const markers = page.locator('[data-testid^="twin3d-story-marker-"]');
  await expect.poll(async () => markers.count()).toBeGreaterThanOrEqual(4);

  for (const anchor of ['firstWater', 'peak', 'maxExtent', 'dayAfter']) {
    await expect(page.getByTestId(`twin3d-story-marker-${anchor}`)).toHaveCount(1);
  }

  await page.getByTestId('twin3d-story-marker-firstWater').click();
  const early = await page.getByTestId('twin3d-clock').innerText();
  await page.getByTestId('twin3d-story-marker-dayAfter').click();
  const late = await page.getByTestId('twin3d-clock').innerText();
  expect(early).not.toBe(late);
  await expect(page.getByTestId('twin3d-clock')).toContainText('15.07., 22:00');
});

test('every caption says whether it is modelled or sourced', async ({ page }) => {
  const ids = await page
    .locator('[data-testid^="twin3d-story-marker-"]')
    .evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).dataset.testid!.replace('twin3d-story-marker-', ''))
    );
  expect(ids.length).toBeGreaterThanOrEqual(4);
  const sourced: string[] = [];

  for (const id of ids) {
    await page.getByTestId(`twin3d-story-marker-${id}`).click();
    await expect(page.getByTestId('twin3d-story-caption')).toBeVisible();
    const kind = await page.getByTestId('twin3d-story-kind').innerText();
    expect(kind).toMatch(/^(MODELLIERT|AMTLICH)$/);
    if (kind === 'AMTLICH') sourced.push(id);
  }

  // Exactly one beat may claim to be documented rather than modelled, and it is the peak.
  expect(sourced).toEqual(['peak']);
});

test('the sourced beat carries its citation, not a bare number', async ({ page }) => {
  await page.getByTestId('twin3d-story-marker-peak').click();
  const caption = page.getByTestId('twin3d-story-caption');
  await expect(caption.getByTestId('sourced-figure').first()).toBeVisible();
  await expect(caption).toContainText('Landesamt für Umwelt');
  await expect(caption).toContainText('m³/s');
  // §4.8: an unsourced figure would render as a defect marker. There must be none here.
  await expect(caption.getByTestId('unsourced-figure')).toHaveCount(0);
});

test('the peak beat admits that the time of the peak was never measured', async ({ page }) => {
  // The figures are official; the hour is not. The Altenahr gauge was destroyed at 20:45 with
  // 575 cm on the board, so no peak time exists in any record. The app anchors its clock to 22:00
  // as an assumption, and §4.8 does not allow that to pass as fact just because it sits next to
  // figures that are sourced.
  await page.getByTestId('twin3d-story-marker-peak').click();
  const caption = page.getByTestId('twin3d-story-caption');
  await expect(caption).toContainText('575');
  await expect(caption).toContainText('20:45');
  await expect(caption).toContainText('nie gemessen');
});

test('the largest extent comes after the peak at the gauge', async ({ page }) => {
  // This is the substantive claim the annotations make: the wave takes time to travel, so the
  // moment of greatest extent is not the moment of the peak. If the two collapse onto the same
  // time, the caption that explains the lag stops being true.
  await page.getByTestId('twin3d-story-marker-peak').click();
  await expect(page.getByTestId('twin3d-clock')).toContainText('14.07., 22:00');

  await page.getByTestId('twin3d-story-marker-maxExtent').click();
  await expect(page.getByTestId('twin3d-clock')).toContainText('15.07.');
});

test('each village shows its own peak time, later downstream', async ({ page }) => {
  // The wave takes about 105 minutes to get from Altenahr to Ahrweiler. That is real but it is
  // under 5 % of a 36-hour timeline, so scrubbing alone makes the villages look simultaneous.
  // Stating each village's own time is what makes the lag legible — and if the sign of the lag
  // ever flipped, this is where it would show.
  const peakAt = async (id: string) => {
    const text = await page.getByTestId(`twin3d-peak-${id}`).innerText();
    const match = text.match(/(\d{2}):(\d{2})/);
    expect(match, `no peak time on ${id}`).not.toBeNull();
    return Number(match![1]) * 60 + Number(match![2]);
  };

  const altenahr = await peakAt('altenahr');
  const dernau = await peakAt('dernau');
  const ahrweiler = await peakAt('ahrweiler');

  // Strictly later downstream. This used to assert that Ahrweiler's clock wrapped past midnight,
  // which was only true while its pin sat 1.45 km too far east — on Bad Neuenahr rather than on
  // Ahrweiler. Ordering is the claim; which side of midnight it lands on is an accident of where
  // the evening's peak happens to fall.
  expect(dernau).toBeGreaterThan(altenahr);
  expect(ahrweiler).toBeGreaterThan(dernau);

  const spreadMinutes = ahrweiler - altenahr;
  expect(spreadMinutes).toBeGreaterThan(60);
  expect(spreadMinutes).toBeLessThan(180);
});

test('each village can be jumped to its own peak', async ({ page }) => {
  // The most specific question the timeline can answer is when the water was highest *here*, so
  // the per-village time is a control rather than a caption. Each button must land on its own
  // moment, not on the gauge peak they all share.
  const jump = async (id: string) => {
    const label = await page.getByTestId(`twin3d-peak-${id}`).innerText();
    const expected = label.match(/(\d{2}:\d{2})/)![1];
    await page.getByTestId(`twin3d-peak-${id}`).click();
    await expect(page.getByTestId('twin3d-clock')).toContainText(expected);
    // Jumping there also brings the camera, because the moment is only worth seeing over the
    // village it belongs to.
    await expect(page.getByTestId(`twin3d-place-${id}`)).toHaveAttribute('aria-pressed', 'true');
    return expected;
  };

  const altenahr = await jump('altenahr');
  const ahrweiler = await jump('ahrweiler');
  expect(altenahr).not.toBe(ahrweiler);

  // Taking hold of a moment must stop playback, like the scrubber does.
  await page.getByTestId('twin3d-play').click();
  await page.getByTestId('twin3d-peak-dernau').click();
  await expect(page.getByTestId('twin3d-play')).toHaveAttribute('aria-pressed', 'false');
});

test('annotations can be switched off and back on', async ({ page }) => {
  const toggle = page.getByTestId('twin3d-story-toggle');
  await page.getByTestId('twin3d-story-marker-peak').click();
  await expect(page.getByTestId('twin3d-story-caption')).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('twin3d-story')).toHaveCount(0);
  await expect(page.getByTestId('twin3d-story-caption')).toHaveCount(0);
  // The scrubber and the twin keep working without them.
  await expect(page.getByTestId('twin3d-scrubber')).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('twin3d-story-caption')).toBeVisible();
});

test('playback advances through the beats', async ({ page }) => {
  await page.getByTestId('twin3d-story-marker-firstWater').click();
  const first = await page.getByTestId('twin3d-story-caption').innerText();

  await page.getByTestId('twin3d-play').click();
  // 40 simulated minutes per real second, so a second or two crosses into the next beat — but only
  // once frames are actually being delivered. Under a full-suite run this shares a GPU with the
  // other 3D specs, so the budget is generous rather than tight.
  await expect
    .poll(async () => page.getByTestId('twin3d-story-caption').innerText(), { timeout: 40_000 })
    .not.toBe(first);
  await page.getByTestId('twin3d-play').click();
});
