// Geometry + colour: turns temperatures into spiral points and yearly rings.
//
// Part B: the inward movement is scaled *continuously* by temperature. The
// radius is a linear function of the (normalised) 30-day rolling average for
// per-day points, and of the yearly mean for the year rings — never the old
// binary "count of warming years" step.

import type {
  ClimateDataset,
  SpiralPoint,
  YearRing,
  YearSeries,
} from "./types.js";
import {
  rollingExtent,
  rollingMean,
  yearMean,
  yearMeanExtent,
} from "./data.js";

export interface SpiralConfig {
  /** Outer radius (coldest) in SVG units. */
  baseR: number;
  /** Inner radius (warmest) — the rim of the black hole. */
  minR: number;
  cx: number;
  cy: number;
}

export const DEFAULT_CONFIG: SpiralConfig = {
  baseR: 360,
  minR: 70,
  cx: 450,
  cy: 450,
};

/** Linear normalisation to 0..1 with a guarded span. */
export function normalise(value: number, min: number, max: number): number {
  const span = Math.max(max - min, 1e-4);
  return clamp01((value - min) / span);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Map a normalised temperature to a radius. Warmer (norm → 1) collapses inward
 * toward {@link SpiralConfig.minR}; colder (norm → 0) sits at the outer rim.
 * This is the heart of the Part B change: radius scales with the temperature
 * value, not with a per-year warm/cool decision.
 */
export function radiusForNorm(norm: number, cfg: SpiralConfig): number {
  return cfg.minR + (cfg.baseR - cfg.minR) * (1 - clamp01(norm));
}

/**
 * Ed-Hawkins-style blue → red ramp. norm 0 = cool blue, 0.5 = magenta,
 * 1 = hot red.
 */
export function colorForNorm(norm: number): string {
  const f = clamp01(norm);
  const r = Math.round(36 + 219 * f);
  const g = Math.round(70 * (1 - Math.abs(f - 0.5) * 2));
  const b = Math.round(255 - 219 * f);
  return `rgb(${r},${g},${b})`;
}

/** Build one ring per year, radius scaled continuously by the yearly mean. */
export function buildYearRings(
  data: ClimateDataset,
  cfg: SpiralConfig = DEFAULT_CONFIG
): YearRing[] {
  const { min, max } = yearMeanExtent(data);
  return data.years
    .map((y, index) => {
      const m = yearMean(y);
      const norm = normalise(m, min, max);
      return {
        year: y.year,
        yearMean: m,
        norm,
        radius: radiusForNorm(norm, cfg),
        color: colorForNorm(norm),
        index,
      } satisfies YearRing;
    })
    .filter((r) => !Number.isNaN(r.yearMean));
}

/**
 * Build the per-day spiral path. The angle winds once per year (Jan at top,
 * clockwise); the radius is driven by each day's 30-day rolling average so the
 * curve drifts inward through warm spells and outward through cold ones.
 */
export function buildSpiralPoints(
  data: ClimateDataset,
  cfg: SpiralConfig = DEFAULT_CONFIG
): SpiralPoint[] {
  const { min, max } = rollingExtent(data);
  const points: SpiralPoint[] = [];
  for (const y of data.years) {
    const roll = rollingMean(y.days);
    const dayCount = y.days.length;
    for (let i = 0; i < dayCount; i++) {
      const rm = roll[i];
      if (Number.isNaN(rm)) continue;
      const norm = normalise(rm, min, max);
      const radius = radiusForNorm(norm, cfg);
      // Jan 1 at top (-90°), clockwise through the year.
      const angle = (2 * Math.PI * i) / dayCount - Math.PI / 2;
      points.push({
        year: y.year,
        dayOfYear: i + 1,
        angle,
        radius,
        rollingMean: rm,
        norm,
        color: colorForNorm(norm),
        x: cfg.cx + radius * Math.cos(angle),
        y: cfg.cy + radius * Math.sin(angle),
      });
    }
  }
  return points;
}

/** Convenience: how many distinct years carry data. */
export function yearCount(years: YearSeries[]): number {
  return years.filter((y) => !Number.isNaN(yearMean(y))).length;
}
