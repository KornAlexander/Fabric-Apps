/**
 * Pre-compress the baked data files after a build.
 *
 * ⚠️ WHY THIS EXISTS: Fabric static hosting serves everything uncompressed.
 * Measured on the deployed app — `content-encoding` absent, `encodedBodySize`
 * equal to `decodedBodySize` — so `network.json` crosses the wire at its full
 * 746 KB. We cannot set response headers there, so the data is compressed here
 * and inflated in the browser (`src/data/fetchBaked.ts`).
 *
 * ⚠️ THE ORIGINALS STAY. Both files ship: the loader falls back to the plain
 * `.json` if the browser cannot inflate, or if the `.gz` is missing. An
 * optimisation must never be the reason a demo goes dark.
 */
import { gzipSync } from 'node:zlib'
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Only the files big enough to be worth a second request path.
const DIST_DATA = join(process.cwd(), 'dist', 'data')
// Plus every per-site building and tree binary (D29, D31): 16.7 MB of int16
// geometry that compresses well. Read by fetchBin in src/buildings/lod2.ts.
const BINARIES = existsSync(DIST_DATA)
  ? readdirSync(DIST_DATA).filter((f) => /^(buildings|trees)-.+\.bin$/.test(f))
  : []
const FILES = ['charging.json', 'units.json', 'sites.json', 'context.json', ...BINARIES]

let raw = 0
let gz = 0
for (const name of FILES) {
  const src = join(DIST_DATA, name)
  if (!existsSync(src)) {
    console.warn(`[gzip-data] skipped, not built: ${name}`)
    continue
  }
  const buf = readFileSync(src)
  const out = gzipSync(buf, { level: 9 })
  writeFileSync(`${src}.gz`, out)
  raw += buf.length
  gz += out.length
  const pct = ((1 - out.length / buf.length) * 100).toFixed(0)
  console.log(
    `[gzip-data] ${name.padEnd(48)} ${(buf.length / 1024).toFixed(0).padStart(5)} KB -> ` +
      `${(out.length / 1024).toFixed(0).padStart(4)} KB  (${pct}% saved)`,
  )
}
if (raw > 0) {
  console.log(
    `[gzip-data] total ${(raw / 1024).toFixed(0)} KB -> ${(gz / 1024).toFixed(0)} KB ` +
      `(${((1 - gz / raw) * 100).toFixed(0)}% saved)`,
  )
}
// A sanity check that the gz really is smaller; a "compression" that grows the
// payload would be worse than doing nothing at all.
if (raw > 0 && gz >= raw) {
  console.error('[gzip-data] compression did not shrink the payload - refusing')
  process.exit(1)
}
void statSync
