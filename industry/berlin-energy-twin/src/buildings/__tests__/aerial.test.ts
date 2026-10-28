import { describe, expect, it } from 'vitest'
import {
  aerialFade,
  boundsSizeM,
  fillsViewportAtZoom,
  metresPerPixel,
  PLANNED_VIEWPORT_PX,
  SCENE_LAT,
} from '../aerial'

describe('metres per pixel', () => {
  it('is the Web Mercator resolution at the equator', () => {
    expect(metresPerPixel(0, 0)).toBeCloseTo(156543.03392, 3)
    expect(metresPerPixel(1, 0)).toBeCloseTo(156543.03392 / 2, 3)
  })

  it('shrinks with latitude, because Mercator stretches', () => {
    expect(metresPerPixel(12, 48.78)).toBeLessThan(metresPerPixel(12, 0))
  })
})

describe('bounds size', () => {
  it('measures a rectangle in metres at its own latitude', () => {
    const { widthM, heightM } = boundsSizeM({
      west: 9.0,
      east: 9.1,
      south: 48.7,
      north: 48.8,
    })
    // 0.1 deg of latitude is ~11.05 km anywhere; 0.1 deg of longitude is less,
    // and at 48.75 deg it is about two thirds of that.
    expect(heightM).toBeCloseTo(11054, 0)
    expect(widthM).toBeGreaterThan(7000)
    expect(widthM).toBeLessThan(7500)
  })
})

describe('when a patch may appear', () => {
  it('lets a wider patch appear sooner', () => {
    const wide = fillsViewportAtZoom(30_000, 30_000)
    const narrow = fillsViewportAtZoom(2_000, 2_000)
    expect(wide).toBeLessThan(narrow)
  })

  it('decides on the SHORTER side, because that is the edge you see first', () => {
    // A patch 2 km wide and 8 km tall still shows its left and right edges.
    expect(fillsViewportAtZoom(2_000, 8_000)).toBeCloseTo(fillsViewportAtZoom(2_000, 2_000), 6)
  })

  it('really does fill the planned viewport at that zoom', () => {
    const sizeM = 5_000
    const z = fillsViewportAtZoom(sizeM, sizeM)
    expect(metresPerPixel(z, SCENE_LAT) * PLANNED_VIEWPORT_PX).toBeCloseTo(sizeM, 0)
  })

  it('gives a ramp that ends fully on and starts fully off', () => {
    // A 6 x 4 km patch around Alexanderplatz.
    const ramp = aerialFade({ west: 13.365, east: 13.453, south: 52.502, north: 52.538 }) as unknown[]
    expect(ramp[0]).toBe('interpolate')
    expect(ramp[ramp.length - 1]).toBe(1)
    expect(ramp[ramp.length - 3]).toBe(0)
    // half a zoom level of fade, so it arrives already edge to edge
    expect((ramp[ramp.length - 2] as number) - (ramp[ramp.length - 4] as number)).toBeCloseTo(
      0.5,
      6,
    )
  })
})
