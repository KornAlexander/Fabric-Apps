import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

/*
  Source that git cannot see.

  ⚠️ This exists because `.gitignore` line 24 read `media/`, with no leading
  slash, and a pattern without a leading slash matches a directory of that name
  at ANY depth. It was meant to keep the generated soundtrack and video out of
  a repository that is intended to go public. What it also did was swallow
  `tools/media/`, whole and silently.

  The file it swallowed was the intro recorder: the tool written specifically
  so the intro video would stop being a hand-made copy that drifts away from
  the anthem it is cut to. The fix for drift would itself have drifted out of
  the repository on its first commit.

  Nothing reports this. `git status` prints an ignored file exactly the way it
  prints a file that does not exist, which is to say not at all, and the
  publishable scan only ever looks at TRACKED files, so an ignored source file
  is also an unscanned one. Two safety nets with the same blind spot.

  So: no file under a source or tooling directory may be ignored, ever.
*/

const REPO = resolve(__dirname, '..', '..');

/** Directories whose contents must always be visible to git. */
const MUST_BE_VISIBLE = ['tools', 'app/src', 'engine/src', 'learn/src'];

/** Build outputs and dependencies legitimately live inside some of these. */
const ALLOWED_IGNORES = /(^|[\\/])(node_modules|dist)([\\/]|$)/;

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const path = join(d, entry);
      if (ALLOWED_IGNORES.test(relative(REPO, path))) continue;
      if (statSync(path).isDirectory()) walk(path);
      else out.push(path);
    }
  };
  walk(dir);
  return out;
}

describe('repository visibility', () => {
  const roots = MUST_BE_VISIBLE.map((d) => join(REPO, d)).filter((d) => existsSync(d));
  const files = roots.flatMap(filesUnder);

  it('finds the source directories to check', () => {
    // ⚠️ The scan must be proved non-empty. A check that silently covers
    // nothing is the same failure it is looking for, one level up.
    expect(roots.length).toBe(MUST_BE_VISIBLE.length);
    expect(files.length).toBeGreaterThan(20);
  });

  it('⚠️ keeps every source and tooling file visible to git', () => {
    // `git check-ignore --stdin` prints the paths that ARE ignored, and exits
    // 1 when none of them are, which is the case we want.
    let ignored: string[] = [];
    try {
      const out = execFileSync('git', ['check-ignore', '--stdin'], {
        cwd: REPO,
        input: files.map((f) => relative(REPO, f)).join('\n'),
        encoding: 'utf8',
      });
      ignored = out.split(/\r?\n/).filter(Boolean);
    } catch (error) {
      // Exit status 1 means nothing matched. Anything else is a real failure,
      // but a machine without git should not fail the suite.
      const status = (error as { status?: number }).status;
      if (status !== 1) return;
    }

    expect(ignored, [
      'These files are invisible to git, so they will never be committed and',
      'the publishable scan will never read them. Check .gitignore for a',
      'pattern without a leading slash: `media/` matches at any depth,',
      '`/media/` matches only the root.',
      '',
      ...ignored,
    ].join('\n')).toEqual([]);
  });
});
