/**
 * Clip a polyline to the modelled core.
 *
 * ⚠️ EXTRACTED SO IT CAN BE TESTED, BECAUSE THE FIRST VERSION WAS WRONG IN A WAY NOTHING CAUGHT.
 * It searched for a boundary crossing only when exactly one endpoint was inside, so a segment
 * with BOTH ends outside was discarded even when it crossed the entire core. Route geometry is
 * sparse where a line runs straight, which is exactly where such segments occur, and the failure
 * is invisible: a missing piece of a tram route looks like a tram route.
 *
 * Liang-Barsky solves the entry and exit parameters for every segment, so a crossing survives
 * whatever its endpoints do.
 *
 * ⚠️ THIS CLIPS A CENTRELINE. The caller widens the result into a ribbon afterwards, so a drawn
 * vertex can lie up to half a ribbon width beyond the boundary. At the widths used here, under
 * 7 m against a 3.25 km core, that is immaterial, but it is not the claim "nothing is drawn
 * outside the core".
 */

/**
 * @typedef {[number, number]} Position  easting, northing in EPSG:25832
 * @typedef {{ minE: number, minN: number, maxE: number, maxN: number }} Box
 */

/**
 * @param {Position[]} points
 * @param {Box | null} box
 * @returns {Position[][]} the runs lying inside the box, in order
 */
export function clipPolylineToBox(points, box) {
  if (!Array.isArray(points) || points.length < 2) return [];
  if (!box) return [points];

  const runs = [];
  let current = [];

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const p = [-dx, dx, -dy, dy];
    const q = [a[0] - box.minE, box.maxE - a[0], a[1] - box.minN, box.maxN - a[1]];

    let t0 = 0;
    let t1 = 1;
    let outside = false;
    for (let edge = 0; edge < 4; edge++) {
      if (p[edge] === 0) {
        // Parallel to this edge. Outside it means the whole segment is outside.
        if (q[edge] < 0) { outside = true; break; }
        continue;
      }
      const r = q[edge] / p[edge];
      if (p[edge] < 0) {
        if (r > t1) { outside = true; break; }
        if (r > t0) t0 = r;
      } else {
        if (r < t0) { outside = true; break; }
        if (r < t1) t1 = r;
      }
    }

    if (outside) {
      if (current.length >= 2) runs.push(current);
      current = [];
      continue;
    }

    const start = [a[0] + t0 * dx, a[1] + t0 * dy];
    const end = [a[0] + t1 * dx, a[1] + t1 * dy];

    // The piece continues the current run only if it begins where the previous one ended, which
    // for consecutive segments means it was not clipped at its own start.
    if (current.length === 0 || t0 > 0) {
      if (current.length >= 2) runs.push(current);
      current = [start, end];
    } else {
      current.push(end);
    }

    // Clipped at its end: the line leaves the core here, so the run stops.
    if (t1 < 1) {
      runs.push(current);
      current = [];
    }
  }

  if (current.length >= 2) runs.push(current);
  return runs;
}
