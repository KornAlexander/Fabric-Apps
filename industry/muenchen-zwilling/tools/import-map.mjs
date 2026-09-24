import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BINARY_FILES, JSON_FILES, ASSET_FILES, cleanDescriptor, inheritedName, privateCoordinate } from './map-assets.mjs';

const source = process.argv[2];
if (!source || !isAbsolute(source)) throw new Error('Pass the absolute path of an approved Munich map asset folder.');
const destination = fileURLToPath(new URL('../public/terrain/munich/', import.meta.url));
if (resolve(source) === resolve(destination)) throw new Error('The input and output folders must differ.');
// Validate everything before writing. No recursive copying or data-folder imports.
for (const name of ASSET_FILES) {
  if (!(await stat(resolve(source, name))).isFile()) throw new Error(`Missing map asset: ${name}`);
}
const descriptors = new Map();
for (const name of JSON_FILES) {
  const input = JSON.parse(await readFile(resolve(source, name), 'utf8'));
  const cleaned = cleanDescriptor(name, input);
  const text = JSON.stringify(cleaned, null, 2) + '\n';
  if (inheritedName.test(text) || privateCoordinate.test(text)) throw new Error(`Unexpected identity in ${name}.`);
  descriptors.set(name, text);
}
const terrain = JSON.parse(descriptors.get('heightmap.json'));
if (terrain.width !== 1627 || terrain.height !== 1971 || terrain.origin.easting !== 689916 || terrain.origin.northing !== 5333514) {
  throw new Error('The supplied data is not the verified Munich map grid.');
}
await mkdir(destination, { recursive: true });
const unexpected = (await readdir(destination)).filter(name => !ASSET_FILES.includes(name));
if (unexpected.length) throw new Error('Output contains unexpected files; inspect rather than overwrite.');
for (const name of BINARY_FILES) await copyFile(resolve(source, name), resolve(destination, name));
for (const [name, text] of descriptors) await writeFile(resolve(destination, name), text, 'utf8');
console.log(`Imported ${ASSET_FILES.length} geometry-only map assets. Input unchanged.`);