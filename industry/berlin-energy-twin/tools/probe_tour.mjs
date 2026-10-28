/**
 * Walks the guided tour headlessly (PLAN §7 Phase 4 check): starts it, steps
 * with the keys a presentation clicker sends, waits at each stop for the flight
 * and the site to load, records caption, figure and badges, screenshots every
 * stop, goes back once and ends with Esc.
 *
 *   node tools/probe_tour.mjs [url] [outDir] [--en]
 *
 * Fails (exit 1) on a page error, a missing caption number or a missing badge
 * the plan requires ("Schätzung" on estimates, "aggregiert", "Luftlinie").
 */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { chromium } = require('../../fresenius-campus-zwilling/node_modules/@playwright/test')

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const url = pos[0] ?? 'http://127.0.0.1:5293/'
const outDir = pos[1] ?? '../temp/edge-bsw/tour'
const en = process.argv.includes('--en')
mkdirSync(outDir, { recursive: true })

const REQUIRED = { hero: ['estimate'], estate: ['estimate'], charging: ['airline'], bsw: ['aggregated'], close: ['estimate'] }

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu'] })
const problems = []
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 820 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 })
  if (en) await page.click('button:text-is("EN")')
  await page.waitForSelector('[data-testid="tour-start"]:not([disabled])', { timeout: 30_000 })
  await page.click('[data-testid="tour-start"]')

  const settle = async () => {
    await page.waitForTimeout(3600) // the 3 s flight
    // a site stop: its buildings and photo load lazily once in view (D29)
    if ((await page.evaluate(() => window.__twinMap.getZoom())) >= 13.5) await page.waitForFunction(() => window.__twinSites?.loadedIds().length > 0, null, { timeout: 90_000 }).catch(() => undefined)
    await page.waitForFunction(() => window.__twinMap?.areTilesLoaded() && !window.__twinMap.isMoving(), null, { timeout: 60_000 }).catch(() => undefined)
    await page.waitForTimeout(2500)
  }

  const stops = []
  for (let i = 0; ; i++) {
    const card = page.locator('[data-testid="tour-card"]')
    const id = await card.getAttribute('data-stop')
    await settle()
    const info = await page.evaluate(() => ({
      step: document.querySelector('[data-testid="tour-step"]')?.textContent,
      title: document.querySelector('.tour-card h2')?.textContent,
      body: document.querySelector('.tour-card p')?.textContent,
      figure: document.querySelector('[data-testid="tour-figure"] b')?.textContent,
      badges: [...document.querySelectorAll('[data-testid^="tour-badge-"]')].map((b) => b.getAttribute('data-testid').replace('tour-badge-', '')),
      lens: document.querySelector('[data-testid="kpi-bar"]')?.getAttribute('data-lens'),
      zoom: window.__twinMap?.getZoom().toFixed(1),
      sites: window.__twinSites?.loadedIds() ?? [],
      gapLayer: !!window.__twinMap?.getLayer('tour-gap-line') && (window.__twinMap.getSource('tour-gap')?._data?.features?.length ?? -1),
      panelOpen: document.querySelector('[data-testid="panel"]')?.getAttribute('data-open'),
    }))
    stops.push({ id, ...info })
    await page.screenshot({ path: `${outDir}/${String(i + 1).padStart(2, '0')}-${id}.png` })
    if (/NaN|undefined|\{\w+\}/.test(`${info.title} ${info.body} ${info.figure}`)) problems.push(`${id}: unfilled caption`)
    for (const b of REQUIRED[id] ?? []) if (!info.badges.includes(b)) problems.push(`${id}: badge ${b} missing`)
    // Switching DE/EN mid-stop must not fly the camera again (review 2026-10-28).
    if (i === 2) {
      const at = await page.evaluate(() => window.__twinMap.getCenter().toArray())
      await page.click(`button:text-is("${en ? 'DE' : 'EN'}")`)
      await page.waitForTimeout(1200)
      const moved = await page.evaluate((a) => {
        const c = window.__twinMap.getCenter().toArray()
        return window.__twinMap.isMoving() || Math.hypot(c[0] - a[0], c[1] - a[1]) > 1e-6
      }, at)
      if (moved) problems.push('language switch re-flew the tour stop')
      await page.click(`button:text-is("${en ? 'EN' : 'DE'}")`)
      await page.waitForTimeout(400)
    }
    const last = (await page.locator('[data-testid="tour-next"]').textContent()) !== (en ? 'Next' : 'Weiter')
    if (last) break
    await page.keyboard.press(i === 0 ? 'PageDown' : 'ArrowRight')
    // the first press goes back once and forward again, so Back is exercised too
    if (i === 1) {
      await page.keyboard.press('ArrowLeft')
      await page.waitForTimeout(400)
      const back = await card.getAttribute('data-stop')
      if (back !== stops[1].id) problems.push(`ArrowLeft went to ${back}, expected ${stops[1].id}`)
      await page.keyboard.press('ArrowRight')
    }
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  const ended = (await page.locator('[data-testid="tour-card"]').count()) === 0
  if (!ended) problems.push('Esc did not end the tour')
  const panel = await page.locator('[data-testid="panel"]').getAttribute('data-open')
  if (panel !== 'true') problems.push('panel not restored after the tour')
  if (errors.length) problems.push(...errors.map((e) => `page: ${e}`))
  console.log(JSON.stringify({ stops, ended, panelAfter: panel, problems }, null, 1))
} finally {
  await browser.close()
}
process.exit(problems.length ? 1 : 0)
