/**
 * Copy the repository's previews and demo media into the site's public folder.
 *
 * The repo is the single source of truth: docs/previews and docs/media are what the
 * READMEs and the post drafts already point at. Copying rather than duplicating means a
 * newly captured preview appears on the site the moment it is pushed, with nothing to
 * remember.
 *
 * Runs from prebuild and predev, so it is impossible to build the site against stale
 * media by accident.
 */
import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const site = dirname(here);
const repo = dirname(site);

const JOBS = [
  ['docs/previews', 'public/previews'],
  ['docs/media', 'public/media'],
];

let copied = 0;
let bytes = 0;

for (const [from, to] of JOBS) {
  const src = join(repo, from);
  const dst = join(site, to);
  if (!existsSync(src)) {
    console.log(`  skip ${from} (not present)`);
    continue;
  }
  await mkdir(dst, { recursive: true });
  await cp(src, dst, { recursive: true });

  for (const name of await readdir(dst)) {
    const s = await stat(join(dst, name));
    if (s.isFile()) {
      copied += 1;
      bytes += s.size;
    }
  }
  console.log(`  ${from} -> ${to}`);
}

console.log(`  ${copied} media file(s), ${(bytes / 1048576).toFixed(1)} MB`);
