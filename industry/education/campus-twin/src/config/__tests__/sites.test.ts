import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import de from '@/i18n/de.json';
import en from '@/i18n/en.json';
import { AOIS, DEFAULT_AOI, hasPlanner, supportsLens, type AoiConfig } from '@/config/aoi';
import { EXCLUDED_AOIS, NAVIGATUM_MODE } from '@/config/release';
import { knownSchedulerSites } from '@/api/scheduler';

/**
 * ⚠️ THE BACKEND URLS COME FROM `.env.local`, WHICH `rayfin env` GENERATES AND GIT IGNORES.
 * `knownSchedulerSites()` reads them through `import.meta.env`, so on a fresh clone it is empty
 * and the one case that depends on it fails for a missing prerequisite rather than a defect.
 * Everything else in this file is about the committed registry and runs anywhere.
 *
 * ⚠️ THE GUARD ASKS FOR THE SCHEDULER KEYS SPECIFICALLY, not for the file. `rayfin env` can
 * write a file with only a comment header, or with Fabric identifiers and no backend URLs at all
 * — both leave `knownSchedulerSites()` empty while an existence check says go, which turns a
 * missing prerequisite into a red suite.
 */
const ENV_LOCAL = (() => {
  const path = resolve(process.cwd(), '.env.local');
  if (!existsSync(path)) return false;
  return /^VITE_[A-Z0-9_]*SCHEDULER_API/m.test(readFileSync(path, 'utf-8'));
})();

/**
 * The site-registry contract.
 *
 * Campus-Scheduler shipped one university and then acquired a second, which is the moment every
 * "the AOI is configuration" claim gets tested for real. `src/config/aoi.ts` warns about exactly
 * this in its module note, and the warning was earned elsewhere in the same codebase: components
 * that simply imported the one JSON file by name.
 *
 * These checks are about the SEAMS between an AOI and the rest of the app — the places where a
 * second site can be wrong in a way that nothing else notices:
 *
 *   * a tour caption key that has no translation. ⚠️ The i18n catalogue test cannot catch this
 *     one. It scans for literal `t('...')` calls in source, and a tour caption is never written
 *     that way — it arrives from JSON at runtime. A missing `tour.lmu.klinikum` would render as
 *     the raw key on screen, invisible to tsc, to that test, and to any e2e assertion that only
 *     checks an element is present and non-empty. That is precisely the defect the catalogue test
 *     was written to stop, coming in through a door it does not watch.
 *   * a tour stop pointing at a focus place that does not exist
 *   * a focus place or campus box outside the AOI's own core box, which would put the camera or
 *     the building filter somewhere the terrain was never built
 */

const CATALOGUES: Record<string, unknown> = { de, en };

function lookup(catalogue: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      catalogue,
    );
}

const entries = Object.entries(AOIS) as [string, AoiConfig][];

/**
 * Every site this repository can build, before `config/release.json` has its say.
 *
 * ⚠️ WRITTEN OUT IN FULL ON PURPOSE, then filtered — not read back off `AOIS`. Comparing the
 * registry against itself would pass on an empty registry, which is precisely the accident a
 * release switch can cause.
 */
const ALL_SITES = [
  'aachen',
  'campus-demo',
  'fau-erlangen',
  'garching',
  'koeln',
  'lmu-muenchen',
  'muenster',
  'oth-regensburg',
  'tu-berlin',
  'tuebingen',
  'uni-regensburg',
];
const EXPECTED_SITES = ALL_SITES.filter((id) => !EXCLUDED_AOIS.includes(id));

/** Garching is the only NavigaTUM site, so either lever can take it out of scope. */
const GARCHING_SHIPS = !EXCLUDED_AOIS.includes('garching');

describe('the AOI registry', () => {
  it('ships every university and defaults to the first customer', () => {
    // ⚠️ EIGHT OF THE NINE HAVE A PLANNER, AND SIX OF THOSE DID NOT. Garching and Tübingen arrived
    // from Campus-Insights as campus twins — scenes, rooms and lenses, no timetable — and FAU
    // Erlangen, Köln, Aachen and Münster were built later for the top-ten-by-students set and were
    // twins for the same reason: none of them publishes a timetable this project can read. That is
    // still true. What changed is that "no published timetable" stopped meaning "no planner": six
    // of them were given a GENERATED one, the OTH and LMU route, with an academic profile,
    // ownership rules and a `data/synthetic-<id>/provenance.json` that says in as many words that
    // the timetable is invented and the buildings are not.
    //
    // ⚠️ THE NINTH, `uni-regensburg`, IS THE ONE THAT DELIBERATELY HAS NONE, and it is registered
    // for that reason as much as for its scene. When every site carried a planner, the guard in
    // `rail.spec.ts` — a twin with no timetable offers no week, no walks and no changes — had no
    // subject left and stopped guarding anything. See PLAN §76.
    expect(Object.keys(AOIS).sort()).toEqual(EXPECTED_SITES);
    expect(DEFAULT_AOI).toBe('oth-regensburg');
  });

  it('gives a planner exactly to the sites that have a timetable behind it', () => {
    // The pairing that matters: a site claiming a backend must name which one, and a site with no
    // backend must not be quietly carrying a stale `schedulerSite` from whatever it was forked
    // from. Pinned by id so adding a ninth site is a decision rather than an inherited default.
    //
    // ⚠️ GARCHING'S PLANNER IS TUM'S REAL TIMETABLE, so it alone drops out in every mode that
    // withholds NavigaTUM data. The other seven are generated and are withheld by nothing.
    // Substituting the twin's occupancy does NOT substitute the planner: its dataset is a
    // separate derivation of the same TUMonline bookings, in `data/tum/`.
    const expected = [
      'aachen',
      'campus-demo',
      'fau-erlangen',
      'garching',
      'koeln',
      'lmu-muenchen',
      'muenster',
      'oth-regensburg',
      'tu-berlin',
      'tuebingen',
    ].filter(
      (id) => !EXCLUDED_AOIS.includes(id) && !(NAVIGATUM_MODE !== 'include' && id === 'garching'),
    );
    const withPlanner = entries.filter(([, aoi]) => hasPlanner(aoi)).map(([id]) => id);
    expect(withPlanner.sort()).toEqual(expected);
    for (const [id, aoi] of entries) {
      expect(Boolean(aoi.schedulerSite), id).toBe(hasPlanner(aoi));
    }
  });

  it.skipIf(!ENV_LOCAL)(
    'knows a backend for every site that claims one (needs `rayfin env --framework vite`)',
    () => {
    /*
     * ⚠️ THE TRAP THIS EXISTS FOR. `hasPlanner` is `Boolean(schedulerSite)`, so one line in an AOI
     * turns the entire planner on — and `apiBase()` resolves an unregistered site to the
     * single-backend FALLBACK, which is another university's container. Adding the AOI line
     * without the base would render Garching's campus over OTH's timetable under a TUM heading:
     * every request succeeds, every number is real, and all of them are about someone else.
     *
     * The failure is silent by construction, so it has to be caught here rather than noticed.
     */
    const known = knownSchedulerSites();
    for (const [id, aoi] of entries) {
      if (!aoi.schedulerSite) continue;
      expect(known, `${id} names scheduler site "${aoi.schedulerSite}" with no backend URL`).toContain(
        aoi.schedulerSite
      );
    }
    },
  );

  it.each(entries)('%s keys itself by its own id', (id, aoi) => {
    // A registry keyed by one id holding a config that calls itself another is how the wrong
    // terrain directory gets loaded — `public/terrain/<aoi.id>` is derived from the config.
    expect(aoi.id).toBe(id);
  });

  it.runIf(GARCHING_SHIPS)(
    'offers no lens that would divide real teaching among invented people',
    () => {
      /*
       * ⚠️ A RATIFIED PRODUCT DECISION, PINNED SO IT CANNOT BE UNDONE BY ACCIDENT.
       *
       * Both of these lenses answer questions about PEOPLE and COHORTS: `staffing` divides
       * teaching load against each lecturer's contracted SWS, `quality` measures how a cohort's
       * day is shaped. At Garching the sessions, rooms and hours are really TUM's, and the
       * lecturers and cohorts are invented — TUMonline publishes neither. So both lenses would
       * compute exact, confident findings about fabricated staff, attached by name to real courses.
       *
       * That is the single most misleading pairing this project can produce, and it would look
       * completely normal on screen. The site simply does not declare them (`lenses` is
       * `["occupancy", "flow"]`), but "we happened not to add it" is not a guarantee — this is.
       *
       * Skipped when `config/release.json` withholds Garching outright; when it withholds only
       * the TUM data the site is still here with `lenses: []`, which satisfies this just as well.
       */
      const garching = AOIS['garching'];
      expect(garching.lenses).not.toContain('staffing');
      expect(garching.lenses).not.toContain('quality');
      expect(supportsLens(garching, 'staffing')).toBe(false);
      expect(supportsLens(garching, 'quality')).toBe(false);
    },
  );
});

describe.each(entries)('%s', (_id, aoi) => {
  it('describes itself in both languages', () => {
    for (const lang of Object.keys(CATALOGUES)) {
      expect(aoi.site.name[lang]?.length).toBeGreaterThan(0);
      expect(aoi.site.region[lang]?.length).toBeGreaterThan(0);
    }
  });

  it('has a tour whose stops all exist as focus places', () => {
    const places = new Set(aoi.focusPlaces.map((p) => p.id));
    expect(aoi.tour.length).toBeGreaterThan(0);
    for (const stop of aoi.tour) {
      expect(places, `tour stop '${stop.placeId}'`).toContain(stop.placeId);
    }
  });

  it('has a translated caption for every tour stop, in every language', () => {
    for (const [lang, catalogue] of Object.entries(CATALOGUES)) {
      for (const stop of aoi.tour) {
        const caption = lookup(catalogue, stop.captionKey);
        expect(typeof caption, `${lang}: ${stop.captionKey}`).toBe('string');
        expect((caption as string).length).toBeGreaterThan(0);
      }
    }
  });

  /**
   * ⚠️ A SITE THAT SHOWS ROOMS MUST SAY WHERE THEY CAME FROM — IN ITS OWN WORDS.
   *
   * Both provenance lines used to be one hard-coded sentence about OTH's published storey plans,
   * and it was rendered over TUM Garching and LMU as well. At Garching it was wrong in both
   * directions at once: the floor plans there are OpenStreetMap indoor mapping, not an OTH CAD
   * drawing, and the bookings are REAL TUMonline data, not a generated timetable — the app was
   * disclaiming as invented the one dataset in the whole project that is genuinely measured.
   *
   * These keys are built from the AOI id at runtime, so `catalogue.test.ts` cannot see them: its
   * scan finds literal `t('...')` calls, and this is a template. Same door the tour captions come
   * through, which is why the check lives here.
   */
  it('names its own room provenance in every language, when it has rooms', () => {
    if (!aoi.rooms) return;
    for (const [lang, catalogue] of Object.entries(CATALOGUES)) {
      for (const key of [`rooms.provenance.${aoi.id}`, `occupancy.provenance.${aoi.id}`]) {
        const line = lookup(catalogue, key);
        expect(typeof line, `${lang}: ${key}`).toBe('string');
        expect((line as string).length).toBeGreaterThan(20);
      }
    }
  });

  it('keeps every focus place inside its own core box', () => {
    for (const place of aoi.focusPlaces) {
      expect(place.lat, place.id).toBeGreaterThanOrEqual(aoi.bbox.south);
      expect(place.lat, place.id).toBeLessThanOrEqual(aoi.bbox.north);
      expect(place.lon, place.id).toBeGreaterThanOrEqual(aoi.bbox.west);
      expect(place.lon, place.id).toBeLessThanOrEqual(aoi.bbox.east);
    }
  });

  it('nests its core box inside its shell', () => {
    expect(aoi.bbox.west).toBeGreaterThanOrEqual(aoi.shell.west);
    expect(aoi.bbox.east).toBeLessThanOrEqual(aoi.shell.east);
    expect(aoi.bbox.south).toBeGreaterThanOrEqual(aoi.shell.south);
    expect(aoi.bbox.north).toBeLessThanOrEqual(aoi.shell.north);
  });

  it('holds exactly the campuses it is supposed to, all inside the core box', () => {
    // ⚠️ PINNED BY ID, NOT BY COUNT. This asserted `toHaveLength(2)` and had to be revisited the
    // moment OTH gained a third location — which is the wrong kind of revisit, because a bare
    // count cannot tell "we added TechBase on purpose" from "we silently lost Prüfening". Naming
    // them catches a loss, a rename and an accidental addition, and it makes the third site a
    // deliberate edit here rather than a number that quietly changed.
    const expected: Record<string, string[]> = {
      // ⚠️ TECHBASE IS NOT HERE, AND WAS BRIEFLY LISTED AS A CAMPUS BY MISTAKE. OTH is a TENANT in
      // the TechBase building — `building=office` operated by TechBase Regensburg, with Vector
      // Informatik, GEFASOFT and intive at the same address — and its presence is one node, the
      // Sensorik-Applikationszentrum. The AOI config's own comment said "ONE TENANCY IN ONE
      // BUILDING, not a campus" while the entry sat in `campuses[]` regardless. The tenancy still
      // shows up in `ownership.extraIds`, which is the honest place for it: a building OTH
      // operates in, not a site OTH has.
      'oth-regensburg': ['pruefening', 'seyboth'],
      'lmu-muenchen': ['klinikum', 'stammgelaende'],
      // ⚠️ GARCHING CARRIES NO `campuses` BLOCK, AND THE ABSENCE IS THE STATEMENT. It is a
      // single-site AOI — one research campus — so there is no corridor between two locations for
      // the plan to reason about, which is the only reason the block exists. It is listed here
      // with an empty expectation rather than left out of the table, because omitting it would
      // quietly drop it from this guard and a `campuses` block appearing later by accident would
      // then go unnoticed.
      garching: [],
      // ⚠️ THE FIVE ENTRIES BELOW WERE ALL `[]`, AND THE REASON THEY WERE IS WORTH KEEPING. It ran:
      // "real on the ground, and not declared, because `campuses` exists for a planner to reason
      // about a corridor and neither site has a timetable to reason with." That was correct while
      // it was true. All five now have a generated timetable, an academic profile and a routed
      // travel matrix, so the corridor is exactly what the planner reasons about — FAU's three
      // campuses span 2.88 km, the widest separation in the repository, and its middle campus is
      // what makes "move it to the other site" a real choice rather than a binary one.
      //
      // Every box below was MEASURED: single-linkage clustering at 350 m over the features that
      // carry each university's name or operator, plus ~200 m of margin. See the `$bboxComment` on
      // each entry in `config/aoi/*.json`.
      aachen: ['innenstadt', 'melaten'],
      'fau-erlangen': ['innenstadt', 'roethelheim', 'suedgelaende'],
      koeln: ['hauptcampus', 'nord'],
      muenster: ['coesfelder-kreuz', 'schlossplatz'],
      // ⚠️ TU BERLIN'S TWO ARE 5.00 km APART — the widest separation in the repository, past FAU's
      // 2.88 km. And the second one is NOT the site that was planned: the AOI was to be
      // Charlottenburg plus "Wedding (Seestraße)", and the probe found Seestraße holds exactly one
      // TU Berlin feature while the substantial second site is the TIB at Gustav-Meyer-Allee,
      // 1.5 km further east. A single building is not a campus, so the id names the site that is.
      'tu-berlin': ['charlottenburg', 'wedding-tib'],
      // ⚠️ THE GENERIC SITE'S CAMPUS IDS ARE ITS OWN, AND GETTING THERE TOOK TWO ATTEMPTS.
      // `config/buildings-tuberlin.json` stamps a `campusId` on every polygon and `campus-demo` is
      // served that same shared file, so the first attempt at neutral ids left its ownership rule
      // matching nothing: 0 of 1367 sessions landed at the second campus and the generator called
      // it a success. The fix was NOT to inherit the reference build's vocabulary — a demo whose
      // API responses say `wedding-tib` is not a generic demo — but to translate it on load. The
      // AOI carries `campusIdMap`, `Site.buildings_payload()` applies it, and every other site,
      // having no map, is untouched.
      'campus-demo': ['campus-mitte', 'campus-nord'],
      // ⚠️ TÜBINGEN HAS ONE, AND THAT IS THE MEASUREMENT RATHER THAN A SIMPLIFICATION. Every other
      // twin has two or three; Tübingen's institutes are threaded through a medieval town, and at
      // 350 m linkage the 28 in-core features form ONE group of 20 plus singletons. Its second
      // real site, Morgenstelle, is 1.5 km north and outside this AOI's core box. So there is no
      // cross-campus constraint here and there must not be a pretend one — the validator's
      // cross-campus checks skip the site by design.
      tuebingen: ['innenstadt'],
      // ⚠️ ONE CAMPUS, AND UNLIKE TÜBINGEN'S IT IS ONE BY CONSTRUCTION RATHER THAN BY MEASUREMENT.
      // UR was built in the 1960s as a single contiguous site on the Galgenberg and has stayed
      // that way, so there is no second location to route between and no travel-time matrix to
      // build — which makes the larger of the two Regensburg universities the SIMPLER scheduling
      // problem of the two. Listed, not omitted, for the same reason Garching is: an absence has
      // to be asserted or a `campuses` block appearing later goes unnoticed.
      'uni-regensburg': ['universitaetsstrasse'],
    };
    const campuses =
      (aoi as unknown as { campuses?: { id: string; bbox: Record<string, number> }[] }).campuses ??
      [];
    expect(campuses.map((c) => c.id).sort()).toEqual(expected[aoi.id]);
    for (const campus of campuses) {
      expect(campus.bbox.west, campus.id).toBeGreaterThanOrEqual(aoi.bbox.west);
      expect(campus.bbox.east, campus.id).toBeLessThanOrEqual(aoi.bbox.east);
      expect(campus.bbox.south, campus.id).toBeGreaterThanOrEqual(aoi.bbox.south);
      expect(campus.bbox.north, campus.id).toBeLessThanOrEqual(aoi.bbox.north);
    }
  });

  it('declares an elevation bracket that contains its own measurement', () => {
    expect(aoi.elevationRangeM.min).toBeLessThan(aoi.elevationRangeM.max);
  });

  it('only offers lenses it lists', () => {
    // `supportsLens` is what the UI asks before showing a control. A lens offered by an AOI that
    // cannot answer it is the "grey means unknown, never zero" rule broken at the panel level.
    for (const lens of aoi.lenses) {
      expect(supportsLens(aoi, lens)).toBe(true);
    }
    expect(supportsLens(aoi, 'condition')).toBe(aoi.lenses.includes('condition'));
  });
});

/**
 * The scheduler-site list in `aoi.ts` must match the one `scheduler.ts` has URLs for.
 *
 * ⚠️ THIS IS THE GUARD THAT MAKES A DELIBERATE DUPLICATION SAFE. `scheduler.ts` imports
 * `activeAoi` from `aoi.ts`, so `aoi.ts` cannot import back without a module cycle — and a cycle
 * resolved during initialisation degrades to an EMPTY list, which would silently reject every
 * `?scheduler=` override instead of failing. So the list is written twice and compared here, the
 * same technique `planStore.test.ts` uses across the entity boundary.
 */
describe('the scheduler override list', () => {
  const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf-8');

  it('names exactly the sites scheduler.ts can reach', () => {
    const aoiSrc = read('src/config/aoi.ts');
    const apiSrc = read('src/api/scheduler.ts');

    const declared = /const SCHEDULER_SITES = \[([^\]]+)\]/.exec(aoiSrc);
    expect(declared, 'SCHEDULER_SITES not found in aoi.ts').toBeTruthy();
    const listed = [...declared![1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();

    const block = /const SITE_BASES[^{]*\{([\s\S]*?)\n\};/.exec(apiSrc);
    expect(block, 'SITE_BASES not found in scheduler.ts').toBeTruthy();
    const keys = [...block![1].matchAll(/^\s*'?([a-z-]+)'?:/gm)].map((m) => m[1]).sort();

    expect(keys.length).toBeGreaterThan(2);
    expect(listed).toEqual(keys);
  });
});
