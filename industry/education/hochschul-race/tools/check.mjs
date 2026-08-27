// Structural checks for a single-file app — this is `npm run lint`.
//
// The template ships no framework and no bundler, so there is nothing for
// ESLint to walk over a src/ tree. What can still go wrong is exactly what is
// checked here: the four places that must agree on the template id, a syntax
// error inside an inline <script>, and a tenant identifier accidentally left in
// the source.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url)).replace(/[\\/]tools$/, '');
const fail = [];
const ok = (label) => console.log(`  ok  ${label}`);

// 1. Identifiers agree across package.json, manifest.json and rayfin/rayfin.yml.
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const rayfinYml = await readFile(join(root, 'rayfin', 'rayfin.yml'), 'utf8');
const dirName = root.split(/[\\/]/).pop();

const expect = (actual, want, label) => {
  if (actual === want) ok(label);
  else fail.push(`${label}: expected "${want}", got "${actual}"`);
};
expect(pkg.name, dirName, 'package.json name matches directory');
expect(pkg.template?.name, dirName, 'package.json template.name matches directory');
expect(manifest.templateId, dirName, 'manifest.json templateId matches directory');
expect(/^id:\s*(\S+)/m.exec(rayfinYml)?.[1], dirName, 'rayfin.yml id matches directory');
expect(/^name:\s*(\S+)/m.exec(rayfinYml)?.[1], dirName, 'rayfin.yml name matches directory');
if (!pkg.template?.displayName) fail.push('package.json is missing template.displayName');
if (!pkg.template?.description) fail.push('package.json is missing template.description');

// 2. Every inline <script> parses.
const html = await readFile(join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
if (scripts.length === 0) fail.push('index.html contains no inline <script> blocks');
scripts.forEach((src, i) => {
  try {
    new Function(src);
  } catch (e) {
    fail.push(`inline <script> #${i + 1} does not parse: ${e.message}`);
  }
});
if (!fail.some((f) => f.includes('<script>'))) ok(`${scripts.length} inline scripts parse`);

// 3. No tenant-specific identifiers left in the source.
const sources = ['index.html', 'rayfin/rayfin.yml', 'tools/data/hi_dax.ps1', 'README.md'];
const GUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
for (const rel of sources) {
  const text = await readFile(join(root, rel), 'utf8');
  const hits = text.match(GUID);
  if (hits) fail.push(`${rel} contains a tenant identifier: ${[...new Set(hits)].join(', ')}`);
  if (/webapp\.fabricapps\.net|pbidedicated\.windows\.net/.test(text)) {
    fail.push(`${rel} contains a deployment-specific hostname`);
  }
}
if (!fail.some((f) => f.includes('identifier') || f.includes('hostname'))) {
  ok('no tenant identifiers in source');
}

// 4. The live config that ships is the example, and it is all placeholders.
const example = JSON.parse(await readFile(join(root, 'config', 'live.example.json'), 'utf8'));
for (const key of ['clientId', 'tenantId', 'workspaceId', 'datasetId']) {
  if (!/^__[A-Z0-9_]+__$/.test(example[key] ?? '')) {
    fail.push(`config/live.example.json ${key} should be a __PLACEHOLDER__`);
  }
}
if (!fail.some((f) => f.includes('live.example.json'))) ok('live.example.json is all placeholders');

if (fail.length) {
  console.error('\n' + fail.map((f) => `  ✗ ${f}`).join('\n'));
  console.error(`\n${fail.length} problem(s) found.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
