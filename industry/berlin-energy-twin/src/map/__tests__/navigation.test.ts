import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLICK_TOLERANCE_PX,
  createOrbitNavigation,
  degreesPerPixel,
  gestureFor,
  ROTATE_SPEED,
  type NavMapLike,
  type OrbitNavigation,
} from '../navigation'

// Same approach as the flyControls tests: vitest runs in the node environment
// here, and the module only ever calls addEventListener on the canvas and on
// window, so both are stubbed and events are delivered by hand.

function makeTarget() {
  const listeners: Record<string, ((e: unknown) => void)[]> = {}
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

function stubMap() {
  const canvas = { ...makeTarget(), clientHeight: 720, clientWidth: 1280 }
  const state = { bearing: 0, pitch: 0, zoom: 14 }
  const pans: [number, number][] = []
  const map = {
    state,
    pans,
    canvas,
    dragPan: handler(),
    dragRotate: handler(),
    getBearing: () => state.bearing,
    getPitch: () => state.pitch,
    getZoom: () => state.zoom,
    getMinPitch: () => 0,
    getMaxPitch: () => 75,
    getCanvas: () => canvas as unknown as HTMLCanvasElement,
    jumpTo(o: { bearing?: number; pitch?: number; zoom?: number }) {
      if (o.bearing !== undefined) state.bearing = o.bearing
      if (o.pitch !== undefined) state.pitch = o.pitch
      if (o.zoom !== undefined) state.zoom = o.zoom
    },
    panBy(offset: [number, number]) {
      pans.push(offset)
    },
  }
  return map
}

let win: ReturnType<typeof makeTarget>
const live: OrbitNavigation[] = []

function build(map: ReturnType<typeof stubMap>): OrbitNavigation {
  const nav = createOrbitNavigation({ map: map as unknown as NavMapLike })
  live.push(nav)
  return nav
}

beforeEach(() => {
  win = makeTarget()
  ;(globalThis as unknown as { window: unknown }).window = win
})

afterEach(() => {
  while (live.length) live.pop()!.dispose()
  delete (globalThis as unknown as { window?: unknown }).window
})

const mouse = (over: Record<string, unknown> = {}) => ({
  pointerType: 'mouse',
  button: 0,
  shiftKey: false,
  movementX: 0,
  movementY: 0,
  preventDefault: vi.fn(),
  ...over,
})

describe('the binding table', () => {
  it('matches the other twins: drag rotates, Shift+drag pans', () => {
    expect(gestureFor(0, false)).toBe('rotate')
    expect(gestureFor(0, true)).toBe('pan')
  })

  it('pans on the right button and dollies on the middle one', () => {
    expect(gestureFor(2, false)).toBe('pan')
    expect(gestureFor(1, false)).toBe('zoom')
  })

  it('ignores buttons nobody bound', () => {
    expect(gestureFor(4, false)).toBeNull()
  })
})

describe('rotation speed', () => {
  it('turns a full circle over one viewport height, as OrbitControls does', () => {
    expect(degreesPerPixel(720, 1)).toBeCloseTo(0.5, 6)
    expect(degreesPerPixel(720, 1) * 720).toBeCloseTo(360, 6)
  })

  it('is independent of window size for the same drag fraction', () => {
    const small = degreesPerPixel(600) * 60 // 10 % of the height
    const large = degreesPerPixel(1200) * 120 // also 10 %
    expect(small).toBeCloseTo(large, 6)
  })

  it('refuses to divide by a zero-height canvas', () => {
    expect(degreesPerPixel(0)).toBe(0)
    expect(degreesPerPixel(Number.NaN)).toBe(0)
  })
})

describe('driving the map', () => {
  it('takes MapLibre’s mouse bindings away on creation', () => {
    const map = stubMap()
    build(map)
    expect(map.dragPan.enabled).toBe(false)
    expect(map.dragRotate.enabled).toBe(false)
  })

  it('rotates on a plain drag', () => {
    const map = stubMap()
    build(map)
    map.canvas.fire('pointerdown', mouse())
    map.canvas.fire('pointermove', mouse({ movementX: 100, movementY: 0 }))
    expect(map.state.bearing).toBeCloseTo(100 * degreesPerPixel(720, ROTATE_SPEED), 6)
    expect(map.pans).toHaveLength(0)
  })

  it('pitches up when dragged up, the way the siblings turn', () => {
    const map = stubMap()
    build(map)
    map.state.pitch = 30
    map.canvas.fire('pointerdown', mouse())
    map.canvas.fire('pointermove', mouse({ movementX: 0, movementY: -50 }))
    expect(map.state.pitch).toBeGreaterThan(30)
  })

  it('clamps the pitch to the map’s own limits', () => {
    const map = stubMap()
    build(map)
    map.state.pitch = 70
    map.canvas.fire('pointerdown', mouse())
    for (let i = 0; i < 40; i++) map.canvas.fire('pointermove', mouse({ movementY: -50 }))
    expect(map.state.pitch).toBeLessThanOrEqual(75)
  })

  it('pans on Shift+drag, and the content follows the pointer', () => {
    const map = stubMap()
    build(map)
    map.canvas.fire('pointerdown', mouse({ shiftKey: true }))
    map.canvas.fire('pointermove', mouse({ shiftKey: true, movementX: 40, movementY: 25 }))
    // Grab-and-drag: dragging right moves the camera west.
    expect(map.pans).toEqual([[-40, -25]])
    expect(map.state.bearing).toBe(0)
  })

  it('keeps the gesture chosen at pointerdown for the whole drag', () => {
    // Releasing Shift mid-drag must not turn a pan into a rotation under the
    // pointer - that is the same "never flip mid-gesture" rule as the drone.
    const map = stubMap()
    build(map)
    map.canvas.fire('pointerdown', mouse({ shiftKey: true }))
    map.canvas.fire('pointermove', mouse({ shiftKey: false, movementX: 30 }))
    expect(map.pans).toHaveLength(1)
    expect(map.state.bearing).toBe(0)
  })

  it('zooms on a middle drag', () => {
    const map = stubMap()
    build(map)
    map.canvas.fire('pointerdown', mouse({ button: 1 }))
    map.canvas.fire('pointermove', mouse({ button: 1, movementY: -100 }))
    expect(map.state.zoom).toBeGreaterThan(14)
  })

  it('does nothing at all until a button goes down', () => {
    const map = stubMap()
    build(map)
    map.canvas.fire('pointermove', mouse({ movementX: 200 }))
    expect(map.state.bearing).toBe(0)
    expect(map.pans).toHaveLength(0)
  })

  it('stops when the button is released off the canvas', () => {
    const map = stubMap()
    build(map)
    map.canvas.fire('pointerdown', mouse())
    win.fire('pointerup', {})
    map.canvas.fire('pointermove', mouse({ movementX: 200 }))
    expect(map.state.bearing).toBe(0)
  })

  it('survives a browser that reports no movement delta', () => {
    const map = stubMap()
    build(map)
    map.canvas.fire('pointerdown', mouse())
    map.canvas.fire('pointermove', mouse({ movementX: undefined, movementY: undefined }))
    expect(Number.isFinite(map.state.bearing)).toBe(true)
  })
})

describe('clicks versus drags', () => {
  it('reports a short press as a click, so selection still works', () => {
    const map = stubMap()
    const nav = build(map)
    map.canvas.fire('pointerdown', mouse())
    map.canvas.fire('pointermove', mouse({ movementX: 1, movementY: 1 }))
    expect(nav.didDrag()).toBe(false)
  })

  it('reports a real drag, so turning the view cannot select a line', () => {
    const map = stubMap()
    const nav = build(map)
    map.canvas.fire('pointerdown', mouse())
    map.canvas.fire('pointermove', mouse({ movementX: CLICK_TOLERANCE_PX + 5 }))
    expect(nav.didDrag()).toBe(true)
  })
})

describe('touch', () => {
  it('hands the map back to MapLibre for the whole touch interaction', () => {
    // Pinch-zoom and one-finger panning are conventions nobody gives up.
    const map = stubMap()
    build(map)
    expect(map.dragPan.enabled).toBe(false)
    map.canvas.fire('pointerdown', { pointerType: 'touch', button: 0 })
    expect(map.dragPan.enabled).toBe(true)
    expect(map.dragRotate.enabled).toBe(true)
  })

  it('reclaims the mouse once the touch ends', () => {
    const map = stubMap()
    build(map)
    map.canvas.fire('pointerdown', { pointerType: 'touch', button: 0 })
    win.fire('pointerup', {})
    expect(map.dragPan.enabled).toBe(false)
  })

  it('never rotates from a touch move', () => {
    const map = stubMap()
    build(map)
    map.canvas.fire('pointerdown', { pointerType: 'touch', button: 0 })
    map.canvas.fire('pointermove', { pointerType: 'touch', movementX: 100, movementY: 0 })
    expect(map.state.bearing).toBe(0)
  })
})

describe('handing over to the drone camera', () => {
  it('goes quiet while flying and does not fight it for the mouse', () => {
    const map = stubMap()
    const nav = build(map)
    nav.setEnabled(false)
    map.canvas.fire('pointerdown', mouse())
    map.canvas.fire('pointermove', mouse({ movementX: 120 }))
    expect(map.state.bearing).toBe(0)
    expect(nav.enabled).toBe(false)
  })

  it('reclaims the mouse when the drone hands back', () => {
    const map = stubMap()
    const nav = build(map)
    nav.setEnabled(false)
    // The drone re-enables what it disabled; navigation must take its own back.
    map.dragPan.enable()
    map.dragRotate.enable()
    nav.setEnabled(true)
    expect(map.dragPan.enabled).toBe(false)
    expect(map.dragRotate.enabled).toBe(false)
  })
})

describe('lifecycle', () => {
  it('gives the map its own handlers back on dispose', () => {
    const map = stubMap()
    const nav = build(map)
    nav.dispose()
    live.pop()
    expect(map.dragPan.enabled).toBe(true)
    expect(map.dragRotate.enabled).toBe(true)
  })

  it('removes every listener it added', () => {
    const map = stubMap()
    const nav = build(map)
    expect(map.canvas.count('pointerdown')).toBe(1)
    expect(win.count('pointerup')).toBe(1)
    nav.dispose()
    live.pop()
    expect(map.canvas.count('pointerdown')).toBe(0)
    expect(map.canvas.count('pointermove')).toBe(0)
    expect(win.count('pointerup')).toBe(0)
  })

  it('suppresses the context menu, which the right-drag pan needs', () => {
    const map = stubMap()
    build(map)
    const e = { preventDefault: vi.fn() }
    map.canvas.fire('contextmenu', e)
    expect(e.preventDefault).toHaveBeenCalled()
  })
})
