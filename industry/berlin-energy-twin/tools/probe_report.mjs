/**
 * Headless check of the report window (D57): opens it, checks the frame address follows the lens
 * (degewo -> page degewo, BVG -> page bvg, a page picked by hand wins until the lens changes),
 * and screenshots it. The frame itself shows Power BI's sign-in headless; that is expected.
 *   node tools/probe_report.mjs [url] [png]
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('../../fresenius-campus-zwilling/node_modules/@playwright/test')

const url = process.argv[2] ?? 'http://127.0.0.1:5293/'
const out = process.argv[3] ?? 'fabric/shots/report-window.png'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu'] })
const page = await browser.newPage({ viewport: { width: 1360, height: 820 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(url, { waitUntil: 'load' })
await page.waitForSelector('[data-testid=report-start]', { timeout: 60_000 })
await page.waitForTimeout(3000)
await page.click('[data-testid=report-start]')
const src = () => page.getAttribute('[data-testid=report-frame]', 'src')
const problems = []
const want = (s, p) => {
  if (!s?.startsWith('https://app.powerbi.com/reportEmbed?') || !s.includes(`pageName=${p}`)) problems.push(`expected page ${p}: ${s}`)
}
want(await src(), 'degewo')
await page.locator('.seg-light button', { hasText: /^BVG$/ }).first().click()
await page.waitForTimeout(500)
want(await src(), 'bvg')
await page.click('[data-testid=report-page-laden]')
want(await src(), 'laden')
await page.locator('.seg-light button', { hasText: /^degewo$/ }).first().click()
await page.waitForTimeout(500)
want(await src(), 'degewo')
await page.waitForTimeout(4000)
await page.screenshot({ path: out })
await page.click('[data-testid=report-close]')
const closed = (await page.locator('[data-testid=report-window]').count()) === 0
if (!closed) problems.push('window did not close')
await browser.close()
console.log(JSON.stringify({ problems, errors }, null, 1))
if (problems.length || errors.length) process.exit(1)
