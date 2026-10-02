// Assembles fabric-dist/ for Rayfin static hosting: the Airport IQ landing page
// plus the two views (Live Approach + DUS Live-Ops), each with its own data/.
// The assistant backend address is a deployment value, not source: it is read from
// AIRPORT_IQ_API_BASE at build time and written into fabric-dist only.
import { cp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = dirname(fileURLToPath(import.meta.url)).replace(/[\\/]tools$/, '');
const out = join(root, 'fabric-dist');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(root, 'index.html'), join(out, 'index.html'));
await cp(join(root, 'views'), join(out, 'views'), { recursive: true });

const apiBase = (process.env.AIRPORT_IQ_API_BASE ?? '').trim().replace(/\/$/, '');
if (apiBase && !/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(apiBase)) {
  throw new Error('AIRPORT_IQ_API_BASE must be a bare https origin, e.g. https://<app>.<env>.<region>.azurecontainerapps.io');
}
const configPath = join(out, 'views', 'assistant', 'config.js');
const config = await readFile(configPath, 'utf8');
if (!config.includes('__AIRPORT_IQ_API_BASE__')) throw new Error('config.js lost its __AIRPORT_IQ_API_BASE__ placeholder');
await writeFile(configPath, config.replace('__AIRPORT_IQ_API_BASE__', apiBase));
console.log(`Assembled fabric-dist/ (index.html + views/**), assistant backend ${apiBase ? 'set' : 'NOT set (chat disabled)'}`);
