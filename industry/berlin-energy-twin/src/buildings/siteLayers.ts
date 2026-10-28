import type { Map as MlMap } from 'maplibre-gl'
import {
  createBuildingsLayer,
  loadBuildings,
  loadSiteList,
  snapToTerrain,
  type BuildingSite,
  type BuildingsData,
  type BuildingsLayerOptions,
} from './lod2'

/**
 * The partner sites' buildings and sharp photos, loaded one site at a time as
 * the camera comes near (D29).
 *
 * All sites together are about 100 MB of photo and geometry. A meeting laptop
 * must not pull that on the first tick of a checkbox, so nothing site-specific
 * loads until a site is actually in view at street-block zoom; the whole-city
 * base photo is the only thing installed up front (EnergyMap does that).
 *
 * Each site is its own custom layer with its own origin and its own roof photo,
 * snapped onto the terrain on its own. One site loads at a time: two estates
 * arriving together would stall the frame that uploads them.
 */

/** A site starts loading when it is in view at this zoom or closer. */
export const SITE_LOAD_ZOOM = 13.5
/**
 * At most this many sites stay loaded. Each holds its geometry and two copies
 * of a 4096 px photo on the GPU (the raster source and the roof texture), so
 * free roaming over all 26 sites could exhaust an integrated GPU and lose the
 * context (review 2026-10-28). The tour needs three at once.
 */
export const MAX_LOADED_SITES = 4

export type AerialPatch = {
  id: string
  file: string
  bounds: BuildingSite['bounds']
  imageryOnly?: boolean
}

type Loaded = {
  data: BuildingsData
  refresh: ((from?: number, to?: number) => void) | null
  pending: boolean
  lastPending: number
  lastSnap: number
  /** last time any part of the site was in view, for eviction */
  lastSeen: number
}

export type SiteLayerOptions = {
  getLight: BuildingsLayerOptions['getLight']
  /** layer the buildings and photos go beneath, so the data stays on top */
  beforeId: () => string | undefined
  onLoading?: (loading: boolean) => void
  onGroundOffset?: (medianM: number, spreadM: number) => void
  /**
   * True while the terrain is the Berlin DGM1, the same survey the LoD2 ground
   * heights come from (they agree to 0.1 m median). Buildings then keep their
   * surveyed heights: snapping them to queryTerrainElevation is worse than
   * useless, because it answers from whatever tile is loaded and fixed 22 % of
   * Gropiusstadt 5-9 m too low when their tile was not in view yet.
   */
  surveyTerrain?: () => boolean
}

export function intersects(a: BuildingSite['bounds'], b: BuildingSite['bounds']): boolean {
  return a.west < b.east && b.west < a.east && a.south < b.north && b.south < a.north
}

export class SiteLayers {
  private sites: BuildingSite[] = []
  private photos = new Map<string, AerialPatch>()
  private loaded = new Map<string, Loaded>()
  private failed = new Set<string>()
  private loading = false
  private ready: Promise<void> | null = null

  constructor(
    private readonly m: MlMap,
    private readonly opts: SiteLayerOptions,
  ) {}

  /** Site list and photo manifest, once. */
  init(patches: AerialPatch[]): Promise<void> {
    if (!this.ready) {
      for (const p of patches) if (!p.imageryOnly) this.photos.set(p.id, p)
      this.ready = loadSiteList().then((s) => {
        this.sites = s
      })
    }
    return this.ready
  }

  /** Ids of the sites loaded so far, for the probe and the tests. */
  loadedIds(): string[] {
    return [...this.loaded.keys()]
  }

  /** Call on every idle: load the next site in view, (re)install layers, snap. */
  async update(): Promise<void> {
    if (!this.ready) return
    await this.ready
    for (const [id, s] of this.loaded) this.install(id, s)
    this.snap()
    const b = this.m.getBounds()
    const view = { west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth() }
    const now = performance.now()
    let loadedInView = 0
    for (const site of this.sites) {
      const s = this.loaded.get(site.id)
      if (s && intersects(site.bounds, view)) {
        s.lastSeen = now
        loadedInView += 1
      }
    }
    if (this.loading || this.m.getZoom() < SITE_LOAD_ZOOM) return
    // ⚠️ Full with sites the camera is looking at: load nothing more. Evicting
    // one of them would reload it on the next idle and evict the next, forever
    // (re-review 2026-10-28: six BVG sites in view over Lichtenberg at 13.5).
    // A fifth visible site gets its buildings once the camera comes closer.
    if (loadedInView >= MAX_LOADED_SITES) return
    const next = this.sites.find((s) => !this.loaded.has(s.id) && !this.failed.has(s.id) && intersects(s.bounds, view))
    if (!next) return
    this.loading = true
    this.opts.onLoading?.(true)
    try {
      const data = await loadBuildings(next.id)
      const s: Loaded = { data, refresh: null, pending: true, lastPending: Number.MAX_SAFE_INTEGER, lastSnap: 0, lastSeen: performance.now() }
      this.loaded.set(next.id, s)
      this.evict(next.id, now)
      this.install(next.id, s)
      this.snap()
    } catch (e) {
      this.failed.add(next.id)
      console.warn(`site ${next.id} unavailable`, e)
    } finally {
      this.loading = false
      this.opts.onLoading?.(false)
    }
  }

  /**
   * Drop the longest-unseen sites beyond MAX_LOADED_SITES; never the one just
   * loaded and never one in view (`lastSeen` of this idle, `seenNow`).
   */
  private evict(keep: string, seenNow: number): void {
    while (this.loaded.size > MAX_LOADED_SITES) {
      let oldest: string | null = null
      for (const [id, s] of this.loaded) {
        if (id === keep || s.lastSeen >= seenNow) continue
        if (oldest === null || s.lastSeen < this.loaded.get(oldest)!.lastSeen) oldest = id
      }
      if (oldest === null) return
      this.remove(oldest)
      this.loaded.delete(oldest)
    }
  }

  private remove(id: string): void {
    try {
      if (this.m.getLayer(`lod2-${id}`)) this.m.removeLayer(`lod2-${id}`)
      if (this.m.getLayer(`aerial-${id}`)) this.m.removeLayer(`aerial-${id}`)
      if (this.m.getSource(`aerial-${id}`)) this.m.removeSource(`aerial-${id}`)
    } catch {
      /* style may still be settling; the data is dropped either way */
    }
  }

  /** True while any loaded site still has buildings waiting for terrain. */
  settling(): boolean {
    for (const s of this.loaded.values()) if (s.pending) return true
    return false
  }

  /** Show or hide everything site-specific (the realism checkbox). */
  setVisible(on: boolean): void {
    for (const id of this.loaded.keys()) {
      if (!on && this.m.getLayer(`lod2-${id}`)) this.m.removeLayer(`lod2-${id}`)
      if (this.m.getLayer(`aerial-${id}`)) this.m.setLayoutProperty(`aerial-${id}`, 'visibility', on ? 'visible' : 'none')
    }
  }

  /** After a lost GL context or a style swap: forget the GPU side, keep the data. */
  reset(): void {
    for (const [id, s] of this.loaded) {
      try {
        if (this.m.getLayer(`lod2-${id}`)) this.m.removeLayer(`lod2-${id}`)
      } catch {
        /* style may still be settling */
      }
      s.refresh = null
      s.pending = true
      s.lastPending = Number.MAX_SAFE_INTEGER
    }
  }

  private install(id: string, s: Loaded): void {
    const photo = this.photos.get(id)
    const before = this.opts.beforeId()
    if (photo && !this.m.getSource(`aerial-${id}`)) {
      const b = photo.bounds
      this.m.addSource(`aerial-${id}`, {
        type: 'image',
        url: `data/${photo.file}`,
        coordinates: [
          [b.west, b.north],
          [b.east, b.north],
          [b.east, b.south],
          [b.west, b.south],
        ],
      })
      // Over the city base photo, not over a blank map: a sharper patch's edge
      // is a step in sharpness of the same ground, so it may show from the zoom
      // its buildings appear at, instead of waiting until it fills the screen.
      this.m.addLayer(
        {
          id: `aerial-${id}`,
          type: 'raster',
          source: `aerial-${id}`,
          paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 12.8, 0, 13.6, 1], 'raster-fade-duration': 300 },
        },
        before,
      )
    }
    if (!this.m.getLayer(`lod2-${id}`)) {
      this.m.addLayer(
        createBuildingsLayer(s.data, {
          id: `lod2-${id}`,
          getZOffset: () => 0,
          getLight: this.opts.getLight,
          roofPhoto: photo ? { url: `data/${photo.file}`, bounds: photo.bounds } : undefined,
          onBuffersReady: (refresh) => {
            s.refresh = refresh
          },
        }),
        before,
      )
    }
  }

  private snap(): void {
    if (this.opts.surveyTerrain?.()) {
      for (const s of this.loaded.values()) s.pending = false
      return
    }
    const now = performance.now()
    for (const s of this.loaded.values()) {
      if (!s.pending || now - s.lastSnap < 4000) continue
      s.lastSnap = now
      const res = snapToTerrain(s.data, (lon, lat) => this.m.queryTerrainElevation({ lng: lon, lat }))
      if (res.moved > 0) {
        s.refresh?.()
        this.m.triggerRepaint()
      }
      const improved = res.pending < s.lastPending
      s.lastPending = res.pending
      s.pending = res.pending > 0 && (improved || res.moved > 0)
      this.opts.onGroundOffset?.(res.medianM, res.spreadM)
    }
  }
}
