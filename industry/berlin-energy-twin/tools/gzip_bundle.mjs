/**
 * Post-build: compress the application bundle and point index.html at a loader
 * that can read it. See tools/bundle_loader.mjs for why this is necessary.
 *
 * Run after `vite build`. Both files ship - the `.gz` and the original.
 */
import { gzipSync } from 'node:zlib'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { rewriteHtml } from './bundle_loader.mjs'

const DIST = join(process.cwd(), 'dist')
const HTML = join(DIST, 'index.html')

if (!existsSync(HTML)) {
  console.error('[gzip-bundle] dist/index.html is missing - build first')
  process.exit(1)
}

const html = readFileSync(HTML, 'utf8')

// Find the bundle first, so its real length can go into the loader.
const probe = /<script\b(?=[^>]*\btype="module")[^>]*\bsrc="([^"]+)"/.exec(html)
if (!probe) {
  console.error('[gzip-bundle] no module script in dist/index.html')
  process.exit(1)
}
const src = probe[1]
const file = join(DIST, src.replace(/^\//, ''))
if (!existsSync(file)) {
  console.error(`[gzip-bundle] bundle not found: ${file}`)
  process.exit(1)
}

const buf = readFileSync(file)
const chars = buf.toString('utf8').length
const gz = gzipSync(buf, { level: 9 })

// A "compression" that grows the payload would be worse than doing nothing.
if (gz.length >= buf.length) {
  console.error('[gzip-bundle] compression did not shrink the bundle - refusing')
  process.exit(1)
}

writeFileSync(`${file}.gz`, gz)
writeFileSync(HTML, rewriteHtml(html, chars).html)

const pct = ((1 - gz.length / buf.length) * 100).toFixed(0)
console.log(
  `[gzip-bundle] ${src.split('/').pop()} ${(buf.length / 1024).toFixed(0)} KB -> ` +
    `${(gz.length / 1024).toFixed(0)} KB (${pct}% saved), loader inlined`,
)
