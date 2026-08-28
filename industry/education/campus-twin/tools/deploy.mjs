/**
 * Deploy, and fail when a step of the deploy failed.
 *
 * ⚠️ THE REASON THIS EXISTS: `rayfin up` EXITS 0 WHEN PART OF IT DID NOT WORK. Measured on
 * 2026-08-22, three consecutive deployments printed
 *
 *     [rayfin up] Database apply failed: DAB server responded with error: 403 Forbidden
 *     RootActivityId: 00000000-…  FAILED (37.9s)
 *
 * and then, having lost the entire database step, reported "Project is now deployed to Fabric!"
 * and returned **exit code 0**. Anything reading that exit code — a script, a pipeline, a person
 * skimming — is told the deployment succeeded.
 *
 * That is the same failure shape this project keeps meeting and keeps writing checks for: the log
 * is green, the artefact is wrong. `tools/verify_deploy.mjs` was written because "bytes uploaded"
 * is not "renders"; this is written because "command finished" is not "every step ran".
 *
 * It does not judge whether a given failure matters. `staticHosting` can succeed while `data`
 * fails, and the app will still render — that is exactly how this went unnoticed. The judgement is
 * the operator's; the job here is to make sure they are told.
 *
 *   node tools/deploy.mjs              # deploy, then fail loudly if any step failed
 *   node tools/deploy.mjs --allow-fail # deploy, report failures, still exit 0
 *
 * ⚠️ ONE DEPLOY AT A TIME. Fabric static hosting takes a lock: starting a second deployment while
 * one is running answers `409 Conflict`, and the hosting URL serves **404 until the stuck
 * deployment expires**, which the service puts at about 15 minutes. Deploying three times in quick
 * succession to test this script took the site down for exactly that long.
 */
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Lines that mean a step of the deploy did not work.
 *
 * ⚠️ DELIBERATELY NARROW. A build that prints "Some chunks are larger than 500 kB after
 * minification" has not failed, and a guard that cried wolf on warnings would be switched off
 * within a week — which is worse than no guard, because then nobody is watching at all.
 *
 * So: the CLI's own step marker, its "<service> apply failed" wording, and an explicit HTTP error
 * from a backing service. Each was taken from real output rather than imagined.
 */
const FAILURE_PATTERNS = [
  /\bFAILED\b/,
  /\b\w+ apply failed\b/i,
  /\b(?:deploy|deployment) failed\b/i,
  /responded with error:\s*\d{3}/i,
  /\b(?:401|403|409|500|502|503)\s+(?:Unauthorized|Forbidden|Conflict|Internal Server Error|Bad Gateway|Service Unavailable)\b/,
];

/**
 * Lines that look alarming and are not.
 *
 * `allowedRedirectUris` legitimately lists `http://localhost:5173`, and rollup's chunk-size notice
 * is advice, not a fault.
 */
const BENIGN = [/chunks are larger than/i, /allowedRedirectUris/i, /--allow-fail/];

/** Every line of `text` that reports a failed step. Exported so it can be tested without deploying. */
export function findDeployFailures(text) {
  const seen = new Set();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || BENIGN.some((b) => b.test(line))) continue;
    if (FAILURE_PATTERNS.some((p) => p.test(line))) seen.add(line);
  }
  return [...seen];
}

/**
 * The URL this project deploys to, read from the state the CLI itself maintains.
 *
 * Taken from `rayfin/.deployments.json` rather than hard-coded, because the hosting URL changes
 * when the item is recreated and a stale constant would have this check quietly probing somebody
 * else's site — green, and meaningless. Exported for testing.
 */
export function hostingUrlFrom(deployments) {
  const active = deployments?.active;
  const entry = active ? deployments?.deployments?.[active] : undefined;
  return entry?.hostingUrl ?? null;
}

/**
 * The hosting URL from the environment, used when the deployment state has lost it.
 *
 * ⚠️ NEEDED BECAUSE A FAILED DEPLOY DELETES THE FIELD THIS CHECK DEPENDS ON. After the 409
 * collision of 2026-08-22, `.deployments.json` was rewritten without `hostingUrl` — the entry kept
 * its ids and its publishable key and lost the address of the site. That is the worst possible
 * moment to lose it: the run where the deployment failed is the run where you most need to ask
 * whether the site is still up. The file is gitignored, so there is no history to fall back on.
 *
 * ⚠️ AND THE FIRST FALLBACK WRITTEN FOR THIS READ `rayfin/rayfin.yml`, WHICH WAS WRONG. It looked
 * sound — the file is committed and did contain the hosting URL — but only because `rayfin up` had
 * just written it there, over a comment that says in as many words: "LOCAL ORIGINS ONLY, ON
 * PURPOSE... naming a deployment here buys nothing and puts one tenant's app address into every
 * clone of this template." Reading a value out of a file whose own documentation forbids it being
 * there is a fallback that works until somebody restores the file, and then fails silently.
 *
 * `CAMPUS_SCHEDULER_URL` is the same variable `tools/verify_deploy.mjs` already takes, so there is
 * one way to say "the site is over there" rather than two.
 */
export function hostingUrlFromEnv(env = process.env) {
  const url = (env.CAMPUS_SCHEDULER_URL ?? '').trim();
  return url ? url.replace(/\/$/, '') : null;
}

/**
 * Ask the deployed site whether it is actually there.
 *
 * ⚠️ BECAUSE A GREEN LOG IS NOT A LIVE SITE, AND THIS SCRIPT LEARNED THAT THE HARD WAY. The first
 * version of this guard read the CLI's output and nothing else. On 2026-08-22 a deployment collided
 * with one still in flight, the service answered `409 Conflict`, and **every path on the hosting URL
 * served 404 until the stuck deployment expired** — about fifteen minutes. A log-only guard can
 * report "every step reported success" while the site is down, which is the exact failure this file
 * was written to stop.
 *
 * Retried rather than asked once: the workload takes a little while to warm up after a deployment,
 * and a single probe a second after upload would fail on a site that is fine.
 */
async function siteAnswers(url, { tries = 6, waitMs = 10_000 } = {}) {
  const seen = [];
  for (let i = 0; i < tries; i += 1) {
    let status;
    try {
      status = (await fetch(url, { redirect: 'follow' })).status;
    } catch (err) {
      status = `unreachable (${String(err).slice(0, 60)})`;
    }
    seen.push(status);
    if (status === 200) return { ok: true, seen };
    if (i < tries - 1) await new Promise((r) => setTimeout(r, waitMs));
  }
  return { ok: false, seen };
}

/**
 * How long to assume a deployment we started is still holding the service's lock.
 *
 * The service says a stuck deployment expires "automatically after 15 minutes", so a local record
 * younger than that is assumed to still own it.
 */
const LOCK_MINUTES = 15;

/**
 * Is a recorded deploy old enough to ignore? Pure, so the window can be tested without waiting.
 *
 * ⚠️ A MISSING OR UNREADABLE RECORD IS STALE, NOT FRESH. Failing open matters here: a corrupt lock
 * file must never become a permanent bar on deploying, because the recovery from a bad deployment
 * is usually another deployment.
 */
export function lockIsStale(lock, now = Date.now(), minutes = LOCK_MINUTES) {
  const startedAt = Date.parse(lock?.startedAt ?? '');
  if (!Number.isFinite(startedAt)) return true;
  return now - startedAt > minutes * 60_000;
}

/**
 * Files `rayfin up` is known to rewrite behind your back, relative to the repository root.
 *
 * ⚠️ MEASURED, NOT SUSPECTED. `git diff rayfin/rayfin.yml` after a deploy on 2026-08-22 read **one
 * line added, thirteen deleted**. The addition was the hosting URL of the item just created. Among
 * the deletions was the comment forbidding exactly that:
 *
 *     ⚠️ LOCAL ORIGINS ONLY, ON PURPOSE. `rayfin up` adds the hosting URL of the item it just
 *     created, so naming a deployment here buys nothing and puts one tenant's app address into
 *     every clone of this template.
 *
 * The rest of the deletion was the explanation of why the Fabric SQL database exists at all. So the
 * tool did the thing the file warns against, erased the warning, and took unrelated documentation
 * with it — in a change set a parallel session was also writing to, which is how it went unnoticed
 * for three deployments.
 *
 * The URL is applied to the deployed item during the deploy; the local copy is not what makes auth
 * work. Restoring it afterwards therefore costs nothing.
 */
const REWRITTEN_BY_DEPLOY = ['rayfin/rayfin.yml'];

/**
 * Decide what to restore after a deploy.
 *
 * ⚠️ IT COMPARES AGAINST WHAT WAS THERE BEFORE THIS RUN, NOT AGAINST HEAD. A `git checkout` would
 * be simpler and would silently throw away any uncommitted edit somebody was part-way through —
 * turning a helpful guard into a way to lose work. Exported so the decision is testable without
 * deploying anything.
 */
export function filesToRestore(before, after) {
  return Object.keys(before)
    .filter((path) => before[path] !== undefined && after[path] !== undefined)
    .filter((path) => before[path] !== after[path]);
}

/**
 * Everything whose git status changed while the deploy ran, minus what was deliberately restored.
 *
 * ⚠️ §68.5 LEFT THIS AS A HABIT RATHER THAN A CHECK: "`REWRITTEN_BY_DEPLOY` lists one file, because
 * one is all that has been observed being rewritten. If a future deploy touches something else, the
 * same `git status` habit is what will find it." A habit is not a check — that one-file list exists
 * only because somebody happened to run `git diff` at the right moment, and the next rewrite has no
 * reason to be that lucky.
 *
 * ⚠️ IT REPORTS RATHER THAN RESTORES, AND THAT ASYMMETRY IS THE DESIGN. A parallel session is often
 * editing this same working tree, and a deploy takes ninety seconds — long enough to overlap with
 * somebody else's save. Rolling those back would destroy another person's work on the strength of a
 * coincidence in timing. Only the known list is restored; everything else is named and left exactly
 * where it is, for a human to judge.
 *
 * Takes the two `git status --porcelain` outputs as strings, so it is testable without deploying.
 */
export function changedDuringDeploy(beforeStatus, afterStatus, restored = []) {
  const parse = (text) => {
    const map = new Map();
    for (const line of String(text).split(/\r?\n/)) {
      if (!line.trim()) continue;
      // "XY path" — two status columns, a space, then the path.
      map.set(line.slice(3).trim().replace(/^"|"$/g, ''), line.slice(0, 2));
    }
    return map;
  };

  const before = parse(beforeStatus);
  const after = parse(afterStatus);
  const known = new Set(restored);

  return [...after]
    .filter(([path]) => !known.has(path))
    .filter(([path, code]) => before.get(path) !== code)
    .map(([path, code]) => ({ path, code, was: before.get(path) ?? 'unchanged' }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Turn a known failure line into something the reader can act on.
 *
 * ⚠️ A BARE `403 Forbidden` GETS RE-DIAGNOSED EVERY TIME. The DAB step has failed on every deploy
 * since 2026-08-22 and was carried as "undiagnosed" through four sections of PLAN.md, because the
 * summary line says only that the server refused. Running the step alone — `rayfin up db apply
 * --verbose`, which does not need a full deploy — prints the actual reason on the next line:
 *
 *     Details: Only AppBackend artifact owner can perform this operation.
 *
 * It is an OWNERSHIP problem, not a permissions one, which is why nothing in the workspace's role
 * assignments explains it and why the static-hosting step succeeds regardless: uploading a site
 * needs workspace write, applying a DAB schema needs to BE the artifact's owner.
 *
 * Exported so the mapping is testable without deploying.
 */
export function explainFailure(line) {
  /*
    ⚠️ MATCHED ON THE LINE `rayfin up` ACTUALLY PRINTS, WHICH IS NOT THE INFORMATIVE ONE. A full
    deploy shows only:

        [rayfin up] Database apply failed: DAB server responded with error: 403 Forbidden

    The reason lives on a `Details:` line that the full deploy never emits — it appears only when
    the step is run alone with `rayfin up db apply --verbose`. That asymmetry is the entire reason
    this was carried as "undiagnosed" through four sections of PLAN.md: the summary says the server
    refused and stops there.
  */
  if (/database apply failed|artifact owner can perform this operation/i.test(line)) {
    return [
      'Ownership, not permissions. `rayfin up db apply --verbose` prints the detail the full',
      '    deploy hides: "Only AppBackend artifact owner can perform this operation."',
      '    The item was created by a different identity than the one deploying — two accounts here',
      '    are both called "Alexander Korn", a corp one and an MCAP-native one, and only the',
      '    CREATOR of the AppBackend may apply DAB config. `~/.rayfin/auth.json` says which is',
      '    signed in; `rayfin login` offers an account picker.',
      '    Static hosting is unaffected: it needs workspace write, not artifact ownership.',
      '',
      '    ⚠ WHAT IT COSTS: this is the SCHEMA step, not the runtime one. Whatever schema was',
      '    applied when the item was created keeps serving, so the app behaves normally and',
      '    nothing looks wrong. But an edit to rayfin/data/*.ts DOES NOT REACH THE DATABASE —',
      '    the deploy says it shipped, the entity definition in the repo says one thing and the',
      '    live database says another, and the first symptom is a GraphQL error on a planner\'s',
      '    confirm click. If you have not touched rayfin/data/, this is currently harmless.',
    ].join('\n');
  }
  if (/409 Conflict|already in progress/i.test(line)) {
    return [
      'A PREVIOUS deployment still holds the lock. Do not hammer it: the service expires a',
      '    stuck deployment after about 15 minutes, and the hosting URL serves 404 meanwhile.',
      '    Wait, then `npx rayfin up staticapp deploy` to retry only the static step.',
    ].join('\n');
  }
  return null;
}

async function main() {
  /*
    ⚠️ `--help` MUST NOT DEPLOY, AND IT USED TO.

    This script's only behaviour is to ship the app, and it had no way to ask it anything without
    doing so. `node tools/deploy.mjs --help` — the first thing anybody types at an unfamiliar
    command — fell through to the deploy. It happened here on 2026-08-23, inside a line that was
    piped to `Out-Null` as a harmless "does the module load" check: it started an unattended
    production deploy, which then failed because the capacity was paused, and left a lock behind.

    An unknown flag is treated the same way. A deploy is not a reasonable response to a typo.
  */
  const KNOWN = new Set(['--allow-fail', '--force']);
  const unknown = process.argv.slice(2).filter((a) => !KNOWN.has(a));
  const askedForHelp = unknown.some((a) => a === '--help' || a === '-h');

  if (askedForHelp || unknown.length > 0) {
    const usage = [
      'Usage: node tools/deploy.mjs [--allow-fail] [--force]',
      '',
      '  Deploys with `rayfin up`, then fails if any step of it failed or the site does not',
      '  answer — because `rayfin up` exits 0 even when its database step did not run.',
      '',
      '  --allow-fail  report a failed step but still exit 0',
      '  --force       deploy even if a recent deployment may still hold the service lock',
      '',
      '  One deploy at a time: a collision answers 409 and the site serves 404 for about',
      '  fifteen minutes. See PLAN §60 and §62.',
    ].join('\n');

    if (askedForHelp) {
      console.log(usage);
      process.exitCode = 0;
      return;
    }
    console.error(`deploy: unrecognised argument(s): ${unknown.join(', ')}\n\n${usage}`);
    process.exitCode = 2;
    return;
  }

  const allowFail = process.argv.includes('--allow-fail');
  const force = process.argv.includes('--force');
  const HERE = dirname(fileURLToPath(import.meta.url));
  const LOCK = join(HERE, '..', 'rayfin', '.deploy-in-progress.json');

  /*
    ⚠️ ONE DEPLOY AT A TIME, ENFORCED RATHER THAN REQUESTED.

    Fabric static hosting takes a lock. Starting a second deployment while one is running answers
    `409 Conflict`, and the hosting URL then serves **404 on every path until the stuck deployment
    expires** — about fifteen minutes of downtime. On 2026-08-22 this file's own author caused
    exactly that by running three deployments in quick succession to test the failure guard below.

    A comment saying "don't do that" would not have stopped it; a check does. `--force` is there
    because the recovery from a bad deployment is usually another deployment, and a lock that
    cannot be overridden would be its own outage.
  */
  if (!force) {
    let held = null;
    try {
      held = JSON.parse(readFileSync(LOCK, 'utf8'));
    } catch {
      /* absent or unreadable — treated as stale, see `lockIsStale` */
    }
    if (held && !lockIsStale(held)) {
      const age = Math.round((Date.now() - Date.parse(held.startedAt)) / 60_000);
      console.error(
        `deploy: a deployment started ${age} min ago (pid ${held.pid}) may still hold the lock.\n` +
          '  Starting another now risks a 409 and roughly fifteen minutes of 404s on the live site.\n' +
          `  Wait it out, or re-run with --force if you know it is finished.\n` +
          `  (record: ${LOCK})`
      );
      process.exitCode = 1;
      return;
    }
  }
  writeFileSync(LOCK, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

  // Snapshot the files the deploy is known to rewrite, so its edits can be undone afterwards.
  const REPO = join(HERE, '..');
  const before = {};
  for (const rel of REWRITTEN_BY_DEPLOY) {
    try {
      before[rel] = readFileSync(join(REPO, rel), 'utf8');
    } catch {
      /* absent is fine — nothing to put back */
    }
  }

  // And the whole working tree's shape, to notice anything rewritten that is NOT on that list.
  const gitStatus = () => {
    try {
      return execFileSync('git', ['status', '--porcelain'], {
        cwd: REPO,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
      });
    } catch {
      return ''; // not a checkout, or no git — the restore above still works
    }
  };
  const statusBefore = gitStatus();

  const captured = [];

  const code = await new Promise((resolve) => {
    // `shell: true` because on Windows the runnable is `npx.cmd`.
    const child = spawn('npx', ['rayfin', 'up', '--yes'], { shell: true });
    const tee = (stream, sink) =>
      stream.on('data', (buf) => {
        const text = buf.toString();
        captured.push(text);
        sink.write(text);
      });
    tee(child.stdout, process.stdout);
    tee(child.stderr, process.stderr);
    child.on('close', resolve);
  });

  const failures = findDeployFailures(captured.join(''));

  /*
    Put back anything the deploy rewrote. Done before the liveness check so the report reads in the
    order things happened, and unconditionally — a failed deploy rewrites the config just as
    happily as a successful one.
  */
  const after = {};
  for (const rel of Object.keys(before)) {
    try {
      after[rel] = readFileSync(join(REPO, rel), 'utf8');
    } catch {
      /* the deploy deleted it; leave that alone and let git report it */
    }
  }
  const touched = filesToRestore(before, after);
  for (const rel of touched) {
    writeFileSync(join(REPO, rel), before[rel]);
    console.log(`\ndeploy: restored ${rel}, which the deploy rewrote (see PLAN §67.3)`);
  }

  /*
    Anything ELSE that moved while the deploy ran. Reported, never reverted — a parallel session
    editing this tree is the normal case here, and ninety seconds is long enough to catch somebody
    mid-save. The point is only that a rewrite nobody knew about cannot pass unseen.
  */
  const alsoMoved = changedDuringDeploy(statusBefore, gitStatus(), touched);
  if (alsoMoved.length > 0) {
    console.log(
      `\ndeploy: ${alsoMoved.length} other file(s) changed while this ran. NOT reverted — a parallel\n` +
        '  session editing the tree looks exactly like this. Worth a glance if you were not editing:'
    );
    for (const f of alsoMoved.slice(0, 12)) {
      console.log(`    ${f.code}  ${f.path}   (was: ${f.was})`);
    }
    if (alsoMoved.length > 12) console.log(`    … and ${alsoMoved.length - 12} more`);
  }

  /*
    The site itself, not the log. Run whether or not a step reported failure, because both
    directions are worth knowing: a clean log over a dead site is the case that caused an outage
    here, and a failed `data` step over a site that still renders is the case that is often fine.
  */
  let url = null;
  try {
    url = hostingUrlFrom(
      JSON.parse(readFileSync(join(HERE, '..', 'rayfin', '.deployments.json'), 'utf8'))
    );
  } catch {
    /* no deployment state on disk — the config fallback below covers it */
  }
  if (!url) {
    url = hostingUrlFromEnv();
    if (url) console.log(`\ndeploy: hosting URL taken from CAMPUS_SCHEDULER_URL (deployment state has none)`);
  }

  let live = null;
  if (url) {
    process.stdout.write(`\ndeploy: asking ${url} whether it is live`);
    live = await siteAnswers(url);
    console.log(` — ${live.ok ? 'HTTP 200' : `NOT LIVE (saw ${live.seen.join(', ')})`}`);
  } else {
    console.log('\ndeploy: no hosting URL in rayfin/.deployments.json — cannot check liveness.');
  }

  console.log('');
  if (failures.length === 0 && live?.ok !== false) {
    /*
      Deployment finished and the site answers, so the service is no longer holding its lock and
      the next deploy need not wait. Cleared only on this path: after a failure the record is left
      in place deliberately, so a hasty retry is blocked for the fifteen minutes the service takes
      to expire a stuck deployment. That is the exact mistake this guard exists to prevent.
    */
    try {
      rmSync(LOCK, { force: true });
    } catch {
      /* a lock we cannot remove is stale within fifteen minutes anyway */
    }
    console.log(`deploy: every step reported success (rayfin exit ${code}).`);
    process.exitCode = code === 0 ? 0 : 1;
    return;
  }

  if (live && !live.ok) {
    console.error(
      `deploy: THE SITE IS NOT SERVING (${url} returned ${live.seen.join(', ')}).\n` +
        '  A deployment that uploaded cleanly can still leave the site down — a collision with a\n' +
        '  deployment already in progress does exactly that. Wait for the lock to expire, then\n' +
        '  `npx rayfin up staticapp deploy` to retry only the static step.'
    );
  }

  if (failures.length > 0) {
    console.error('deploy: A STEP OF THIS DEPLOYMENT FAILED, whatever the CLI exit code says:');
    for (const f of failures) {
      console.error(`  - ${f}`);
      // Say what a known refusal actually means, so it is diagnosed once rather than every time.
      const why = explainFailure(f);
      if (why) console.error(`    ⚠ ${why}`);
    }
    console.error(
      '\nThe static site may still be live and may still render — check what actually broke\n' +
        'before treating this as shipped. Re-run with --allow-fail to accept it deliberately.'
    );
  }

  /*
    ⚠️ `process.exitCode`, NOT `process.exit()`. `process.exit` terminates immediately, without
    waiting for stdio to drain, and this script is wrapping a command that uploads 183 MB. Exiting
    abruptly around a deploy is a good way to leave the service holding a half-finished deployment
    — which is exactly the 409-plus-404 state this project has now seen once. Setting the code and
    returning lets Node exit normally when there is genuinely nothing left to do.
  */
  process.exitCode = allowFail ? 0 : 1;
}

// Only deploy when run directly; importing this for its matcher must not launch anything.
if (process.argv[1] && process.argv[1].endsWith('deploy.mjs')) {
  await main();
}
