import { describe, expect, it } from 'vitest'
import { FLY_DURATION_MS, flyToOptions, type RequestedCamera } from '../camera'

/**
 * ⚠️ Four of the five viewpoints crashed the deployed app, and every one of
 * them looked correct in review. These pin the reason.
 */

const cam = (over: Partial<RequestedCamera> = {}): RequestedCamera => ({
  center: [9.1672, 48.7565],
  zoom: 15.1,
  pitch: 72,
  bearing: 186,
  nonce: 1,
  ...over,
})

describe('flyTo options for a requested camera', () => {
  it('NEVER passes a key as undefined, whatever the camera leaves out', () => {
    // ⚠️ THIS IS THE WHOLE BUG. MapLibre fills defaults by merging, so an
    // explicit `undefined` OVERWRITES the default instead of falling back to
    // it: `offset: undefined` reached `Point.convert` and threw
    // "Cannot read properties of undefined (reading 'x')", which the
    // ErrorBoundary turned into "Anzeige unterbrochen" over the whole app.
    // Asserted over every key so the next optional field cannot repeat it.
    const opts = flyToOptions(cam())
    for (const [key, value] of Object.entries(opts)) {
      expect(value, `${key} must be omitted rather than set to undefined`).not.toBe(undefined)
    }
  })

  it('omits the offset entirely for a viewpoint that has none', () => {
    expect('offset' in flyToOptions(cam())).toBe(false)
  })

  it('keeps the offset for a viewpoint that needs one', () => {
    // The Betriebshof sits behind the depot panel unless it is pushed clear.
    expect(flyToOptions(cam({ offset: [300, -150] })).offset).toEqual([300, -150])
  })

  it('carries the frame through unchanged', () => {
    const o = flyToOptions(cam())
    expect(o.center).toEqual([9.1672, 48.7565])
    expect(o.zoom).toBe(15.1)
    expect(o.pitch).toBe(72)
    expect(o.bearing).toBe(186)
  })

  it('stays essential, so reduced-motion cannot silently freeze the demo', () => {
    // A camera button that does nothing reads as broken, not as considerate.
    expect(flyToOptions(cam()).essential).toBe(true)
    expect(flyToOptions(cam()).duration).toBe(FLY_DURATION_MS)
  })

  it('treats a zero offset as a real offset, not as absent', () => {
    // [0, 0] is falsy-adjacent but is a perfectly valid explicit request.
    const o = flyToOptions(cam({ offset: [0, 0] }))
    expect(o.offset).toEqual([0, 0])
  })
})
