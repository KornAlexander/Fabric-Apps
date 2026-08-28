import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AOIS } from '@/config/aoi';

/**
 * A site list written out by hand in an end-to-end spec must still name every site that ships.
 *
 * ⚠️ WRITTEN BECAUSE A STALE PIN WENT UNNOTICED FOR TWO PLAN SECTIONS. `twin-sites.spec.ts` names
 * nine ids and asserts the switcher offers exactly those; `uni-regensburg` was registered in §76
 * and the list was not updated. The spec went red — correctly, immediately, and **invisibly**,
 * because that file is not in the fast Playwright lane and takes six minutes to run. Nothing in
 * the default run had anything to say about it.
 *
 * ⚠️ THE PIN ITSELF IS RIGHT AND IS NOT WHAT THIS FIXES. Deriving that list from the registry
 * would compare the registry against itself and pass on an empty menu, which is the exact failure
 * `sites.test.ts` explains at length. The pin stays; this makes it impossible for the pin to rot
 * quietly, by checking it in a suite that runs in seconds.
 *
 * So: the browser still proves the menu WORKS. This proves the browser test is still asking about
 * every site.
 */

const E2E = resolve(process.cwd(), 'e2e');

/**
 * Any array literal holding three or more quoted lower-case ids.
 *
 * ⚠️ BOTH QUOTE STYLES, DELIBERATELY. A single-quote-only pattern was tried and it worked, but a
 * probe reformatting the list to double quotes turned the whole file red — the list was still
 * correct and only its shape had changed. A guard that a formatter can break is a guard somebody
 * deletes. Accepting either quote leaves the vacuity check below firing on a genuinely structural
 * change and silent on a cosmetic one.
 */
const ID_ARRAY = /\[\s*((?:(['"])[a-z][a-z-]+\2\s*,\s*){2,}(['"])[a-z][a-z-]+\3\s*,?)\s*\]/g;

interface PinnedList {
  file: string;
  line: number;
  ids: string[];
}

/** Every hand-written list in `e2e/` that is recognisably a list of AOI ids. */
function pinnedAoiLists(): PinnedList[] {
  const registry = new Set(Object.keys(AOIS));
  const found: PinnedList[] = [];

  for (const name of readdirSync(E2E).filter((f) => f.endsWith('.ts'))) {
    const text = readFileSync(resolve(E2E, name), 'utf8');
    for (const match of text.matchAll(ID_ARRAY)) {
      const ids = [...match[1].matchAll(/['"]([a-z][a-z-]+)['"]/g)].map((m) => m[1]);
      /*
        ⚠️ A LIST IS ONLY "A LIST OF SITES" IF MOST OF IT ALREADY IS. `e2e/` is full of arrays of
        test ids, lens names and day tokens; a looser rule would drag those in, and a check that
        cries wolf is one somebody silences. Two or more real AOI ids, and a clear majority.
      */
      const known = ids.filter((id) => registry.has(id));
      if (known.length < 2 || known.length * 2 <= ids.length) continue;
      found.push({ file: name, line: text.slice(0, match.index).split('\n').length, ids });
    }
  }
  return found;
}

describe('a site list pinned by hand in an e2e spec', () => {
  it('is found at all — otherwise everything below is vacuous', () => {
    /*
      The way this check fails open: the regex stops matching (a reformat, a rename, prettier
      putting the array on one line) and the assertion below iterates an empty array and passes,
      reporting that every pinned list agrees with the registry while reading none of them.
    */
    const lists = pinnedAoiLists();
    expect(lists.length, 'no pinned AOI list found in e2e/ — has the format changed?').toBeGreaterThan(0);
  });

  it('names every site the registry ships', () => {
    const registry = Object.keys(AOIS).sort();
    for (const { file, line, ids } of pinnedAoiLists()) {
      expect(
        [...ids].sort(),
        `${file}:${line} pins a site list that no longer matches the registry`,
      ).toEqual(registry);
    }
  });
});
