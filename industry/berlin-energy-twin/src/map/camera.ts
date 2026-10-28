import type { FlyToOptions } from 'maplibre-gl'

/**
 * Turning a requested camera into MapLibre `flyTo` options.
 *
 * ⚠️⚠️ THIS EXISTS BECAUSE FOUR OF THE FIVE VIEWPOINTS CRASHED THE APP.
 *
 * The Betriebshof needs its subject off dead centre, because the depot panel
 * sits over the middle of the map, so `camera.offset` was added and passed
 * straight through:
 *
 *     m.flyTo({ ..., offset: camera.offset })
 *
 * Every other viewpoint declares no offset. `camera.offset` is then
 * `undefined` — and **passing `undefined` is NOT the same as passing nothing**.
 * MapLibre fills its defaults by merging (`{...defaults, ...options}`), and an
 * explicit `undefined` OVERWRITES the `[0, 0]` default rather than falling back
 * to it. `flyTo` then hands `undefined` to `Point.convert`, which throws
 * `Cannot read properties of undefined (reading 'x')`.
 *
 * That exception lands in a React effect, so the ErrorBoundary replaced the
 * whole app with "Anzeige unterbrochen". **Clicking the first camera preset in
 * front of the room ended the demo.** It shipped on 2026-08-13 and survived
 * every run since, because the one viewpoint anybody clicked while testing the
 * feature was the Betriebshof — the only one that HAS an offset.
 *
 * The lesson is bigger than this call: when a library fills defaults by
 * merging, an optional property must be OMITTED, never passed as `undefined`.
 * The test on this function asserts no key is ever `undefined`, so the whole
 * class of bug is caught rather than this one instance.
 */

export type RequestedCamera = {
  center: [number, number]
  zoom: number
  pitch: number
  bearing: number
  /** pixels to place the subject away from dead centre, [x, y] */
  offset?: [number, number]
  /** flight time in ms; the tour flies slower than a list click */
  duration?: number
  nonce: number
}

/** How long a viewpoint takes to fly, in ms. */
export const FLY_DURATION_MS = 2200

export function flyToOptions(camera: RequestedCamera): FlyToOptions {
  const opts: FlyToOptions = {
    center: camera.center,
    zoom: camera.zoom,
    pitch: camera.pitch,
    bearing: camera.bearing,
    duration: camera.duration ?? FLY_DURATION_MS,
    // Keep flying even if the user's system asks for reduced motion; a demo
    // camera that silently does not move looks like a broken button.
    essential: true,
  }
  // ⚠️ Only set it when there IS one. `offset: undefined` is the bug.
  if (camera.offset) opts.offset = camera.offset
  return opts
}
