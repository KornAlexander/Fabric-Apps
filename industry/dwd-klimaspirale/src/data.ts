// Data loading + the 30-day rolling average that drives the inward collapse.

import type { ClimateDataset, DailyTemp, MultiDataset, RegionMonthly, YearSeries, WeatherMapDoc, GeoData } from "./types.js";

/**
 * Centred 30-day rolling mean of the daily temperature series.
 *
 * This is the value that scales the inward movement of the spiral (Part B):
 * instead of a binary "is this year warmer than the last" decision, every day
 * is placed on the spiral according to its smoothed 30-day average.
 *
 * @param days   ordered daily values for a single year
 * @param window window length in days (default 30)
 */
export function rollingMean(days: DailyTemp[], window = 30): number[] {
  const n = days.length;
  const out = new Array<number>(n).fill(NaN);
  const half = Math.floor(window / 2);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j < 0 || j >= n) continue;
      const v = days[j].tMean;
      if (v === null || Number.isNaN(v)) continue;
      sum += v;
      count++;
    }
    out[i] = count > 0 ? sum / count : NaN;
  }
  return out;
}

/** Arithmetic mean of a year's daily values, ignoring gaps. */
export function yearMean(year: YearSeries): number {
  let sum = 0;
  let count = 0;
  for (const d of year.days) {
    if (d.tMean === null || Number.isNaN(d.tMean)) continue;
    sum += d.tMean;
    count++;
  }
  return count > 0 ? sum / count : NaN;
}

/** Global min / max of the 30-day rolling means across the whole dataset. */
export function rollingExtent(data: ClimateDataset): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const y of data.years) {
    for (const v of rollingMean(y.days)) {
      if (Number.isNaN(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  return { min, max };
}

/** Global min / max of yearly mean temperatures. */
export function yearMeanExtent(data: ClimateDataset): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const y of data.years) {
    const m = yearMean(y);
    if (Number.isNaN(m)) continue;
    if (m < min) min = m;
    if (m > max) max = m;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  return { min, max };
}

/**
 * Load a {@link ClimateDataset} from a JSON URL. Falls back to the bundled
 * sample data when the fetch fails (e.g. opened from the file system).
 */
export async function loadDataset(url: string): Promise<ClimateDataset> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as ClimateDataset;
  } catch (err) {
    console.warn(`Klimaspirale: falling back to generated sample data (${String(err)})`);
    return generateSampleDataset();
  }
}

/**
 * Load the multi-region monthly {@link MultiDataset} (national + Bundesländer)
 * from a JSON URL. Throws on failure so the caller can fall back to the daily
 * sample path.
 */
export async function loadMultiDataset(url: string): Promise<MultiDataset> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const doc = (await res.json()) as Partial<MultiDataset>;
  if (!doc.national || !Array.isArray(doc.bundeslaender)) {
    throw new Error("not a MultiDataset");
  }
  return doc as MultiDataset;
}

/** Lazily load the per-station monthly series (large; fetched on first use). */
export async function loadStations(url: string): Promise<RegionMonthly[]> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const doc = (await res.json()) as { stations?: RegionMonthly[] };
  return doc.stations ?? [];
}

/** Lazily load the multi-parameter weather-map dataset (temp/precip/sun/wind). */
export async function loadWeatherMap(url: string): Promise<WeatherMapDoc> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const doc = (await res.json()) as Partial<WeatherMapDoc>;
  if (!doc.params || !doc.years) throw new Error("not a WeatherMapDoc");
  return doc as WeatherMapDoc;
}

/** Load the simplified Germany outline (Bundesländer) for clipping + borders. */
export async function loadGermany(url: string): Promise<GeoData> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const doc = (await res.json()) as Partial<GeoData>;
  if (!doc.bbox || !Array.isArray(doc.states)) throw new Error("not a GeoData");
  return doc as GeoData;
}

/**
 * Deterministic, realistic-looking sample dataset: a seasonal daily cycle plus
 * a long-term warming trend and mild year-to-year noise. Used as a fallback so
 * the visual runs stand-alone without a data export. Replace with a real export
 * from the semantic model (see README) for production use.
 */
export function generateSampleDataset(
  startYear = 1995,
  endYear = 2024
): ClimateDataset {
  // Simple seeded PRNG (mulberry32) for reproducibility.
  let seed = 0x9e3779b9;
  const rand = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const years: YearSeries[] = [];
  for (let year = startYear; year <= endYear; year++) {
    const yearsIn = year - startYear;
    // ~0.04 °C per year warming trend + small per-year anomaly.
    const trend = 0.04 * yearsIn;
    const anomaly = (rand() - 0.5) * 1.2;
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const dayCount = leap ? 366 : 365;
    const days: DailyTemp[] = [];
    for (let doy = 1; doy <= dayCount; doy++) {
      // Seasonal cycle: coldest mid-January, warmest mid-July.
      const seasonal = -Math.cos((2 * Math.PI * (doy - 15)) / dayCount);
      const base = 9.5 + 8.5 * seasonal; // German-ish annual range
      const weather = (rand() - 0.5) * 5; // daily weather noise
      days.push({
        date: isoDate(year, doy),
        tMean: round1(base + trend + anomaly + weather),
      });
    }
    years.push({ year, days });
  }
  return { region: "Deutschland (Beispiel)", parameter: "temperature_air_mean_2m", years };
}

function isoDate(year: number, dayOfYear: number): string {
  const d = new Date(Date.UTC(year, 0, dayOfYear));
  return d.toISOString().slice(0, 10);
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
