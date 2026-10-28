/**
 * flyControls — the drone camera, MapLibre edition.
 *
 * The Rayfin twins share a free-flight camera with a very specific *contract*:
 * no toggle button, the keys are the whole control, and the map keeps its
 * normal behaviour for anyone who never presses them. This file is the third
 * engine that contract runs on, alongside the three.js and Cesium copies.
 *
 * ⚠️ It is a **sibling, not a copy**. The other two are byte-identical to their
 * own kind and must stay so; this one cannot be, because MapLibre's camera is
 * neither a Y-up scene camera nor an ECEF one — it is `center / zoom / bearing
 * / pitch`, and altitude is a *consequence* of zoom rather than a coordinate.
 * What is kept identical is everything a user or a test can observe: the key
 * map, the latch, `DISENGAGE_MS`, `SPIN_PER_SECOND`, the option names and the
 * telemetry shape.
 *
 * Two pieces of the other engines are deliberately absent, and their absence is
 * the point rather than an omission:
 *
 * 1. **No `handBackToOrbit()`.** Those ~120 lines exist purely to dodge
 *    `OrbitControls.update()`, which re-clamps the polar angle every frame and
 *    enforces it by moving the camera. MapLibre has no orbit target and no
 *    polar clamp, so handing back is just re-enabling the handlers, in place.
 * 2. **No `spinCentre` latch.** R/F must swing around whatever is in the middle
 *    of the view; in MapLibre changing `bearing` is *defined* as rotating about
 *    the screen centre, so there is no centre to latch and no spiral to avoid.
 */

/** Structural handler type — `map.dragPan`, `map.scrollZoom`, … */
export interface MapHandlerLike {
  enable(): void
  disable(): void
}

/**
 * Structural map type, so the module can be driven by a stub in tests. A real
 * `maplibregl.Map` satisfies it; nothing here needs WebGL.
 */
export interface MapLike {
  getCenter(): { lng: number; lat: number }
  getZoom(): number
  getBearing(): number
  getPitch(): number
  getCanvas(): HTMLCanvasElement
  jumpTo(options: {
    center?: [number, number]
    zoom?: number
    bearing?: number
    pitch?: number
  }): void
  dragPan: MapHandlerLike
  dragRotate: MapHandlerLike
  scrollZoom: MapHandlerLike
  keyboard: MapHandlerLike
  queryTerrainElevation?: (lngLat: [number, number]) => number | null
}

/** Slowest the throttle goes, m/s. */
export const CRUISE_MIN_MS = 25
/** Fastest the throttle goes, m/s. */
export const CRUISE_MAX_MS = 900
/** Where the throttle starts, m/s. */
export const CRUISE_DEFAULT_MS = 180
/** Multiplier per wheel notch. */
export const CRUISE_STEP = 1.18
/** Shift multiplier. */
export const BOOST = 3
/** Radians per second that R and F swing the view. Same number as the siblings. */
export const SPIN_PER_SECOND = 0.6
/**
 * How long the camera stays engaged with no input.
 *
 * ⚠️ 1000, not 2000 — a user flew Campus-Scheduler and said 2 s read as slow.
 * Going back to the map is the common case. Do not raise it without flying it.
 */
export const DISENGAGE_MS = 1_000

/** Height above ground at which cruise runs at exactly the configured speed. */
export const REFERENCE_AGL_M = 400
export const AGL_SCALE_MIN = 0.22
export const AGL_SCALE_MAX = 2.6

const MOVEMENT_KEYS = 'wasdqerf'
const ARROW_KEYS = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright'])
/** Degrees of turn per pixel of drag. 0.0022 rad in the siblings. */
const LOOK_PER_PIXEL_DEG = 0.126
/** Degrees of turn per second on the arrow keys. 1.1 rad/s in the siblings. */
const LOOK_PER_SECOND_DEG = 63
/** Below this, treat the camera as parked. m/s. */
const PARKED_MS = 0.1
const RAD_TO_DEG = 180 / Math.PI

/**
 * Ground resolution at the equator for zoom 0, metres per pixel. MapLibre
 * scales this by `cos(latitude)` and by `2^-zoom`.
 */
export const EQUATOR_M_PER_PX = 156_543.033_928_04

/**
 * Camera distance in units of viewport height, for MapLibre's default field of
 * view (0.6435 rad): `1 / (2 · tan(fov/2))`.
 */
export const FOV_FACTOR = 1.5

export function metresPerPixel(latDeg: number, zoom: number): number {
  return (EQUATOR_M_PER_PX * Math.cos((latDeg * Math.PI) / 180)) / 2 ** zoom
}

/** Height of the camera above the point it is centred on, in metres. */
export function cameraAltitudeM(
  heightPx: number,
  latDeg: number,
  zoom: number,
  pitchDeg: number,
): number {
  const distance = FOV_FACTOR * heightPx * metresPerPixel(latDeg, zoom)
  return distance * Math.cos((pitchDeg * Math.PI) / 180)
}

/**
 * The zoom that puts the camera at `targetAltM`, given where it is now.
 *
 * Altitude is proportional to `2^-zoom`, so this is exact rather than iterative.
 * Guarded because a non-positive altitude has no logarithm — and a drone that
 * descends *through* the ground would otherwise produce `-Infinity` zoom and a
 * blank map.
 */
export function zoomForAltitude(zoom: number, currentAltM: number, targetAltM: number): number {
  if (currentAltM <= 0 || targetAltM <= 0) return zoom
  return zoom - Math.log2(targetAltM / currentAltM)
}

/**
 * How much faster to fly when high up.
 *
 * At 3 km a city-scale cruise crawls; at 50 m it would be a blur. Speed scales
 * with height above ground, clamped at both ends.
 */
export function aglScale(
  aglM: number,
  referenceAglM: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(aglM) || aglM <= 0) return min
  return Math.max(min, Math.min(max, aglM / referenceAglM))
}

/** Metres → degrees of longitude at a given latitude. */
export function metresToLngDeg(metres: number, latDeg: number): number {
  const cos = Math.cos((latDeg * Math.PI) / 180)
  // At the poles a metre is infinitely many degrees; clamp so the camera
  // cannot teleport if someone flies to the top of the world.
  if (Math.abs(cos) < 1e-6) return 0
  return metres / (111_320 * cos)
}

/** Metres → degrees of latitude. */
export function metresToLatDeg(metres: number): number {
  return metres / 110_540
}

export interface FlyTelemetry {
  engaged: boolean
  /** Configured cruise, m/s — the speed the throttle is *set* to. */
  cruiseMs: number
  /** Cruise as 0..1 on the log scale the wheel walks, for a throttle bar. */
  cruise: number
  /** Speed the camera is *actually* moving at, m/s. Differs under inertia. */
  speedMs: number
  /** Camera height above the centre point, m. */
  altitudeM: number
  /** Height above terrain, m. Null where the map has no elevation to give. */
  aglM: number | null
  /** Compass heading, degrees, 0 = north. */
  headingDeg: number
}

export interface FlyControls {
  readonly engaged: boolean
  readonly cruiseMs: number
  /** Ask for the latch to flip. Queued to the next `pointerup` mid-drag. */
  setEngaged(on: boolean): void
  telemetry(): FlyTelemetry
  /** Advance the camera and run the disengage timer. Safe when not engaged. */
  update(dt: number): void
  dispose(): void
}

export interface FlyControlsOptions {
  map: MapLike
  /**
   * ⚠️ The UI must FOLLOW the latch, never command it. The keys engage it, so
   * anything drawn from a local `useState` is wrong the moment someone hits W.
   */
  onEngagedChange?: (engaged: boolean) => void
  cruiseMinMs?: number
  cruiseMaxMs?: number
  cruiseDefaultMs?: number
  cruiseStep?: number
  boost?: number
  spinPerSecond?: number
  disengageMs?: number
  referenceAglM?: number
  aglScaleMin?: number
  aglScaleMax?: number
  minPitchDeg?: number
  maxPitchDeg?: number
  /** Seconds to reach ~63 % of cruise. Omit for instant. */
  accelerateTauS?: number
  /** Seconds to shed ~63 % of speed. Omit for instant. */
  brakeTauS?: number
  /** Seconds for the gimbal to catch up with the pointer. Omit for rigid. */
  lookTauS?: number
  /** Frame driver, injectable so tests never need `requestAnimationFrame`. */
  raf?: (cb: (t: number) => void) => number
  cancelRaf?: (handle: number) => void
}

/** Frame-rate independent exponential approach. */
const approach = (dt: number, tau: number) => 1 - Math.exp(-dt / tau)

export function createFlyControls(options: FlyControlsOptions): FlyControls {
  const {
    map,
    onEngagedChange,
    cruiseMinMs = CRUISE_MIN_MS,
    cruiseMaxMs = CRUISE_MAX_MS,
    cruiseDefaultMs = CRUISE_DEFAULT_MS,
    cruiseStep = CRUISE_STEP,
    boost = BOOST,
    spinPerSecond = SPIN_PER_SECOND,
    disengageMs = DISENGAGE_MS,
    referenceAglM = REFERENCE_AGL_M,
    aglScaleMin = AGL_SCALE_MIN,
    aglScaleMax = AGL_SCALE_MAX,
    minPitchDeg = 0,
    maxPitchDeg = 75,
    accelerateTauS,
    brakeTauS,
    lookTauS,
    raf = (cb) => requestAnimationFrame(cb),
    cancelRaf = (h) => cancelAnimationFrame(h),
  } = options

  const canvas = map.getCanvas()
  const held = new Set<string>()

  let engaged = false
  let dragging = false
  let pendingEngaged: boolean | null = null
  let cruiseMs = Math.max(cruiseMinMs, Math.min(cruiseMaxMs, cruiseDefaultMs))
  let speedMs = 0
  let idleS = 0
  let frame: number | null = null
  let lastT = 0

  // Unwrapped so smoothing never takes the long way round at the 0/360 seam.
  let bearing = map.getBearing()
  let targetBearing = bearing
  let pitch = map.getPitch()
  let targetPitch = pitch

  const hasInertia = accelerateTauS !== undefined && brakeTauS !== undefined
  const clampPitch = (p: number) => Math.max(minPitchDeg, Math.min(maxPitchDeg, p))

  function agl(lng: number, lat: number, altitudeM: number): number | null {
    const ground = map.queryTerrainElevation?.([lng, lat])
    if (ground === null || ground === undefined || !Number.isFinite(ground)) return null
    return altitudeM - ground
  }

  function setEngagedNow(on: boolean): void {
    if (on === engaged) return
    engaged = on

    // ⚠️ MapLibre's own handlers must be off while flying, or a drag both looks
    // AND pans the map underneath, and the wheel zooms while the viewer thinks
    // they are setting a speed. Re-enabling them IS the hand-back.
    // ⚠️ dragPan/dragRotate are NOT touched here: map/navigation.ts owns the
    // mouse and keeps them disabled for good, so enabling them on hand-back
    // would quietly restore MapLibre's drag-to-pan over the top of it. The host
    // suspends the navigation instead, through `onEngagedChange`.
    for (const h of [map.scrollZoom, map.keyboard]) {
      if (on) h.disable()
      else h.enable()
    }

    if (on) {
      // ⚠️ Shift held for a map gesture would otherwise arrive as instant boost.
      held.delete('shift')
      bearing = targetBearing = map.getBearing()
      pitch = targetPitch = clampPitch(map.getPitch())
      idleS = 0
      // MapLibre gives no host render loop to hang `update` on — unlike the
      // three.js and Cesium hosts, which already run one — so the module drives
      // its own while engaged, and stops it again on hand-back.
      lastT = 0
      if (frame === null) frame = raf(tick)
    } else {
      speedMs = 0
      if (frame !== null) {
        cancelRaf(frame)
        frame = null
      }
    }
    onEngagedChange?.(on)
  }

  /**
   * ⚠️ NEVER FLIP THE LATCH MID-GESTURE. MapLibre's handlers hold captured
   * pointer state; flipping under them makes the first move after the flip
   * apply the whole accumulated delta, and the view snaps.
   */
  function requestEngaged(on: boolean): void {
    if (dragging) pendingEngaged = on
    else setEngagedNow(on)
  }

  function tick(t: number): void {
    frame = raf(tick)
    if (lastT === 0) {
      lastT = t
      return
    }
    // Cap the step: returning to a backgrounded tab hands over a huge delta,
    // which would fling the camera across the region in one frame.
    const dt = Math.min(0.1, (t - lastT) / 1000)
    lastT = t
    update(dt)
  }

  function update(dt: number): void {
    if (!engaged || dt <= 0) return

    const fwd = (held.has('w') ? 1 : 0) - (held.has('s') ? 1 : 0)
    const strafe = (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0)
    const climb = (held.has('e') ? 1 : 0) - (held.has('q') ? 1 : 0)
    const spin = (held.has('r') ? 1 : 0) - (held.has('f') ? 1 : 0)
    const moving = fwd !== 0 || strafe !== 0 || climb !== 0 || spin !== 0

    // Arrow keys look around without moving — and reset the idle timer, which
    // is what lets someone hold a view steady without being handed back.
    let arrowX = (held.has('arrowright') ? 1 : 0) - (held.has('arrowleft') ? 1 : 0)
    let arrowY = (held.has('arrowdown') ? 1 : 0) - (held.has('arrowup') ? 1 : 0)
    if (arrowX || arrowY) idleS = 0
    targetBearing += arrowX * LOOK_PER_SECOND_DEG * dt
    targetPitch = clampPitch(targetPitch - arrowY * LOOK_PER_SECOND_DEG * dt)
    arrowX = arrowY = 0

    if (moving) idleS = 0
    else {
      idleS += dt
      if (idleS * 1000 >= disengageMs) {
        requestEngaged(false)
        return
      }
    }

    // R/F swing the view around the screen centre. In MapLibre that is simply
    // bearing: rotation is defined about the centre point, so unlike the other
    // engines there is no centre to latch and no spiral to guard against.
    if (spin !== 0) targetBearing += spin * spinPerSecond * RAD_TO_DEG * dt

    // Smooth the gimbal if asked, otherwise follow the target exactly.
    if (lookTauS !== undefined) {
      const k = approach(dt, lookTauS)
      bearing += (targetBearing - bearing) * k
      pitch += (targetPitch - pitch) * k
    } else {
      bearing = targetBearing
      pitch = targetPitch
    }

    const centre = map.getCenter()
    const zoom = map.getZoom()
    const heightPx = canvas.clientHeight || canvas.height || 1
    const altitudeM = cameraAltitudeM(heightPx, centre.lat, zoom, pitch)
    const aglM = agl(centre.lng, centre.lat, altitudeM)
    const scale = aglScale(aglM ?? altitudeM, referenceAglM, aglScaleMin, aglScaleMax)

    const wanted =
      (moving ? cruiseMs * scale : 0) * (held.has('shift') ? boost : 1)
    if (hasInertia) {
      const tau = wanted > speedMs ? accelerateTauS! : brakeTauS!
      speedMs += (wanted - speedMs) * approach(dt, tau)
      if (speedMs < PARKED_MS) speedMs = 0
    } else {
      speedMs = wanted
    }

    let lng = centre.lng
    let lat = centre.lat
    let nextZoom = zoom

    if ((fwd !== 0 || strafe !== 0) && speedMs > 0) {
      // Normalise so flying diagonally is not faster than flying straight.
      const len = Math.hypot(fwd, strafe)
      const distance = speedMs * dt
      const rad = (bearing * Math.PI) / 180
      // Bearing is clockwise from north: forward is (sin, cos), right is the
      // bearing turned 90° clockwise.
      const north = ((fwd / len) * Math.cos(rad) - (strafe / len) * Math.sin(rad)) * distance
      const east = ((fwd / len) * Math.sin(rad) + (strafe / len) * Math.cos(rad)) * distance
      lat += metresToLatDeg(north)
      lng += metresToLngDeg(east, lat)
    }

    if (climb !== 0) {
      const rate = cruiseMs * scale * (held.has('shift') ? boost : 1)
      nextZoom = zoomForAltitude(zoom, altitudeM, altitudeM + climb * rate * dt)
    }

    map.jumpTo({
      center: [lng, lat],
      zoom: nextZoom,
      bearing: bearing % 360,
      pitch,
    })
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase()
    if (e.metaKey || e.ctrlKey || e.altKey) return
    // Typing in the search box or the ask panel must not take off.
    const el = e.target as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
    // D51: the order and finance tabs cover the map; their keys are not the camera's.
    if (typeof document !== 'undefined' && document.querySelector('.tab-page:not([hidden])')) return

    if (key === 'shift') held.add('shift')
    if (key.length === 1 && MOVEMENT_KEYS.includes(key)) {
      held.add(key)
      idleS = 0
      requestEngaged(true)
    }
    if (ARROW_KEYS.has(key)) {
      held.add(key)
      // ⚠️ Only swallow the arrows WHILE ENGAGED. Always would break keyboard
      // navigation and every range slider in the depot panel.
      if (engaged) e.preventDefault()
    }
    // ⚠️ Deliberately NOT preventDefault: Escape must still close the popup.
    // The camera simply takes its own meaning from it as well.
    if (key === 'escape' && engaged) requestEngaged(false)
  }

  const onKeyUp = (e: KeyboardEvent) => {
    held.delete(e.key.toLowerCase())
  }

  // A window blur leaves keys stuck down for ever — alt-tab away mid-flight and
  // the camera is still going when you come back.
  const onBlur = () => held.clear()

  const onPointerDown = (e: PointerEvent) => {
    // ⚠️ Touch stays on MapLibre's handlers unconditionally: Chromium does not
    // report `movementX` for touch, so drag-to-look silently does nothing.
    if (e.pointerType === 'touch') return
    dragging = true
    if (engaged) idleS = 0
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!engaged || !dragging || e.pointerType === 'touch') return
    targetBearing += e.movementX * LOOK_PER_PIXEL_DEG
    targetPitch = clampPitch(targetPitch - e.movementY * LOOK_PER_PIXEL_DEG)
    idleS = 0
  }

  // ⚠️ On WINDOW, not the canvas: a drag that ends off the canvas would
  // otherwise never end, and the latch would stay queued for ever.
  const onPointerUp = () => {
    dragging = false
    if (pendingEngaged !== null) {
      const next = pendingEngaged
      pendingEngaged = null
      setEngagedNow(next)
    }
  }

  const onWheel = (e: WheelEvent) => {
    if (!engaged) return
    e.preventDefault()
    const factor = e.deltaY < 0 ? cruiseStep : 1 / cruiseStep
    cruiseMs = Math.max(cruiseMinMs, Math.min(cruiseMaxMs, cruiseMs * factor))
    idleS = 0
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  window.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  // `passive: false` because the handler calls preventDefault; without it the
  // page scrolls behind the canvas while the viewer thinks they set a speed.
  canvas.addEventListener('wheel', onWheel, { passive: false })

  return {
    get engaged() {
      return engaged
    },
    get cruiseMs() {
      return cruiseMs
    },
    setEngaged(on: boolean) {
      requestEngaged(on)
    },
    telemetry(): FlyTelemetry {
      const centre = map.getCenter()
      const heightPx = canvas.clientHeight || canvas.height || 1
      const altitudeM = cameraAltitudeM(heightPx, centre.lat, map.getZoom(), map.getPitch())
      const span = Math.log(cruiseMaxMs / cruiseMinMs)
      return {
        engaged,
        cruiseMs,
        cruise: span > 0 ? Math.log(cruiseMs / cruiseMinMs) / span : 0,
        speedMs,
        altitudeM,
        aglM: agl(centre.lng, centre.lat, altitudeM),
        headingDeg: ((map.getBearing() % 360) + 360) % 360,
      }
    },
    update,
    dispose() {
      if (frame !== null) cancelRaf(frame)
      frame = null
      // Leaving the handlers disabled would freeze the map for good.
      if (engaged) {
        engaged = false
        for (const h of [map.scrollZoom, map.keyboard]) h.enable()
      }
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('wheel', onWheel)
    },
  }
}
