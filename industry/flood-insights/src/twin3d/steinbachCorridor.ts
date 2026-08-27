/**
 * The Steinbachtalsperre corridor — geometry for the dam-break scenario.
 *
 * ⚠️ Read `src/data/steinbach.ts` first. It sets the rule this file works under: **the break did
 * not happen**, and this application does not compute a dam failure of its own. Everything here
 * renders the Hydrotec study that was presented to the Wasserversorgungsverband on 28 September
 * 2022. Nothing here derives a new hydraulic result.
 *
 * What that permits, and what it forbids
 * --------------------------------------
 * The study published an arrival time for three places along the corridor. Those three points
 * describe one coherent wave — measured against the real distances, the front runs at 5.6 m/s to
 * Schweinheim and decelerates to about 1.5 m/s by Heimerzheim, which is what a dam-break front
 * does as it spreads and shallows, and sits sensibly above the 3 m/s *flow* velocity the study
 * gives for Schweinheim itself. So a front position can be interpolated between them for the
 * animation.
 *
 * 🔴 **Interpolation drives the picture. It never becomes a stated figure.** The front sweeps
 * past Palmersheim because a continuous wave must, but Palmersheim's arrival time stays unknown,
 * because the study gave a depth there and no time. An earlier draft of the data module filled
 * that gap with a plausible-looking 30 minutes; `publishedArrivalMinutes` exists so the same
 * mistake cannot be made through the back door of a renderer. `steinbachCorridor.test.ts` pins it.
 */

import { DAM_BREAK_SCENARIO } from '@/data/steinbach';

/** A point on the corridor, in WGS84, with its distance along the flow path. */
export interface CorridorPlace {
  id: string;
  name: string;
  lon: number;
  lat: number;
  /** Distance from the dam along the flow path, in kilometres. */
  kmFromDam: number;
  /**
   * Ground elevation in metres, sampled from EU-DEM at 25 m.
   *
   * ⚠️ Indicative, not the render surface. The scene draws the 20 m NRW raster in
   * `public/terrain/steinbach-2021`, and the two disagree by up to 25 m where a place sits on a
   * valley side — two point samples on sloping ground at different grid sizes. Endpoints agree
   * to under 5 m, so this is resampling rather than a georeferencing error. A marker must take
   * its height from the raster, not from here, or it will float or sink on the hillsides.
   */
  groundM: number;
  /** Evacuated on the night of 14–15 July 2021. A fact about what happened, not about the model. */
  evacuated: boolean;
}

/**
 * The dam itself.
 *
 * Coordinates from OpenStreetMap, cross-checked against the distance the data module states: it
 * says the dam stands 13.7 km from Altenahr, and these coordinates put it at 13.6 km. Two
 * independent statements agreeing to 100 m is the reason this is worth writing down.
 */
export const DAM = {
  id: 'steinbachtalsperre',
  name: 'Steinbachtalsperre',
  lon: 6.83748,
  lat: 50.59070,
  groundM: 277,
} as const;

/**
 * The places the water would have passed, in the order it would have reached them.
 *
 * The flow leaves the dam as the Steinbach and runs Orbach → Jungbach → Swist, away from the Ahr.
 * Distances are great-circle from the dam, which under-reads a meandering stream slightly; they
 * are used for ordering and for placing the front, never presented as channel lengths.
 */
export const CORRIDOR: CorridorPlace[] = [
  { id: 'schweinheim', name: 'Schweinheim', lon: 6.86946, lat: 50.61331, kmFromDam: 3.4, groundM: 190, evacuated: true },
  { id: 'flamersheim', name: 'Flamersheim', lon: 6.85099, lat: 50.62396, kmFromDam: 3.9, groundM: 184, evacuated: true },
  { id: 'palmersheim', name: 'Palmersheim', lon: 6.85897, lat: 50.63708, kmFromDam: 5.2, groundM: 175, evacuated: true },
  { id: 'odendorf', name: 'Odendorf', lon: 6.88266, lat: 50.64801, kmFromDam: 7.1, groundM: 160, evacuated: false },
  { id: 'heimerzheim', name: 'Heimerzheim', lon: 6.91359, lat: 50.71697, kmFromDam: 15.0, groundM: 132, evacuated: false },
];

/** Distance at which the corridor ends, so the front has somewhere to stop. */
export const CORRIDOR_LENGTH_KM = CORRIDOR[CORRIDOR.length - 1].kmFromDam;

/**
 * The only arrival times that exist: the ones the study published.
 *
 * Built from `DAM_BREAK_SCENARIO` rather than restated, so there is exactly one place in the
 * codebase where a travel time can be added, and it is the one that carries the source citation.
 */
export const FRONT_CONTROL_POINTS: { km: number; minutes: number }[] = [
  { km: 0, minutes: 0 },
  ...DAM_BREAK_SCENARIO.flatMap((place) => {
    const onCorridor = CORRIDOR.find((c) => c.id === place.id);
    return onCorridor && place.travelMinutes !== undefined
      ? [{ km: onCorridor.kmFromDam, minutes: place.travelMinutes }]
      : [];
  }),
].sort((a, b) => a.km - b.km);

/**
 * The arrival time the study published for a place, or undefined where it published none.
 *
 * The gap is the point. Palmersheim has a modelled depth and no modelled time, and this returns
 * undefined for it however convenient a number would be.
 */
export function publishedArrivalMinutes(placeId: string): number | undefined {
  return DAM_BREAK_SCENARIO.find((p) => p.id === placeId)?.travelMinutes;
}

/**
 * How far the front has travelled, in kilometres, `minutes` after the assumed failure.
 *
 * Piecewise-linear between the published control points. Before the failure it has not started;
 * after the last control point it stops at the end of the corridor rather than running on into
 * terrain the study says nothing about.
 */
export function frontKmAt(minutes: number): number {
  if (minutes <= 0) return 0;
  const pts = FRONT_CONTROL_POINTS;
  const last = pts[pts.length - 1];
  if (minutes >= last.minutes) return last.km;

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (minutes <= b.minutes) {
      const span = b.minutes - a.minutes;
      const k = span > 0 ? (minutes - a.minutes) / span : 1;
      return a.km + (b.km - a.km) * k;
    }
  }
  return last.km;
}

/**
 * Front celerity in m/s on the leg containing `minutes`.
 *
 * Reported so the deceleration is visible in the interface rather than implied: a viewer who sees
 * the front slow from 5.6 m/s to 1.5 m/s is reading the study's own result, which is also the
 * reason the downstream villages had time that Schweinheim did not.
 */
export function frontCelerityMs(minutes: number): number {
  const pts = FRONT_CONTROL_POINTS;
  const last = pts[pts.length - 1];
  if (minutes <= 0 || minutes > last.minutes) return 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (minutes <= b.minutes) {
      const dtSeconds = (b.minutes - a.minutes) * 60;
      return dtSeconds > 0 ? ((b.km - a.km) * 1000) / dtSeconds : 0;
    }
  }
  return 0;
}

/** Whether the front has reached a place, for the animation only. */
export function frontHasReached(placeId: string, minutes: number): boolean {
  const place = CORRIDOR.find((c) => c.id === placeId);
  return place ? frontKmAt(minutes) >= place.kmFromDam : false;
}

/**
 * The corridor's bounding box, for framing the camera and for requesting terrain.
 *
 * Padded by roughly a kilometre so the valley sides are in shot rather than clipped at the
 * settlements.
 */
export function corridorBounds(padDegrees = 0.012) {
  const lons = [DAM.lon, ...CORRIDOR.map((c) => c.lon)];
  const lats = [DAM.lat, ...CORRIDOR.map((c) => c.lat)];
  return {
    west: Math.min(...lons) - padDegrees,
    east: Math.max(...lons) + padDegrees,
    south: Math.min(...lats) - padDegrees,
    north: Math.max(...lats) + padDegrees,
  };
}
