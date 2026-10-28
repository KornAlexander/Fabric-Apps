/**
 * Metric scale bar measured at the map centre.
 *
 * MapLibre's own ScaleControl unprojects two screen points, which with terrain
 * on goes through the depth buffer and answered "NaN m" at high pitch. The
 * zoom already defines the scale at the centre, so it is computed from that.
 */
import type maplibregl from 'maplibre-gl'

const EARTH_CIRCUMFERENCE_M = 40075016.686
/** MapLibre's zoom 0 world is 512 CSS pixels wide. */
const WORLD_PX = 512

export function metresPerPixel(zoom: number, lat: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / (WORLD_PX * 2 ** zoom)
}

/** The largest 1, 2, 3 or 5 x 10^n not above `m`. */
export function niceDistance(m: number): number {
  const p = 10 ** Math.floor(Math.log10(m))
  const d = m / p
  return p * (d >= 5 ? 5 : d >= 3 ? 3 : d >= 2 ? 2 : 1)
}

export function scaleLabel(m: number): string {
  return m >= 1000 ? `${m / 1000} km` : `${m} m`
}

export class ScaleBar implements maplibregl.IControl {
  private map?: maplibregl.Map
  private el?: HTMLDivElement
  private readonly maxWidth: number

  constructor(maxWidth = 70) {
    this.maxWidth = maxWidth
  }

  onAdd(map: maplibregl.Map): HTMLElement {
    this.map = map
    this.el = document.createElement('div')
    this.el.className = 'maplibregl-ctrl maplibregl-ctrl-scale'
    this.el.dataset.testid = 'scale-bar'
    map.on('move', this.update)
    this.update()
    return this.el
  }

  onRemove(): void {
    this.map?.off('move', this.update)
    this.el?.remove()
    this.map = undefined
  }

  private update = () => {
    if (!this.map || !this.el) return
    const mpp = metresPerPixel(this.map.getZoom(), this.map.getCenter().lat)
    const d = niceDistance(mpp * this.maxWidth)
    this.el.style.width = `${Math.round(d / mpp)}px`
    this.el.textContent = scaleLabel(d)
  }
}
