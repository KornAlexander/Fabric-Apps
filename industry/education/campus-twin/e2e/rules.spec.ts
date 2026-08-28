import { expect, test } from '@playwright/test';

import { waitForCampusReady } from './campus';
import { solverlessAoi } from './release';

/**
 * The Regelwerk — PLAN §26.8, §39, built 2026-08-20.
 *
 * ⚠️ THE POINT OF EVERY CASE HERE IS THAT THE SCREEN CHANGES SOMETHING REAL. A settings page that
 * renders its own state back to itself is theatre, and this repo has been caught by a green test
 * over exactly that shape before (the vacuous room-geometry gate, the pinning script that rewrote
 * nothing and reported success). So the ordering case reads the DERIVED WEIGHT back, and the
 * capacity case asserts the consequence rather than the input.
 */

async function openRules(page: import('@playwright/test').Page) {
  await page.goto('/?aoi=lmu-muenchen');
  await waitForCampusReady(page);
  const rail = page.getByTestId('rail-rules');
  await expect(rail).toBeVisible();
  await rail.click();
  await expect(page.getByTestId('rules-panel')).toBeVisible({ timeout: 60_000 });
}

test.describe('Regelwerk', () => {
  test('ranks the soft rules by dragging, and the weight follows the rank', async ({ page }) => {
    await openRules(page);

    const room = page.getByTestId('rules-order-room');
    const slot = page.getByTestId('rules-order-slot');
    await expect(room).toBeVisible();

    // The shipped ranking: keeping the ROOM is the cheapest change (weight 3), the SLOT next (6).
    await expect(room).toHaveAttribute('data-rank', '1');
    await expect(room).toContainText('3');
    await expect(slot).toContainText('6');

    // Drag "keep the time" above "keep the room".
    await slot.dragTo(room);

    // ⚠️ The assertion that has teeth: the WEIGHT moved, not just the row. The weight is computed
    // by the backend from the ranking, so reading 3 next to the slot proves the round trip.
    await expect(slot).toHaveAttribute('data-rank', '1', { timeout: 30_000 });
    await expect(slot).toContainText('3');
    await expect(room).toContainText('6');

    // Put it back, so the suite leaves the shared backend as it found it.
    await page.getByTestId('rules-reset').click();
    await expect(page.getByTestId('rules-order-room')).toHaveAttribute('data-rank', '1', {
      timeout: 30_000,
    });
  });

  test('an out-of-range number is refused, and says the bounds', async ({ page }) => {
    await openRules(page);
    const field = page.getByTestId('rules-num-breakMin');
    await field.fill('999');
    await field.blur();
    // ⚠️ The refusal must reach the screen. A backend that refuses while the UI says "gespeichert"
    // is worse than one that accepts nonsense, because the planner believes the wrong number.
    await expect(page.getByTestId('rules-note')).toContainText(/zwischen 0 und 60/i, {
      timeout: 30_000,
    });
  });

  test('shows the provenance of every number, so an assumption is visible as one', async ({
    page,
  }) => {
    await openRules(page);
    // `breakMin` has never been agreed with a university (§39.1 row 1). The badge is the whole
    // reason this page exists — it is the surface on which to ask the customer.
    const row = page.getByTestId('rules-num-breakMin').locator('xpath=ancestor::tr');
    await expect(row).toContainText(/angenommen/i);
  });

  test('room capacity is editable, and a shrink reports what no longer fits', async ({ page }) => {
    await openRules(page);
    await page.getByTestId('rules-tab-rooms').click();
    await expect(page.getByTestId('rules-room-table')).toBeVisible({ timeout: 60_000 });

    // A room the LMU plan actually uses (7 booked slots), so the consequence is real rather than
    // hypothetical. ⚠️ Room IDs are per-site — OTH's look like "AB 002", LMU's like "A 022".
    const search = page.getByTestId('rules-room-search');
    await search.fill('A 022');
    const field = page.getByTestId('rules-capacity-A 022');
    await expect(field).toBeVisible({ timeout: 30_000 });
    const original = await field.inputValue();

    await field.fill('1');
    await field.blur();
    // ⚠️ NOT "gespeichert". Shrinking a booked room makes the existing plan illegal, and the whole
    // contract of this panel — inherited from the availability editor — is that the write reports
    // that rather than hiding it behind a green banner.
    await expect(page.getByTestId('rules-note')).toContainText(/passen jetzt nicht mehr/i, {
      timeout: 30_000,
    });

    await field.fill(original);
    await field.blur();
    await expect(page.getByTestId('rules-note')).toContainText(/gespeichert/i, { timeout: 30_000 });
  });

  test('a twin with no timetable offers no Regelwerk at all', async ({ page }) => {
    // ⚠️ THE MIRROR. The rules are the solver's rules and the room table is the planner's stock;
    // on a site with neither, a settings screen would configure a feature that does not exist.
    // Without this case, rendering the rail item everywhere would pass every test above.
    //
    // ⚠️ THE SITE IS DERIVED, NOT NAMED. This drove `/?aoi=tuebingen` until Tübingen was given a
    // generated timetable, at which point it asserted the absence of a Regelwerk the app was right
    // to offer. See `solverlessAoi()`; four specs made the same mistake.
    await page.goto(`/?aoi=${solverlessAoi()}`);
    await waitForCampusReady(page);
    await expect(page.getByTestId('rail-rules')).toHaveCount(0);
  });
});
