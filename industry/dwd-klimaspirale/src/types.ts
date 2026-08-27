// Shared data types for the Klimaspirale web app.

/** One daily mean-temperature observation. */
export interface DailyTemp {
  /** ISO date string, e.g. "2014-03-21". */
  date: string;
  /** Daily mean air temperature 2 m (°C). May be null for gaps. */
  tMean: number | null;
}

/** One calendar year with its daily observations. */
export interface YearSeries {
  year: number;
  /** Daily values ordered by day-of-year (index 0 = Jan 1). */
  days: DailyTemp[];
}

/** The full dataset the visual renders. */
export interface ClimateDataset {
  /** Human-readable label for the geography in scope (e.g. "Deutschland"). */
  region: string;
  /** Parameter rendered, kept for documentation/traceability. */
  parameter: string;
  years: YearSeries[];
}

/**
 * One geographic region (Germany / a Bundesland / a single station) as a flat
 * monthly-mean-temperature series. `t[i]` is the mean for calendar month
 * `(y0 + Math.floor(i/12))`-`(i%12 + 1)`; `null` marks a gap.
 */
export interface RegionMonthly {
  id: string;
  name: string;
  type: "national" | "bundesland" | "station";
  bundesland?: string;
  lat?: number;
  lon?: number;
  hoehe?: number;
  /** First calendar year of the series. */
  y0: number;
  /** Monthly means (°C) from `y0`-01, length = years * 12; `null` = gap. */
  t: Array<number | null>;
}

/** The multi-region monthly dataset (national + Bundesländer; stations lazy). */
export interface MultiDataset {
  parameter: string;
  /** Reference period for the anomaly baseline (default 1961–1990). */
  baseline?: { from: number; to: number };
  national: RegionMonthly;
  bundeslaender: RegionMonthly[];
  /** Optional inline stations; usually loaded on demand. */
  stations?: RegionMonthly[];
}

// ---------- Germany weather map (interpolated heat map) ----------

/** One weather station's annual series for the interpolated map. */
export interface WeatherStation {
  id: string;
  name: string;
  /** Bundesland name. */
  bl: string;
  lat: number;
  lon: number;
  /** First year of `v`. */
  y0: number;
  /** Mean annual value over the baseline period (reference for the anomaly). */
  base: number;
  /** Annual values from `y0`; `null` = gap. */
  v: Array<number | null>;
}

/** One mappable parameter (temperature, precipitation, …) with its stations. */
export interface WeatherParam {
  /** Display label, e.g. "Temperatur". */
  label: string;
  /** Physical unit, e.g. "°C". */
  unit: string;
  /** `abs` = absolute anomaly (value − base); `pct` = percent of base. */
  mode: "abs" | "pct";
  /** Anomaly magnitude that maps to the full colour intensity. */
  scale: number;
  /** Annual aggregation used (mean / sum), kept for documentation. */
  agg: string;
  stations: WeatherStation[];
}

/** The full multi-parameter weather-map dataset. */
export interface WeatherMapDoc {
  /** `[minYear, maxYear]` covered across all parameters. */
  years: [number, number];
  /** Reference period for the per-station baseline. */
  baseline: { from: number; to: number };
  /** Parameter key (`temp`/`precip`/`sun`/`wind`) → its data. */
  params: Record<string, WeatherParam>;
}

/** One Bundesland outline: array of polygons, each an array of rings of [lon,lat]. */
export interface GeoState {
  id: string;
  name: string;
  polys: number[][][][];
}

/** Simplified Germany outline (Bundesländer) for clipping and borders. */
export interface GeoData {
  /** `[minLon, minLat, maxLon, maxLat]`. */
  bbox: [number, number, number, number];
  states: GeoState[];
}

/** A single point on the spiral, already projected to screen space. */
export interface SpiralPoint {
  year: number;
  /** Day-of-year, 1..366. */
  dayOfYear: number;
  /** Angle in radians (0 = Jan, clockwise). */
  angle: number;
  /** Radius in SVG units. */
  radius: number;
  /** The 30-day rolling mean that drives this point's radius (°C). */
  rollingMean: number;
  /** Normalised temperature 0..1 (0 = coldest, 1 = warmest). */
  norm: number;
  /** rgb(...) colour string. */
  color: string;
  x: number;
  y: number;
}

/** One drawn ring (a single year) for the black-hole phase. */
export interface YearRing {
  year: number;
  /** Yearly mean temperature (°C). */
  yearMean: number;
  /** Normalised 0..1. */
  norm: number;
  /** Radius in SVG units (continuous, scaled by temperature). */
  radius: number;
  color: string;
  /** 0-based index of the year within the dataset. */
  index: number;
}
