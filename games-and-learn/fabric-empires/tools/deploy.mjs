/**
 * Deploy, then put the config back the way it has to be committed.
 *
 * ⚠️ `rayfin up` rewrites `rayfin/rayfin.yml` on every run. It strips all
 * comments, and it appends the tenant's hosting URL to `allowedRedirectUris`.
 * That URL is exactly what the `fabric-app-host` class in the publishability
 * gate exists to keep out of the tree: committed, it writes one tenant's app
 * address into every clone.
 *
 * D403 recorded that and said to strip it by hand before committing. It then
 * recurred on the very next deploy and was committed anyway, because the gate
 * ran after the commit rather than before it. **A rule that depends on
 * remembering is a rule that fails on the day you are busy**, which is the same
 * lesson as D376 and D406 in a third costume.
 *
 * So the deploy owns the cleanup. Run this instead of `rayfin up`.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(repo, 'rayfin', 'rayfin.yml');
/*
 * ⚠️ **Rayfin Apps, not a workspace of our own.**
 *
 * This first deployed into a dedicated "Fabric Empires" workspace, which
 * looked tidy and was wrong: every other Rayfin app lives in "Rayfin Apps",
 * so a workspace of one meant its own membership list, and the item failed to
 * open for an account that opens all the others perfectly well. The symptom
 * reads as an identity problem ("you don't have access to the item") and is
 * actually a workspace problem.
 *
 * ⚠️ It also cannot be corrected after the fact. Fabric folders live inside a
 * workspace, so `POST /items/{id}/move` with a folder from another workspace
 * returns `FolderNotFound`. There is no cross-workspace move for an app
 * backend: the only route is to deploy again into the right workspace, which
 * mints a NEW item and a NEW hosting URL. Getting this argument wrong is
 * therefore not a tidy-up, it is a re-issued address.
 *
 * Which is why it is a default here rather than something to remember to pass,
 * for the reason the rest of this file exists.
 */
const workspace = process.argv[2] ?? 'Rayfin Apps';

const isWindows = process.platform === 'win32';

// ⚠️ `npx` on Windows is a `.cmd` shim, and recent Node refuses to spawn one
// without a shell. Without `shell: true` this returns a non-zero status and
// **no output at all**, which reads exactly like a deploy that failed for a
// real reason. With a shell, arguments containing spaces have to be quoted
// here, because the shell re-parses them.
const quote = (s) => (isWindows && /\s/.test(s) ? `"${s}"` : s);

const result = spawnSync(
  'npx',
  ['rayfin', 'up', '-w', quote(workspace), '-y'],
  { cwd: repo, stdio: 'inherit', shell: true },
);

if (result.status !== 0) {
  console.error('\ndeploy: rayfin up failed; leaving the config alone.');
  process.exit(result.status ?? 1);
}

const before = readFileSync(configPath, 'utf8');
const kept = before
  .split(/\r?\n/)
  .filter((line) => !/^\s*-\s*https?:\/\/(?!localhost|127\.0\.0\.1)/.test(line));
const after = kept.join('\n');

if (after !== before) {
  writeFileSync(configPath, after, 'utf8');
  const dropped = before.split(/\r?\n/).length - kept.length;
  console.log(
    `\ndeploy: removed ${dropped} non-local redirect URI from rayfin.yml ` +
      'so the tenant host is not committed.',
  );
} else {
  console.log('\ndeploy: rayfin.yml already carries local origins only.');
}

// Prove it, rather than trusting the regex above.
const gate = spawnSync('python', ['tools/verify_publishable.py'], {
  cwd: repo,
  stdio: 'inherit',
  shell: true,
});
process.exit(gate.status ?? 0);
