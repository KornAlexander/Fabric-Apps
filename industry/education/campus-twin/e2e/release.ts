import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The publication switch, as the end-to-end suite sees it.
 *
 * ⚠️ THE SUITE USED TO BE PINNED TO ONE POSTURE, AND IT WAS THE ONE WE DO NOT PUBLISH.
 * `tum.spec.ts` opened Garching's week and `twin-sites.spec.ts` declared `planner: true` and
 * `lens: 'flow'` for it — all correct with `navigatumData: "include"`, and all impossible under
 * `"synthetic"`, which is the posture the template actually ships. A gallery template whose own
 * test suite is red on arrival is worse than one with fewer tests, and nothing in the repository
 * would have said so: the unit suite runs in all six postures (`tools/test_release_switch.py`),
 * the end-to-end suite ran in none.
 *
 * ⚠️ READ FROM THE FILE, NOT FROM `src/config/release.ts`. A spec is Node and the app module is
 * bundled through Vite aliases; importing it drags the whole config graph into the test runner.
 * The fail-closed rule is small enough to mirror, and `release.test.ts` already guards that the
 * app's own copy agrees with the file.
 */
const RAW = JSON.parse(
  readFileSync(resolve(process.cwd(), 'config/release.json'), 'utf-8'),
) as { navigatumData?: string; excludeAois?: string[]; realCustomerData?: string };

export type NavigatumMode = 'include' | 'synthetic' | 'exclude';

/** An unrecognised value fails CLOSED, exactly as `src/config/release.ts` does. */
export const NAVIGATUM_MODE: NavigatumMode =
  RAW.navigatumData === 'include' || RAW.navigatumData === 'synthetic'
    ? RAW.navigatumData
    : 'exclude';

export const EXCLUDED_AOIS: readonly string[] = RAW.excludeAois ?? [];

export const SHIPS_REAL_CUSTOMER_DATA = RAW.realCustomerData === 'include';

export const GARCHING_SHIPS = !EXCLUDED_AOIS.includes('garching');

/**
 * Garching's planner exists only where its TUMonline-derived dataset does.
 *
 * `hasPlanner` is `Boolean(schedulerSite)` and `applyRelease()` strips that field in both
 * non-`include` modes, so this is the one fact the rail, the week drawer, the assistant and the
 * walk list all follow from.
 */
export const GARCHING_HAS_PLANNER = GARCHING_SHIPS && NAVIGATUM_MODE === 'include';

/** Its interiors survive `synthetic` — the room polygons are OpenStreetMap's, not TUM's. */
export const GARCHING_HAS_INTERIORS = GARCHING_SHIPS && NAVIGATUM_MODE !== 'exclude';

/** The flow lens goes in `synthetic` too: it is routed from real consecutive bookings. */
export const GARCHING_LENS: 'flow' | 'occupancy' | null = !GARCHING_HAS_INTERIORS
  ? null
  : NAVIGATUM_MODE === 'include'
    ? 'flow'
    : 'occupancy';

/**
 * Whether an AOI has a planner behind it, READ FROM ITS CONFIG rather than written down here.
 *
 * ⚠️ THE HAND-WRITTEN VERSION OF THIS FACT HAS NOW GONE STALE IN TWO SEPARATE SPECS. `rail.spec.ts`
 * pinned Tübingen as "the twin with no solver" and went red when Tübingen gained one, having
 * already gone red once when Garching did (PLAN §76). `twin-sites.spec.ts` kept a table declaring
 * `planner: false` for five sites — Tübingen, FAU, Köln, Aachen, Münster — every one of which had
 * since been given a generated timetable, so it asserted that a site says "no timetable" while the
 * app correctly showed a week.
 *
 * Neither failure was a bug in the app. Both were a fact about `config/aoi/*.json` written down in
 * a second place and left behind. So it is read from the one place that decides it.
 *
 * ⚠️ GARCHING IS THE EXCEPTION AND KEEPS `GARCHING_HAS_PLANNER`. Its planner is TUM's real
 * timetable, which `applyRelease()` strips in every non-`include` posture — a fact about the
 * release switch, not about the config file, and this function cannot see it.
 */
export function aoiHasPlanner(aoiId: string): boolean {
  const raw = readFileSync(resolve(process.cwd(), 'config', 'aoi', `${aoiId}.json`), 'utf-8');
  return Boolean((JSON.parse(raw) as { schedulerSite?: string }).schedulerSite);
}

/**
 * The first lens an AOI declares, or `null` if it declares none.
 *
 * ⚠️ THE SAME STALENESS AGAIN, IN A SECOND FIELD. The spec table pinned `lens: null` for FAU, Köln,
 * Aachen and Münster on the stated grounds that they "declare `lenses: []`". All four now declare
 * three, so the suite asserted that the app shows NO lens card while the app correctly showed
 * three — and the comment explaining the pin was still there, describing a state that had ended.
 *
 * ⚠️ GARCHING KEEPS `GARCHING_LENS` for the reason `aoiHasPlanner` skips it: which lens it offers
 * depends on the release posture (`flow` on real data, `occupancy` on substituted), which no
 * config file states.
 */
export function firstLensFor(aoiId: string): string | null {
  const raw = readFileSync(resolve(process.cwd(), 'config', 'aoi', `${aoiId}.json`), 'utf-8');
  const lenses = (JSON.parse(raw) as { lenses?: string[] }).lenses ?? [];
  return lenses[0] ?? null;
}

/**
 * A shipped site with no planner behind it — FOUND, not named.
 *
 * ⚠️ FOUR SPECS HAVE NOW GONE RED ON A HAND-NAMED VERSION OF THIS. `rail.spec.ts` said `garching`
 * until TUM's published week landed, then `tuebingen` until that got a generated one;
 * `twin-sites.spec.ts` pinned five `planner: false` rows and four `lens: null` rows; `guide.spec.ts`
 * opens `/?aoi=tuebingen` under the comment "Garching and Tübingen have no planner"; and
 * `rules.spec.ts` does the same to prove a twin offers no Regelwerk. Not one of them was a bug in
 * the application. Each was a fact about `config/aoi/*.json`, written down somewhere else, left
 * behind when the configs moved.
 *
 * ⚠️ AND THE SILENT FAILURE IS WORSE THAN THE RED ONE. Between Tübingen gaining a planner and
 * `uni-regensburg` being registered, EVERY shipped site had one. There was no site any of these
 * tests could truthfully be pointed at, so the properties they guard — planner-only surfaces
 * ABSENT rather than dead — were guarded by nothing at all. Hence the throw: when the set is
 * empty, that has to be loud.
 *
 * Read from the JSON rather than from the app's registry for the reason given at the top of this
 * file: a spec is Node and the registry is bundled through Vite aliases. `applyRelease()` only ever
 * STRIPS `schedulerSite` (Garching loses it in the non-`include` postures) and never adds one, so a
 * site without it here is without it at runtime too.
 */
export function solverlessAoi(): string {
  const dir = resolve(process.cwd(), 'config', 'aoi');
  const found = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map(
      (f) => JSON.parse(readFileSync(resolve(dir, f), 'utf-8')) as { id: string; schedulerSite?: string },
    )
    .filter((aoi) => !aoi.schedulerSite && !EXCLUDED_AOIS.includes(aoi.id))
    .map((aoi) => aoi.id)
    .sort();

  if (found.length === 0) {
    throw new Error(
      'No shipped AOI is without a schedulerSite, so "a twin with no timetable" cannot be tested. ' +
        'Either the last planner-less site gained one, or this suite has silently stopped guarding ' +
        'that planner-only surfaces are absent rather than dead — see PLAN §76 and §81.',
    );
  }
  return found[0];
}

/**
 * A one-line description of the posture, for skip reasons.
 *
 * ⚠️ EVERY SKIP IN THIS SUITE CARRIES ONE. A silently skipped spec is how four tests once sat
 * disabled while the run stayed green; Playwright prints the reason next to the skip, so the
 * report says *why* coverage is smaller rather than just being smaller.
 */
export const POSTURE = `navigatumData=${NAVIGATUM_MODE}, realCustomerData=${
  SHIPS_REAL_CUSTOMER_DATA ? 'include' : 'exclude'
}${EXCLUDED_AOIS.length ? `, excluded=${EXCLUDED_AOIS.join('/')}` : ''}`;
