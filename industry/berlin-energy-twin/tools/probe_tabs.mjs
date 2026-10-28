/**
 * Headless check of the two tabs from Caldova Köln (D51): opens the built app, switches to
 * "Caldova Bestellung" and "IBCS Charts", fails on page errors and writes one screenshot per tab.
 *   node tools/probe_tabs.mjs [url] [out-dir]
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('../../fresenius-campus-zwilling/node_modules/@playwright/test')

const url = process.argv[2] ?? 'http://127.0.0.1:5294/'
const out = process.argv[3] ?? 'fabric/shots'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
await page.goto(url, { waitUntil: 'load' })
await page.waitForSelector('[data-testid=tab-reorder]', { timeout: 60_000 })

await page.click('[data-testid=tab-reorder]')
await page.waitForTimeout(4000)
const reorderText = (await page.locator('[data-testid=page-reorder]').innerText()).slice(0, 300)
await page.screenshot({ path: `${out}/tab-reorder.png` })

await page.click('[data-testid=tab-finanzen]')
await page.waitForTimeout(6000)
const finText = (await page.locator('[data-testid=page-finanzen]').innerText()).slice(0, 300)
await page.screenshot({ path: `${out}/tab-finanzen.png` })

await page.click('[data-testid=tab-twin]')
await page.waitForTimeout(1500)
const twinVisible = await page.locator('[data-testid=kpi-bar]').isVisible()
await page.screenshot({ path: `${out}/tab-twin.png` })
await browser.close()

console.log(JSON.stringify({ reorderText, finText, twinVisible, errors }, null, 2))
if (errors.length || !reorderText.trim() || !finText.trim() || !twinVisible) process.exit(1)
