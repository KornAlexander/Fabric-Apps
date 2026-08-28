/**
 * WGS84 → UTM, any northern-hemisphere zone, without a projection library.
 *
 * A direct port of `tools/geodata/utm.py`, and it has to stay one: the terrain grid is generated
 * by the Python side and everything drawn on it is placed by this one. If the two projections
 * disagree by so much as a few metres, geometry drifts off the ground it actually sits on —
 * which is invisible from the code and obvious in the render.
 *
 * Transverse Mercator on the GRS80/WGS84 ellipsoid (Krüger series, 6th order), which is what
 * EPSG:258xx uses. Accurate to a few millimetres across a UTM zone.
 *
 * ⚠️ THE ZONE IS AN ARGUMENT, NOT A CONSTANT. This file used to hard-code zone 32, which was true
 * of every site until TU Berlin (EPSG:25833). The zone comes from the AOI's `workingCrs`, and it
 * is required rather than defaulted: a default of 32 would silently mis-place the whole Berlin
 * campus, and the Python side made the same call for the same reason.
 *
 * ⚠️ A ZONE IS NOT DECIDED BY LONGITUDE. Bavaria publishes the entire state in zone 32 although it
 * reaches 13.8°E, so OTH Regensburg at 12.10°E is correctly EPSG:25832 even though the textbook
 * zone there is 33. Always read the AOI, never compute the zone from the coordinate.
 */

const A = 6378137.0;
const F = 1 / 298.257222101;
const N = F / (2 - F);

const K0 = 0.9996;
const FALSE_EASTING = 500000.0;
const FALSE_NORTHING = 0.0;

/** Central meridian of a UTM zone, in radians. Zone 32 → 9°E, zone 33 → 15°E. */
function lonOrigin(zone: number): number {
  return ((6 * zone - 183) * Math.PI) / 180;
}

/**
 * Read the UTM zone out of an ETRS89 (EPSG:258xx) or WGS84 (EPSG:326xx) UTM code.
 *
 * Throws rather than guessing. A CRS this function cannot read means the AOI config is wrong, and
 * a guessed zone would place a campus in the wrong country while looking entirely plausible.
 * Mirrors `crs_to_zone` in `tools/geodata/utm.py`.
 */
export function crsToZone(crs: string): number {
  const match = /^(?:EPSG:)?(?:258|326)(\d{2})$/i.exec(crs.trim());
  if (!match) {
    throw new Error(
      `Cannot read a UTM zone from CRS "${crs}". Expected an ETRS89 (EPSG:258xx) or ` +
        `WGS84 (EPSG:326xx) UTM zone code, e.g. "EPSG:25832" for zone 32.`
    );
  }
  return Number(match[1]);
}

const A_BAR = (A / (1 + N)) * (1 + N ** 2 / 4 + N ** 4 / 64);
const ALPHA = [
  N / 2 - (2 / 3) * N ** 2 + (5 / 16) * N ** 3,
  (13 / 48) * N ** 2 - (3 / 5) * N ** 3,
  (61 / 240) * N ** 3,
];

export interface Utm {
  easting: number;
  northing: number;
}

export function wgs84ToUtm(lon: number, lat: number, zone: number): Utm {
  const phi = (lat * Math.PI) / 180;
  const lambda = (lon * Math.PI) / 180 - lonOrigin(zone);

  const t = Math.sinh(
    Math.atanh(Math.sin(phi)) -
      ((2 * Math.sqrt(N)) / (1 + N)) * Math.atanh(((2 * Math.sqrt(N)) / (1 + N)) * Math.sin(phi))
  );
  const xi = Math.atan(t / Math.cos(lambda));
  const eta = Math.atanh(Math.sin(lambda) / Math.sqrt(1 + t * t));

  let easting = K0 * A_BAR * eta;
  let northing = K0 * A_BAR * xi;
  ALPHA.forEach((alpha, index) => {
    const j = index + 1;
    easting += K0 * A_BAR * alpha * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    northing += K0 * A_BAR * alpha * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  });

  return { easting: easting + FALSE_EASTING, northing: northing + FALSE_NORTHING };
}
