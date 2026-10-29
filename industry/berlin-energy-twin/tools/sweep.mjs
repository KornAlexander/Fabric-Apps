/**
 * Playwright sweep of the whole app (D60): every lens, tab, language, theme, the tour, the report
 * window, BVG live, panel collapse, 3D and buildings, on a desktop and a phone viewport. Collects
 * page errors, console errors, failed requests, unfilled placeholders ({x} or raw string keys),
 * horizontal overflow, controls without an accessible name, and screenshots each state.
 *
 *   node tools/sweep.mjs [url] [out-dir]
 *
 * Use the dev server (debug hooks) or the built app on a static server; both work.
 */
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('../../fresenius-campus-zwilling/node_modules/@playwright/test')

const url = process.argv[2] ?? 'http://127.0.0.1:5293/'
const out = process.argv[3] ?? 'fabric/shots/sweep'
mkdirSync(out, { recursive: true })
const issues = []
const note = (where, what) => issues.push(`${where}: ${what}`)

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu'] })

async function run(name, viewport, steps) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => note(name, `pageerror ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|React DevTools/.test(m.text())) note(name, `console ${m.text().slice(0, 200)}`)
  })
  page.on('response', (r) => {
    const u = r.url()
    if (r.status() >= 400 && !/powerbi|microsoftonline|favicon/.test(u)) note(name, `HTTP ${r.status()} ${u.slice(0, 140)}`)
  })
  page.on('requestfailed', (r) => {
    const u = r.url()
    if (!/powerbi|microsoftonline|ERR_ABORTED/.test(`${u} ${r.failure()?.errorText}`)) note(name, `failed ${r.failure()?.errorText} ${u.slice(0, 140)}`)
  })
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForSelector('[data-testid=kpi-bar]', { timeout: 90_000 })
  await page.waitForTimeout(6000)
  for (const [label, fn] of steps) {
    try {
      await fn(page)
      await page.waitForTimeout(1200)
      await check(page, `${name}/${label}`, viewport)
      await page.screenshot({ path: `${out}/${name}-${label}.png` })
    } catch (e) {
      note(`${name}/${label}`, `step failed: ${e.message.split('\n')[0]}`)
    }
  }
  await ctx.close()
}

async function check(page, where, viewport) {
  const r = await page.evaluate(() => {
    const visible = (el) => {
      const s = getComputedStyle(el)
      const b = el.getBoundingClientRect()
      return s.visibility !== 'hidden' && s.display !== 'none' && b.width > 0 && b.height > 0
    }
    const text = document.body.innerText
    const placeholders = [...new Set(text.match(/\{[a-zA-Z]+\}|\b(?:tour|kpi|panel|layer|report|bvg|tabs|badge|pop|roof|depot|dist|charging|vp|lens|view|real|header|place|carrier|app)\.(?!transport\.rest)[a-zA-Z.]+\b/g) ?? [])]
    const unnamed = [...document.querySelectorAll('button, a, [role=button], input')]
      .filter((el) => visible(el) && !el.closest('.maplibregl-ctrl-attrib'))
      .filter((el) => !(el.getAttribute('aria-label') || el.textContent.trim() || el.getAttribute('title') || el.closest('label') ||
        (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.getAttribute('aria-labelledby')))
      .map((el) => el.outerHTML.slice(0, 90))
    const offscreen = [...document.querySelectorAll('header.header *')]
      .filter((el) => visible(el) && el.getBoundingClientRect().right > window.innerWidth + 1)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 60))
    return {
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      placeholders,
      unnamed: unnamed.slice(0, 5),
      offscreen: [...new Set(offscreen)].slice(0, 5),
    }
  })
  if (r.overflowX) note(where, `horizontal overflow at ${viewport.width}px`)
  if (r.placeholders.length) note(where, `unfilled text ${r.placeholders.join(', ')}`)
  if (r.unnamed.length) note(where, `controls without a name: ${r.unnamed.join(' | ')}`)
  if (r.offscreen.length) note(where, `header items past the right edge: ${r.offscreen.join(', ')}`)
}

const click = (sel) => async (p) => p.locator(sel).first().click()
const lens = (name) => async (p) => p.locator('.seg-light button', { hasText: new RegExp(`^${name}$`) }).first().click()

const desktop = [
  ['start', async () => {}],
  ['lens-bvg', lens('BVG')],
  ['lens-bsw', lens('Stadtwerke')],
  ['lens-degewo', lens('degewo')],
  ['list-fly', async (p) => { await p.locator('.panel button, .panel li').filter({ hasText: /kWp offen/ }).first().click(); await p.waitForTimeout(5000) }],
  ['districts', async (p) => {
    await p.locator('[data-testid=districts-toggle]').check()
    await p.evaluate(() => window.__twinMap?.jumpTo({ center: [13.405, 52.507], zoom: 10, pitch: 0, bearing: 0 }))
    await p.waitForTimeout(3500)
    const legend = await p.locator('[data-testid=districts-legend]').count()
    if (!legend) throw new Error('no district legend')
  }],
  ['district-popup', async (p) => {
    // A charge point within the hit box wins over the district (by design), so try quiet spots.
    const box = await p.locator('.map').first().boundingBox()
    for (const ll of [[13.16, 52.55], [13.24, 52.43], [13.64, 52.40], [13.47, 52.62]]) {
      const xy = await p.evaluate((c) => { const q = window.__twinMap?.project(c); return q && [q.x, q.y] }, ll)
      if (!xy) throw new Error('no debug map hook (use the dev server)')
      await p.keyboard.press('Escape')
      await p.mouse.click(box.x + xy[0], box.y + xy[1])
      if (await p.locator('[data-testid=district-popup]').count()) return
      await p.waitForTimeout(500)
      if (await p.locator('[data-testid=district-popup]').count()) return
    }
    throw new Error('no district popup at any quiet spot')
  }],
  ['districts-3d', async (p) => {
    await p.keyboard.press('Escape')
    await p.locator('.seg-light button', { hasText: /3D/ }).first().click()
    await p.evaluate(() => window.__twinMap?.jumpTo({ center: [13.4094, 52.5208], zoom: 14.6, pitch: 55, bearing: 20 }))
    await p.waitForTimeout(5000)
    const order = await p.evaluate(() => {
      const ids = window.__twinMap.getStyle().layers.map((l) => l.id)
      const at = (id) => ids.indexOf(id)
      const aerial = ids.filter((id) => id.startsWith('aerial-')).map(at)
      return { dist: at('districts-fill'), stations: Math.min(at('stations-other'), at('stations-bsw')), aerialMax: aerial.length ? Math.max(...aerial) : -1 }
    })
    if (order.dist < 0 || order.dist > order.stations) throw new Error(`district shade above the charge points ${JSON.stringify(order)}`)
    if (order.aerialMax > order.stations) throw new Error(`aerial photo above the charge points ${JSON.stringify(order)}`)
  }],
  ['districts-off', async (p) => { await p.locator('.seg-light button', { hasText: /^2D$/ }).first().click(); await p.locator('[data-testid=districts-toggle]').uncheck() }],
  ['3d', async (p) => { await p.locator('.seg-light button', { hasText: /3D/ }).first().click(); await p.waitForTimeout(3000) }],
  ['bvg-live', async (p) => { await p.locator('[data-testid=bvg-live-toggle]').check(); await p.waitForTimeout(4000) }],
  ['report', async (p) => { await p.locator('[data-testid=report-start]').click(); await p.waitForTimeout(2500) }],
  ['report-close', click('[data-testid=report-close]')],
  ['en', async (p) => p.locator('header .seg button', { hasText: /^EN$/ }).click()],
  ['dark', async (p) => p.locator('header .seg button[title]').nth(1).click()],
  ['light-de', async (p) => { await p.locator('header .seg button[title]').nth(0).click(); await p.locator('header .seg button', { hasText: /^DE$/ }).click() }],
  ['tour-1', click('[data-testid=tour-start]')],
  ['tour-2', async (p) => { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(4500) }],
  ['tour-3', async (p) => { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(4500) }],
  ['tour-4', async (p) => { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(5500) }],
  ['tour-5', async (p) => { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(5000) }],
  ['tour-end', async (p) => p.keyboard.press('Escape')],
  ['panel-collapse', click('.panel-toggle, [aria-label*="anel"], .collapse')],
  ['tab-reorder', click('[data-testid=tab-reorder]')],
  ['tab-finanzen', async (p) => { await p.locator('[data-testid=tab-finanzen]').click(); await p.waitForTimeout(3000) }],
  ['finanzen-guv', async (p) => { await p.locator('[data-testid=page-finanzen] button', { hasText: /GuV & Simulation/ }).first().click(); await p.waitForTimeout(2500) }],
  ['back-twin', click('[data-testid=tab-twin]')],
]

const phone = [
  ['start', async () => {}],
  ['panel-open', click('.panel-toggle')],
  ['lens-bvg', lens('BVG')],
  ['panel-close', click('.panel-toggle')],
  ['tour-1', click('[data-testid=tour-start]')],
  ['tour-end', async (p) => p.keyboard.press('Escape')],
  ['tab-reorder', click('[data-testid=tab-reorder]')],
  ['tab-finanzen', async (p) => { await p.locator('[data-testid=tab-finanzen]').click(); await p.waitForTimeout(3000) }],
]

await run('desktop', { width: 1600, height: 900 }, desktop)
await run('laptop', { width: 1280, height: 720 }, [['start', async () => {}], ['report', async (p) => { await p.locator('[data-testid=report-start]').click(); await p.waitForTimeout(2000) }], ['tour-1', click('[data-testid=tour-start]')]])
await run('phone', { width: 390, height: 844 }, phone)
await browser.close()

console.log(JSON.stringify({ issues: [...new Set(issues)] }, null, 1))
process.exit(issues.length ? 1 : 0)
