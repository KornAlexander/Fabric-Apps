// engine.ts — Interactive multi-projection Klimaspirale on Canvas 2D.
// Three alignment views inspired by NASA SVS (tilted spiral + vertical funnel)
// and spren9er's climate-spiral (diverging colour, centre readout, media controls).
import type { ClimateDataset, MultiDataset, RegionMonthly, WeatherMapDoc, WeatherParam, GeoData } from "./types.js";

export interface MonthAnomaly {
  t: number; // absolute month index from first year (0-based, includes gaps)
  year: number;
  month: number; // 0..11
  a: number; // anomaly vs per-calendar-month baseline
}

export interface AnomalySeries {
  region: string;
  parameter: string;
  points: MonthAnomaly[];
  years: number[];
  yearMean: Record<number, number>;
  yearIndex: Record<number, number>;
  aMax: number;
  totalMonths: number;
}

type View = "spiral" | "vertical" | "horizontal" | "stripes" | "karte";

interface State {
  progress: number; // cursor in absolute months (float)
  playing: boolean;
  speed: number;
  view: View;
  tilt: number; // degrees
}

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const SPEEDS = [0.25, 0.5, 1, 2, 4];
const BASE_RATE = 14; // months per second at 1x

// ---------- data ----------

export function buildMonthlyAnomalies(data: ClimateDataset): AnomalySeries {
  const mm = new Map<number, number[]>();
  for (const y of data.years) {
    const sums = new Array(12).fill(0);
    const cnt = new Array(12).fill(0);
    for (const d of y.days) {
      if (d.tMean === null || Number.isNaN(d.tMean)) continue;
      const m = parseInt(d.date.slice(5, 7), 10) - 1;
      if (m < 0 || m > 11) continue;
      sums[m] += d.tMean;
      cnt[m] += 1;
    }
    mm.set(y.year, sums.map((s, m) => (cnt[m] > 0 ? s / cnt[m] : NaN)));
  }

  const base = new Array(12).fill(0);
  const bcnt = new Array(12).fill(0);
  for (const arr of mm.values()) {
    for (let m = 0; m < 12; m++) {
      if (!Number.isNaN(arr[m])) {
        base[m] += arr[m];
        bcnt[m] += 1;
      }
    }
  }
  const bm = base.map((s, m) => (bcnt[m] > 0 ? s / bcnt[m] : 0));

  const years = [...mm.keys()].sort((a, b) => a - b);
  const points: MonthAnomaly[] = [];
  const yearMean: Record<number, number> = {};
  const yearIndex: Record<number, number> = {};
  let aMax = 0;
  let t = 0;
  years.forEach((yr, idx) => {
    yearIndex[yr] = idx;
    const arr = mm.get(yr)!;
    let ys = 0;
    let yc = 0;
    for (let m = 0; m < 12; m++) {
      const a = arr[m] - bm[m];
      if (!Number.isNaN(a)) {
        points.push({ t, year: yr, month: m, a });
        aMax = Math.max(aMax, Math.abs(a));
        ys += a;
        yc += 1;
      }
      t += 1;
    }
    yearMean[yr] = yc > 0 ? ys / yc : 0;
  });

  if (aMax <= 0) aMax = 1;
  return {
    region: data.region,
    parameter: data.parameter,
    points,
    years,
    yearMean,
    yearIndex,
    aMax,
    totalMonths: years.length * 12,
  };
}

/**
 * Build the anomaly series for one region from its flat monthly-mean array.
 * Baseline is the per-calendar-month mean over `baseline` (default 1961–1990);
 * months with too little coverage in that window fall back to the full-period
 * mean so very long station records still render.
 */
export function buildMonthlyAnomaliesFromRegion(
  r: RegionMonthly,
  baseline?: { from: number; to: number },
): AnomalySeries {
  const nYears = Math.floor(r.t.length / 12);
  const lastYear = r.y0 + nYears - 1;
  const val = (yr: number, m: number): number => {
    const i = (yr - r.y0) * 12 + m;
    const v = i >= 0 && i < r.t.length ? r.t[i] : null;
    return v === null || v === undefined || Number.isNaN(v) ? NaN : v;
  };

  const bFrom = baseline?.from ?? 1961;
  const bTo = baseline?.to ?? 1990;
  const baseM = new Array(12).fill(0);
  const baseC = new Array(12).fill(0);
  const fullM = new Array(12).fill(0);
  const fullC = new Array(12).fill(0);
  for (let yr = r.y0; yr <= lastYear; yr++) {
    for (let m = 0; m < 12; m++) {
      const v = val(yr, m);
      if (Number.isNaN(v)) continue;
      fullM[m] += v;
      fullC[m] += 1;
      if (yr >= bFrom && yr <= bTo) {
        baseM[m] += v;
        baseC[m] += 1;
      }
    }
  }
  const bm = new Array(12).fill(0).map((_, m) => {
    if (baseC[m] >= 10) return baseM[m] / baseC[m];
    return fullC[m] > 0 ? fullM[m] / fullC[m] : 0;
  });

  const years: number[] = [];
  for (let yr = r.y0; yr <= lastYear; yr++) years.push(yr);
  const points: MonthAnomaly[] = [];
  const yearMean: Record<number, number> = {};
  const yearIndex: Record<number, number> = {};
  let aMax = 0;
  let t = 0;
  years.forEach((yr, idx) => {
    yearIndex[yr] = idx;
    let ys = 0;
    let yc = 0;
    for (let m = 0; m < 12; m++) {
      const v = val(yr, m);
      if (!Number.isNaN(v)) {
        const a = v - bm[m];
        points.push({ t, year: yr, month: m, a });
        aMax = Math.max(aMax, Math.abs(a));
        ys += a;
        yc += 1;
      }
      t += 1;
    }
    yearMean[yr] = yc > 0 ? ys / yc : 0;
  });

  if (aMax <= 0) aMax = 1;
  return {
    region: r.name,
    parameter: "temperature_air_mean_2m",
    points,
    years,
    yearMean,
    yearIndex,
    aMax,
    totalMonths: years.length * 12,
  };
}

// ---------- colour ----------

function lerp(a: number[], b: number[], t: number): number[] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function divergingColor(a: number, aMax: number, alpha = 1): string {
  const f = Math.max(-1, Math.min(1, a / aMax));
  const t = (f + 1) / 2;
  const cold = [40, 96, 205];
  const mid = [238, 238, 242];
  const warm = [206, 36, 46];
  const c = t < 0.5 ? lerp(cold, mid, t * 2) : lerp(mid, warm, (t - 0.5) * 2);
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;
}

function recencyAlpha(age: number): number {
  if (age <= 0) return 1;
  return Math.max(0.12, 0.95 - age * 0.06);
}

function fmtAnomaly(a: number): string {
  const sign = a >= 0 ? "+" : "−";
  return `${sign}${Math.abs(a).toFixed(2)}°`;
}

// ---------- shared canvas helpers ----------

function setFont(ctx: CanvasRenderingContext2D, weight: number, size: number): void {
  ctx.font = `${weight} ${size}px 'Segoe UI', system-ui, sans-serif`;
}

function drawCenterReadout(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: AnomalySeries,
  curIdx: number
): void {
  const year = s.years[curIdx];
  const a = s.yearMean[year];
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  setFont(ctx, 700, 52);
  ctx.fillStyle = "#f2f6ff";
  ctx.fillText(String(year), cx, cy - 4);
  setFont(ctx, 600, 22);
  ctx.fillStyle = divergingColor(a, s.aMax, 1);
  ctx.fillText(fmtAnomaly(a), cx, cy + 32);
  ctx.restore();
}

// ---------- view: tilted spiral ----------

function drawSpiral(ctx: CanvasRenderingContext2D, W: number, H: number, s: AnomalySeries, st: State): void {
  const cx = W / 2;
  const cy = H * 0.5;
  const R = Math.min(W, H) * 0.3;
  const aspan = R * 0.62;
  const ky = Math.cos((st.tilt * Math.PI) / 180); // vertical squash → ellipse (the tilt)
  const cur = st.progress;
  const curIdx = Math.min(Math.floor(cur / 12), s.years.length - 1);

  // guide ellipse + month spokes/labels
  ctx.save();
  ctx.strokeStyle = "rgba(140,160,200,0.16)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(cx, cy, R, R * ky, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  setFont(ctx, 600, 12);
  for (let m = 0; m < 12; m++) {
    const ang = (m / 12) * Math.PI * 2 - Math.PI / 2;
    const lx = cx + (R * 1.16) * Math.cos(ang);
    const ly = cy + (R * 1.16) * Math.sin(ang) * ky;
    ctx.strokeStyle = "rgba(140,160,200,0.10)";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.cos(ang), cy + R * Math.sin(ang) * ky);
    ctx.stroke();
    ctx.fillStyle = "rgba(180,196,226,0.75)";
    ctx.fillText(MONTHS[m], lx, ly);
  }
  ctx.restore();

  // spiral path
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = 3.2;
  let prev: { x: number; y: number } | null = null;
  for (const p of s.points) {
    if (p.t > cur) break;
    const ang = (p.month / 12) * Math.PI * 2 - Math.PI / 2;
    const r = R + (p.a / s.aMax) * aspan;
    const x = cx + r * Math.cos(ang);
    const y = cy + r * Math.sin(ang) * ky;
    if (prev) {
      const alpha = recencyAlpha(curIdx - s.yearIndex[p.year]);
      ctx.strokeStyle = divergingColor(p.a, s.aMax, alpha);
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    prev = { x, y };
  }

  drawCenterReadout(ctx, cx, cy, s, curIdx);
}

// ---------- view: vertical funnel / tornado ----------

function drawVertical(ctx: CanvasRenderingContext2D, W: number, H: number, s: AnomalySeries, st: State): void {
  const cx = W / 2;
  const top = H * 0.16;
  const bottom = H * 0.9;
  const N = s.years.length;
  const Rb = Math.min(W, H) * 0.15;
  const aspan = Rb * 0.95;
  const ky = Math.cos((st.tilt * Math.PI) / 180) * 0.42 + 0.06; // flattened rings
  const cur = st.progress;
  const curIdx = Math.min(Math.floor(cur / 12), N - 1);

  // reference verticals at the axis
  ctx.save();
  ctx.strokeStyle = "rgba(140,160,200,0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, top - 10);
  ctx.lineTo(cx, bottom + 10);
  ctx.stroke();
  ctx.restore();

  // tube
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = 2.8;
  let prev: { x: number; y: number } | null = null;
  for (const p of s.points) {
    if (p.t > cur) break;
    const yi = s.yearIndex[p.year];
    const yc = bottom - (yi / Math.max(N - 1, 1)) * (bottom - top);
    const widen = 1 + (s.yearMean[p.year] / s.aMax) * 0.5;
    const ang = (p.month / 12) * Math.PI * 2 - Math.PI / 2;
    const r = Rb * widen + (p.a / s.aMax) * aspan * 0.5;
    const x = cx + r * Math.cos(ang);
    const y = yc + r * Math.sin(ang) * ky;
    if (prev) {
      const alpha = recencyAlpha(curIdx - yi);
      ctx.strokeStyle = divergingColor(p.a, s.aMax, alpha);
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    prev = { x, y };
  }

  // year labels every 5 years along the axis
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  setFont(ctx, 600, 12);
  s.years.forEach((yr, yi) => {
    if (yi > curIdx) return;
    if (yr % 5 !== 0 && yi !== 0 && yi !== curIdx) return;
    const yc = bottom - (yi / Math.max(N - 1, 1)) * (bottom - top);
    ctx.fillStyle = yi === curIdx ? "#9be3a0" : "rgba(170,190,220,0.55)";
    ctx.fillText(String(yr), cx + Rb * 1.7, yc);
  });
  ctx.restore();

  // current-year readout top-left (clear of the centred funnel)
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  setFont(ctx, 700, 30);
  ctx.fillStyle = "#f2f6ff";
  ctx.fillText(String(s.years[curIdx]), W * 0.07, H * 0.18);
  setFont(ctx, 600, 16);
  ctx.fillStyle = divergingColor(s.yearMean[s.years[curIdx]], s.aMax, 1);
  ctx.fillText(fmtAnomaly(s.yearMean[s.years[curIdx]]), W * 0.07, H * 0.18 + 22);
  ctx.restore();
}

// ---------- view: horizontal time series ----------

function drawHorizontal(ctx: CanvasRenderingContext2D, W: number, H: number, s: AnomalySeries, st: State): void {
  const left = W * 0.09;
  const right = W * 0.95;
  const mid = H * 0.54;
  const plotH = H * 0.34;
  const total = s.totalMonths;
  const N = s.years.length;
  const cur = st.progress;
  const curIdx = Math.min(Math.floor(cur / 12), N - 1);
  const ky = plotH / (s.aMax * 1.1);

  // gridlines at -1 / 0 / +1 °C (clamped to range)
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  setFont(ctx, 600, 12);
  const lines = [-1, 0, 1].filter((v) => Math.abs(v) <= s.aMax * 1.1);
  for (const v of lines) {
    const y = mid - v * ky;
    ctx.strokeStyle = v === 0 ? "rgba(160,180,215,0.35)" : "rgba(140,160,200,0.14)";
    ctx.lineWidth = v === 0 ? 1.4 : 1;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.fillStyle = "rgba(170,190,220,0.6)";
    ctx.fillText(fmtAnomaly(v), right + 6 > W ? left - 4 : right + 6, y);
  }
  ctx.restore();

  // bars
  const bw = Math.max(1.2, ((right - left) / total) * 0.78);
  for (const p of s.points) {
    if (p.t > cur) break;
    const x = left + (p.t / total) * (right - left);
    const y = mid - p.a * ky;
    const alpha = p.year >= s.years[curIdx] - 9 ? 1 : 0.5;
    ctx.strokeStyle = divergingColor(p.a, s.aMax, alpha);
    ctx.lineWidth = bw;
    ctx.beginPath();
    ctx.moveTo(x, mid);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  // x-axis year ticks every 5 years
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  setFont(ctx, 600, 11);
  ctx.fillStyle = "rgba(170,190,220,0.6)";
  s.years.forEach((yr, yi) => {
    if (yr % 5 !== 0 && yi !== 0 && yi !== N - 1) return;
    const x = left + ((yi * 12) / total) * (right - left);
    ctx.strokeStyle = "rgba(140,160,200,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, mid + plotH * 0.5 + 4);
    ctx.lineTo(x, mid + plotH * 0.5 + 10);
    ctx.stroke();
    ctx.fillText(String(yr), x, mid + plotH * 0.5 + 12);
  });
  ctx.restore();

  // readout top-left
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  setFont(ctx, 700, 30);
  ctx.fillStyle = "#f2f6ff";
  ctx.fillText(String(s.years[curIdx]), left, H * 0.18);
  setFont(ctx, 600, 16);
  ctx.fillStyle = divergingColor(s.yearMean[s.years[curIdx]], s.aMax, 1);
  ctx.fillText(fmtAnomaly(s.yearMean[s.years[curIdx]]), left, H * 0.18 + 22);
  ctx.restore();
}

// ---------- view: warming stripes (Klimastreifen) ----------
// One vertical stripe per year, coloured by its mean anomaly (Ed Hawkins
// #ShowYourStripes). Stripes "paint in" up to the playback cursor; future
// years stay dim so the reveal matches the other views' animation.
function drawStripes(ctx: CanvasRenderingContext2D, W: number, H: number, s: AnomalySeries, st: State): void {
  const N = s.years.length;
  const left = W * 0.06;
  const right = W * 0.94;
  const top = H * 0.26;
  const bottom = H * 0.78;
  const bandW = (right - left) / N;
  const curIdx = Math.min(Math.floor(st.progress / 12), N - 1);

  for (let i = 0; i < N; i++) {
    const yr = s.years[i];
    const x = left + i * bandW;
    ctx.fillStyle = i <= curIdx ? divergingColor(s.yearMean[yr], s.aMax, 1) : "rgba(20,26,42,0.55)";
    ctx.fillRect(x, top, Math.ceil(bandW) + 0.5, bottom - top);
  }

  // current-year marker
  const cx = left + (curIdx + 0.5) * bandW;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, top - 8);
  ctx.lineTo(cx, bottom + 8);
  ctx.stroke();
  ctx.restore();

  // year ticks (every 10 yrs, every 20 for long station records)
  const tickStep = N > 80 ? 20 : 10;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  setFont(ctx, 600, 11);
  ctx.fillStyle = "rgba(170,190,220,0.7)";
  s.years.forEach((yr, i) => {
    if (yr % tickStep !== 0 && i !== 0 && i !== N - 1) return;
    const x = left + (i + 0.5) * bandW;
    ctx.fillText(String(yr), x, bottom + 8);
  });
  ctx.restore();

  // readout top-left: current year + its anomaly
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  setFont(ctx, 700, 30);
  ctx.fillStyle = "#f2f6ff";
  ctx.fillText(String(s.years[curIdx]), left, H * 0.185);
  setFont(ctx, 600, 16);
  ctx.fillStyle = divergingColor(s.yearMean[s.years[curIdx]], s.aMax, 1);
  ctx.fillText(fmtAnomaly(s.yearMean[s.years[curIdx]]), left + 84, H * 0.185);
  ctx.restore();
}

// ---------- view: Germany weather heat map ----------
// A continuous, interpolated surface over Germany. For the playback year the
// per-station annual anomaly (vs the 1961–1990 baseline) is interpolated onto a
// fine geographic grid with inverse-distance weighting (precomputed K-nearest
// station weights per cell), rasterised once per year, and blitted — smoothed —
// onto the canvas, clipped to the Bundesländer outline.

type Palette = { neg: number[]; mid: number[]; pos: number[] };

const MAP_PALETTES: Record<string, Palette> = {
  temp: { neg: [40, 96, 205], mid: [238, 238, 242], pos: [206, 36, 46] },
  precip: { neg: [150, 99, 42], mid: [240, 238, 232], pos: [40, 118, 201] },
  sun: { neg: [74, 116, 176], mid: [238, 238, 240], pos: [235, 150, 30] },
  wind: { neg: [52, 150, 138], mid: [240, 238, 236], pos: [201, 74, 140] },
};
const MAP_LEGENDS: Record<string, { neg: string; pos: string }> = {
  temp: { neg: "kälter", pos: "wärmer" },
  precip: { neg: "trockener", pos: "feuchter" },
  sun: { neg: "trüber", pos: "sonniger" },
  wind: { neg: "windstiller", pos: "windiger" },
};
const MAP_GRID_NY = 200; // raster rows; columns derived from the bbox aspect
const MAP_K = 16; // stations blended per grid cell (IDW)
const MAP_COVER_START = 50; // min stations for the first year of the slider
const MAP_COVER_END = 8; // min stations for the last year of the slider

interface GeoGrid {
  NX: number;
  NY: number;
  bbox: [number, number, number, number];
  cellLon: Float32Array;
  cellLat: Float32Array;
  inside: Uint8Array;
}

interface ParamGrid {
  idx: Int32Array; // NX*NY*K nearest-station indices (-1 = unused slot)
  w: Float32Array; // matching IDW weights
}

interface MapParamModel {
  key: string;
  meta: WeatherParam;
  paramGrid: ParamGrid;
  years: number[];
  yearMean: Record<number, number>;
  aMax: number;
  palette: Palette;
  legend: { neg: string; pos: string };
}

interface MapRuntime {
  geo: GeoData;
  weather: WeatherMapDoc;
  grid: GeoGrid;
  models: Map<string, MapParamModel>;
  current: MapParamModel;
  off: HTMLCanvasElement;
  offCtx: CanvasRenderingContext2D;
  lastYear: number;
  lastKey: string;
  path: Path2D | null;
  pathW: number;
  pathH: number;
  anBuf: Float32Array;
  hasBuf: Uint8Array;
}

function paletteRGB(a: number, scale: number, p: Palette): number[] {
  const f = Math.max(-1, Math.min(1, a / scale));
  const t = (f + 1) / 2;
  return t < 0.5 ? lerp(p.neg, p.mid, t * 2) : lerp(p.mid, p.pos, (t - 0.5) * 2);
}

function paletteCss(a: number, scale: number, p: Palette, alpha = 1): string {
  const c = paletteRGB(a, scale, p);
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;
}

function stationAnomaly(val: number, base: number, mode: "abs" | "pct"): number {
  return mode === "pct" ? (base !== 0 ? ((val - base) / base) * 100 : 0) : val - base;
}

function pointInGermany(lon: number, lat: number, geo: GeoData): boolean {
  let inside = false;
  for (const st of geo.states) {
    for (const poly of st.polys) {
      for (const ring of poly) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const xi = ring[i][0];
          const yi = ring[i][1];
          const xj = ring[j][0];
          const yj = ring[j][1];
          if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
            inside = !inside;
          }
        }
      }
    }
  }
  return inside;
}

function prepareGeoGrid(geo: GeoData): GeoGrid {
  const [minLon, minLat, maxLon, maxLat] = geo.bbox;
  const midLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180);
  const gw = (maxLon - minLon) * lonScale;
  const gh = maxLat - minLat;
  const NY = MAP_GRID_NY;
  const NX = Math.max(40, Math.round((NY * gw) / gh));
  const cellLon = new Float32Array(NX * NY);
  const cellLat = new Float32Array(NX * NY);
  const inside = new Uint8Array(NX * NY);
  for (let j = 0; j < NY; j++) {
    const lat = maxLat - ((j + 0.5) / NY) * (maxLat - minLat);
    for (let i = 0; i < NX; i++) {
      const lon = minLon + ((i + 0.5) / NX) * (maxLon - minLon);
      const c = j * NX + i;
      cellLon[c] = lon;
      cellLat[c] = lat;
      inside[c] = pointInGermany(lon, lat, geo) ? 1 : 0;
    }
  }
  return { NX, NY, bbox: geo.bbox, cellLon, cellLat, inside };
}

function buildParamModel(grid: GeoGrid, weather: WeatherMapDoc, key: string): MapParamModel {
  const meta = weather.params[key];
  const stations = meta.stations;
  const N = grid.NX * grid.NY;
  const idx = new Int32Array(N * MAP_K).fill(-1);
  const w = new Float32Array(N * MAP_K);
  const midLat = (grid.bbox[1] + grid.bbox[3]) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180);
  const bd = new Float64Array(MAP_K);
  const bi = new Int32Array(MAP_K);

  for (let c = 0; c < N; c++) {
    if (!grid.inside[c]) continue;
    const clon = grid.cellLon[c];
    const clat = grid.cellLat[c];
    let cnt = 0;
    let worst = Infinity;
    let worstAt = -1;
    for (let s = 0; s < stations.length; s++) {
      const st = stations[s];
      const dx = (clon - st.lon) * lonScale;
      const dy = clat - st.lat;
      const d2 = dx * dx + dy * dy;
      if (cnt < MAP_K) {
        bd[cnt] = d2;
        bi[cnt] = s;
        cnt++;
        if (cnt === MAP_K) {
          worst = -Infinity;
          for (let q = 0; q < MAP_K; q++) if (bd[q] > worst) ((worst = bd[q]), (worstAt = q));
        }
      } else if (d2 < worst) {
        bd[worstAt] = d2;
        bi[worstAt] = s;
        worst = -Infinity;
        for (let q = 0; q < MAP_K; q++) if (bd[q] > worst) ((worst = bd[q]), (worstAt = q));
      }
    }
    const off = c * MAP_K;
    for (let q = 0; q < cnt; q++) {
      idx[off + q] = bi[q];
      w[off + q] = 1 / (bd[q] + 1e-4);
    }
  }

  // Dense, contiguous year window + national mean anomaly per year.
  const [y0g, y1g] = weather.years;
  const mode = meta.mode;
  const counts: Record<number, { sum: number; n: number }> = {};
  for (let yr = y0g; yr <= y1g; yr++) counts[yr] = { sum: 0, n: 0 };
  for (const st of stations) {
    for (let i = 0; i < st.v.length; i++) {
      const val = st.v[i];
      if (val === null || val === undefined) continue;
      const yr = st.y0 + i;
      const bucket = counts[yr];
      if (!bucket) continue;
      bucket.sum += stationAnomaly(val, st.base, mode);
      bucket.n += 1;
    }
  }
  let startYear = y0g;
  for (let yr = y0g; yr <= y1g; yr++) {
    if (counts[yr].n >= MAP_COVER_START) {
      startYear = yr;
      break;
    }
  }
  let endYear = startYear;
  for (let yr = y1g; yr >= startYear; yr--) {
    if (counts[yr].n >= MAP_COVER_END) {
      endYear = yr;
      break;
    }
  }
  const years: number[] = [];
  const yearMean: Record<number, number> = {};
  for (let yr = startYear; yr <= endYear; yr++) {
    years.push(yr);
    const b = counts[yr];
    yearMean[yr] = b.n > 0 ? b.sum / b.n : 0;
  }

  return {
    key,
    meta,
    paramGrid: { idx, w },
    years,
    yearMean,
    aMax: meta.scale,
    palette: MAP_PALETTES[key] ?? MAP_PALETTES.temp,
    legend: MAP_LEGENDS[key] ?? MAP_LEGENDS.temp,
  };
}

function buildGermanyPath(geo: GeoData, project: (lon: number, lat: number) => [number, number]): Path2D {
  const path = new Path2D();
  for (const st of geo.states) {
    for (const poly of st.polys) {
      for (const ring of poly) {
        ring.forEach((pt, i) => {
          const [x, y] = project(pt[0], pt[1]);
          if (i === 0) path.moveTo(x, y);
          else path.lineTo(x, y);
        });
        path.closePath();
      }
    }
  }
  return path;
}

function renderMapRaster(map: MapRuntime, year: number): void {
  const m = map.current;
  const pg = m.paramGrid;
  const grid = map.grid;
  const stations = m.meta.stations;
  const NX = grid.NX;
  const NY = grid.NY;
  const mode = m.meta.mode;
  const scale = m.meta.scale;
  const pal = m.palette;
  const an = map.anBuf;
  const has = map.hasBuf;

  for (let s = 0; s < stations.length; s++) {
    const st = stations[s];
    const i = year - st.y0;
    const val = i >= 0 && i < st.v.length ? st.v[i] : null;
    if (val === null || val === undefined) {
      has[s] = 0;
      continue;
    }
    has[s] = 1;
    an[s] = stationAnomaly(val, st.base, mode);
  }

  const img = map.offCtx.createImageData(NX, NY);
  const data = img.data;
  const total = NX * NY;
  for (let c = 0; c < total; c++) {
    if (!grid.inside[c]) continue;
    let wsum = 0;
    let asum = 0;
    const off = c * MAP_K;
    for (let k = 0; k < MAP_K; k++) {
      const si = pg.idx[off + k];
      if (si < 0) break;
      if (!has[si]) continue;
      const wk = pg.w[off + k];
      wsum += wk;
      asum += wk * an[si];
    }
    if (wsum <= 0) continue;
    const rgb = paletteRGB(asum / wsum, scale, pal);
    const p = c * 4;
    data[p] = rgb[0] | 0;
    data[p + 1] = rgb[1] | 0;
    data[p + 2] = rgb[2] | 0;
    data[p + 3] = 236;
  }
  map.offCtx.putImageData(img, 0, 0);
}

function fmtMapVal(a: number, mode: "abs" | "pct", unit: string): string {
  const sign = a >= 0 ? "+" : "−";
  const v = Math.abs(a);
  return mode === "pct" ? `${sign}${v.toFixed(0)} %` : `${sign}${v.toFixed(2)} ${unit}`;
}

function drawMapLegend(ctx: CanvasRenderingContext2D, W: number, H: number, m: MapParamModel): void {
  const lw = Math.min(240, W * 0.34);
  const lh = 10;
  const lx = W * 0.06;
  const ly = H * 0.82;
  const grad = ctx.createLinearGradient(lx, 0, lx + lw, 0);
  const c0 = m.palette.neg;
  const cm = m.palette.mid;
  const c1 = m.palette.pos;
  grad.addColorStop(0, `rgb(${c0[0]},${c0[1]},${c0[2]})`);
  grad.addColorStop(0.5, `rgb(${cm[0]},${cm[1]},${cm[2]})`);
  grad.addColorStop(1, `rgb(${c1[0]},${c1[1]},${c1[2]})`);
  ctx.save();
  ctx.fillStyle = grad;
  ctx.strokeStyle = "rgba(150,170,210,0.4)";
  ctx.lineWidth = 1;
  ctx.fillRect(lx, ly, lw, lh);
  ctx.strokeRect(lx, ly, lw, lh);
  ctx.textBaseline = "middle";
  setFont(ctx, 600, 12);
  ctx.fillStyle = "rgba(180,196,226,0.85)";
  ctx.textAlign = "right";
  ctx.fillText(m.legend.neg, lx - 8, ly + lh / 2);
  ctx.textAlign = "left";
  ctx.fillText(m.legend.pos, lx + lw + 8, ly + lh / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  setFont(ctx, 600, 11);
  ctx.fillStyle = "rgba(143,163,200,0.8)";
  const unit = m.meta.mode === "pct" ? "% vom Mittel 1961\u20131990" : `${m.meta.unit} vs. Mittel 1961\u20131990`;
  ctx.fillText(`${m.meta.label} \u00b7 ${unit}`, lx - 0, ly + lh + 7);
  ctx.restore();
}

function drawMap(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  s: AnomalySeries,
  st: State,
  map: MapRuntime,
): void {
  const N = s.years.length;
  const curIdx = Math.min(Math.floor(st.progress / 12), N - 1);
  const year = s.years[curIdx];

  if (map.lastYear !== year || map.lastKey !== map.current.key) {
    renderMapRaster(map, year);
    map.lastYear = year;
    map.lastKey = map.current.key;
  }

  const [minLon, minLat, maxLon, maxLat] = map.grid.bbox;
  const midLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180);
  const gw = (maxLon - minLon) * lonScale;
  const gh = maxLat - minLat;
  const availW = W * 0.9;
  const availH = H * 0.6;
  const sc = Math.min(availW / gw, availH / gh);
  const dw = gw * sc;
  const dh = gh * sc;
  const ox = (W - dw) / 2;
  const oy = H * 0.15 + (availH - dh) / 2;
  const project = (lon: number, lat: number): [number, number] => [
    ox + (((lon - minLon) * lonScale) / gw) * dw,
    oy + ((maxLat - lat) / gh) * dh,
  ];

  if (!map.path || map.pathW !== W || map.pathH !== H) {
    map.path = buildGermanyPath(map.geo, project);
    map.pathW = W;
    map.pathH = H;
  }

  // interpolated surface, clipped to the country outline
  ctx.save();
  ctx.clip(map.path);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(map.off, ox, oy, dw, dh);
  ctx.restore();

  // station markers (faint) — show where the data actually is
  ctx.save();
  ctx.fillStyle = "rgba(18,24,40,0.22)";
  for (const station of map.current.meta.stations) {
    const [x, y] = project(station.lon, station.lat);
    ctx.beginPath();
    ctx.arc(x, y, 1.0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Bundesländer borders
  ctx.save();
  ctx.strokeStyle = "rgba(226,236,255,0.28)";
  ctx.lineWidth = 1;
  ctx.lineJoin = "round";
  ctx.stroke(map.path);
  ctx.restore();

  // readout (top-left): current year + national-mean anomaly
  const nm = s.yearMean[year] ?? 0;
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  setFont(ctx, 700, 30);
  ctx.fillStyle = "#f2f6ff";
  ctx.fillText(String(year), W * 0.06, H * 0.18);
  setFont(ctx, 600, 16);
  ctx.fillStyle = paletteCss(nm, map.current.aMax, map.current.palette, 1);
  ctx.fillText(`${map.current.meta.label}: ${fmtMapVal(nm, map.current.meta.mode, map.current.meta.unit)}`, W * 0.06, H * 0.18 + 22);
  ctx.restore();

  drawMapLegend(ctx, W, H, map.current);
}

function drawMapPlaceholder(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  setFont(ctx, 600, 18);
  ctx.fillStyle = "rgba(180,196,226,0.8)";
  ctx.fillText("Karte l\u00e4dt\u2026", W / 2, H * 0.46);
  ctx.restore();
}

// ---------- controls ----------

interface Controls {
  el: HTMLElement;
  sync: () => void;
  setMax: (totalMonths: number) => void;
}

function buildControls(
  state: State,
  getTotal: () => number,
  onChange: () => void,
  onView?: (v: View) => void,
  includeMap = false,
): Controls {
  const el = document.createElement("div");
  el.className = "ks-controls";

  const timeline = document.createElement("input");
  timeline.type = "range";
  timeline.className = "ks-timeline";
  timeline.min = "0";
  timeline.max = String(getTotal() - 1);
  timeline.step = "1";
  timeline.value = "0";
  timeline.addEventListener("input", () => {
    state.progress = Number(timeline.value);
    state.playing = false;
    syncPlay();
    onChange();
  });
  el.appendChild(timeline);

  const row = document.createElement("div");
  row.className = "ks-row";
  el.appendChild(row);

  // view toggle group
  const seg = document.createElement("div");
  seg.className = "ks-seg";
  const viewDefs: Array<[View, string]> = [
    ["spiral", "Spirale"],
    ["vertical", "Vertikal"],
    ["horizontal", "Horizontal"],
    ["stripes", "Klimastreifen"],
  ];
  if (includeMap) viewDefs.push(["karte", "Karte"]);
  const viewBtns: Record<string, HTMLButtonElement> = {};
  for (const [v, label] of viewDefs) {
    const b = document.createElement("button");
    b.className = "ks-btn";
    b.textContent = label;
    b.addEventListener("click", () => {
      state.view = v;
      syncView();
      onView?.(v);
      onChange();
    });
    viewBtns[v] = b;
    seg.appendChild(b);
  }
  row.appendChild(seg);

  // transport
  const mkBtn = (label: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.className = "ks-btn";
    b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  };
  row.appendChild(mkBtn("⏮", () => {
    state.progress = 0;
    onChange();
  }));
  row.appendChild(mkBtn("◀", () => {
    state.progress = Math.max(0, Math.floor(state.progress) - 1);
    state.playing = false;
    syncPlay();
    onChange();
  }));
  const playBtn = mkBtn("⏸", () => {
    state.playing = !state.playing;
    syncPlay();
  });
  row.appendChild(playBtn);
  row.appendChild(mkBtn("▶", () => {
    state.progress = Math.min(getTotal() - 1, Math.floor(state.progress) + 1);
    state.playing = false;
    syncPlay();
    onChange();
  }));

  const speedBtn = mkBtn("1×", () => {
    const i = SPEEDS.indexOf(state.speed);
    state.speed = SPEEDS[(i + 1) % SPEEDS.length];
    speedBtn.textContent = `${state.speed}×`;
  });
  row.appendChild(speedBtn);

  // tilt slider
  const tiltWrap = document.createElement("label");
  tiltWrap.className = "ks-tilt";
  const tiltText = document.createElement("span");
  tiltText.textContent = "Neigung";
  const tilt = document.createElement("input");
  tilt.type = "range";
  tilt.min = "0";
  tilt.max = "78";
  tilt.step = "1";
  tilt.value = String(state.tilt);
  tilt.addEventListener("input", () => {
    state.tilt = Number(tilt.value);
    onChange();
  });
  tiltWrap.appendChild(tiltText);
  tiltWrap.appendChild(tilt);
  row.appendChild(tiltWrap);

  function syncPlay(): void {
    playBtn.textContent = state.playing ? "⏸" : "▶";
  }
  function syncView(): void {
    for (const [v] of viewDefs) viewBtns[v].classList.toggle("active", state.view === v);
    tiltWrap.classList.toggle("disabled", state.view === "horizontal" || state.view === "stripes" || state.view === "karte");
  }
  syncView();
  syncPlay();

  return {
    el,
    sync: () => {
      timeline.value = String(Math.floor(state.progress));
    },
    setMax: (totalMonths: number) => {
      timeline.max = String(Math.max(0, totalMonths - 1));
    },
  };
}

// ---------- CSS ----------

const CSS = `
.ks-stage{position:absolute;inset:0;overflow:hidden}
.ks-canvas{position:absolute;inset:0}
.ks-title{position:absolute;top:18px;left:0;right:0;text-align:center;pointer-events:none;z-index:2}
.ks-title h1{margin:0;font:700 26px 'Segoe UI',system-ui,sans-serif;color:#eaf1ff;letter-spacing:.01em}
.ks-title p{margin:4px 0 0;font:600 12px 'Segoe UI',system-ui,sans-serif;color:#8fa3c8;letter-spacing:.16em;text-transform:uppercase}
.ks-controls{position:absolute;left:50%;bottom:20px;transform:translateX(-50%);z-index:3;display:flex;flex-direction:column;gap:10px;align-items:center;width:min(760px,92vw)}
.ks-timeline{width:100%;accent-color:#6f9bff;cursor:pointer;height:4px}
.ks-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center}
.ks-btn{appearance:none;border:1px solid rgba(150,170,210,.25);background:rgba(20,28,48,.7);color:#cfe0ff;font:600 13px 'Segoe UI',system-ui,sans-serif;padding:7px 12px;border-radius:8px;cursor:pointer;backdrop-filter:blur(4px)}
.ks-btn:hover{background:rgba(40,54,86,.85)}
.ks-btn.active{background:#3257a8;border-color:#5b82d6;color:#fff}
.ks-seg{display:flex;border:1px solid rgba(150,170,210,.25);border-radius:8px;overflow:hidden}
.ks-seg .ks-btn{border:none;border-radius:0;border-right:1px solid rgba(150,170,210,.18)}
.ks-seg .ks-btn:last-child{border-right:none}
.ks-tilt{display:flex;align-items:center;gap:8px;color:#9fb0d0;font:600 12px 'Segoe UI',system-ui,sans-serif}
.ks-tilt input{accent-color:#6f9bff;cursor:pointer}
.ks-tilt.disabled{opacity:.35;pointer-events:none}
.ks-picker{position:absolute;top:84px;left:50%;transform:translateX(-50%);z-index:3;display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;width:min(760px,92vw)}
.ks-picker .ks-lvl{color:#8fa3c8;font:600 11px 'Segoe UI',system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;margin-right:2px}
.ks-select{appearance:none;border:1px solid rgba(150,170,210,.25);background:rgba(20,28,48,.78);color:#dce8ff;font:600 13px 'Segoe UI',system-ui,sans-serif;padding:7px 30px 7px 12px;border-radius:8px;cursor:pointer;backdrop-filter:blur(4px);background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path d='M2 4l4 4 4-4' stroke='%238fa3c8' stroke-width='1.6' fill='none' stroke-linecap='round'/></svg>");background-repeat:no-repeat;background-position:right 10px center}
.ks-select:hover{background-color:rgba(40,54,86,.9)}
.ks-search{border:1px solid rgba(150,170,210,.25);background:rgba(20,28,48,.78);color:#dce8ff;font:600 13px 'Segoe UI',system-ui,sans-serif;padding:7px 12px;border-radius:8px;min-width:200px;backdrop-filter:blur(4px)}
.ks-search::placeholder{color:#6c7fa3}
.ks-picker .hide{display:none}
.ks-picker.hide{display:none}
.ks-params{position:absolute;top:84px;left:50%;transform:translateX(-50%);z-index:3;display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;width:min(760px,92vw)}
.ks-params .ks-lvl{color:#8fa3c8;font:600 11px 'Segoe UI',system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;margin-right:2px}
.ks-params.hide{display:none}
`;

// ---------- region picker ----------

function spanLabel(s: AnomalySeries): string {
  if (!s.years.length) return "";
  return `${s.years[0]}\u2013${s.years[s.years.length - 1]}`;
}

function subtitleFor(r: RegionMonthly, s: AnomalySeries, baseline?: { from: number; to: number }): string {
  const bf = baseline?.from ?? 1961;
  const bt = baseline?.to ?? 1990;
  return `${r.name} \u00b7 ${spanLabel(s)} \u00b7 Abweichung vom Mittel ${bf}\u2013${bt}`;
}

type SetRegion = (series: AnomalySeries, subtitle: string) => void;
type Mode = "national" | "bundesland" | "station";

function buildRegionPicker(
  dataset: MultiDataset,
  loadStations: () => Promise<RegionMonthly[]>,
  setRegion: SetRegion,
): HTMLElement {
  const baseline = dataset.baseline;
  const el = document.createElement("div");
  el.className = "ks-picker";

  const lvl = document.createElement("span");
  lvl.className = "ks-lvl";
  lvl.textContent = "Ebene";
  el.appendChild(lvl);

  const seg = document.createElement("div");
  seg.className = "ks-seg";
  el.appendChild(seg);

  // Bundesland dropdown
  const blSel = document.createElement("select");
  blSel.className = "ks-select hide";
  for (const b of dataset.bundeslaender) {
    const o = document.createElement("option");
    o.value = b.id;
    o.textContent = b.name;
    blSel.appendChild(o);
  }
  el.appendChild(blSel);

  // Station search
  const stSearch = document.createElement("input");
  stSearch.className = "ks-search hide";
  stSearch.setAttribute("list", "ks-station-list");
  stSearch.placeholder = "Station suchen\u2026";
  const dl = document.createElement("datalist");
  dl.id = "ks-station-list";
  el.appendChild(stSearch);
  el.appendChild(dl);

  let stations: RegionMonthly[] | null = dataset.stations ?? null;
  const stByLabel = new Map<string, RegionMonthly>();

  const pick = (r: RegionMonthly): void => {
    const s = buildMonthlyAnomaliesFromRegion(r, baseline);
    setRegion(s, subtitleFor(r, s, baseline));
  };

  const fillStations = (list: RegionMonthly[]): void => {
    dl.textContent = "";
    stByLabel.clear();
    for (const r of list) {
      const label = r.bundesland ? `${r.name} (${r.bundesland})` : r.name;
      stByLabel.set(label, r);
      const o = document.createElement("option");
      o.value = label;
      dl.appendChild(o);
    }
  };

  const setMode = async (mode: Mode): Promise<void> => {
    for (const [m, b] of Object.entries(modeBtns)) b.classList.toggle("active", m === mode);
    blSel.classList.toggle("hide", mode !== "bundesland");
    stSearch.classList.toggle("hide", mode !== "station");
    if (mode === "national") {
      pick(dataset.national);
    } else if (mode === "bundesland") {
      const b = dataset.bundeslaender.find((x) => x.id === blSel.value) ?? dataset.bundeslaender[0];
      if (b) pick(b);
    } else {
      if (!stations) {
        stSearch.disabled = true;
        stSearch.placeholder = "lädt\u2026";
        try {
          stations = await loadStations();
        } catch {
          stations = [];
        }
        fillStations(stations);
        stSearch.disabled = false;
        stSearch.placeholder = "Station suchen\u2026";
      }
      stSearch.focus();
    }
  };

  const modeDefs: Array<[Mode, string]> = [
    ["national", "Deutschland"],
    ["bundesland", "Bundesland"],
    ["station", "Station"],
  ];
  const modeBtns: Record<string, HTMLButtonElement> = {};
  for (const [m, label] of modeDefs) {
    const b = document.createElement("button");
    b.className = "ks-btn";
    b.textContent = label;
    b.addEventListener("click", () => void setMode(m));
    modeBtns[m] = b;
    seg.appendChild(b);
  }
  modeBtns.national.classList.add("active");

  blSel.addEventListener("change", () => {
    const b = dataset.bundeslaender.find((x) => x.id === blSel.value);
    if (b) pick(b);
  });
  stSearch.addEventListener("change", () => {
    const r = stByLabel.get(stSearch.value);
    if (r) pick(r);
  });
  if (stations) fillStations(stations);

  return el;
}

// ---------- map parameter switcher ----------

function buildParamSwitcher(onPick: (key: string) => void): {
  el: HTMLElement;
  setActive: (key: string) => void;
} {
  const el = document.createElement("div");
  el.className = "ks-params hide";

  const lvl = document.createElement("span");
  lvl.className = "ks-lvl";
  lvl.textContent = "Parameter";
  el.appendChild(lvl);

  const seg = document.createElement("div");
  seg.className = "ks-seg";
  el.appendChild(seg);

  const defs: Array<[string, string]> = [
    ["temp", "Temperatur"],
    ["precip", "Niederschlag"],
    ["sun", "Sonnenschein"],
    ["wind", "Wind"],
  ];
  const btns: Record<string, HTMLButtonElement> = {};
  for (const [k, label] of defs) {
    const b = document.createElement("button");
    b.className = "ks-btn";
    b.textContent = label;
    b.addEventListener("click", () => onPick(k));
    btns[k] = b;
    seg.appendChild(b);
  }

  return {
    el,
    setActive: (key: string) => {
      for (const k of Object.keys(btns)) btns[k].classList.toggle("active", k === key);
    },
  };
}

function synthMapSeries(model: MapParamModel): AnomalySeries {
  const yearIndex: Record<number, number> = {};
  model.years.forEach((y, i) => (yearIndex[y] = i));
  return {
    region: "Deutschland",
    parameter: model.key,
    points: [],
    years: model.years,
    yearMean: model.yearMean,
    yearIndex,
    aMax: model.aMax,
    totalMonths: model.years.length * 12,
  };
}

function mapSubtitle(model: MapParamModel): string {
  const last = model.years[model.years.length - 1];
  return `Deutschland \u00b7 ${model.years[0]}\u2013${last} \u00b7 ${model.meta.label} (Abweichung vom Mittel 1961\u20131990)`;
}

// ---------- entry ----------

export function runKlimaspirale(root: HTMLElement, data: ClimateDataset): void {
  const series = buildMonthlyAnomalies(data);
  runCore(root, series, `${series.region} · monatliche Abweichung vom Monatsmittel`);
}

type LoadMap = () => Promise<{ weather: WeatherMapDoc; geo: GeoData }>;

export function runKlimaspiraleMulti(
  root: HTMLElement,
  dataset: MultiDataset,
  loadStations: () => Promise<RegionMonthly[]>,
  loadMap?: LoadMap,
): void {
  const series = buildMonthlyAnomaliesFromRegion(dataset.national, dataset.baseline);
  runCore(
    root,
    series,
    subtitleFor(dataset.national, series, dataset.baseline),
    (setRegion) => buildRegionPicker(dataset, loadStations, setRegion),
    loadMap,
  );
}

function runCore(
  root: HTMLElement,
  initialSeries: AnomalySeries,
  initialSubtitle: string,
  buildPicker?: (setRegion: SetRegion) => HTMLElement,
  loadMap?: LoadMap,
): void {
  let series = initialSeries;

  root.textContent = "";
  const style = document.createElement("style");
  style.textContent = CSS;
  root.appendChild(style);

  const stage = document.createElement("div");
  stage.className = "ks-stage";
  root.appendChild(stage);

  const canvas = document.createElement("canvas");
  canvas.className = "ks-canvas";
  stage.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");

  const title = document.createElement("div");
  title.className = "ks-title";
  const h1 = document.createElement("h1");
  h1.textContent = "Klimaspirale";
  const sub = document.createElement("p");
  sub.textContent = initialSubtitle;
  title.appendChild(h1);
  title.appendChild(sub);
  stage.appendChild(title);

  const state: State = { progress: 0, playing: true, speed: 1, view: "spiral", tilt: 58 };
  const controls = buildControls(
    state,
    () => series.totalMonths,
    () => render(),
    (v) => onViewChange(v),
    Boolean(loadMap),
  );

  let regionSubtitle = initialSubtitle;
  const setRegion: SetRegion = (s, subtitle) => {
    series = s;
    regionSubtitle = subtitle;
    sub.textContent = subtitle;
    state.progress = 0;
    controls.setMax(series.totalMonths);
    controls.sync();
    render();
  };

  const pickerEl = buildPicker ? buildPicker(setRegion) : null;
  if (pickerEl) stage.appendChild(pickerEl);

  // --- Germany heat-map wiring ---
  let mapRuntime: MapRuntime | null = null;
  let savedSeries: AnomalySeries | null = null; // region series to restore on leave
  let mapParamKey = "temp";
  let mapLoading = false;
  const paramSwitcher = loadMap ? buildParamSwitcher((key) => selectMapParam(key)) : null;
  if (paramSwitcher) stage.appendChild(paramSwitcher.el);

  function selectMapParam(key: string): void {
    if (!mapRuntime) return;
    const prevYear = series.years.length
      ? series.years[Math.min(Math.floor(state.progress / 12), series.years.length - 1)]
      : null;
    let model = mapRuntime.models.get(key);
    if (!model) {
      model = buildParamModel(mapRuntime.grid, mapRuntime.weather, key);
      mapRuntime.models.set(key, model);
    }
    mapRuntime.current = model;
    mapRuntime.lastYear = -1;
    mapParamKey = key;
    paramSwitcher?.setActive(key);
    if (savedSeries === null) savedSeries = series; // remember region series once
    series = synthMapSeries(model);
    sub.textContent = mapSubtitle(model);
    let progress = 0;
    if (prevYear !== null) {
      const i = model.years.indexOf(prevYear);
      if (i >= 0) progress = i * 12;
    }
    state.progress = progress;
    controls.setMax(series.totalMonths);
    controls.sync();
    render();
  }

  async function enterMap(key: string): Promise<void> {
    mapParamKey = key;
    paramSwitcher?.setActive(key);
    if (pickerEl) pickerEl.classList.add("hide");
    paramSwitcher?.el.classList.remove("hide");
    if (!loadMap) return;
    if (!mapRuntime) {
      if (mapLoading) return;
      mapLoading = true;
      sub.textContent = "Karte l\u00e4dt\u2026";
      try {
        const { weather, geo } = await loadMap();
        const grid = prepareGeoGrid(geo);
        const off = document.createElement("canvas");
        off.width = grid.NX;
        off.height = grid.NY;
        const offCtx = off.getContext("2d");
        if (!offCtx) throw new Error("offscreen 2D context unavailable");
        let maxStations = 0;
        for (const k of Object.keys(weather.params)) {
          maxStations = Math.max(maxStations, weather.params[k].stations.length);
        }
        const first = buildParamModel(grid, weather, key);
        const models = new Map<string, MapParamModel>([[key, first]]);
        mapRuntime = {
          geo,
          weather,
          grid,
          models,
          current: first,
          off,
          offCtx,
          lastYear: -1,
          lastKey: "",
          path: null,
          pathW: 0,
          pathH: 0,
          anBuf: new Float32Array(maxStations),
          hasBuf: new Uint8Array(maxStations),
        };
      } catch (err) {
        console.warn(`Karte: Daten nicht verf\u00fcgbar (${String(err)})`);
        sub.textContent = "Karte: Daten nicht verf\u00fcgbar";
        mapLoading = false;
        return;
      }
      mapLoading = false;
    }
    if (state.view === "karte") selectMapParam(key);
  }

  function leaveMap(): void {
    paramSwitcher?.el.classList.add("hide");
    if (pickerEl) pickerEl.classList.remove("hide");
    if (savedSeries) {
      series = savedSeries;
      savedSeries = null;
      sub.textContent = regionSubtitle;
      state.progress = 0;
      controls.setMax(series.totalMonths);
      controls.sync();
      render();
    }
  }

  function onViewChange(v: View): void {
    if (v === "karte") void enterMap(mapParamKey);
    else leaveMap();
  }

  stage.appendChild(controls.el);

  let W = 0;
  let H = 0;

  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = stage.clientWidth;
    H = stage.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function render(): void {
    ctx!.clearRect(0, 0, W, H);
    const g = ctx!.createRadialGradient(W / 2, H * 0.46, 40, W / 2, H * 0.46, Math.max(W, H) * 0.72);
    g.addColorStop(0, "#0a0f1f");
    g.addColorStop(0.6, "#05070f");
    g.addColorStop(1, "#000000");
    ctx!.fillStyle = g;
    ctx!.fillRect(0, 0, W, H);
    if (state.view === "spiral") drawSpiral(ctx!, W, H, series, state);
    else if (state.view === "vertical") drawVertical(ctx!, W, H, series, state);
    else if (state.view === "horizontal") drawHorizontal(ctx!, W, H, series, state);
    else if (state.view === "stripes") drawStripes(ctx!, W, H, series, state);
    else if (state.view === "karte") {
      if (mapRuntime) drawMap(ctx!, W, H, series, state, mapRuntime);
      else drawMapPlaceholder(ctx!, W, H);
    }
  }

  window.addEventListener("resize", () => {
    resize();
    render();
  });
  resize();

  let last = performance.now();
  function frame(now: number): void {
    const dt = (now - last) / 1000;
    last = now;
    if (state.playing) {
      state.progress += dt * BASE_RATE * state.speed;
      if (state.progress >= series.totalMonths) state.progress %= series.totalMonths;
      controls.sync();
    }
    render();
    requestAnimationFrame(frame);
  }

  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    state.playing = false;
    state.progress = series.totalMonths - 1;
    controls.sync();
    render();
  } else {
    requestAnimationFrame(frame);
  }
}
