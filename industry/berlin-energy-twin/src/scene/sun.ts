/**
 * Where the sun actually is over the scene, right now.
 *
 * The scene was lit by a fixed direction picked to look pleasant. That is the
 * one thing in this app that was invented rather than measured, and it shows:
 * the light never matches the clock in the corner, so a demo at nine in the
 * evening was lit like midday. This computes the real solar position, which
 * costs nothing and makes the whole scene agree with itself.
 *
 * NOAA's solar position algorithm, accurate to well under a degree for dates
 * around now - far beyond what a shading direction needs.
 */

const RAD = Math.PI / 180

export type SunPosition = {
  /** degrees above the horizon; negative when the sun has set */
  elevation: number
  /** degrees clockwise from true north */
  azimuth: number
}

/** Days (and fraction) since J2000.0. */
function julianDays(date: Date): number {
  return date.getTime() / 86400000 - 10957.5
}

export function sunPosition(date: Date, latDeg: number, lonDeg: number): SunPosition {
  const d = julianDays(date)

  // Mean anomaly and ecliptic longitude of the sun.
  const g = (357.529 + 0.98560028 * d) * RAD
  const q = 280.459 + 0.98564736 * d
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD

  // Obliquity of the ecliptic.
  const e = (23.439 - 0.00000036 * d) * RAD

  const declination = Math.asin(Math.sin(e) * Math.sin(L))
  let rightAscension = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L))

  // Greenwich mean sidereal time -> local hour angle.
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24
  const lst = (gmst * 15 + lonDeg) * RAD
  rightAscension = ((rightAscension / RAD + 360) % 360) * RAD
  let hourAngle = lst - rightAscension
  // wrap to -pi..pi so the azimuth comes out on the correct side
  hourAngle = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle))

  const lat = latDeg * RAD
  const sinEl =
    Math.sin(lat) * Math.sin(declination) +
    Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle)
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl)))

  const azimuth = Math.atan2(
    -Math.sin(hourAngle),
    Math.tan(declination) * Math.cos(lat) - Math.sin(lat) * Math.cos(hourAngle),
  )

  return {
    elevation: elevation / RAD,
    azimuth: ((azimuth / RAD) % 360 + 360) % 360,
  }
}

/**
 * Sun direction in the scene's own axes: x east, y north, z up.
 *
 * Kept above the horizon for lighting purposes. The demo runs at whatever hour
 * it runs at, and a geometrically honest night sun would render the city as a
 * silhouette - so below a few degrees the light is held just above the horizon
 * and the scene is lit as dusk rather than as pitch dark. The sky colours below
 * still follow the true elevation, so the picture reads as evening.
 */
export function sunVector(pos: SunPosition): [number, number, number] {
  const el = Math.max(pos.elevation, 4) * RAD
  const az = pos.azimuth * RAD
  return [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)]
}

export type SkyColours = {
  sky: string
  horizon: string
  fog: string
  /** warm at low sun, neutral high up */
  sunTint: [number, number, number]
  shadowTint: [number, number, number]
  /** ambient, diffuse */
  ramp: [number, number]
}

function mix(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => v + (b[i] - v) * t)
}

function css(rgb: number[]): string {
  return `rgb(${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v)))).join(',')})`
}

/**
 * Sky, horizon and fog for a given sun elevation.
 *
 * Four anchors - night, dusk, golden, day - interpolated by elevation. Not a
 * physical atmosphere model, and not presented as one: it is stagecraft, and
 * the only part of the lighting that is.
 */
export function skyColours(elevationDeg: number): SkyColours {
  const night = { sky: [16, 24, 46], horizon: [40, 52, 84], fog: [38, 48, 72] }
  const dusk = { sky: [58, 82, 132], horizon: [188, 132, 106], fog: [122, 122, 138] }
  const golden = { sky: [110, 160, 214], horizon: [246, 196, 150], fog: [212, 200, 194] }
  const day = { sky: [106, 176, 245], horizon: [206, 228, 247], fog: [214, 226, 234] }

  let a = night
  let b = dusk
  let t = 0
  const el = elevationDeg
  if (el < -6) {
    a = night
    b = night
    t = 0
  } else if (el < 0) {
    a = night
    b = dusk
    t = (el + 6) / 6
  } else if (el < 10) {
    a = dusk
    b = golden
    t = el / 10
  } else if (el < 30) {
    a = golden
    b = day
    t = (el - 10) / 20
  } else {
    a = day
    b = day
    t = 0
  }

  // Low sun is warm and the shadows go blue; high sun is close to neutral.
  const warmth = Math.max(0, Math.min(1, 1 - Math.max(el, 0) / 30))
  const sunTint: [number, number, number] = [
    1,
    0.98 - 0.14 * warmth,
    0.94 - 0.3 * warmth,
  ]
  const shadowTint: [number, number, number] = [
    0.62 - 0.08 * warmth,
    0.68 - 0.04 * warmth,
    0.82 + 0.04 * warmth,
  ]
  // Less contrast when the sun is low, more when it is overhead.
  const daylight = Math.max(0, Math.min(1, (el + 6) / 26))
  const ramp: [number, number] = [0.5 + 0.14 * daylight, 0.26 + 0.24 * daylight]

  return {
    sky: css(mix(a.sky, b.sky, t)),
    horizon: css(mix(a.horizon, b.horizon, t)),
    fog: css(mix(a.fog, b.fog, t)),
    sunTint,
    shadowTint,
    ramp,
  }
}
