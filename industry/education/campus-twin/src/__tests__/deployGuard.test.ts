import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

import { changedDuringDeploy, explainFailure, filesToRestore, findDeployFailures, hostingUrlFrom, hostingUrlFromEnv, lockIsStale } from '../../tools/deploy.mjs';

/**
 * The guard over `rayfin up`.
 *
 * ⚠️ EVERY STRING BELOW IS REAL OUTPUT, copied from the deployments of 2026-08-22, not invented.
 * The whole value of this guard is that it recognises what the CLI actually prints; a test written
 * against imagined wording would pass while the guard sat blind in front of the real thing.
 */

/** The deployment that lost its database step and still said "deployed to Fabric!". */
const REAL_FAILING_RUN = `
> rayfin env --framework vite
✓ built in 2.66s
✔ Static build command completed
[rayfin up] Database apply failed: DAB server responded with error: 403 Forbidden
RootActivityId: 00000000-1111-2222-3333-444444444444... FAILED (37.9s)
[rayfin up] Static content packaged (203 files, 183.4 MB)... done (4.5s)
[rayfin up] Static content deployed (203 files, 183.4 MB)... done (82.3s)
✔ Hosting URL added to allowed redirect URIs
🎉 Project "campus-scheduler" is now deployed to Fabric!
`;

/** A clean run: the same shape, with the database step succeeding. */
const CLEAN_RUN = `
> rayfin env --framework vite
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
✓ built in 2.54s
✔ Static build command completed
[rayfin up] Database apply... done (12.1s)
[rayfin up] Static content deployed (203 files, 183.4 MB)... done (68.5s)
✔ Hosting URL added to allowed redirect URIs
🎉 Project "campus-scheduler" is now deployed to Fabric!
`;

describe('spotting a deploy step that failed', () => {
  it('catches the database step that failed while the CLI exited 0', () => {
    const found = findDeployFailures(REAL_FAILING_RUN);

    expect(found.length).toBeGreaterThan(0);
    expect(found.join('\n')).toContain('Database apply failed');
    expect(found.join('\n')).toContain('403 Forbidden');
  });

  it('says nothing about a clean run', () => {
    expect(findDeployFailures(CLEAN_RUN)).toEqual([]);
  });

  it('does not cry wolf over a chunk-size warning', () => {
    /*
      ⚠️ THE FAILURE MODE OF A GUARD IS NOISE. One false alarm on a warning that appears in every
      single build and this gets switched off, which leaves nobody watching at all — strictly worse
      than not having written it.
    */
    expect(
      findDeployFailures('(!) Some chunks are larger than 500 kB after minification. Consider:')
    ).toEqual([]);
  });

  it('does not flag the localhost redirect URI the config legitimately lists', () => {
    expect(findDeployFailures('  allowedRedirectUris: http://localhost:5173')).toEqual([]);
  });

  it('catches an HTTP error from a backing service on its own line', () => {
    expect(findDeployFailures('  auth apply failed: responded with error: 500')).toHaveLength(1);
    expect(findDeployFailures('  something returned 403 Forbidden')).toHaveLength(1);
  });

  it('reports each distinct failing line once', () => {
    // The CLI retries, so the same line can appear several times in one run.
    const repeated = [
      '[rayfin up] Database apply failed: DAB server responded with error: 403 Forbidden',
      '[rayfin up] Database apply failed: DAB server responded with error: 403 Forbidden',
    ].join('\n');
    expect(findDeployFailures(repeated)).toHaveLength(1);
  });

  it('catches the 409 that takes the site down', () => {
    /*
      ⚠️ REAL, AND IT CAUSED AN OUTAGE. Deploying again while a deployment is still running answers
      409, and the hosting URL then serves 404 until the stuck deployment expires — about fifteen
      minutes. Testing this guard by deploying three times in quick succession is what found it.
      The line must be caught, because a run that ends this way has NOT shipped anything.
    */
    const real = [
      '[rayfin up] Static content deployment failed: Static deploy failed: 409 Conflict',
      'Details: A deployment is already in progress. Please wait for the current deployment to complete before starting a new one.',
      'RootActivityId: 045cd29c-db09-4300-bf1e-64f299d5f82e... FAILED (15.6s)',
    ].join('\n');

    const found = findDeployFailures(real);
    expect(found.length).toBeGreaterThan(0);
    expect(found.join('\n')).toContain('409 Conflict');
  });

  it('ignores blank output rather than inventing a failure', () => {
    expect(findDeployFailures('')).toEqual([]);
    expect(findDeployFailures('   \n  \n')).toEqual([]);
  });
});

describe('finding the site to check', () => {
  /*
    ⚠️ THE LIVENESS CHECK IS ONLY WORTH ANYTHING IF IT ASKS THE RIGHT HOST. A hard-coded URL would
    keep returning 200 from a previous deployment's site after the item is recreated — a green
    check that proves nothing, which is worse than no check.
  */
  it('agrees with the state file the CLI actually maintains', (ctx) => {
    /*
      ⚠️ THIS DELIBERATELY DOES NOT ASSERT THAT A URL IS PRESENT, and the reason is a real
      observation: a FAILED deployment rewrites `.deployments.json` and drops `hostingUrl`
      altogether. After the 409 collision of 2026-08-22 the entry kept `fabricItemId`,
      `fabricApiUrl`, `publishableKey` and `deployedAt` — and lost the one field that says where the
      site is. The file is gitignored, so there is no history to restore it from either.

      An assertion that a URL exists would therefore fail for a legitimate reason, on exactly the
      run where the deployment went wrong. What is worth pinning is that the reader agrees with the
      file: same answer, whatever the file currently says. That still catches schema drift.

      ⚠️ AND IT SKIPS ON A CLEAN CLONE, NAMING WHAT WOULD PRODUCE THE FILE. `rayfin/.deployments.json`
      is one tenant's deployment state — the workspace, the item and the host it was published to —
      so it is withheld from the published tree on purpose. Reading it unconditionally turned that
      correct exclusion into a red suite for everyone who clones this repo. It must SKIP rather than
      pass: a vacuous green here would report that the reader agrees with a file nobody read.
    */
    if (!existsSync('rayfin/.deployments.json')) {
      ctx.skip(
        'no rayfin/.deployments.json — it is deliberately not published. ' +
          'Run `npx rayfin up` against your own workspace to create it, then this check has something to compare against.',
      );
      return;
    }
    const real = JSON.parse(readFileSync('rayfin/.deployments.json', 'utf8'));
    const expected = real.deployments?.[real.active]?.hostingUrl ?? null;

    expect(hostingUrlFrom(real)).toBe(expected);
  });

  it('follows `active` rather than taking whichever entry comes first', () => {
    const url = hostingUrlFrom({
      active: 'second',
      deployments: {
        first: { hostingUrl: 'https://wrong.example' },
        second: { hostingUrl: 'https://right.example' },
      },
    });
    expect(url).toBe('https://right.example');
  });

  it('returns null instead of guessing when there is no usable state', () => {
    expect(hostingUrlFrom(undefined)).toBeNull();
    expect(hostingUrlFrom({})).toBeNull();
    expect(hostingUrlFrom({ active: 'missing', deployments: {} })).toBeNull();
    expect(hostingUrlFrom({ deployments: { a: { hostingUrl: 'https://x.example' } } })).toBeNull();
  });

  it('falls back to the environment when a failed deploy stripped the URL', () => {
    /*
      This is the case that matters. A failed deployment rewrites `.deployments.json` without
      `hostingUrl`, so without a fallback the liveness check goes quiet on precisely the runs where
      something went wrong.

      ⚠️ THE FIRST FALLBACK READ `rayfin/rayfin.yml`, AND THAT WAS WRONG. The file is committed and
      did contain the hosting URL — but only because `rayfin up` had just written it there, over a
      comment reading "LOCAL ORIGINS ONLY, ON PURPOSE... naming a deployment here buys nothing and
      puts one tenant's app address into every clone of this template". Reading a value out of a
      file whose own documentation forbids it being there works until somebody restores the file.
      `CAMPUS_SCHEDULER_URL` is the variable `tools/verify_deploy.mjs` already uses.
    */
    expect(hostingUrlFromEnv({ CAMPUS_SCHEDULER_URL: 'https://example.test' })).toBe(
      'https://example.test'
    );
  });

  it('trims a trailing slash so paths do not double up', () => {
    expect(hostingUrlFromEnv({ CAMPUS_SCHEDULER_URL: 'https://example.test/' })).toBe(
      'https://example.test'
    );
  });

  it('returns null when the environment says nothing', () => {
    expect(hostingUrlFromEnv({})).toBeNull();
    expect(hostingUrlFromEnv({ CAMPUS_SCHEDULER_URL: '' })).toBeNull();
    expect(hostingUrlFromEnv({ CAMPUS_SCHEDULER_URL: '   ' })).toBeNull();
  });
});

describe('putting back what the deploy rewrote', () => {
  /*
    ⚠️ `rayfin up` EDITS TRACKED CONFIGURATION. Measured after a deploy on 2026-08-22:
    `rayfin/rayfin.yml` came back one line longer in content and thirteen comment lines shorter —
    the hosting URL added, and the comment forbidding exactly that deleted along with the note
    explaining why the Fabric SQL database exists. It went unnoticed for three deployments because
    it landed in a change set a parallel session was also writing to.
  */
  const CONFIG = 'rayfin/rayfin.yml';

  it('spots a file the deploy changed', () => {
    const before = { [CONFIG]: 'allowedRedirectUris:\n  # LOCAL ORIGINS ONLY\n  - http://localhost:5173\n' };
    const after = { [CONFIG]: 'allowedRedirectUris:\n  - https://something.example\n' };

    expect(filesToRestore(before, after)).toEqual([CONFIG]);
  });

  it('says nothing when the deploy left the file alone', () => {
    const same = { [CONFIG]: 'services:\n  auth:\n    enabled: true\n' };
    expect(filesToRestore(same, { ...same })).toEqual([]);
  });

  it('compares against the pre-run state, not against HEAD', () => {
    /*
      ⚠️ THE REASON THIS IS NOT `git checkout`. Somebody may be part-way through an edit to the same
      file. Restoring HEAD would be simpler and would silently destroy that work, turning a guard
      into a way to lose changes. An uncommitted edit the deploy did NOT touch must survive.
    */
    const edited = { [CONFIG]: 'services:\n  auth:\n    enabled: false  # mid-edit\n' };
    expect(filesToRestore(edited, { ...edited })).toEqual([]);
  });

  it('ignores a file that was not there to begin with', () => {
    // Nothing to put back, and inventing one would create a file the repo never had.
    expect(filesToRestore({}, { [CONFIG]: 'appeared from nowhere' })).toEqual([]);
  });

  it('does not try to recreate a file the deploy deleted', () => {
    /*
      A deletion is a much louder event than an edit and `git status` reports it plainly. Writing
      the old bytes back would hide it, which is the opposite of the point.
    */
    expect(filesToRestore({ [CONFIG]: 'was here' }, {})).toEqual([]);
  });
});

describe('noticing anything else the deploy moved', () => {
  /*
    ⚠️ §68.5 LEFT THIS AS A HABIT: the restore list has one file on it because somebody happened to
    run `git diff` at the right moment. The next rewrite has no reason to be that lucky, so the
    whole working tree's shape is compared instead — reported, never reverted.
  */
  it('spots a file that changed during the run', () => {
    const before = ' M PLAN.md\n';
    const after = ' M PLAN.md\n M rayfin/rayfin.yml\n';

    expect(changedDuringDeploy(before, after)).toEqual([
      { path: 'rayfin/rayfin.yml', code: ' M', was: 'unchanged' },
    ]);
  });

  it('says nothing when the tree came back as it went in', () => {
    const same = ' M PLAN.md\n?? tools/deploy.mjs\n';
    expect(changedDuringDeploy(same, same)).toEqual([]);
  });

  it('leaves out what was already put back', () => {
    // No point reporting a file in the same breath as saying it was restored.
    const before = '';
    const after = ' M rayfin/rayfin.yml\n';
    expect(changedDuringDeploy(before, after, ['rayfin/rayfin.yml'])).toEqual([]);
  });

  it('notices a status that changed kind, not just appeared', () => {
    // Untracked becoming modified is a different event and must not be missed.
    expect(changedDuringDeploy('?? notes.md\n', ' M notes.md\n')).toEqual([
      { path: 'notes.md', code: ' M', was: '??' },
    ]);
  });

  it('handles a quoted path with spaces', () => {
    const found = changedDuringDeploy('', ' M "docs/a file.md"\n');
    expect(found[0].path).toBe('docs/a file.md');
  });

  it('survives an empty or absent git status', () => {
    /*
      ⚠️ NOT EVERY CHECKOUT IS A GIT ONE, and `git` may not be on PATH at all. Returning nothing is
      right; throwing here would fail a deploy that had otherwise succeeded, which is a guard doing
      more harm than the thing it guards against.
    */
    expect(changedDuringDeploy('', '')).toEqual([]);
    expect(changedDuringDeploy('   \n', '  \n')).toEqual([]);
  });
});

describe('explaining a refusal instead of restating it', () => {
  /*
    ⚠️ THE DAB STEP WAS CARRIED AS "UNDIAGNOSED" THROUGH FOUR SECTIONS OF PLAN.md, because the line
    a full deploy prints says only that the server said no. Running the step alone —
    `rayfin up db apply --verbose` — prints the reason on a line the full deploy never emits:
    "Only AppBackend artifact owner can perform this operation." Ownership, not permissions.
  */
  it('explains the DAB refusal from the line a full deploy actually prints', () => {
    // ⚠️ This is the real line, and it contains no reason at all — that is the point.
    const line = '[rayfin up] Database apply failed: DAB server responded with error: 403 Forbidden';
    const why = explainFailure(line);

    expect(why).toBeTruthy();
    expect(why).toContain('Ownership, not permissions');
    expect(why).toContain('db apply --verbose');
    // It must say why the site still works, or the reader over-reacts to a red line.
    expect(why).toContain('Static hosting is unaffected');
    /*
      ⚠️ AND IT MUST SAY WHAT THE FAILURE ACTUALLY COSTS, which is the part that is easy to lose.
      This is the SCHEMA step: the live database keeps serving whatever was applied when the item
      was created, so nothing looks wrong — while an edit to `rayfin/data/*.ts` silently does not
      reach it. "Harmless" and "invisible" are not the same thing, and a reader told only that the
      site is fine will conclude the first from the second.
    */
    expect(why).toContain('DOES NOT REACH THE DATABASE');
  });

  it('also explains it from the detailed line, when that is the one to hand', () => {
    expect(explainFailure('Details: Only AppBackend artifact owner can perform this operation.'))
      .toContain('Ownership, not permissions');
  });

  it('explains a 409 as a lock rather than a fault', () => {
    const why = explainFailure('Static deploy failed: 409 Conflict');
    expect(why).toContain('still holds the lock');
    expect(why).toContain('staticapp deploy');
  });

  it('says nothing about a failure it does not recognise', () => {
    /*
      ⚠️ NEGATIVE CONTROL. A guard that attaches an explanation to everything trains the reader to
      skip explanations — and the one line that needed reading goes past unread.
    */
    expect(explainFailure('[rayfin up] Something entirely new... FAILED (2.1s)')).toBeNull();
    expect(explainFailure('')).toBeNull();
  });
});

describe('refusing to start a second deploy on top of a running one', () => {
  /*
    ⚠️ THIS IS THE PREVENTION, NOT THE DETECTION. The guard elsewhere in this file notices a 409
    after it has happened; by then the site has been serving 404 for a while. Fabric static hosting
    takes a lock, and starting a second deployment while one is running cost about fifteen minutes
    of downtime on 2026-08-22 — caused by running three deploys in quick succession to test the
    failure guard itself. A comment saying "one at a time" would not have stopped that. A check does.
  */
  const NOW = Date.parse('2026-08-22T22:20:00Z');
  const at = (minutesAgo: number) =>
    new Date(NOW - minutesAgo * 60_000).toISOString();

  it('treats a deploy started moments ago as still holding the lock', () => {
    expect(lockIsStale({ startedAt: at(0) }, NOW)).toBe(false);
    expect(lockIsStale({ startedAt: at(5) }, NOW)).toBe(false);
    expect(lockIsStale({ startedAt: at(14) }, NOW)).toBe(false);
  });

  it('lets go once the service would have expired the deployment', () => {
    // The service expires a stuck deployment after about fifteen minutes; the window matches it.
    expect(lockIsStale({ startedAt: at(16) }, NOW)).toBe(true);
    expect(lockIsStale({ startedAt: at(60) }, NOW)).toBe(true);
  });

  it('fails OPEN on a missing or unreadable record', () => {
    /*
      ⚠️ DELIBERATE, AND THE OPPOSITE OF WHAT A LOCK USUALLY DOES. Recovery from a bad deployment is
      normally another deployment, so a corrupt lock file must never become a permanent bar on
      deploying. Better to allow a deploy that should have waited than to block the fix for one.
    */
    expect(lockIsStale(undefined, NOW)).toBe(true);
    expect(lockIsStale({}, NOW)).toBe(true);
    expect(lockIsStale({ startedAt: 'not a date' }, NOW)).toBe(true);
    expect(lockIsStale({ startedAt: null }, NOW)).toBe(true);
  });

  it('would have blocked the deploy that caused the outage', () => {
    // The real sequence: a deploy at 22:19:24Z, then another begun barely a minute later.
    const first = { pid: 1234, startedAt: '2026-08-22T22:19:24Z' };
    const secondAttemptAt = Date.parse('2026-08-22T22:20:35Z');

    expect(lockIsStale(first, secondAttemptAt)).toBe(false);
  });
});






