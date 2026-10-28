import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  aglScale,
  cameraAltitudeM,
  createFlyControls,
  metresPerPixel,
  metresToLatDeg,
  metresToLngDeg,
  zoomForAltitude,
  type FlyControls,
  type MapLike,
} from '../flyControls'

// ---------------------------------------------------------------------------
// The suite runs in vitest's *node* environment (there is no jsdom here), and
// the module only ever calls `addEventListener` / `removeEventListener` on
// `window` and on the canvas. So both are stubbed and events are delivered by
// calling the registered handler directly - which also makes every test
// synchronous and free of animation-frame timing.
// ---------------------------------------------------------------------------

type Listeners = Record<string, ((e: unknown) => void)[]>

function makeTarget() {
  const listeners: Listeners = {}
  return {
    listeners,
    addEventListener(type: string, fn: (e: unknown) => void) {
      ;(listeners[type] ??= []).push(fn)
    },
    removeEventListener(type: string, fn: (e: unknown) => void) {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn)
    },
    fire(type: string, event: unknown = {}) {
      for (const fn of listeners[type] ?? []) fn(event)
    },
    count(type: string) {
      return (listeners[type] ?? []).length
    },
  }
}

function handler() {
  return { enabled: true, enable() { this.enabled = true }, disable() { this.enabled = false } }
}

function stubMap(initial?: Partial<{ lng: number; lat: number; zoom: number; bearing: number; pitch: number }>) {
  const canvas = { ...makeTarget(), clientHeight: 600, clientWidth: 1000 }
  const state = {
    lng: initial?.lng ?? 9.18,
    lat: initial?.lat ?? 48.78,
    zoom: initial?.zoom ?? 14,
    bearing: initial?.bearing ?? 0,
    pitch: initial?.pitch ?? 0,
  }
  const map = {
    state,
    canvas,
    dragPan: handler(),
    dragRotate: handler(),
    scrollZoom: handler(),
    keyboard: handler(),
    getCenter: () => ({ lng: state.lng, lat: state.lat }),
    getZoom: () => state.zoom,
    getBearing: () => state.bearing,
    getPitch: () => state.pitch,
    getCanvas: () => canvas as unknown as HTMLCanvasElement,
    jumpTo(o: { center?: [number, number]; zoom?: number; bearing?: number; pitch?: number }) {
      if (o.center) {
        state.lng = o.center[0]
        state.lat = o.center[1]
      }
      if (o.zoom !== undefined) state.zoom = o.zoom
      if (o.bearing !== undefined) state.bearing = o.bearing
      if (o.pitch !== undefined) state.pitch = o.pitch
    },
  }
  return map
}

let win: ReturnType<typeof makeTarget>
const live: FlyControls[] = []

function build(map: ReturnType<typeof stubMap>, extra: Record<string, unknown> = {}): FlyControls {
  const fly = createFlyControls({
    map: map as unknown as MapLike,
    // Pin the altitude scaling out of the way so movement tests measure the
    // movement maths and nothing else.
    aglScaleMin: 1,
    aglScaleMax: 1,
    cruiseDefaultMs: 100,
    // Never let a real animation frame start: `update` is called explicitly.
    raf: () => 1,
    cancelRaf: () => {},
    ...extra,
  })
  live.push(fly)
  return fly
}

beforeEach(() => {
  win = makeTarget()
  ;(globalThis as unknown as { window: unknown }).window = win
})

afterEach(() => {
  // Dispose every instance or window listeners leak between tests.
  while (live.length) live.pop()!.dispose()
  delete (globalThis as unknown as { window?: unknown }).window
})

const key = (k: string, extra: Record<string, unknown> = {}) => ({
  key: k,
  preventDefault: vi.fn(),
  ...extra,
})

describe('camera maths', () => {
  it('halves the ground resolution for every zoom level', () => {
    expect(metresPerPixel(0, 1)).toBeCloseTo(metresPerPixel(0, 0) / 2, 6)
  })

  it('shrinks the ground resolution towards the poles', () => {
    expect(metresPerPixel(60, 14)).toBeCloseTo(metresPerPixel(0, 14) * 0.5, 4)
  })

  it('lowers the camera as the view pitches over', () => {
    const level = cameraAltitudeM(600, 48.78, 14, 0)
    const tilted = cameraAltitudeM(600, 48.78, 14, 60)
    expect(tilted).toBeCloseTo(level * 0.5, 6)
  })

  it('round-trips altitude through zoom', () => {
    const alt = cameraAltitudeM(600, 48.78, 14, 0)
    const z = zoomForAltitude(14, alt, alt * 2)
    expect(z).toBeCloseTo(13, 9)
    expect(cameraAltitudeM(600, 48.78, z, 0)).toBeCloseTo(alt * 2, 6)
  })

  it('refuses to take the logarithm of a non-positive altitude', () => {
    // A drone descending through the ground would otherwise produce -Infinity
    // zoom, and the map goes blank rather than merely wrong.
    expect(zoomForAltitude(14, 0, 100)).toBe(14)
    expect(zoomForAltitude(14, 100, -5)).toBe(14)
    expect(Number.isFinite(zoomForAltitude(14, 100, 200))).toBe(true)
  })

  it('clamps the speed scaling at both ends', () => {
    expect(aglScale(600, 600, 0.22, 2.6)).toBeCloseTo(1, 9)
    expect(aglScale(1, 600, 0.22, 2.6)).toBe(0.22)
    expect(aglScale(600_000, 600, 0.22, 2.6)).toBe(2.6)
    expect(aglScale(Number.NaN, 600, 0.22, 2.6)).toBe(0.22)
  })

  it('does not divide by zero at the pole', () => {
    expect(metresToLngDeg(100, 90)).toBe(0)
    expect(metresToLatDeg(110_540)).toBeCloseTo(1, 6)
  })
})

describe('the latch', () => {
  it('starts on the map, not in the air', () => {
    const map = stubMap()
    const fly = build(map)
    expect(fly.engaged).toBe(false)
    expect(map.dragPan.enabled).toBe(true)
    expect(map.scrollZoom.enabled).toBe(true)
  })

  it('engages on a movement key and takes the map handlers with it', () => {
    const map = stubMap()
    const fly = build(map)
    win.fire('keydown', key('w'))
    expect(fly.engaged).toBe(true)
    // Otherwise the wheel zooms while the viewer thinks they are setting a
    // speed, and the arrow keys pan the map instead of turning the camera.
    expect(map.scrollZoom.enabled).toBe(false)
    expect(map.keyboard.enabled).toBe(false)
  })

  it('leaves dragPan and dragRotate alone - map/navigation.ts owns those', () => {
    // ⚠️ If the drone re-enabled them on hand-back it would quietly restore
    // MapLibre's drag-to-pan on top of the re-bound navigation.
    const map = stubMap()
    map.dragPan.disable()
    map.dragRotate.disable()
    const fly = build(map, { disengageMs: 1000 })
    win.fire('keydown', key('w'))
    win.fire('keyup', key('w'))
    fly.update(1.1)
    expect(fly.engaged).toBe(false)
    expect(map.dragPan.enabled).toBe(false)
    expect(map.dragRotate.enabled).toBe(false)
  })

  it('ignores keys typed into an input, so the search box cannot take off', () => {
    const map = stubMap()
    const fly = build(map)
    win.fire('keydown', key('w', { target: { tagName: 'INPUT' } }))
    expect(fly.engaged).toBe(false)
  })

  it('ignores shortcut chords', () => {
    const map = stubMap()
    const fly = build(map)
    win.fire('keydown', key('w', { ctrlKey: true }))
    win.fire('keydown', key('s', { metaKey: true }))
    expect(fly.engaged).toBe(false)
  })

  it('hands back after the grace window, and gives the map its handlers', () => {
    const map = stubMap()
    const fly = build(map, { disengageMs: 1000 })
    win.fire('keydown', key('w'))
    win.fire('keyup', key('w'))
    fly.update(0.6)
    expect(fly.engaged).toBe(true) // still inside the window
    fly.update(0.6)
    expect(fly.engaged).toBe(false)
    expect(map.dragPan.enabled).toBe(true)
    expect(map.scrollZoom.enabled).toBe(true)
  })

  it('keeps flying while a key is held, however long', () => {
    const map = stubMap()
    const fly = build(map, { disengageMs: 1000 })
    win.fire('keydown', key('w'))
    for (let i = 0; i < 20; i++) fly.update(0.5)
    expect(fly.engaged).toBe(true)
  })

  it('lets an arrow key hold the view without being handed back', () => {
    // Turning the camera is input; the grace window must see it as such.
    const map = stubMap()
    const fly = build(map, { disengageMs: 1000 })
    win.fire('keydown', key('w'))
    win.fire('keyup', key('w'))
    win.fire('keydown', key('ArrowLeft'))
    for (let i = 0; i < 10; i++) fly.update(0.5)
    expect(fly.engaged).toBe(true)
  })

  it('hands back at once on Escape, without swallowing the key', () => {
    const map = stubMap()
    const fly = build(map)
    win.fire('keydown', key('w'))
    const esc = key('Escape')
    win.fire('keydown', esc)
    expect(fly.engaged).toBe(false)
    // Escape must still close the vehicle popup and any dialog.
    expect(esc.preventDefault).not.toHaveBeenCalled()
  })

  it('only swallows the arrow keys while engaged', () => {
    const map = stubMap()
    build(map)
    const idle = key('ArrowLeft')
    win.fire('keydown', idle)
    // Swallowing them on the ground would break the depot panel's sliders.
    expect(idle.preventDefault).not.toHaveBeenCalled()

    win.fire('keydown', key('w'))
    const flying = key('ArrowLeft')
    win.fire('keydown', flying)
    expect(flying.preventDefault).toHaveBeenCalled()
  })

  it('never flips the latch mid-drag', () => {
    // MapLibre holds captured pointer state; flipping under it makes the first
    // move after the flip apply the whole accumulated delta and the view snaps.
    const map = stubMap()
    const fly = build(map)
    map.canvas.fire('pointerdown', { pointerType: 'mouse' })
    win.fire('keydown', key('w'))
    expect(fly.engaged).toBe(false)
    win.fire('pointerup', {})
    expect(fly.engaged).toBe(true)
  })

  it('drops a held shift on engage, so it is not read as instant boost', () => {
    const map = stubMap()
    const fly = build(map, { boost: 3 })
    win.fire('keydown', key('Shift'))
    win.fire('keydown', key('w'))
    fly.update(1)
    expect(fly.telemetry().speedMs).toBeCloseTo(100, 6)
  })

  it('clears held keys on blur, so alt-tab does not fly away', () => {
    const map = stubMap()
    const fly = build(map, { disengageMs: 1000 })
    win.fire('keydown', key('w'))
    win.fire('blur', {})
    fly.update(0.5)
    const moved = map.state.lat
    fly.update(0.6)
    expect(fly.engaged).toBe(false)
    expect(map.state.lat).toBeCloseTo(moved, 9)
  })
})

describe('flying', () => {
  it('W flies along the current bearing', () => {
    const map = stubMap({ bearing: 0, lat: 48.78, lng: 9.18 })
    const fly = build(map)
    win.fire('keydown', key('w'))
    fly.update(1)
    // 100 m/s for one second, due north.
    expect(map.state.lat).toBeCloseTo(48.78 + metresToLatDeg(100), 7)
    expect(map.state.lng).toBeCloseTo(9.18, 7)
  })

  it('turns with the bearing rather than always flying north', () => {
    const map = stubMap({ bearing: 90, lat: 48.78, lng: 9.18 })
    const fly = build(map)
    win.fire('keydown', key('w'))
    fly.update(1)
    expect(map.state.lng).toBeGreaterThan(9.18)
    expect(map.state.lat).toBeCloseTo(48.78, 7)
  })

  it('strafes to the right of the bearing on D', () => {
    const map = stubMap({ bearing: 0, lat: 48.78, lng: 9.18 })
    const fly = build(map)
    win.fire('keydown', key('d'))
    fly.update(1)
    expect(map.state.lng).toBeGreaterThan(9.18)
    expect(map.state.lat).toBeCloseTo(48.78, 7)
  })

  it('does not fly faster diagonally', () => {
    const straight = stubMap({ bearing: 0 })
    const flyA = build(straight)
    win.fire('keydown', key('w'))
    flyA.update(1)
    const northOnly = (straight.state.lat - 48.78) * 110_540
    expect(northOnly).toBeCloseTo(100, 6)
    flyA.dispose()

    win = makeTarget()
    ;(globalThis as unknown as { window: unknown }).window = win
    const diagonal = stubMap({ bearing: 0 })
    const flyB = build(diagonal)
    win.fire('keydown', key('w'))
    win.fire('keydown', key('d'))
    flyB.update(1)
    const north = (diagonal.state.lat - 48.78) * 110_540
    const east =
      (diagonal.state.lng - 9.18) * 111_320 * Math.cos((diagonal.state.lat * Math.PI) / 180)
    // Same 100 m of travel, just pointed 45° off.
    expect(Math.hypot(north, east)).toBeCloseTo(100, 3)
  })

  it('boosts with shift', () => {
    const map = stubMap({ bearing: 0 })
    const fly = build(map, { boost: 3 })
    win.fire('keydown', key('w'))
    win.fire('keydown', key('Shift'))
    fly.update(1)
    expect(map.state.lat - 48.78).toBeCloseTo(metresToLatDeg(300), 7)
  })

  it('E climbs and Q descends', () => {
    const map = stubMap()
    const fly = build(map)
    win.fire('keydown', key('e'))
    fly.update(1)
    // Climbing means a wider view, which in MapLibre means a lower zoom.
    expect(map.state.zoom).toBeLessThan(14)
  })

  it('R swings the view around the screen centre without moving it', () => {
    const map = stubMap({ bearing: 0, lat: 48.78, lng: 9.18 })
    const fly = build(map, { spinPerSecond: 0.6, lookTauS: undefined })
    win.fire('keydown', key('r'))
    fly.update(1)
    expect(map.state.bearing).toBeCloseTo((0.6 * 180) / Math.PI, 4)
    // A horizontal orbit: the centre and the altitude are untouched.
    expect(map.state.lat).toBeCloseTo(48.78, 9)
    expect(map.state.lng).toBeCloseTo(9.18, 9)
    expect(map.state.zoom).toBeCloseTo(14, 9)
  })

  it('F swings the other way', () => {
    const map = stubMap({ bearing: 0 })
    const fly = build(map, { spinPerSecond: 0.6 })
    win.fire('keydown', key('f'))
    fly.update(1)
    expect(map.state.bearing).toBeCloseTo((-0.6 * 180) / Math.PI, 4)
  })

  it('does not move the camera when nothing is held', () => {
    const map = stubMap()
    const fly = build(map)
    win.fire('keydown', key('w'))
    win.fire('keyup', key('w'))
    fly.update(0.3)
    expect(map.state.lat).toBeCloseTo(48.78, 9)
    expect(fly.telemetry().speedMs).toBe(0)
  })
})

describe('looking around', () => {
  it('drag turns the view', () => {
    const map = stubMap({ bearing: 0, pitch: 30 })
    const fly = build(map)
    win.fire('keydown', key('w'))
    map.canvas.fire('pointerdown', { pointerType: 'mouse' })
    map.canvas.fire('pointermove', { pointerType: 'mouse', movementX: 100, movementY: 0 })
    fly.update(0.016)
    expect(map.state.bearing).toBeGreaterThan(0)
  })

  it('dragging up looks up', () => {
    const map = stubMap({ pitch: 30 })
    const fly = build(map)
    win.fire('keydown', key('w'))
    map.canvas.fire('pointerdown', { pointerType: 'mouse' })
    map.canvas.fire('pointermove', { pointerType: 'mouse', movementX: 0, movementY: -50 })
    fly.update(0.016)
    expect(map.state.pitch).toBeGreaterThan(30)
  })

  it('clamps the pitch to the map’s own limits', () => {
    const map = stubMap({ pitch: 70 })
    const fly = build(map, { maxPitchDeg: 75, minPitchDeg: 0 })
    win.fire('keydown', key('w'))
    map.canvas.fire('pointerdown', { pointerType: 'mouse' })
    map.canvas.fire('pointermove', { pointerType: 'mouse', movementX: 0, movementY: -5000 })
    for (let i = 0; i < 30; i++) fly.update(0.05)
    expect(map.state.pitch).toBeLessThanOrEqual(75)
    expect(map.state.pitch).toBeGreaterThan(70)
  })

  it('ignores touch, which reports no movement delta', () => {
    // Chromium gives no movementX for touch, so drag-to-look would silently do
    // nothing while the map had already stopped responding.
    const map = stubMap({ bearing: 0 })
    const fly = build(map)
    win.fire('keydown', key('w'))
    map.canvas.fire('pointerdown', { pointerType: 'touch' })
    map.canvas.fire('pointermove', { pointerType: 'touch', movementX: 100, movementY: 0 })
    fly.update(0.016)
    expect(map.state.bearing).toBeCloseTo(0, 6)
  })

  it('ignores a touch drag even once a mouse drag is in progress', () => {
    // A touch pointerdown alone never sets `dragging`, so this mixed-input case
    // is the only thing the guard on pointermove actually protects.
    const map = stubMap({ bearing: 0 })
    const fly = build(map)
    win.fire('keydown', key('w'))
    map.canvas.fire('pointerdown', { pointerType: 'mouse' })
    map.canvas.fire('pointermove', { pointerType: 'touch', movementX: 500, movementY: 0 })
    fly.update(0.016)
    expect(map.state.bearing).toBeCloseTo(0, 6)
  })
})

describe('the throttle', () => {
  it('the wheel sets speed while flying, and is swallowed', () => {
    const map = stubMap()
    const fly = build(map, { cruiseDefaultMs: 100, cruiseStep: 2 })
    win.fire('keydown', key('w'))
    const up = { deltaY: -1, preventDefault: vi.fn() }
    map.canvas.fire('wheel', up)
    expect(fly.cruiseMs).toBeCloseTo(200, 6)
    // Without preventDefault the page scrolls behind the canvas.
    expect(up.preventDefault).toHaveBeenCalled()
  })

  it('leaves the wheel alone on the ground, so it still zooms the map', () => {
    const map = stubMap()
    const fly = build(map, { cruiseDefaultMs: 100, cruiseStep: 2 })
    const ev = { deltaY: -1, preventDefault: vi.fn() }
    map.canvas.fire('wheel', ev)
    expect(fly.cruiseMs).toBeCloseTo(100, 6)
    expect(ev.preventDefault).not.toHaveBeenCalled()
  })

  it('clamps the throttle at both ends', () => {
    const map = stubMap()
    const fly = build(map, { cruiseMinMs: 50, cruiseMaxMs: 200, cruiseDefaultMs: 100, cruiseStep: 2 })
    win.fire('keydown', key('w'))
    for (let i = 0; i < 10; i++) map.canvas.fire('wheel', { deltaY: -1, preventDefault: vi.fn() })
    expect(fly.cruiseMs).toBe(200)
    for (let i = 0; i < 20; i++) map.canvas.fire('wheel', { deltaY: 1, preventDefault: vi.fn() })
    expect(fly.cruiseMs).toBe(50)
  })

  it('reports the throttle as 0..1 on the log scale the wheel walks', () => {
    const map = stubMap()
    const fly = build(map, { cruiseMinMs: 50, cruiseMaxMs: 200, cruiseDefaultMs: 100 })
    expect(fly.telemetry().cruise).toBeCloseTo(0.5, 6)
  })
})

describe('lifecycle', () => {
  it('dispose gives the map back its handlers even mid-flight', () => {
    // Leaving them disabled would freeze the map for good.
    const map = stubMap()
    const fly = build(map)
    win.fire('keydown', key('w'))
    expect(map.scrollZoom.enabled).toBe(false)
    fly.dispose()
    live.pop()
    expect(map.scrollZoom.enabled).toBe(true)
    expect(map.keyboard.enabled).toBe(true)
  })

  it('dispose removes every listener it added', () => {
    const map = stubMap()
    const fly = build(map)
    expect(win.count('keydown')).toBe(1)
    expect(map.canvas.count('wheel')).toBe(1)
    fly.dispose()
    live.pop()
    expect(win.count('keydown')).toBe(0)
    expect(win.count('pointerup')).toBe(0)
    expect(map.canvas.count('wheel')).toBe(0)
    expect(map.canvas.count('pointermove')).toBe(0)
  })

  it('tells the UI to follow the latch instead of commanding it', () => {
    const map = stubMap()
    const seen: boolean[] = []
    const fly = build(map, { onEngagedChange: (on: boolean) => seen.push(on), disengageMs: 1000 })
    win.fire('keydown', key('w'))
    win.fire('keyup', key('w'))
    fly.update(1.1)
    expect(seen).toEqual([true, false])
  })
})
