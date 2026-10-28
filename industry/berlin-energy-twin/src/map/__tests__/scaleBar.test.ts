import { describe, expect, it } from 'vitest'
import { metresPerPixel, niceDistance, scaleLabel } from '../scaleBar'

describe('scale bar', () => {
  it('measures Berlin at zoom 16 at about 1.45 m per 256-pixel tile pixel, so 0.73 m per CSS pixel', () => {
    expect(metresPerPixel(16, 52.5)).toBeCloseTo(0.727, 2)
  })

  it('never answers NaN, whatever the pitch: it only reads zoom and latitude', () => {
    for (let z = 0; z <= 22; z += 0.5) expect(Number.isFinite(metresPerPixel(z, 52.5))).toBe(true)
  })

  it('rounds to 1, 2, 3 or 5 steps and labels km from 1000 m', () => {
    expect(niceDistance(47)).toBe(30)
    expect(niceDistance(51)).toBe(50)
    expect(niceDistance(2400)).toBe(2000)
    expect(scaleLabel(2000)).toBe('2 km')
    expect(scaleLabel(30)).toBe('30 m')
  })
})
