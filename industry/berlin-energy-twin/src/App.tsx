import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useI18n } from './i18n/I18nProvider'
import { fill, type StringKey } from './i18n/strings'
import { EnergyMap, esc, OTHER_COLOUR, OWN_COLOUR, type Layers } from './components/EnergyMap'
import { bswShare, summarise, type ChargingData } from './charging/charging'
import { fetchBakedJson, fetchFile } from './lib/fetchBaked'
import {
  LENSES,
  lensBounds,
  lensSummary,
  openKw,
  rankRoofs,
  type Lens,
  type RoofHeights,
  type SitesData,
  type Unit,
} from './partners/partners'
import type { PartnerData } from './components/partnerLayers'
import { buildTour, CARRIERS, flightMs, gapFeatures, type TourCamera } from './tour/tour'
import { TourCard } from './tour/TourCard'
import { estateReach, mergeNested } from './partners/chargingGap'
import { ReorderApp } from '@reorder/ReorderApp'
import { useLive } from '@/nachbestellung/useLive'
import { useBvgLive } from './live/useBvgLive'
import { estimateKw, useSolarNow } from './live/solarNow'
import { vehicleFeatures, type Bbox } from './live/bvgRadar'
import { MODE_COLOURS } from './components/bvgLayer'
import { DISTRICT_HIGH, DISTRICT_LOW } from './components/districtLayer'
import { districtFeatures, districtStats, sparkPath, type ContextDistrict, type DistrictStats } from './charging/districts'
import { embedUrl } from './powerbi/embedUrl'
import { ReportWindow, type ReportPage } from './powerbi/ReportWindow'
// The Finanzen tab (from Caldova Köln, D51) is code-split: cockpit, exports and visuals load on first open.
const FinanzenApp = lazy(() => import('@finanzen/FinanzenApp').then((m) => ({ default: m.FinanzenApp })))

type Tab = 'twin' | 'reorder' | 'finanzen'
/** The report page each lens opens on (D57). */
const LENS_PAGE: Record<Lens, ReportPage> = { bsw: 'stadtwerke', degewo: 'degewo', bvg: 'bvg' }
const PBI = { reportId: import.meta.env.VITE_PBI_REPORT_ID as string, tenantId: import.meta.env.VITE_PBI_TENANT_ID as string }
const TABS: Tab[] = ['twin', 'reorder', 'finanzen']

const THEME_KEY = 'bsw-twin-theme'
const PANEL_KEY = 'bsw-twin-panel'
/** How close a list click flies: one building or depot fills the middle of the view. */
const SITE_VIEW = { zoom: 17.2, pitch: 58, bearing: -20 }

type Viewpoint = {
  id: string
  label: StringKey
  center: [number, number]
  zoom: number
  pitch: number
  bearing: number
}

const VIEWPOINTS: Viewpoint[] = [
  { id: 'city', label: 'vp.city', center: [13.405, 52.507], zoom: 10, pitch: 0, bearing: 0 },
  { id: 'mitte', label: 'vp.mitte', center: [13.4094, 52.5208], zoom: 14.6, pitch: 62, bearing: 20 },
]

export default function App() {
  const { t, lang, setLang } = useI18n()
  const loc = lang === 'en' ? 'en-GB' : 'de-DE'
  const [panelOpen, setPanelOpen] = useState(() => {
    try {
      // D60: on a phone the open panel covers the whole map, so it starts closed there
      return (localStorage.getItem(PANEL_KEY) ?? (window.innerWidth < 760 ? 'closed' : 'open')) === 'open'
    } catch {
      return true
    }
  })
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return (localStorage.getItem(THEME_KEY) as 'light' | 'dark') ?? 'light'
    } catch {
      return 'light'
    }
  })
  const [charging, setCharging] = useState<ChargingData | null>(null)
  const [chargingError, setChargingError] = useState(false)
  const [layers, setLayers] = useState<Layers>({ chargingBsw: true, chargingOthers: true })
  // D61: charging per district, shaded by public points per 1,000 residents
  const [showDistricts, setShowDistricts] = useState(false)
  const [contextDistricts, setContextDistricts] = useState<ContextDistrict[] | null>(null)
  // D62: the tour shades the districts at its district stop, whatever the toggle says
  const [tourOverlay, setTourOverlay] = useState<'districts' | null>(null)
  const reportByTour = useRef(false)
  // degewo is the focus partner, so its lens is on from the first second (D36)
  const [lens, setLens] = useState<Lens>('degewo')
  const [partners, setPartners] = useState<PartnerData | null>(null)
  const [frame, setFrame] = useState<{ bounds: [[number, number], [number, number]]; nonce: number } | null>(null)
  const [threeD, setThreeD] = useState(false)
  const [realism, setRealism] = useState(false)
  const [realismLoading, setRealismLoading] = useState(false)
  const [glLost, setGlLost] = useState(false)
  const [clock, setClock] = useState(() => new Date())
  const [camera, setCamera] = useState<{
    center: [number, number]
    zoom: number
    pitch: number
    bearing: number
    duration?: number
    nonce: number
  } | null>(null)
  // Guided tour (Phase 4): index of the current stop, null when not touring.
  const [tour, setTour] = useState<number | null>(null)
  const panelBeforeTour = useRef(true)
  // D51: the Caldova order app and the IBCS finance cockpit as two more tabs.
  // The map stays mounted underneath, so switching back never reloads it.
  const [tab, setTab] = useState<Tab>('twin')
  const [finanzenOpened, setFinanzenOpened] = useState(false)
  const live = useLive(tab === 'reorder')
  // D55: BVG vehicles in the camera view; on with the BVG lens, paused on the other tabs.
  const [bvgOn, setBvgOn] = useState(false)
  // true while the lens or the tour turned it on; a tick by hand stays on everywhere
  const bvgAuto = useRef(false)
  const [view, setView] = useState<Bbox | null>(null)
  const bvgLive = useBvgLive(bvgOn && tab === 'twin', view)
  const solarNow = useSolarNow(clock)
  // D57: the Power BI report in a window over the map; its page follows the lens until picked by hand.
  const [reportOpen, setReportOpen] = useState(false)
  const reportOpenRef = useRef(reportOpen)
  reportOpenRef.current = reportOpen
  const [reportPage, setReportPage] = useState<ReportPage | null>(null)
  const [reportMax, setReportMax] = useState(false)
  const page: ReportPage = reportPage ?? LENS_PAGE[lens]
  const reportUrl = embedUrl({
    ...PBI,
    pageName: page,
    chromeless: true,
    locale: lang === 'en' ? { language: 'en', formatLocale: 'en-GB' } : { language: 'de', formatLocale: 'de-DE' },
  })
  const autoBvg = (want: boolean) => {
    if (want) {
      setBvgOn((on) => {
        if (!on) bvgAuto.current = true
        return true
      })
    } else if (bvgAuto.current) {
      bvgAuto.current = false
      setBvgOn(false)
    }
  }
  const vehicles = useMemo(() => (bvgLive.kind === 'ok' ? vehicleFeatures(bvgLive.vehicles) : null), [bvgLive])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* private window: the choice simply is not remembered */
    }
  }, [theme])
  useEffect(() => {
    try {
      localStorage.setItem(PANEL_KEY, panelOpen ? 'open' : 'closed')
    } catch {
      /* see above */
    }
  }, [panelOpen])
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  // ⚠️ No abort signal: the load is shared (fetchBakedJson), and StrictMode's
  // mount-unmount-mount aborted it for the second mount too, which then got a
  // rejected promise and never showed a single station. Ignore late results instead.
  useEffect(() => {
    let alive = true
    fetchBakedJson<ChargingData>('data/charging.json')
      .then((d) => alive && setCharging(d))
      .catch((e) => {
        console.warn('charging data unavailable', e)
        if (alive) setChargingError(true)
      })
    return () => {
      alive = false
    }
  }, [])

  // Same pattern as the charging load: shared fetch, late results ignored.
  useEffect(() => {
    let alive = true
    Promise.all([
      fetchBakedJson<SitesData>('data/sites.json'),
      fetchBakedJson<{ units: Unit[] }>('data/units.json'),
      fetchFile('data/roofs.json')
        .then((r) => r.json() as Promise<RoofHeights>)
        .catch(() => null),
    ])
      .then(([sites, u, heights]) => alive && setPartners({ sites, units: u.units, heights }))
      .catch((e) => console.warn('partner data unavailable', e))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (contextDistricts) return
    let alive = true
    fetchBakedJson<{ districts: ContextDistrict[] }>('data/context.json')
      .then((c) => alive && setContextDistricts(c.districts))
      .catch((e) => {
        console.warn('district outlines unavailable', e)
        if (alive) setShowDistricts(false)
      })
    return () => {
      alive = false
    }
  }, [contextDistricts])
  const dStats = useMemo(
    () => (charging && contextDistricts ? districtStats(charging.stations, charging.districts, contextDistricts) : null),
    [charging, contextDistricts],
  )
  const summary = useMemo(() => (partners ? lensSummary(lens, partners.units, partners.sites) : null), [partners, lens])
  const ranked = useMemo(() => (partners ? rankRoofs(partners.sites.buildings) : []), [partners])
  const depots = useMemo(
    () => (partners ? [...partners.sites.depots].filter((d) => d.lon !== null).sort((a, b) => b.kwGross - a.kwGross) : []),
    [partners],
  )
  const pickLens = (l: Lens) => {
    setLens(l)
    setReportPage(null)
    autoBvg(l === 'bvg')
    const b = partners && lensBounds(l, partners.units, partners.sites)
    if (b) setFrame({ bounds: b, nonce: Date.now() })
  }
  const flyToSite = (lon: number, lat: number) => {
    // A site from the list is worth its 3D: buildings and photo load for it alone.
    setRealism(true)
    fly({ center: [lon, lat], ...SITE_VIEW })
  }
  const kw = (n: number) => (n >= 1000 ? `${(n / 1000).toLocaleString(loc, { maximumFractionDigits: 1 })} MW` : `${Math.round(n).toLocaleString(loc)} kW`)

  const stations = useMemo(() => charging?.stations ?? [], [charging])
  const bsw = useMemo(() => summarise(stations.filter((s) => s.bsw)), [stations])
  const all = useMemo(() => summarise(stations), [stations])
  const share = useMemo(() => bswShare(stations), [stations])
  const asOf = charging ? new Date(charging.meta.bakedUtc).toLocaleDateString(loc) : ''
  const fmt = (n: number) => n.toLocaleString(loc)
  const dec1 = (n: number) => n.toLocaleString(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const districtLayer = useMemo(() => {
    if (!(showDistricts || tourOverlay === 'districts') || !dStats || !contextDistricts) return null
    const row = (k: string, v: string) => `<div class="veh-pop-row"><span>${k}</span><b>${v}</b></div>`
    const popupHtml = (s: DistrictStats) => {
      const last = s.kwhByYear[s.kwhByYear.length - 1]
      const spark = sparkPath(s.kwhByYear, 200, 34)
      return (
        `<div class="veh-pop" data-testid="district-popup"><div class="veh-pop-head"><b>${esc(s.bez)}</b></div>` +
        row(t('dist.points'), fmt(s.points)) +
        row(t('dist.per1000'), dec1(s.per1000)) +
        row(t('dist.bsw'), `${fmt(s.bswPoints)} (${s.bswShare === null ? '-' : `${Math.round(s.bswShare * 100)} %`})`) +
        (s.allPoints !== null ? row(t('dist.all'), fmt(s.allPoints)) : '') +
        (last ? row(fill(t('dist.kwh'), { year: String(last[0]) }), `${fmt(Math.round(last[1] / 1000))} MWh`) : '') +
        (spark ? `<svg class="dist-spark" viewBox="-2 -2 204 38" width="204" height="38" aria-hidden="true"><path d="${spark}"/></svg>` +
          `<div class="veh-pop-op">${fill(t('dist.sparkNote'), { from: String(s.kwhByYear[0][0]), to: String(last[0]) })}</div>` : '') +
        `<div class="veh-pop-op">${t('dist.source')}</div></div>`
      )
    }
    const values = dStats.map((s) => s.per1000)
    return {
      fc: districtFeatures(dStats, contextDistricts, popupHtml, (s) => `${s.bez}\n${dec1(s.per1000)}`),
      range: [Math.min(...values), Math.max(...values)] as [number, number],
    }
    // t, fmt and dec1 only depend on lang / loc
  }, [showDistricts, tourOverlay, dStats, contextDistricts, lang, loc])

  const fly = (v: Omit<Viewpoint, 'id' | 'label'> & { duration?: number }) => {
    if (v.pitch > 0) setThreeD(true)
    setCamera({ ...v, nonce: Date.now() })
  }

  // Every caption number is computed from the same baked files as the lenses.
  const tourStops = useMemo(() => {
    if (!partners || !charging) return null
    const pct = (x: number) => `${(x * 100).toLocaleString(loc, { maximumFractionDigits: 0 })} %`
    const carrier = (c: string) => (CARRIERS.includes(c) ? t(`carrier.${c}` as StringKey) : c)
    return buildTour(
      { units: partners.units, sites: partners.sites, stations: charging.stations, districts: dStats, hasReport: Boolean(PBI.reportId && PBI.tenantId) },
      { n: fmt, kw, pct, carrier, dec1 },
      lang,
    )
    // fmt and kw only depend on loc
  }, [partners, charging, dStats, lang, loc])
  const gapGeo = useMemo(
    () => (partners && charging ? gapFeatures(partners.sites.estates, estateReach(mergeNested(partners.sites.estates), charging.stations)) : null),
    [partners, charging],
  )
  // D62: the two live stops get their figure at render time (solar estimate, vehicle count).
  const bswKw = useMemo(() => (partners ? lensSummary('bsw', partners.units, partners.sites).kw : 0), [partners])
  const shownStops = useMemo(() => {
    if (!tourStops) return null
    const solarFig =
      solarNow.kind === 'ok' ? `≈ ${kw(estimateKw(solarNow.wm2, bswKw))}` : solarNow.kind === 'loading' ? '…' : t('kpi.nowNone')
    const vehFig = bvgLive.kind === 'ok' ? fmt(bvgLive.vehicles.length) : bvgLive.kind === 'error' ? '-' : '…'
    return tourStops.map((s) => (s.live === 'solar' ? { ...s, figure: solarFig } : s.live === 'vehicles' ? { ...s, figure: vehFig } : s))
    // kw, fmt and t only depend on loc / lang
  }, [tourStops, solarNow, bvgLive, bswKw, loc, lang])
  const stop = tour !== null && shownStops ? shownStops[tour] : null
  // Fly, then hold still (decided 2026-10-28). The lens and the 3D buildings
  // follow the stop; nothing else the presenter set is touched.
  // ⚠️ Keyed on the stop INDEX, not the stop object: a DE/EN switch rebuilds
  // every stop (new captions), and keying on the object re-flew the current
  // stop for 3 s and reset lens and 3D mid-sentence (review 2026-10-28).
  const stopRef = useRef(stop)
  stopRef.current = stop
  // D54: where the last leg ended, so the next flight takes as long as its distance needs.
  const lastStopCamera = useRef<TourCamera | null>(null)
  useEffect(() => {
    const s = stopRef.current
    if (tour === null || !s) {
      lastStopCamera.current = null
      return
    }
    setLens(s.lens)
    setRealism(s.realism)
    autoBvg(Boolean(s.bvgLive))
    setTourOverlay(s.overlay === 'districts' ? 'districts' : null)
    // A window the presenter opened by hand stays theirs; only a window the tour opened is closed again.
    if (s.report && !reportOpenRef.current) {
      reportByTour.current = true
      setReportPage(s.report)
      setReportOpen(true)
    } else if (!s.report && reportByTour.current) {
      reportByTour.current = false
      setReportOpen(false)
      setReportPage(null)
    }
    fly({ ...s.camera, duration: flightMs(lastStopCamera.current, s.camera) })
    lastStopCamera.current = s.camera
    // fly is recreated every render; the index alone decides
  }, [tour])
  const startTour = () => {
    panelBeforeTour.current = panelOpen
    setPanelOpen(false)
    setTour(0)
  }
  const endTour = useCallback(() => {
    setTour(null)
    setTourOverlay(null)
    if (reportByTour.current) {
      reportByTour.current = false
      setReportOpen(false)
      setReportPage(null)
    }
    setPanelOpen(panelBeforeTour.current)
  }, [])
  const goTo = useCallback((i: number) => setTour(i), [])
  const pickTab = (next: Tab) => {
    if (next !== 'twin' && tour !== null) endTour()
    if (next === 'finanzen') setFinanzenOpened(true)
    setTab(next)
  }

  return (
    <div className="app" data-tour={tour !== null ? 'on' : 'off'} data-report={reportOpen && reportMax && tab === 'twin' && tour === null ? 'max' : 'off'} data-panel={panelOpen ? 'open' : 'closed'}>
      <header className="header">
        <div className="brand">
          <span>{t('app.title')}</span>
        </div>
        <span className="brand-sub">{t('app.subtitle')}</span>
        <div className="seg" role="tablist" aria-label={t('tabs.label')}>
          {TABS.map((id) => (
            <button key={id} role="tab" data-testid={`tab-${id}`} aria-selected={tab === id} aria-pressed={tab === id} onClick={() => pickTab(id)}>
              {t(`tabs.${id}` as StringKey)}
            </button>
          ))}
        </div>
        <span className="header-spacer" />
        {reportUrl && (
          <button
            hidden={tab !== 'twin'}
            className="tour-start report-start"
            onClick={() => setReportOpen((o) => !o)}
            aria-pressed={reportOpen}
            title={t('report.startTitle')}
            data-testid="report-start"
          >
            {t('report.start')}
          </button>
        )}
        <button
          hidden={tab !== 'twin'}
          className="tour-start"
          onClick={() => (tour === null ? startTour() : endTour())}
          disabled={!tourStops}
          aria-pressed={tour !== null}
          title={t('tour.startTitle')}
          data-testid="tour-start"
        >
          {tour === null ? t('tour.start') : t('tour.finish')}
        </button>
        <div className="seg" role="group" aria-label={t('header.language')}>
          <button aria-pressed={lang === 'de'} onClick={() => setLang('de')}>
            DE
          </button>
          <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
            EN
          </button>
        </div>
        <div className="seg" role="group">
          <button aria-pressed={theme === 'light'} onClick={() => setTheme('light')} title={t('header.theme.toLight')}>
            ☀
          </button>
          <button aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')} title={t('header.theme.toDark')}>
            ☾
          </button>
        </div>
      </header>

      <main className="main">
        <EnergyMap
          stations={stations}
          layers={layers}
          labels={{
            operator: t('pop.operator'),
            points: t('pop.points'),
            power: t('pop.power'),
            publicSpace: t('pop.publicSpace'),
            privateGround: t('pop.privateGround'),
            since: t('pop.since'),
            register: t('pop.register'),
          }}
          theme={theme}
          threeD={threeD}
          realism={realism}
          clock={clock}
          camera={camera}
          onRealismLoading={setRealismLoading}
          onContextLost={setGlLost}
          partners={partners}
          lens={lens}
          frame={frame}
          gapAreas={stop?.overlay === 'gap' ? gapGeo : null}
          vehicles={bvgOn ? vehicles : null}
          onView={setView}
          districts={districtLayer}
          locale={loc}
          partnerLabels={{
            operator: t('pop.operator'),
            power: t('pop.kwp'),
            since: t('pop.since'),
            mieterstrom: t('pop.mieterstrom'),
            placement: {
              register: t('place.register'),
              address: t('place.address'),
              'address-osm': t('place.address-osm'),
              depot: t('place.depot'),
              postcode: t('place.postcode'),
            },
            roofPotential: t('roof.potential'),
            roofInstalled: t('roof.installed'),
            roofOpen: t('roof.open'),
            roofShare: t('roof.share'),
            estimate: t('badge.estimate'),
            depotKind: t('depot.status'),
            building: t('depot.building'),
            operating: t('depot.operating'),
            deal2025: t('depot.deal'),
            aggregated: t('badge.aggregated'),
            units: t('pop.units'),
            source: t('pop.source'),
            carrier: t('pop.carrier'),
            carriers: Object.fromEntries(CARRIERS.map((c) => [c, t(`carrier.${c}` as StringKey)])),
          }}
        />

        {(charging || summary) && (
          <div className="livebar" data-testid="kpi-bar" data-lens={lens}>
            <span className="pill pill-static" data-testid="register-pill" title={t('kpi.mastr.title')}>
              <span className="dot" />
              {t('kpi.mastr')}
            </span>
            {summary && (
              <Kpi
                label={fill(t('kpi.kw'), { n: fmt(summary.units) })}
                value={kw(summary.kw)}
                sub={summary.postcodeOnly ? fill(t('kpi.postcodeOnly'), { n: fmt(summary.postcodeOnly) }) : null}
                testid="kpi-lens-kw"
              />
            )}
            {summary && solarNow.kind !== 'loading' && (
              <Kpi
                label={
                  solarNow.kind === 'ok'
                    ? fill(t('kpi.now'), { station: solarNow.station, time: solarNow.at.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }) })
                    : solarNow.kind === 'night'
                      ? t('kpi.nowNight')
                      : t('kpi.nowMissing')
                }
                value={solarNow.kind === 'ok' ? `≈ ${kw(estimateKw(solarNow.wm2, summary.kw))}` : t('kpi.nowNone')}
                sub={solarNow.kind === 'ok' ? (solarNow.stale ? t('kpi.nowStale') : t('badge.estimate')) : null}
                subWarn={solarNow.kind === 'ok' && solarNow.stale}
                title={t('kpi.nowTitle')}
                testid="kpi-solar-now"
              />
            )}
            {lens === 'degewo' && summary?.roofs && (
              <Kpi label={fill(t('kpi.roofsOpen'), { n: fmt(summary.roofs.count) })} value={kw(summary.roofs.openKw)} testid="kpi-roofs-open" />
            )}
            {lens === 'bvg' && summary?.depots && (
              <>
                <Kpi
                  label={t('kpi.depots')}
                  value={fmt(summary.depots.total)}
                  sub={fill(t('kpi.depotsSub'), { n: fmt(summary.depots.construction) })}
                  testid="kpi-depots"
                />
                <Kpi label={t('kpi.deal')} value={fmt(summary.depots.deal2025)} testid="kpi-deal" />
              </>
            )}
            {lens === 'bsw' && summary && <Kpi label={t('kpi.mieterstrom')} value={fmt(summary.mieterstrom)} testid="kpi-mieterstrom" />}
            {lens === 'bsw' && charging && (
              <Kpi
                label={t('kpi.bswPoints')}
                value={fmt(bsw.points)}
                sub={`${share === null ? '-' : `${share.toFixed(0)} %`} ${fill(t('kpi.shareOf'), { n: fmt(all.points) })}`}
                testid="kpi-bsw-points"
              />
            )}
            <span className="clock" data-testid="as-of" title={t('kpi.asOf')}>
              {asOf}
            </span>
          </div>
        )}

        <section className="panel" data-testid="panel" data-open={panelOpen ? 'true' : 'false'}>
          <button
            className="panel-toggle"
            aria-expanded={panelOpen}
            aria-label={panelOpen ? t('panel.collapse') : t('panel.expand')}
            title={panelOpen ? t('panel.collapse') : t('panel.expand')}
            onClick={() => setPanelOpen((v) => !v)}
          >
            {panelOpen ? '‹' : '›'}
          </button>
          {panelOpen && (
            <>
              {glLost && <p className="hint calendar-warn">{t('gl.lost')}</p>}
              {chargingError && <p className="hint calendar-warn">{t('state.chargingError')}</p>}

              <p className="hint" style={{ margin: '0 0 4px' }}>
                {t('lens.label')}
              </p>
              <div className="seg seg-light" role="group" aria-label={t('lens.label')} data-testid="lens-switch">
                {LENSES.map((l) => (
                  <button key={l} aria-pressed={lens === l} onClick={() => pickLens(l)} data-testid={`lens-${l}`}>
                    {t(`lens.${l}` as StringKey)}
                  </button>
                ))}
              </div>

              {lens === 'degewo' && (
                <div className="lens-panel" data-testid="lens-panel-degewo">
                  <h2>{t('panel.degewo.title')}</h2>
                  <p className="hint">{t('panel.degewo.hint')}</p>
                  <p className="hint" style={{ margin: '8px 0 2px' }}>
                    {t('panel.degewo.list')}
                  </p>
                  <ol className="rank-list">
                    {ranked.slice(0, 6).map((r) => (
                      <li key={r.id}>
                        <button className="rank-btn" onClick={() => flyToSite(r.lon, r.lat)}>
                          <span>{r.addr}</span>
                          <b>
                            {fmt(Math.round(openKw(r)))} kWp {t('panel.open')}
                          </b>
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {lens === 'bvg' && (
                <div className="lens-panel" data-testid="lens-panel-bvg">
                  <h2>{t('panel.bvg.title')}</h2>
                  <p className="hint">{t('panel.bvg.hint')}</p>
                  <ol className="rank-list">
                    {depots.slice(0, 8).map((d) => (
                      <li key={d.id}>
                        <button className="rank-btn" onClick={() => flyToSite(d.lon!, d.lat!)}>
                          <span>
                            {d.name}
                            {d.status === 'construction' ? ` · ${t('depot.building')}` : ''}
                          </span>
                          <b>{d.kwGross ? `${fmt(Math.round(d.kwGross))} kWp` : '-'}</b>
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {lens === 'bsw' && (
                <div className="lens-panel" data-testid="lens-panel-bsw">
                  <h2>{t('panel.bsw.title')}</h2>
                  <p className="hint">{t('panel.bsw.hint')}</p>
                </div>
              )}

              <div className="divider" />

              <h2>{t('panel.charging')}</h2>
              <label className="mode-row">
                <input type="checkbox" checked={layers.chargingBsw} onChange={(e) => setLayers((l) => ({ ...l, chargingBsw: e.target.checked }))} />
                <span className="swatch" style={{ background: OWN_COLOUR }} />
                <span>{t('layer.chargingBsw')}</span>
                <span className="count">{charging ? fmt(bsw.points) : '-'}</span>
              </label>
              <label className="mode-row">
                <input type="checkbox" checked={layers.chargingOthers} onChange={(e) => setLayers((l) => ({ ...l, chargingOthers: e.target.checked }))} />
                <span className="swatch" style={{ background: OTHER_COLOUR }} />
                <span>{t('layer.chargingOthers')}</span>
                <span className="count">{charging ? fmt(all.points - bsw.points) : '-'}</span>
              </label>
              <p className="hint">{t('charging.hint')}</p>
              <label className="mode-row" title={t('dist.hint')}>
                <input type="checkbox" data-testid="districts-toggle" checked={showDistricts} onChange={(e) => setShowDistricts(e.target.checked)} />
                <span className="swatch" style={{ background: `linear-gradient(90deg, ${DISTRICT_LOW}, ${DISTRICT_HIGH})`, height: 8 }} />
                <span>{t('dist.layer')}</span>
              </label>
              {showDistricts && districtLayer && (
                <p className="hint" data-testid="districts-legend">
                  {fill(t('dist.legend'), { min: dec1(districtLayer.range[0]), max: dec1(districtLayer.range[1]) })}
                </p>
              )}

              <div className="divider" />

              <h2>{t('panel.bvgLive')}</h2>
              <label className="mode-row">
                <input type="checkbox" data-testid="bvg-live-toggle" checked={bvgOn} onChange={(e) => {
                    bvgAuto.current = false
                    setBvgOn(e.target.checked)
                  }} />
                <span className="swatch" style={{ background: MODE_COLOURS.bus }} />
                <span>{t('layer.bvgLive')}</span>
                <span className="count" data-testid="bvg-live-count">
                  {bvgLive.kind === 'ok' ? fmt(bvgLive.vehicles.length) : bvgLive.kind === 'loading' ? '…' : '-'}
                </span>
              </label>
              {bvgOn && (
                <p className="hint" data-testid="bvg-live-status">
                  {bvgLive.kind === 'error' ? (
                    <span className="warn">{fill(t('bvg.error'), { detail: bvgLive.detail })}</span>
                  ) : (
                    <>
                      <span className="badge">{t('bvg.badge')}</span>{' '}
                      {bvgLive.kind === 'ok' && fill(t(clock.getTime() - bvgLive.at.getTime() > 60_000 ? 'bvg.lastAt' : 'bvg.asOf'), { time: bvgLive.at.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })}
                      {bvgLive.kind === 'ok' && bvgLive.capped && <> · {t('bvg.capped')}</>}
                    </>
                  )}
                </p>
              )}
              <p className="hint bvg-legend">
                {(['bus', 'tram', 'subway', 'ferry'] as const).map((mode) => (
                  <span key={mode}>
                    <span className="swatch" style={{ background: MODE_COLOURS[mode] }} /> {t(`bvg.mode.${mode}` as StringKey)}
                  </span>
                ))}
              </p>
              <p className="hint">{t('bvg.hint')}</p>

              <div className="divider" />

              <div className="seg seg-light" role="group" aria-label={t('view.3d')}>
                <button aria-pressed={!threeD} onClick={() => setThreeD(false)}>
                  {t('view.2d')}
                </button>
                <button aria-pressed={threeD} onClick={() => setThreeD(true)} title={t('view.3dHint')}>
                  {t('view.3d')}
                </button>
              </div>
              <label className="mode-row" style={{ marginTop: 9 }} title={t('real.hint')}>
                <input
                  type="checkbox"
                  checked={realism}
                  onChange={(e) => {
                    setRealism(e.target.checked)
                    if (e.target.checked) {
                      setRealismLoading(true)
                      setThreeD(true)
                    }
                  }}
                />
                <span>{t('real.label')}</span>
              </label>
              {realism && realismLoading && <p className="hint">{t('real.loading')}</p>}

              <p className="hint" style={{ margin: '10px 0 4px' }}>
                {t('view.viewpoints')}
              </p>
              <div className="sig-row">
                {VIEWPOINTS.map((v) => (
                  <button key={v.id} className="vp-btn" onClick={() => fly(v)}>
                    {t(v.label)}
                  </button>
                ))}
              </div>

              <div className="divider" />
              <p className="hint" data-testid="data-note">
                {t('note.data')}
              </p>
            </>
          )}
        </section>

        {/* Licence guard: must stay visible in every mode and theme. */}
        <div className="attribution" data-testid="map-attribution">
          {t('attr.charging')}: Geoportal Berlin (
          <a href="https://www.govdata.de/dl-de/zero-2-0" target="_blank" rel="noreferrer">
            dl-de/zero-2-0
          </a>
          ) · {t('attr.basemap')}: © OpenStreetMap contributors ©{' '}
          <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">
            CARTO
          </a>{' '}
          · {t('attr.terrain')}: Geoportal Berlin (ATKIS DGM1, dl-de/zero-2-0), {t('attr.terrainOutside')}{' '}
          <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">
            AWS Terrain Tiles
          </a>{' '}
          (EU-DEM © Copernicus, SRTM © NASA)
          {partners && (
            <>
              {' · '}
              {t('attr.register')}: Bundesnetzagentur, Marktstammdatenregister (
              <a href="https://www.govdata.de/dl-de/by-2-0" target="_blank" rel="noreferrer">
                dl-de/by-2-0
              </a>
              ), Geoportal Berlin (Solarkataster, PLZ), © OpenStreetMap contributors
            </>
          )}
          {realism && (
            <>
              {' · '}
              {t('attr.buildings')}: Geoportal Berlin (LoD2, TrueDOP 2025, Baumbestand),{' '}
              <a href="https://www.govdata.de/dl-de/zero-2-0" target="_blank" rel="noreferrer">
                dl-de/zero-2-0
              </a>
            </>
          )}
        </div>
        {stop && shownStops && tour !== null && <TourCard stops={shownStops} index={tour} onIndex={goTo} onEnd={endTour} t={t} />}
        {reportOpen && reportUrl && tab === 'twin' && (tour === null || Boolean(stop?.report)) && (
          <ReportWindow
            url={reportUrl}
            page={page}
            onPage={setReportPage}
            onClose={() => {
              setReportOpen(false)
              setReportMax(false)
            }}
            onMax={setReportMax}
            t={t}
          />
        )}
        {tab === 'reorder' && (
          <div className="tab-page" data-testid="page-reorder">
            <ReorderApp live={live} />
          </div>
        )}
        {finanzenOpened && (
          <div className="tab-page" hidden={tab !== 'finanzen'} data-testid="page-finanzen">
            <Suspense fallback={<p className="tab-loading">{t('tabs.loading')}</p>}>
              <FinanzenApp active={tab === 'finanzen'} />
            </Suspense>
          </div>
        )}
      </main>
    </div>
  )
}

function Kpi({
  label,
  value,
  sub = null,
  title,
  testid,
  subWarn = false,
}: {
  label: string
  value: string
  sub?: string | null
  title?: string
  testid: string
  /** pure red (#FF0000) for a semantic warning such as a stale feed */
  subWarn?: boolean
}) {
  return (
    <span className="kpi" data-testid={testid} title={title}>
      <b>
        {value}
        {sub ? <i className={subWarn ? 'warn' : undefined}>{sub}</i> : null}
      </b>
      <em>{label}</em>
    </span>
  )
}
