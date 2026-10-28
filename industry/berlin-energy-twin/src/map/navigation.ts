/**
 * Map navigation, bound the way every other Rayfin twin binds it.
 *
 * The siblings drive a three.js `OrbitControls`, so anyone moving between these
 * apps has one set of habits:
 *
 *   drag          orbit / rotate the view
 *   Shift + drag  pan            (OrbitControls binds ctrl/meta/shift on left)
 *   right drag    pan            (and suppresses the context menu for it)
 *   middle drag   dolly / zoom
 *   wheel         zoom
 *   W A S D …     fly            (see map/flyControls.ts)
 *
 * MapLibre ships the opposite convention - drag pans, right drag rotates - so
 * this module takes the mouse over and re-binds it. The speeds are the siblings'
 * own numbers (`rotateSpeed 0.55`, `zoomSpeed 0.7`) and the rotation is scaled
 * by viewport height exactly as OrbitControls scales it, so a given drag turns
 * the view by the same amount in every app.
 *
 * ⚠️ Touch is deliberately NOT re-bound. Pinch-zoom and two-finger rotate stay
 * with MapLibre's own handlers, and a single finger keeps panning, because on a
 * touch screen "drag moves the map" is not a convention anyone will give up.
 */

export interface NavHandlerLike {
  enable(): void
  disable(): void
}

export interface NavMapLike {
  getBearing(): number
  getPitch(): number
  getZoom(): number
  getCanvas(): HTMLCanvasElement
  jumpTo(options: { bearing?: number; pitch?: number; zoom?: number }): void
  panBy(offset: [number, number], options?: { duration?: number }): void
  getMinPitch?(): number
  getMaxPitch?(): number
  dragPan: NavHandlerLike
  dragRotate: NavHandlerLike
}

/** OrbitControls' own defaults, so the feel matches the siblings. */
export const ROTATE_SPEED = 0.55
export const ZOOM_SPEED = 0.7
/** Zoom levels per pixel of a middle-button drag, before `ZOOM_SPEED`. */
export const ZOOM_PER_PX = 0.01
/** Movement under this many pixels is a click, not a drag. MapLibre uses 3. */
export const CLICK_TOLERANCE_PX = 3

export type Gesture = 'rotate' | 'pan' | 'zoom' | null

/**
 * Which gesture a mouse button and modifier mean.
 *
 * Kept separate from the wiring so the binding table itself can be tested -
 * this is the part a person will disagree with, not the arithmetic.
 */
export function gestureFor(button: number, shiftKey: boolean): Gesture {
  if (button === 0) return shiftKey ? 'pan' : 'rotate'
  if (button === 1) return 'zoom'
  if (button === 2) return 'pan'
  return null
}

/**
 * Degrees of turn per pixel dragged.
 *
 * OrbitControls turns a full circle over one viewport height (`2π · dy /
 * clientHeight · rotateSpeed`), so the same drag produces the same rotation
 * whatever the window size. Reproduced here rather than invented.
 */
export function degreesPerPixel(viewportHeightPx: number, speed = ROTATE_SPEED): number {
  if (!Number.isFinite(viewportHeightPx) || viewportHeightPx <= 0) return 0
  return (360 / viewportHeightPx) * speed
}

export function clampPitch(pitch: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, pitch))
}

export interface OrbitNavigation {
  /** True when the pointer moved far enough to be a drag, not a click. */
  didDrag(): boolean
  /** Hand the mouse back (the drone camera takes it while flying). */
  setEnabled(on: boolean): void
  readonly enabled: boolean
  dispose(): void
}

export interface OrbitNavigationOptions {
  map: NavMapLike
  rotateSpeed?: number
  zoomSpeed?: number
  /**
   * Fired once when a press turns into a real drag. Follow mode uses it to get
   * out of the way: the moment someone moves the camera themselves, having it
   * yanked back to a vehicle a second later is infuriating.
   */
  onGesture?: () => void
}

export function createOrbitNavigation(options: OrbitNavigationOptions): OrbitNavigation {
  const { map, rotateSpeed = ROTATE_SPEED, zoomSpeed = ZOOM_SPEED, onGesture } = options
  const canvas = map.getCanvas()

  let enabled = true
  let gesture: Gesture = null
  let travelled = 0
  let dragged = false

  // MapLibre's own mouse bindings are the ones being replaced. Touch lives in
  // the same DragPanHandler, so it is re-enabled for the duration of a touch.
  const takeMouse = () => {
    map.dragPan.disable()
    map.dragRotate.disable()
  }
  const releaseMouse = () => {
    map.dragPan.enable()
    map.dragRotate.enable()
  }
  takeMouse()

  const onPointerDown = (e: PointerEvent) => {
    if (!enabled) return
    if (e.pointerType !== 'mouse') {
      // Give the map back to MapLibre for the whole touch interaction.
      releaseMouse()
      return
    }
    gesture = gestureFor(e.button, e.shiftKey)
    travelled = 0
    dragged = false
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!enabled || gesture === null || e.pointerType !== 'mouse') return
    const dx = e.movementX
    const dy = e.movementY
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return
    travelled += Math.abs(dx) + Math.abs(dy)
    if (travelled > CLICK_TOLERANCE_PX && !dragged) {
      dragged = true
      onGesture?.()
    }

    if (gesture === 'pan') {
      // Grab-and-drag: the content follows the pointer, so the camera moves the
      // other way.
      map.panBy([-dx, -dy], { duration: 0 })
      return
    }
    if (gesture === 'zoom') {
      map.jumpTo({ zoom: map.getZoom() - dy * ZOOM_PER_PX * zoomSpeed })
      return
    }
    const perPx = degreesPerPixel(canvas.clientHeight || canvas.height, rotateSpeed)
    const minPitch = map.getMinPitch?.() ?? 0
    const maxPitch = map.getMaxPitch?.() ?? 85
    map.jumpTo({
      bearing: map.getBearing() + dx * perPx,
      // Drag up to look up, the same direction the siblings turn.
      pitch: clampPitch(map.getPitch() - dy * perPx, minPitch, maxPitch),
    })
  }

  // ⚠️ On WINDOW, not the canvas: a drag released off the canvas would
  // otherwise leave the gesture running for ever.
  const onPointerUp = () => {
    gesture = null
    if (!enabled) return
    takeMouse()
  }

  // OrbitControls suppresses this for its own right-drag pan.
  const onContextMenu = (e: MouseEvent) => {
    if (enabled) e.preventDefault()
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('pointerup', onPointerUp)

  return {
    didDrag() {
      return dragged
    },
    get enabled() {
      return enabled
    },
    setEnabled(on: boolean) {
      if (on === enabled) return
      enabled = on
      gesture = null
      // Handing back to the drone camera, which disables the map's handlers
      // itself; taking over again means re-claiming the mouse.
      if (on) takeMouse()
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('pointerup', onPointerUp)
      // Leaving the map's own handlers disabled would freeze it for good.
      releaseMouse()
    },
  }
}
