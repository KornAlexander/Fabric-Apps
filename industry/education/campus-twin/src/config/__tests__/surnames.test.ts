import { describe, expect, it } from 'vitest';

import fau from '@config/academic/fau.json';
import koeln from '@config/academic/koeln.json';
import lmu from '@config/academic/lmu.json';
import muenster from '@config/academic/muenster.json';
import oth from '@config/academic/oth.json';
import rwth from '@config/academic/rwth.json';
import tuebingen from '@config/academic/tuebingen.json';

/**
 * Every generated university's lecturer name pool.
 *
 * ⚠️ THIS EXISTS BECAUSE BOTH PROPERTIES FAILED AT ONCE AND NOTHING NOTICED.
 *
 * LMU's pool held 82 names for 102 teaching posts, and the generator indexed it with
 * `pool[i % len(pool)]` — so twenty professors ended up sharing a full name with a colleague in a
 * different faculty, and both halves carried real teaching. `find_teacher` resolves a lecturer by
 * SURNAME, and both the assistant and `/api/calendar?scope=teacher` go through it, so asking about
 * "Lengfelder" returned one of the two and reported the other's workload with total confidence.
 * Separately, `Oberländer` sat in both universities' pools, so one professor appeared to work at
 * Regensburg and Munich at once.
 *
 * The generator now refuses to build rather than wrap. This checks the other half: that the
 * profiles it is given can actually satisfy it, and that the universities stay strangers.
 *
 * ⚠️ SEVEN PROFILES, NOT TWO, AND THE PAIRWISE CHECK IS WHY THAT MATTERS. With two pools there is
 * one pair to keep disjoint and it can be held in a person's head. With seven there are 21, and
 * four of them are between regions that genuinely share a naming stock — Aachen and Köln are both
 * Rhineland, Erlangen and Regensburg are both Bavarian. Those are exactly the pairs a human
 * reviewer would wave through.
 */

interface Profile {
  surnames: string[];
  faculties: { id: string; teachers: number }[];
}

const profiles: [string, Profile][] = [
  ['OTH Regensburg', oth as unknown as Profile],
  ['LMU München', lmu as unknown as Profile],
  ['RWTH Aachen', rwth as unknown as Profile],
  ['Universität zu Köln', koeln as unknown as Profile],
  ['Universität Münster', muenster as unknown as Profile],
  ['FAU Erlangen-Nürnberg', fau as unknown as Profile],
  ['Universität Tübingen', tuebingen as unknown as Profile],
];

describe('lecturer surname pools', () => {
  it.each(profiles)('%s has a distinct name for every teaching post', (_label, profile) => {
    const needed = profile.faculties.reduce((sum, f) => sum + f.teachers, 0);
    const unique = new Set(profile.surnames);
    expect(unique.size).toBe(profile.surnames.length); // no accidental repeats in the list itself
    expect(unique.size).toBeGreaterThanOrEqual(needed);
  });

  it('gives every pair of universities entirely different staff', () => {
    const clashes: string[] = [];
    for (let i = 0; i < profiles.length; i += 1) {
      for (let j = i + 1; j < profiles.length; j += 1) {
        const [leftName, left] = profiles[i];
        const [rightName, right] = profiles[j];
        const rightNames = new Set(right.surnames);
        const shared = left.surnames.filter((name) => rightNames.has(name));
        if (shared.length) clashes.push(`${leftName} / ${rightName}: ${shared.join(', ')}`);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('keeps each pool recognisably its own region', () => {
    // Not a correctness property, but the reason the pools are separate at all: a second
    // university staffed from the first one's list is a tell that nothing behind the names
    // differs either. A handful of names from one region should not appear in another's.
    const othNames = new Set((oth as unknown as Profile).surnames);
    for (const munich of ['Sendlinger', 'Pasinger', 'Nymphenburger', 'Giesinger']) {
      expect(othNames.has(munich)).toBe(false);
    }
    // ⚠️ Aachen and Köln are 70 km apart and share a naming region, which makes them the pair most
    // likely to drift together. `Lövenich` is a place in both cities' orbit and is deliberately in
    // exactly one of the two pools.
    const aachenNames = new Set((rwth as unknown as Profile).surnames);
    const koelnNames = new Set((koeln as unknown as Profile).surnames);
    expect(aachenNames.has('Lövenich')).toBe(true);
    expect(koelnNames.has('Lövenich')).toBe(false);
  });
});
