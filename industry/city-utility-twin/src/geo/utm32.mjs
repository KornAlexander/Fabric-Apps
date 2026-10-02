/**
 * WGS84 → UTM zone 32N (EPSG:25832), the working CRS of every asset in this app.
 *
 * ⚠️ THIS IS A PORT, NOT A NEW IMPLEMENTATION. `tools/geodata/utm.py` projects the terrain, the
 * buildings and the land cover at build time; anything the browser places on top of them — live
 * aircraft, construction sites, transport stops — has to land in the same grid or it will look
 * plausible and be tens of metres out. The constants and the series below are the same ones, and
 * `tests/geo.test.mjs` checks this file against values produced by that Python module rather than
 * against values I believe to be right.
 *
 * ⚠️ IT IS A `.mjs` SO THE TEST CAN IMPORT IT DIRECTLY, the same reason `src/assets/reader.mjs`
 * is. A projection that only runs inside a bundler is a projection that only gets checked by
 * looking at the screen.
 *
 * Accuracy: the three-term Krüger series is good to well under a millimetre inside a zone, orders
 * of magnitude finer than anything this app draws. No proj4 dependency, for the same reason the
 * pipeline has none.
 */

/** GRS80 / WGS84 semi-major axis, in metres. */
const A = 6378137.0;
/** GRS80 flattening. */
const F = 1 / 298.257223563;
/** UTM scale factor on the central meridian. */
const K0 = 0.9996;
const FALSE_EASTING = 500000;
/** Central meridian of zone 32. */
const LON_ORIGIN = 9;

const N = F / (2 - F);
const N2 = N * N;
const N3 = N2 * N;
const N4 = N3 * N;

/** Rectifying radius. */
const A_HAT = (A / (1 + N)) * (1 + N2 / 4 + N4 / 64);

/** Krüger series coefficients, geodetic → transverse Mercator. */
const ALPHA = [
  N / 2 - (2 / 3) * N2 + (5 / 16) * N3,
  (13 / 48) * N2 - (3 / 5) * N3,
  (61 / 240) * N3,
];

const DEG = Math.PI / 180;
const SQRT_N_TERM = (2 * Math.sqrt(N)) / (1 + N);

/**
 * Project a geographic coordinate into EPSG:25832.
 *
 * ⚠️ THE ZONE IS FIXED AT 32 ON PURPOSE. Bavaria publishes the whole state in zone 32 even where
 * it runs past 12°E, so a "pick the zone from the longitude" helper would be *more* correct in
 * general and wrong here: it would put anything east of 12°E into zone 33, several hundred
 * kilometres from the terrain it is supposed to sit on. This app has exactly one grid.
 *
 * @param {number} latDeg
 * @param {number} lonDeg
 * @returns {{ easting: number, northing: number }}
 */
export function wgs84ToUtm32(latDeg, lonDeg) {
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) {
    throw new Error('Cannot project a non-finite coordinate.');
  }
  const lat = latDeg * DEG;
  const lon = (lonDeg - LON_ORIGIN) * DEG;

  const sinLat = Math.sin(lat);
  const t = Math.sinh(Math.atanh(sinLat) - SQRT_N_TERM * Math.atanh(SQRT_N_TERM * sinLat));
  const xiPrime = Math.atan(t / Math.cos(lon));
  const etaPrime = Math.atanh(Math.sin(lon) / Math.sqrt(1 + t * t));

  let xi = xiPrime;
  let eta = etaPrime;
  for (let j = 1; j <= 3; j++) {
    xi += ALPHA[j - 1] * Math.sin(2 * j * xiPrime) * Math.cosh(2 * j * etaPrime);
    eta += ALPHA[j - 1] * Math.cos(2 * j * xiPrime) * Math.sinh(2 * j * etaPrime);
  }

  return {
    easting: FALSE_EASTING + K0 * A_HAT * eta,
    // Northern hemisphere: no false northing.
    northing: K0 * A_HAT * xi,
  };
}
