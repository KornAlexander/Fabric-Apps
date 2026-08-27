/**
 * Local ENU (East-North-Up) projection centred on Circular Quay. Turns
 * lat/lon into a flat metric game world (metres). Accurate enough across the
 * few km of Sydney Ferries; do NOT reuse for all of NSW.
 *
 * Three.js axes: +x = east, +z = south (north maps to -z), y = up.
 */
export const LAT0 = -33.861;
export const LON0 = 151.2105;
const R = 111_320; // metres per degree of latitude
const cosLat0 = Math.cos((LAT0 * Math.PI) / 180);

export interface World {
  x: number;
  z: number;
}

/** lat/lon → world metres. */
export function toWorld(lat: number, lon: number): World {
  const x = (lon - LON0) * cosLat0 * R;
  const z = -(lat - LAT0) * R;
  return { x, z };
}

/** world metres → lat/lon (inverse of toWorld). */
export function toLatLon(x: number, z: number): { lat: number; lon: number } {
  const lon = x / (cosLat0 * R) + LON0;
  const lat = -z / R + LAT0;
  return { lat, lon };
}

/**
 * Heading (radians) so a mesh's +z (bow) points from a → b. The feed has no
 * bearing field, so heading is derived from consecutive samples.
 */
export function headingFromMove(a: World, b: World): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4) return NaN; // stationary
  return Math.atan2(dx, dz);
}
