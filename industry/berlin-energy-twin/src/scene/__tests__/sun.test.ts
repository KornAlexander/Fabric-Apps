import { describe, expect, it } from 'vitest'
import { skyColours, sunPosition, sunVector } from '../sun'

// Reference point (the solar maths is location-independent)
const LAT = 48.7784
const LON = 9.1795

/** Highest elevation of the day, by scanning at one-minute steps. */
function solarNoon(dateUtcMidnight: Date) {
  let best = { elevation: -90, azimuth: 0, at: dateUtcMidnight }
  for (let m = 0; m < 24 * 60; m += 1) {
    const t = new Date(dateUtcMidnight.getTime() + m * 60000)
    const p = sunPosition(t, LAT, LON)
    if (p.elevation > best.elevation) best = { ...p, at: t }
  }
  return best
}

describe('solar position at the reference point', () => {
  it('reaches the textbook elevation at the solstices', () => {
    // At solar noon the sun stands at 90 - latitude + declination, and the
    // declination at the solstices is +-23.44 degrees. That is a check against
    // astronomy rather than against my own arithmetic.
    const summer = solarNoon(new Date(Date.UTC(2026, 5, 21)))
    expect(summer.elevation).toBeCloseTo(90 - LAT + 23.44, 0)

    const winter = solarNoon(new Date(Date.UTC(2026, 11, 21)))
    expect(winter.elevation).toBeCloseTo(90 - LAT - 23.44, 0)
  })

  it('is due south at midday and below the horizon at midnight', () => {
    const noon = solarNoon(new Date(Date.UTC(2026, 5, 21)))
    expect(noon.azimuth).toBeGreaterThan(175)
    expect(noon.azimuth).toBeLessThan(185)

    // 01:00 local in June: the sun is down.
    const night = sunPosition(new Date('2026-06-21T23:00:00Z'), LAT, LON)
    expect(night.elevation).toBeLessThan(0)
  })

  it('rises in the east and sets in the west', () => {
    // 06:00 and 19:00 local (CEST = UTC+2) on a summer day.
    const morning = sunPosition(new Date('2026-06-21T04:00:00Z'), LAT, LON)
    const evening = sunPosition(new Date('2026-06-21T17:00:00Z'), LAT, LON)
    expect(morning.azimuth).toBeGreaterThan(45)
    expect(morning.azimuth).toBeLessThan(110)
    expect(evening.azimuth).toBeGreaterThan(250)
    expect(evening.azimuth).toBeLessThan(315)
  })

  it('points the light where the sun is', () => {
    // Due south, 30 degrees up: +z up, -y (southward) and no easting.
    const [x, y, z] = sunVector({ azimuth: 180, elevation: 30 })
    expect(x).toBeCloseTo(0, 5)
    expect(y).toBeCloseTo(-Math.cos(30 * (Math.PI / 180)), 5)
    expect(z).toBeCloseTo(0.5, 5)

    // Due east, on the horizon.
    const [ex, ey] = sunVector({ azimuth: 90, elevation: 0 })
    expect(ex).toBeGreaterThan(0.99)
    expect(ey).toBeCloseTo(0, 2)
  })

  it('never lets the scene go pitch black at night', () => {
    // A demo runs at whatever hour it runs at. The sky may be night; the city
    // still has to be visible, so the light is held just above the horizon.
    const [, , z] = sunVector({ azimuth: 0, elevation: -40 })
    expect(z).toBeGreaterThan(0.05)
  })

  it('warms and darkens the sky as the sun drops', () => {
    const day = skyColours(50)
    const dusk = skyColours(2)
    const night = skyColours(-20)
    expect(day.sky).not.toBe(night.sky)
    // Contrast falls with the sun.
    expect(day.ramp[1]).toBeGreaterThan(dusk.ramp[1])
    // Low sun is warmer: less blue in the light.
    expect(dusk.sunTint[2]).toBeLessThan(day.sunTint[2])
    for (const c of [day, dusk, night]) {
      for (const v of [c.sky, c.horizon, c.fog]) {
        expect(v).toMatch(/^rgb\(\d+,\d+,\d+\)$/)
      }
    }
  })
})
