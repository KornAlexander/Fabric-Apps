import { DAM_CREST_M, DAM_FULL_SUPPLY_M, DAM_MOMENTS } from '@/data/steinbach';

/**
 * The water rising behind the dam — the half of that night that actually happened.
 *
 * ⚠️ Read this before changing anything here. The corridor scene carries two different things on
 * one timeline and they have opposite standing:
 *
 *   **t < 0 — the reservoir filling. This occurred.** The operator's own account gives two levels
 *   and the clock times they were reached: full supply at 16:35, and the crest at 20:00, which is
 *   what "overtopping began" means. Nothing here is hypothetical.
 *
 *   **t ≥ 0 — the dam-break front. This did not occur.** See `steinbachCorridor.ts` and the five
 *   conditions at the top of `src/data/steinbach.ts`.
 *
 * Putting them on one slider is the point: the viewer drags through several hours of a real
 * emergency and arrives at the moment a study had to imagine. The badge changes with the sign,
 * so the two are never presented as the same kind of claim.
 *
 * The interpolation between 16:35 and 20:00 has exactly the standing the corridor front's does:
 * it moves the picture and never becomes a stated figure. The panel quotes 278.7 m and 281.0 m,
 * the two levels that are sourced, and never the value in between.
 */

/** Minute-of-day for a documented moment, or undefined if the id is unknown. */
function momentMinute(id: string): number | undefined {
  return DAM_MOMENTS.find((m) => m.id === id)?.minute;
}

/** 20:00, when the crest was overtopped. The scene's t = 0. */
export const BREAK_CLOCK_MINUTE = momentMinute('overtopping') ?? 20 * 60;

/** 16:35, when the reservoir reached its normal full supply level. */
export const FULL_SUPPLY_CLOCK_MINUTE = momentMinute('fullSupply') ?? 16 * 60 + 35;

/**
 * Where the scene's timeline starts, in minutes relative to the assumed break.
 *
 * Negative because the filling happened before it. −205 is not a chosen number: it is 16:35 to
 * 20:00, the interval between the two levels the operator published.
 */
export const RESERVOIR_START_MINUTES = FULL_SUPPLY_CLOCK_MINUTE - BREAK_CLOCK_MINUTE;

/** Levels in metres above sea level, both sourced. */
export const FULL_SUPPLY_M = DAM_FULL_SUPPLY_M.value;
export const CREST_M = DAM_CREST_M.value;

/**
 * Water level at a scene time, or `null` before the first documented level.
 *
 * ⚠️ Returns null rather than a guess for t < −205. The reservoir obviously held water before
 * 16:35 — it is a reservoir — but no level was published for any earlier time, and drawing a
 * surface there would be inventing one. The scene shows nothing until the first sourced level.
 */
export function reservoirLevelM(minutes: number): number | null {
  if (minutes < RESERVOIR_START_MINUTES) return null;
  if (minutes >= 0) {
    // Overtopping. The crest is a spillway once water is going over it, so the surface cannot
    // climb meaningfully above it however much more arrives — the excess leaves over the top.
    return CREST_M;
  }
  const t = (minutes - RESERVOIR_START_MINUTES) / (0 - RESERVOIR_START_MINUTES);
  return FULL_SUPPLY_M + t * (CREST_M - FULL_SUPPLY_M);
}

/** How far the water stands above full supply, in metres. 0 at 16:35, 2.3 at 20:00. */
export function freeboardUsedM(minutes: number): number {
  const level = reservoirLevelM(minutes);
  return level === null ? 0 : level - FULL_SUPPLY_M;
}

/** True once the water is at the crest and going over it. */
export function isOvertopping(minutes: number): boolean {
  return minutes >= 0;
}

/**
 * Clock label for a scene time, as HH:MM on 14 July.
 *
 * The slider's own unit is minutes-from-the-break, which is the right unit for the scenario and a
 * useless one for the evening: "minus 143 minutes" is not how anyone remembers a night.
 */
export function clockAt(minutes: number): string {
  const total = ((BREAK_CLOCK_MINUTE + minutes) % 1440 + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = Math.round(total % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
