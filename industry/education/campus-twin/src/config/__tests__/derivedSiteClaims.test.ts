import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AOIS } from '@/config/aoi';

/**
 * A test that claims a site has no planner must FIND that site, never name it.
 *
 * ⚠️ SIX SPECS HAVE NOW SHIPPED THE SAME MISTAKE, AND EVERY ONE OF THEM WENT RED FOR IT.
 * `rail.spec.ts` said `garching`, then `tuebingen`; `twin-sites.spec.ts` pinned five `planner:
 * false` rows and four `lens: null` rows; `guide.spec.ts` drove `/?aoi=tuebingen` under the comment
 * "Garching and Tübingen have no planner"; `rules.spec.ts` did the same for the Regelwerk. Not one
 * was a defect in the application. Each was a fact about `config/aoi/*.json` written down in a
 * second place, and each was found by a human reading a red run rather than by anything automatic.
 *
 * ⚠️ AND THE SILENT CASE IS WORSE THAN THE RED ONE. Between Tübingen gaining a planner and
 * `uni-regensburg` being registered, EVERY shipped site had one — so a test pointed at any site was
 * asserting something untrue about it, and the properties they guard were guarded by nothing.
 *
 * `solverlessAoi()` fixed the six. This exists so there is no seventh: it fails while the mistake
 * is being written, in a suite that runs in milliseconds, rather than six minutes later in a lane
 * nobody runs by default.
 *
 * ⚠️ NARROW ON PURPOSE. It reads only the test's own NAME — an explicit, deliberate claim by
 * whoever wrote it — and only the navigation inside that test's body. Prose in comments is left
 * alone: an ad-hoc version of this check flagged eleven historical notes, and a check that cries
 * wolf is one somebody silences.
 */

const E2E = resolve(process.cwd(), 'e2e');

/** A test name asserting the site under test has no planner behind it. */
const CLAIMS_NO_PLANNER = /(no timetable|without a timetable|no planner|no solver)/i;

/** `page.goto('/?aoi=garching')` — a literal, as opposed to a `${...}` template. */
const LITERAL_AOI_GOTO = /goto\(\s*'[^']*[?&]aoi=([a-z][a-z-]+)/g;

interface Offence {
  file: string;
  test: string;
  aoi: string;
  hasPlanner: boolean;
}

function scan(): { offences: Offence[]; testsChecked: number } {
  const withPlanner = new Set(
    Object.entries(AOIS)
      .filter(([, aoi]) => Boolean((aoi as { schedulerSite?: string }).schedulerSite))
      .map(([id]) => id),
  );

  const offences: Offence[] = [];
  let testsChecked = 0;

  for (const name of readdirSync(E2E).filter((f) => f.endsWith('.spec.ts'))) {
    const text = readFileSync(resolve(E2E, name), 'utf8');
    // Split into test bodies: from one `test('...'` to the next.
    const starts = [...text.matchAll(/\btest\(\s*'([^']+)'/g)];
    for (let i = 0; i < starts.length; i += 1) {
      const title = starts[i][1];
      if (!CLAIMS_NO_PLANNER.test(title)) continue;
      testsChecked += 1;

      const from = starts[i].index ?? 0;
      const to = starts[i + 1]?.index ?? text.length;
      const body = text.slice(from, to);

      for (const nav of body.matchAll(LITERAL_AOI_GOTO)) {
        const aoi = nav[1];
        /*
          Naming a site that HAS a planner is the bug, already shipped four times. Naming the
          planner-less one is merely fragile — it becomes the same bug the moment that site gains
          one, which is precisely how `garching` and then `tuebingen` each stopped being true. Both
          are refused; the message distinguishes them so a failure explains itself.
        */
        offences.push({ file: name, test: title, aoi, hasPlanner: withPlanner.has(aoi) });
      }
    }
  }
  return { offences, testsChecked };
}

describe('a spec that claims a site has no planner', () => {
  it('has such tests to check — otherwise this file proves nothing', () => {
    /*
      The way this fails open: the test-name pattern stops matching (a rename, a translation) and
      the loop below runs zero times while reporting that every such test derives its site.
    */
    const { testsChecked } = scan();
    expect(testsChecked, 'no test name claims a site lacks a planner — has the wording changed?').toBeGreaterThan(0);
  });

  it('derives the site instead of naming one', () => {
    const { offences } = scan();
    expect(
      offences.map(
        (o) =>
          `${o.file} › "${o.test}" navigates to a hard-coded '${o.aoi}'` +
          (o.hasPlanner
            ? ` — and '${o.aoi}' HAS a planner, so the claim is already false`
            : ` — true today, false the moment '${o.aoi}' gains a planner`),
      ),
      'use solverlessAoi() from e2e/release.ts',
    ).toEqual([]);
  });
});
