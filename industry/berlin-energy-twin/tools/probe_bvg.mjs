/**
 * Headless check of BVG live (D55) and solar now (D56): picks the BVG lens (which turns the
 * vehicles on), zooms to Mitte, waits for an answer, and reports count, status line, rendered
 * dots and the solar KPI. Fails on a page error or when no status appears.
 *   node tools/probe_bvg.mjs [url] [png]
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('../../fresenius-campus-zwilling/node_modules/@playwright/test')

const url = process.argv[2] ?? 'http://127.0.0.1:5293/'
const out = process.argv[3] ?? 'fabric/shots/bvg-live.png'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu'] })
const page = await browser.newPage({ viewport: { width: 1360, height: 820 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(url, { waitUntil: 'load' })
await page.waitForSelector('text=BVG', { timeout: 60_000 })
await page.waitForTimeout(6000)
await page.locator('.seg-light button', { hasText: /^BVG$/ }).first().click()
await page.waitForTimeout(4000)
await page.evaluate(() => window.__twinMap?.jumpTo({ center: [13.4094, 52.5208], zoom: 14, pitch: 0, bearing: 0 }))
await page.waitForFunction(() => /Stand|as of|nicht erreichbar|not reachable/.test(document.querySelector('[data-testid=bvg-live-status]')?.textContent ?? ''), null, { timeout: 60_000 })
await page.waitForTimeout(2500)
const info = await page.evaluate(() => ({
  toggle: document.querySelector('[data-testid=bvg-live-toggle]')?.checked,
  count: document.querySelector('[data-testid=bvg-live-count]')?.textContent,
  status: document.querySelector('[data-testid=bvg-live-status]')?.textContent,
  rendered: window.__twinMap?.queryRenderedFeatures({ layers: ['bvg-live-dot'] }).length ?? null,
  solar: document.querySelector('[data-testid=kpi-solar-now]')?.textContent,
}))
await page.screenshot({ path: out })
await browser.close()
console.log(JSON.stringify({ ...info, errors }, null, 1))
if (errors.length || !info.status) process.exit(1)
