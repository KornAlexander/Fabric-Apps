import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every site the app can serve must be one the post-deploy verifier actually checks.
 *
 * ⚠️ WRITTEN BECAUSE THE SAME MISTAKE HAS NOW HAPPENED THREE TIMES, EACH TIME SILENTLY (PLAN §72):
 * a guard that was correct when written, and then the thing it guards grew a second instance.
 * `verify_deploy.mjs` asserted no localhost in *the* bundle and then a second entry point appeared;
 * the media check read *the* README and then a second one appeared. Both kept passing.
 *
 * `tools/verify_deploy.mjs` has the same shape of risk: it drives one AOI at a time from a hand-kept
 * `SITES` map. Add a ninth university, forget the map, and every deploy is verified against the
 * eight that were already fine while the new one is never opened at all — and nothing goes red.
 *
 * ⚠️ AN AOI WITHOUT A `schedulerSite` IS DELIBERATELY EXEMPT. `uni-regensburg` has terrain and no
 * timetable behind it; there is no week to open, so requiring a verifier entry would fail for a
 * fact about the site rather than a gap in the checking.
 */

const AOI_DIR = join(process.cwd(), 'config', 'aoi');
const VERIFIER = join(process.cwd(), 'tools', 'verify_deploy.mjs');

/**
 * Is `name` a top-level key of the verifier's `SITES` map?
 *
 * ⚠️ BOTH QUOTED AND BARE, AND MISSING THAT COST A WRONG ANSWER. JavaScript object keys only need
 * quoting when they are not valid identifiers, so the map reads `'oth-regensburg':` but `garching:`.
 * A first pass matched only the quoted form, reported "3 of 9 covered", and made a well-maintained
 * verifier look badly neglected. The measurement was wrong, not the code — the same trap as the
 * `-ss` frame grabs in §64.3 and the piped exit code in §68.2.
 */
function isVerifiedSite(source: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    new RegExp(`^\\s{2}'${escaped}':\\s*\\{`, 'm').test(source) ||
    new RegExp(`^\\s{2}${escaped}:\\s*\\{`, 'm').test(source)
  );
}

interface Aoi {
  id: string;
  schedulerSite: string | null;
}

function aois(): Aoi[] {
  return readdirSync(AOI_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const parsed = JSON.parse(readFileSync(join(AOI_DIR, f), 'utf8'));
      return { id: f.replace(/\.json$/, ''), schedulerSite: parsed.schedulerSite ?? null };
    });
}

describe('the post-deploy verifier covers every site that has a timetable', () => {
  const source = readFileSync(VERIFIER, 'utf8');
  const all = aois();

  it('finds the AOIs and the verifier', () => {
    // An empty scan must never report success — the failure this whole family of checks exists for.
    expect(all.length).toBeGreaterThanOrEqual(8);
    expect(source).toContain('const SITES');
  });

  it('reads both the quoted and the bare key style', () => {
    /*
      Guarding the reader itself, because getting this wrong does not throw — it silently under-
      reports coverage and turns a healthy file into an apparent emergency.
    */
    expect(isVerifiedSite("const SITES = {\n  'oth-regensburg': {\n", 'oth-regensburg')).toBe(true);
    expect(isVerifiedSite('const SITES = {\n  garching: {\n', 'garching')).toBe(true);
    expect(isVerifiedSite('const SITES = {\n  garching: {\n', 'aachen')).toBe(false);
    // A bare mention in a comment is not coverage.
    expect(isVerifiedSite('// see garching for the shape\n', 'garching')).toBe(false);
  });

  it('checks every AOI that declares a schedulerSite', () => {
    const withScheduler = all.filter((a) => a.schedulerSite);
    const missing = withScheduler.filter((a) => !isVerifiedSite(source, a.id)).map((a) => a.id);

    expect(withScheduler.length).toBeGreaterThanOrEqual(8);
    expect(
      missing,
      `these sites serve a timetable but tools/verify_deploy.mjs never opens them: ${missing.join(', ')}. ` +
        'Add a SITES entry with measured floors, or the next deploy verifies everything except the new site.'
    ).toEqual([]);
  });

  it('exempts an AOI with no timetable behind it', () => {
    // Terrain-only twins are a real category, not an oversight — see uni-regensburg.
    const terrainOnly = all.filter((a) => !a.schedulerSite);
    for (const a of terrainOnly) {
      expect(a.schedulerSite, `${a.id} should have no scheduler`).toBeNull();
    }
  });

  it('would notice a site that the verifier does not open', () => {
    /*
      ⚠️ NEGATIVE CONTROL. Without it, this file passes just as happily if `isVerifiedSite` ever
      starts returning true for everything — which is exactly how a guard stops guarding without
      anybody noticing.
    */
    expect(isVerifiedSite(source, 'a-university-nobody-added')).toBe(false);
  });
});
