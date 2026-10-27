// Writes the guide as one plain HTML file per language into dist/, next to the
// app. Runs after `vite build`, because it inlines the app's compiled styles.
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
const cache = join(root, 'node_modules', '.cache', 'guide-html');

/** A file that grows past this is a sign something was inlined that should not be. */
const MAX_BYTES = 600 * 1024;

const assets = join(dist, 'assets');
if (!existsSync(assets)) throw new Error('dist/assets is missing; run vite build first (npm run build does both)');
const cssFiles = readdirSync(assets).filter((name) => name.endsWith('.css'));
if (cssFiles.length !== 1) throw new Error(`expected one stylesheet in dist/assets, found ${cssFiles.length}; run vite build first`);
const css = readFileSync(join(assets, cssFiles[0]), 'utf8');
// The file must not load anything: no imported stylesheet, no font or picture from an address.
if (/@import/i.test(css)) throw new Error('the stylesheet imports another one; the plain HTML file would load it');
for (const [, target] of css.matchAll(/url\(\s*['"]?([^'")\s]*)/gi)) {
  if (!target.startsWith('#') && !target.startsWith('data:')) throw new Error(`the stylesheet loads ${target}; the plain HTML file would fetch it`);
}
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

await build({
  root,
  configFile: join(root, 'vite.config.ts'),
  logLevel: 'warn',
  build: {
    ssr: 'src/html/render.tsx',
    outDir: cache,
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'render.mjs' } },
  },
});

const { HTML_LOCALES, htmlFileName, renderDocument } = await import(pathToFileURL(join(cache, 'render.mjs')).href);

for (const locale of HTML_LOCALES) {
  const html = renderDocument(locale, css, version);
  const bytes = Buffer.byteLength(html);
  if (bytes > MAX_BYTES) throw new Error(`${htmlFileName(locale)} is ${bytes} bytes, more than ${MAX_BYTES}`);
  if (/<script/i.test(html)) throw new Error(`${htmlFileName(locale)} contains a script`);
  writeFileSync(join(dist, htmlFileName(locale)), html);
  console.log(`dist/${htmlFileName(locale)}  ${(bytes / 1024).toFixed(1)} kB`);
}

rmSync(cache, { recursive: true, force: true });
