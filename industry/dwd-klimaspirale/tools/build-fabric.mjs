// Assembles a clean, self-contained static folder (`fabric-dist/`) for Rayfin
// static hosting. The Klimaspirale app is plain HTML + compiled TS + a JSON
// dataset; this copies exactly those runtime assets (index.html, dist/, data/)
// so the upload contains no source, node_modules, or tooling.
import { cp, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url)).replace(/[\\/]tools$/, '');
const out = join(root, 'fabric-dist');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await cp(join(root, 'index.html'), join(out, 'index.html'));
await cp(join(root, 'dist'), join(out, 'dist'), { recursive: true });
await cp(join(root, 'data'), join(out, 'data'), { recursive: true });

console.log('Assembled fabric-dist/ (index.html + dist/ + data/)');
