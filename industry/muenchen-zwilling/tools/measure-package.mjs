// P01a: use the installed CLI's actual packager, never its deploy function.
import { realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageStaticFolder, MAX_ZIP_SIZE_BYTES } from '../node_modules/@microsoft/rayfin-cli/dist/utils/static-hosting-utils.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const tempRoot = await realpath(resolve(project, '../temp'));
const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg || !isAbsolute(inputArg) || !isAbsolute(outputArg)) {
  throw new Error('Pass absolute input directory and new output ZIP paths.');
}
const input = await realpath(inputArg);
const output = resolve(outputArg);
const parent = await realpath(dirname(output));
const rel = relative(tempRoot, parent);
if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
  throw new Error('Archive output must be in a task-owned repos/temp child.');
}
const bytes = await packageStaticFolder(input);
await writeFile(output, bytes, { flag: 'wx' });
console.log(JSON.stringify({ input: inputArg, output: outputArg, zipBytes: bytes.byteLength,
  maxZipBytes: MAX_ZIP_SIZE_BYTES, node: process.version, zlib: process.versions.zlib }));