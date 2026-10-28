/**
 * When each orthophoto patch is allowed to appear.
 *
 * The patches nest: a wide base, the merged city on top of it, the focus areas
 * on top of that. Same ground, increasing sharpness, so switching
 * between them is invisible - what is NOT invisible is a patch whose own edges
 * are on screen. A photograph that stops in mid-air on a pale vector map reads
 * as a rendering fault, and that is exactly what the old three-rectangle layout
 * looked like when zoomed out.
 *
 * So one rule, applied to every patch: a patch may only fade in once it is
 * wide enough to cover the viewport, i.e. once its edges have left the screen.
 * A patch that cannot yet cover the view simply stays off, and whatever is
 * beneath it - ultimately the vector basemap - is what you see.
 */

/** Web Mercator metres per pixel at zoom 0 on the equator. */
const EQUATOR_M_PER_PX = 156543.03392

/**
 * How wide a window to plan for, in CSS pixels.
 *
 * Deliberately generous: the demo runs on anything from a 1024 px projector to
 * a 1920 px laptop, and being wrong in this direction only delays a patch by a
 * fraction of a zoom level, while being wrong in the other shows its edge.
 */
export const PLANNED_VIEWPORT_PX = 1900

/** Reference latitude of the scene (Berlin, Alexanderplatz). */
export const SCENE_LAT = 52.52

/** Metres per pixel at a given zoom and latitude. */
export function metresPerPixel(zoom: number, lat: number): number {
  return (EQUATOR_M_PER_PX * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
}

/**
 * The lowest zoom at which a patch of this ground size fills the viewport.
 *
 * Uses the SHORTER side: a patch 2 km wide and 4 km tall still shows its left
 * and right edges, so it is the narrow dimension that decides.
 */
export function fillsViewportAtZoom(
  widthM: number,
  heightM: number,
  viewportPx = PLANNED_VIEWPORT_PX,
): number {
  const shorter = Math.max(1, Math.min(widthM, heightM))
  // viewportPx * mpp = shorter  ->  2^zoom = EQUATOR * cos(lat) * viewportPx / shorter
  // cos(lat) is folded in by the caller through `metresPerPixel`; here we invert
  // it for the reference latitude of the scene.
  return Math.log2((EQUATOR_M_PER_PX * Math.cos((SCENE_LAT * Math.PI) / 180) * viewportPx) / shorter)
}

/** Ground size of a lon/lat rectangle, in metres, at its own latitude. */
export function boundsSizeM(b: {
  west: number
  east: number
  south: number
  north: number
}): { widthM: number; heightM: number } {
  const midLat = (b.north + b.south) / 2
  return {
    widthM: (b.east - b.west) * 111_320 * Math.cos((midLat * Math.PI) / 180),
    heightM: (b.north - b.south) * 110_540,
  }
}

/**
 * The MapLibre `raster-opacity` ramp for one patch.
 *
 * Fades over half a zoom level ending at the zoom where the patch covers the
 * view, so it arrives already edge-to-edge rather than growing into place.
 */
export function aerialFade(
  bounds: { west: number; east: number; south: number; north: number },
  viewportPx = PLANNED_VIEWPORT_PX,
): unknown[] {
  const { widthM, heightM } = boundsSizeM(bounds)
  const full = fillsViewportAtZoom(widthM, heightM, viewportPx)
  return ['interpolate', ['linear'], ['zoom'], full - 0.5, 0, full, 1]
}
