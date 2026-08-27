// Assembles a clean, self-contained static folder (`dist/`) for Rayfin static
// hosting. The Studierende-Race app is a single self-contained index.html with
// the dataset inlined, so this just copies index.html (plus the optional
// config/ folder) into dist/ (no source, node_modules or tooling in the upload).
import { cp, rm, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url)).replace(/[\\/]tools$/, '');
const out = join(root, 'dist');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(root, 'index.html'), join(out, 'index.html'));

// config/live.json is optional. When it is absent we still ship the example
// (all placeholders) so the app's config probe gets a 200 and rejects it
// cleanly, instead of logging a 404 on every fresh clone.
let withConfig = false;
await mkdir(join(out, 'config'), { recursive: true });
try {
  await access(join(root, 'config', 'live.json'));
  await cp(join(root, 'config', 'live.json'), join(out, 'config', 'live.json'));
  withConfig = true;
} catch {
  await cp(join(root, 'config', 'live.example.json'), join(out, 'config', 'live.json'));
}

console.log(`Assembled dist/ (index.html${withConfig ? ' + config/live.json' : ', snapshot-only'})`);
