import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

import { createFlyControls, type FlyControls, type FlyTelemetry } from '../map/flyControls'
import { flyToOptions, type RequestedCamera } from '../map/camera'
import { setVehicles } from './bvgLayer'
import type { Bbox } from '../live/bvgRadar'
import { createOrbitNavigation, type OrbitNavigation } from '../map/navigation'
import { useI18n } from '../i18n/I18nProvider'
import { skyColours, sunPosition, sunVector } from '../scene/sun'
import { SiteLayers, type AerialPatch } from '../buildings/siteLayers'
import { fetchFile } from '../lib/fetchBaked'
import { aerialFade } from '../buildings/aerial'
import { DEM_URL, registerDemProtocol, terrainIsSurvey } from '../terrain/demProtocol'
import { ScaleBar } from '../map/scaleBar'
import type { Station } from '../charging/charging'
import type { Lens } from '../partners/partners'
import {
  installPartnerLayers,
  setGapOverlay,
  basemapFont,
  partnerPopup,
  setPartnerLens,
  type PartnerData,
  type PartnerPopupLabels,
} from './partnerLayers'

/** Popup content is built as HTML, so anything interpolated must be escaped. */
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Highlight for the lens company's own assets: the app accent, never a company colour (PLAN D9). */
export const OWN_COLOUR = '#2f6f9f'
export const OTHER_COLOUR = '#8a94a3'

export type Layers = {
  chargingBsw: boolean
  chargingOthers: boolean
}

export type PopupLabels = {
  operator: string
  points: string
  power: string
  publicSpace: string
  privateGround: string
  since: string
  register: string
}

function stationsGeoJSON(stations: readonly Station[], layers: Layers) {
  return {
    type: 'FeatureCollection' as const,
    features: stations
      .filter((s) => (s.bsw ? layers.chargingBsw : layers.chargingOthers))
      .map((s) => ({
        type: 'Feature' as const,
        properties: { id: s.id, bsw: s.bsw ? 1 : 0, n: s.points, dc: s.dc ? 1 : 0 },
        geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
      })),
  }
}

const BASEMAP: Record<'light' | 'dark', string> = {
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
}

/**
 * Berlin DGM1 baked into terrain tiles (city to zoom 13, sites to 16), AWS
 * terrarium outside Berlin; one source, routed in src/terrain/demProtocol.ts (D21).
 */
registerDemProtocol()

/** Berlin, Alexanderplatz. */
export const CENTER: [number, number] = [13.4094, 52.5208]
const ZOOM = 10
/** Berlin city limits, roughly. */
const BERLIN_BOUNDS: [[number, number], [number, number]] = [
  [13.088, 52.338],
  [13.761, 52.675],
]

/** Terrain at true size: the LoD2 buildings carry real heights and must sit on it. */
const TERRAIN_EXAGGERATION = 1

/** Buildings and the depth clear go below the first of these, so the data stays on top. */
const DATA_LAYERS = ['stations-other', 'stations-bsw']

type Props = {
  stations: Station[]
  layers: Layers
  labels: PopupLabels
  theme: 'light' | 'dark'
  threeD: boolean
  realism: boolean
  clock: Date
  camera?: RequestedCamera | null
  onGroundOffset?: (medianM: number, spreadM: number) => void
  onRealismLoading?: (loading: boolean) => void
  onContextLost?: (lost: boolean) => void
  partners?: PartnerData | null
  lens: Lens
  partnerLabels: PartnerPopupLabels
  locale: string
  /** fit the camera to these bounds when the nonce changes (lens picked) */
  frame?: { bounds: [[number, number], [number, number]]; nonce: number } | null
  /** tour stop 4: degewo areas by Stadtwerke charging within 300 m (null hides) */
  gapAreas?: GeoJSON.FeatureCollection | null
  /** live BVG vehicles (D55), null hides the layer */
  vehicles?: GeoJSON.FeatureCollection | null
  /** the camera's view after each move, for the live radar */
  onView?: (b: Bbox) => void
}

/** Clickable layers, most specific first: a unit on a roof wins over the roof. */
const CLICKABLE = ['unit-dot', 'roof-label', 'roof-band', 'depot-point', 'stations-bsw', 'stations-other', 'depot-fill', 'pc-fill']

function applySky(m: maplibregl.Map, spec: Record<string, unknown> | null): boolean {
  if (!spec) return false
  try {
    if (!m.isStyleLoaded()) return false
    m.setSky(spec as never)
    return true
  } catch {
    return false
  }
}

export function EnergyMap({
  stations,
  layers,
  labels,
  theme,
  threeD,
  realism,
  clock,
  camera,
  onGroundOffset,
  onRealismLoading,
  onContextLost,
  partners,
  lens,
  partnerLabels,
  locale,
  frame,
  gapAreas = null,
  vehicles = null,
  onView,
}: Props) {
  const holder = useRef<HTMLDivElement>(null)
  const { t } = useI18n()
  const map = useRef<maplibregl.Map | null>(null)
  const busy = useRef(false)
  const sites = useRef<SiteLayers | null>(null)
  const aerialIds = useRef<string[]>([])
  const glLost = useRef(false)
  const reinstallRealism = useRef<(() => void) | null>(null)
  const light = useRef({
    dir: [0.55, -0.5, 0.67] as [number, number, number],
    sunTint: [1, 0.96, 0.88] as [number, number, number],
    shadowTint: [0.62, 0.68, 0.82] as [number, number, number],
    ramp: [0.62, 0.46] as [number, number],
  })
  const skyRef = useRef<Record<string, unknown> | null>(null)
  const groundOffsetOut = useRef(onGroundOffset)
  groundOffsetOut.current = onGroundOffset
  const loadingOut = useRef(onRealismLoading)
  loadingOut.current = onRealismLoading
  const glOut = useRef(onContextLost)
  glOut.current = onContextLost
  const popup = useRef<maplibregl.Popup | null>(null)
  const flyRef = useRef<FlyControls | null>(null)
  const navRef = useRef<OrbitNavigation | null>(null)
  const [flying, setFlying] = useState(false)
  const [telemetry, setTelemetry] = useState<FlyTelemetry | null>(null)

  // Latest values for handlers registered once and for install(), which runs
  // again on every style load (theme swap) and must use the current data.
  const stationsRef = useRef(stations)
  stationsRef.current = stations
  const layersRef = useRef(layers)
  layersRef.current = layers
  const labelsRef = useRef(labels)
  labelsRef.current = labels
  const clockRef = useRef(clock)
  clockRef.current = clock
  const partnersRef = useRef(partners)
  partnersRef.current = partners
  const lensRef = useRef(lens)
  lensRef.current = lens
  const partnerLabelsRef = useRef(partnerLabels)
  partnerLabelsRef.current = partnerLabels
  const localeRef = useRef(locale)
  localeRef.current = locale
  const sunKey = Math.floor(clock.getTime() / 300000)

  // --- create the map once ------------------------------------------------
  useEffect(() => {
    if (!holder.current || map.current) return
    const m = new maplibregl.Map({
      container: holder.current,
      style: BASEMAP[theme],
      center: CENTER,
      zoom: ZOOM,
      maxPitch: 75,
      attributionControl: false, // exactly one credit surface, rendered by the app
    })
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    m.addControl(new ScaleBar(70), 'top-right')
    map.current = m
    // Frame the whole city clear of the left panel and the KPI bar, so the
    // first view is Berlin and not the panel's back. Again on 'load': at
    // construction the container can still be at its pre-layout size, which
    // measured zoom 7.4 instead of 9.3 and left Berlin off-centre.
    const fitCity = () =>
      m.fitBounds(BERLIN_BOUNDS, {
        padding: { top: 130, bottom: 40, left: Math.min(340, m.getContainer().clientWidth * 0.35), right: 60 },
        duration: 0,
      })
    fitCity()
    m.once('load', () => {
      m.resize()
      fitCity()
    })
    navRef.current = createOrbitNavigation({ map: m, onGesture: () => undefined })
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__twinMap = m
    }
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(holder.current)

    const canvas = m.getCanvas()
    const onLost = (e: Event) => {
      e.preventDefault()
      glLost.current = true
      glOut.current?.(true)
    }
    const onRestored = () => {
      glLost.current = false
      sites.current?.reset()
      aerialIds.current = []
      glOut.current?.(false)
      reinstallRealism.current?.()
      m.triggerRepaint()
    }
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)
    return () => {
      ro.disconnect()
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      navRef.current?.dispose()
      navRef.current = null
      m.remove()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- (re)install our layers whenever the style is (re)loaded -------------
  useEffect(() => {
    const m = map.current
    if (!m) return

    const applyRealism = async () => {
      if (busy.current || glLost.current) return
      if (!realism) {
        sites.current?.setVisible(false)
        if (m.getLayer('depth-clear')) m.removeLayer('depth-clear')
        for (const id of aerialIds.current) {
          if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'none')
        }
        return
      }
      if (!m.isStyleLoaded()) return
      busy.current = true
      try {
        await installRealism()
      } finally {
        busy.current = false
      }
    }

    const installRealism = async () => {
      if (!aerialIds.current.length) {
        try {
          const manifest: { patches: AerialPatch[] } = await (await fetchFile('data/aerial.json')).json()
          // Under every data layer: added on top, the photo covered the charge points.
          const under = ['districts-fill', ...DATA_LAYERS].find((id) => m.getLayer(id))
          // Only the whole-city base goes in up front; each site's sharp photo
          // comes with its buildings when the camera gets there (SiteLayers).
          for (const p of manifest.patches.filter((x) => x.imageryOnly)) {
            const id = `aerial-${p.id}`
            if (m.getSource(id)) continue
            const b = p.bounds
            m.addSource(id, {
              type: 'image',
              url: `data/${p.file}`,
              coordinates: [
                [b.west, b.north],
                [b.east, b.north],
                [b.east, b.south],
                [b.west, b.south],
              ],
            })
            m.addLayer(
              {
                id,
                type: 'raster',
                source: id,
                paint: { 'raster-opacity': aerialFade(b) as never, 'raster-fade-duration': 300 },
              },
              under,
            )
            aerialIds.current.push(id)
          }
          if (!sites.current) {
            sites.current = new SiteLayers(m, {
              getLight: () => light.current,
              beforeId: () => ['depth-clear', ...DATA_LAYERS].find((id) => m.getLayer(id)),
              onLoading: (on) => loadingOut.current?.(on),
              onGroundOffset: (median, spread) => groundOffsetOut.current?.(median, spread),
              surveyTerrain: terrainIsSurvey,
            })
            if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__twinSites = sites.current
          }
          await sites.current.init(manifest.patches)
        } catch (e) {
          console.warn('aerial imagery unavailable', e)
        }
      }
      for (const id of aerialIds.current) {
        if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'visible')
      }
      // ⚠️ The buildings write depth, and MapLibre depth-tests symbols and
      // lines against it with terrain on - so every charge point beside a
      // house or under a tree vanished in 3D (measured: 23 sites "rendered",
      // none visible at the main station). Clearing depth right after the
      // buildings puts the charge points on top, which is the point of this
      // map: they are the subject, the city is the context.
      if (!m.getLayer('depth-clear')) {
        m.addLayer(
          {
            id: 'depth-clear',
            type: 'custom',
            renderingMode: '3d',
            render: (gl) => gl.clear(gl.DEPTH_BUFFER_BIT),
          },
          DATA_LAYERS.find((id) => m.getLayer(id)),
        )
      }
      sites.current?.setVisible(true)
      try {
        await sites.current?.update()
      } catch (e) {
        console.warn('LoD2 sites unavailable', e)
      }
      loadingOut.current?.(false)
    }

    const install = () => {
      // A style swap removes the aerial layers too; forget them so they are
      // added again instead of being "already installed".
      if (aerialIds.current.length && !m.getLayer(aerialIds.current[0])) aerialIds.current = []
      if (!m.getSource('dem')) {
        m.addSource('dem', { type: 'raster-dem', tiles: [DEM_URL], encoding: 'terrarium', tileSize: 256, maxzoom: 16 })
        // Its own source: MapLibre renders hillshade worse from the terrain's source.
        m.addSource('dem-shade', { type: 'raster-dem', tiles: [DEM_URL], encoding: 'terrarium', tileSize: 256, maxzoom: 14 })
        // Subtle relief in 2D and 3D, so Teufelsberg, the Müggelberge and the
        // rail embankments read on the flat city. Under the basemap's labels and
        // under the aerial photos, which take over up close.
        const firstSymbol = m.getStyle().layers.find((l) => l.type === 'symbol')?.id
        m.addLayer(
          {
            id: 'hillshade',
            type: 'hillshade',
            source: 'dem-shade',
            paint: {
              'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 9, 0.65, 13, 0.6, 15, 0.4, 17, 0.1] as never,
              'hillshade-shadow-color': theme === 'dark' ? 'rgba(0,0,0,0.55)' : 'rgba(87,97,111,0.6)',
              'hillshade-highlight-color': theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.35)',
              'hillshade-accent-color': 'rgba(0,0,0,0)',
            },
          },
          firstSymbol,
        )
      }

      if (!m.getSource('stations')) {
        m.addSource('stations', { type: 'geojson', data: stationsGeoJSON(stationsRef.current, layersRef.current) as never })
        // Other operators: small and grey, context for where BSW is not.
        m.addLayer({
          id: 'stations-other',
          type: 'circle',
          source: 'stations',
          filter: ['==', ['get', 'bsw'], 0],
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.6, 15, 4.5],
            'circle-color': OTHER_COLOUR,
            'circle-opacity': 0.65,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 0, 15, 1] as never,
          },
        })
        // BSW: accent fill, white ring, thicker ring for fast charging (DC).
        m.addLayer({
          id: 'stations-bsw',
          type: 'circle',
          source: 'stations',
          filter: ['==', ['get', 'bsw'], 1],
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.4, 15, ['+', 5, ['*', 1.2, ['get', 'n']]]] as never,
            'circle-color': OWN_COLOUR,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': ['case', ['==', ['get', 'dc'], 1], 2.4, 1] as never,
          },
        })
      }

      if (partnersRef.current) installPartnerLayers(m, partnersRef.current, lensRef.current)
      if (gapRef.current) setGapOverlay(m, gapRef.current)
      if (vehiclesRef.current) setVehicles(m, vehiclesRef.current, basemapFont(m))

      m.setTerrain(threeD ? { source: 'dem', exaggeration: TERRAIN_EXAGGERATION } : null)
      applySky(m, skyRef.current)
      void applyRealism()
    }

    // ⚠️ ALWAYS listen, not only while the style is still loading. A theme swap
    // calls setStyle on an idle map; MapLibre diffs our runtime layers away and
    // fires 'style.load' - with nobody listening, every charge point, the grid
    // and the districts vanished until something else re-ran this effect.
    if (m.isStyleLoaded()) install()
    m.on('style.load', install)
    void applyRealism()
    reinstallRealism.current = () => void applyRealism()
    const onIdle = () => {
      applySky(m, skyRef.current)
      void applyRealism()
    }
    m.on('idle', onIdle)
    return () => {
      m.off('style.load', install)
      m.off('idle', onIdle)
      reinstallRealism.current = null
    }
  }, [theme, threeD, realism])

  // --- data updates ----------------------------------------------------------
  useEffect(() => {
    const src = map.current?.getSource('stations') as maplibregl.GeoJSONSource | undefined
    src?.setData(stationsGeoJSON(stations, layers) as never)
  }, [stations, layers])

  // --- partners and lens (D33-D36) ---------------------------------------------
  useEffect(() => {
    const m = map.current
    if (!m || !partners) return
    const run = () => {
      installPartnerLayers(m, partners, lens)
      setPartnerLens(m, partners, lens)
    }
    // ⚠️ The data can arrive while the style reports itself busy (tiles still
    // loading). Skipping then left the partners off the map for good: style.load
    // had already fired before the data existed. So retry on the next idle.
    if (m.isStyleLoaded()) run()
    else m.once('idle', run)
    return () => {
      m.off('idle', run)
    }
  }, [partners, lens])

  const vehiclesRef = useRef(vehicles)
  vehiclesRef.current = vehicles
  useEffect(() => {
    const m = map.current
    if (!m) return
    const run = () => setVehicles(m, vehicles, basemapFont(m))
    if (m.isStyleLoaded()) run()
    else m.once('idle', run)
    return () => {
      m.off('idle', run)
    }
  }, [vehicles])

  const viewOut = useRef(onView)
  viewOut.current = onView
  useEffect(() => {
    const m = map.current
    if (!m) return
    const emit = () => {
      const b = m.getBounds()
      viewOut.current?.({ north: b.getNorth(), west: b.getWest(), south: b.getSouth(), east: b.getEast() })
    }
    emit()
    m.on('moveend', emit)
    return () => {
      m.off('moveend', emit)
    }
  }, [])

  const gapRef = useRef(gapAreas)
  gapRef.current = gapAreas
  useEffect(() => {
    const m = map.current
    if (!m) return
    const run = () => setGapOverlay(m, gapAreas)
    if (m.isStyleLoaded()) run()
    else m.once('idle', run)
    return () => {
      m.off('idle', run)
    }
  }, [gapAreas])

  useEffect(() => {
    const m = map.current
    if (!m || !frame || glLost.current) return
    m.fitBounds(frame.bounds, {
      padding: { top: 140, bottom: 60, left: Math.min(360, m.getContainer().clientWidth * 0.35), right: 80 },
      maxZoom: 14,
      duration: 1600,
    })
  }, [frame])

  // --- popups ------------------------------------------------------------------
  useEffect(() => {
    const m = map.current
    if (!m) return
    const LAYERS = CLICKABLE
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const L = labelsRef.current
      const present = LAYERS.filter((l) => m.getLayer(l))
      const hits = m.queryRenderedFeatures(
        [
          [e.point.x - 6, e.point.y - 6],
          [e.point.x + 6, e.point.y + 6],
        ],
        { layers: present },
      )
      popup.current?.remove()
      hits.sort((a, b) => LAYERS.indexOf(a.layer.id) - LAYERS.indexOf(b.layer.id))
      const hit = hits[0]
      if (!hit) return
      if (!hit.layer.id.startsWith('stations-')) {
        const pd = partnersRef.current
        const pop = pd && partnerPopup(hit, pd, partnerLabelsRef.current, localeRef.current)
        if (pop) {
          popup.current = new maplibregl.Popup({ closeButton: true, offset: 10, maxWidth: '320px' })
            .setLngLat(pop.at)
            .setHTML(pop.html)
            .addTo(m)
        }
        return
      }
      const s = stationsRef.current.find((x) => x.id === hit.properties.id)
      if (!s) return
      const html =
        `<div class="veh-pop" data-testid="station-popup">` +
        `<div class="veh-pop-head"><b>${esc(s.addr)}</b></div>` +
        `<div class="veh-pop-row"><span>${esc(L.operator)}</span><b>${esc(s.op || '-')}</b></div>` +
        `<div class="veh-pop-row"><span>${esc(L.points)}</span><b>${s.points}</b></div>` +
        `<div class="veh-pop-row"><span>${esc(L.power)}</span><b>${s.kw ?? '-'} kW ${s.dc ? 'DC' : 'AC'}</b></div>` +
        `<div class="veh-pop-row"><span>${esc(s.public ? L.publicSpace : L.privateGround)}</span><b>${s.year ? `${esc(L.since)} ${s.year}` : ''}</b></div>` +
        `<div class="veh-pop-op">${esc(L.register)}</div>` +
        `</div>`
      popup.current = new maplibregl.Popup({ closeButton: true, offset: 10, maxWidth: '300px' })
        .setLngLat([s.lon, s.lat])
        .setHTML(html)
        .addTo(m)
    }
    const onMove = (e: maplibregl.MapMouseEvent) => {
      const present = LAYERS.filter((l) => m.getLayer(l))
      const n = present.length ? m.queryRenderedFeatures(e.point, { layers: present }).length : 0
      m.getCanvas().style.cursor = n ? 'pointer' : ''
    }
    m.on('click', onClick)
    m.on('mousemove', onMove)
    return () => {
      m.off('click', onClick)
      m.off('mousemove', onMove)
    }
  }, [])

  // --- theme swap: reload the style, layers come back via 'style.load' ------
  const firstTheme = useRef(true)
  useEffect(() => {
    const m = map.current
    if (!m || glLost.current) return
    if (firstTheme.current) {
      firstTheme.current = false
      return
    }
    m.setStyle(BASEMAP[theme])
  }, [theme])

  // --- 2D / 3D -------------------------------------------------------------
  useEffect(() => {
    const m = map.current
    if (!m || glLost.current) return
    if (m.getSource('dem')) {
      m.setTerrain(threeD ? { source: 'dem', exaggeration: TERRAIN_EXAGGERATION } : null)
    }
    m.easeTo({ pitch: threeD ? 60 : 0, duration: 900 })
  }, [threeD])

  // --- named viewpoints / requested camera ---------------------------------
  useEffect(() => {
    const m = map.current
    if (!m || !camera || glLost.current) return
    m.flyTo(flyToOptions(camera))
  }, [camera])

  // --- the sun over Berlin, and the sky it makes ------------------------
  useEffect(() => {
    const m = map.current
    if (!m || glLost.current) return
    const pos = sunPosition(clockRef.current, CENTER[1], CENTER[0])
    const sky = skyColours(pos.elevation)
    light.current = { dir: sunVector(pos), sunTint: sky.sunTint, shadowTint: sky.shadowTint, ramp: sky.ramp }
    skyRef.current = {
      'sky-color': sky.sky,
      'horizon-color': sky.horizon,
      'fog-color': sky.fog,
      'horizon-fog-blend': 0.55,
      'fog-ground-blend': 0.72,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.8, 12, 0.3, 16, 0],
    }
    applySky(m, skyRef.current)
    m.triggerRepaint()
  }, [sunKey])

  // --- drone mode: the keys are the control ---------------------------------
  useEffect(() => {
    const m = map.current
    if (!m) return
    const fly = createFlyControls({
      map: m,
      cruiseMinMs: 15,
      cruiseMaxMs: 600,
      cruiseDefaultMs: 90,
      referenceAglM: 600,
      maxPitchDeg: 75,
      accelerateTauS: 0.28,
      brakeTauS: 0.16,
      lookTauS: 0.07,
      onEngagedChange: (on) => {
        setFlying(on)
        navRef.current?.setEnabled(!on)
        if (on) popup.current?.remove()
      },
    })
    flyRef.current = fly
    const hud = setInterval(() => {
      if (fly.engaged) setTelemetry(fly.telemetry())
    }, 200)
    return () => {
      clearInterval(hud)
      flyRef.current = null
      fly.dispose()
    }
  }, [])

  return (
    <div className="map-wrap">
      <div ref={holder} className="map" data-testid="energy-map" />
      <div className="fly-state" data-testid="drone-state" data-flying={flying ? 'true' : 'false'}>
        {flying ? (
          <>
            <span className="fly-help">{t('fly.help')}</span>
            <span className="fly-read">
              {t('fly.speed')} {Math.round(telemetry?.speedMs ?? 0)} m/s · {t('fly.altitude')}{' '}
              {Math.round(telemetry?.altitudeM ?? 0)} m
            </span>
          </>
        ) : (
          <span className="fly-hint">{t('fly.hint')}</span>
        )}
      </div>
    </div>
  )
}
