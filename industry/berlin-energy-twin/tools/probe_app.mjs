/**
 * Headless check of the running app (the Browser pane does not finish
 * MapLibre's first render while hidden). Loads the page in headless Edge,
 * waits for the map and the data, prints what a viewer would see and saves a
 * screenshot.
 *
 *   node tools/probe_app.mjs [url] [out.png] [--real] [--3d] [--view lon,lat,zoom,pitch,bearing]
 *
 * --real ticks the photoreal checkbox (LoD2 + aerials, turns 3D on); --3d only turns the
 * terrain on; --view jumps the camera
 * there and waits for the map to go idle before the screenshot.
 *
 * Playwright is borrowed from the Fresenius twin's install (no new dependency here).
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('../../fresenius-campus-zwilling/node_modules/@playwright/test')

const pos = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !['--view', '--lens'].includes(all[i - 1]))
const url = pos[0] ?? 'http://127.0.0.1:5293/'
const out = pos[1] ?? '../temp/edge-bsw/probe.png'
const real = process.argv.includes('--real')
const viewArg = process.argv[process.argv.indexOf('--view') + 1]
const view = process.argv.includes('--view') ? viewArg.split(',').map(Number) : null
const lens = process.argv.includes('--lens') ? process.argv[process.argv.indexOf('--lens') + 1] : null

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu'] })
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 820 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 })
  await page.waitForSelector('[data-testid="kpi-bar"]', { timeout: 30_000 })
  await page.waitForFunction(() => window.__twinMap?.loaded(), null, { timeout: 30_000 }).catch(() => undefined)
  if (real) {
    await page.locator('label.mode-row', { hasText: /LoD2/ }).locator('input').check()
    await page.waitForFunction(() => window.__twinMap?.getLayer('aerial-base'), null, { timeout: 60_000 })
  }
  if (process.argv.includes('--3d') && !real) {
    await page.locator('button', { hasText: /^3D/ }).click()
    await page.waitForFunction(() => window.__twinMap?.getTerrain(), null, { timeout: 30_000 })
  }
  if (lens) {
    await page.click(`[data-testid="lens-${lens}"]`)
    await page.waitForTimeout(2500) // the lens camera flight
  }
  if (view) {
    await page.evaluate(([lng, lat, zoom, pitch, bearing]) => {
      window.__twinMap.jumpTo({ center: [lng, lat], zoom, pitch, bearing })
    }, view)
    // Sites load lazily once in view (D29): wait for at least one, if this is a site view.
    if (real && view[2] >= 13.5) {
      await page.waitForFunction(() => window.__twinSites?.loadedIds().length > 0, null, { timeout: 90_000 }).catch(() => undefined)
    }
    await page.waitForFunction(() => window.__twinMap?.areTilesLoaded() && !window.__twinMap.isMoving(), null, { timeout: 60_000 }).catch(() => undefined)
    await page.waitForTimeout(3000) // roof photo texture and terrain snapping settle after idle
  }
  const state = await page.evaluate(() => {
    const m = window.__twinMap
    return {
      kpi: document.querySelector('[data-testid="kpi-bar"]')?.innerText.replace(/\s+/g, ' '),
      counts: [...document.querySelectorAll('.count')].map((e) => e.textContent),
      zoom: m?.getZoom().toFixed(2),
      centre: m ? [m.getCenter().lng.toFixed(3), m.getCenter().lat.toFixed(3)] : null,
      stationsRendered: m?.queryRenderedFeatures({ layers: ['stations-bsw', 'stations-other'] }).length,
      sitesLoaded: window.__twinSites?.loadedIds() ?? [],
      lensKpi: document.querySelector('[data-testid="kpi-bar"]')?.getAttribute('data-lens'),
      partnerRendered: m?.getLayer('unit-dot') ? m.queryRenderedFeatures({ layers: ['unit-dot'] }).length : null,
      terrainAtCentreM: m?.getTerrain() ? Number(m.queryTerrainElevation(m.getCenter())?.toFixed(2)) : null,
      scale: document.querySelector('[data-testid="scale-bar"]')?.textContent,
    }
  })
  await page.screenshot({ path: out })
  console.log(JSON.stringify({ ...state, errors, screenshot: out }, null, 1))
} finally {
  await browser.close()
}
