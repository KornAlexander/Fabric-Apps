/**
 * Hydraulic erosion.
 *
 * Fractal noise makes convincing lumps and completely unconvincing
 * landscapes, because it has no memory of water. Real terrain is carved:
 * ridges are sharp because everything either side of them has been removed,
 * valleys are V-shaped near the top and flat-bottomed near the bottom, and
 * the whole surface is organised into drainage basins that all run downhill
 * to the sea. None of that emerges from summing octaves, and the eye knows
 * it even when it cannot say why.
 *
 * So water is simulated. Droplets are dropped at random, run downhill
 * gathering speed, pick up material in proportion to how fast and how steep
 * they are, and drop it again when they slow down or flatten out. It is the
 * standard particle-based scheme and it is cheap: a few hundred thousand
 * droplets over a quarter of a million cells runs in about a second, once,
 * at map generation.
 */

export interface ErosionOptions {
  /** Number of droplets. More gives deeper, better connected drainage. */
  readonly droplets: number;
  /** How far a droplet may travel before it is abandoned. */
  readonly maxSteps: number;
  /** How strongly a droplet keeps its heading. 0 follows the gradient exactly. */
  readonly inertia: number;
  /** Sediment carried per unit of speed, water and slope. */
  readonly capacity: number;
  /** Fraction of the deficit eroded per step. */
  readonly erode: number;
  /** Fraction of the excess deposited per step. */
  readonly deposit: number;
  /** Water lost per step. */
  readonly evaporation: number;
  /** Radius, in cells, over which erosion is spread. */
  readonly radius: number;
  /** Minimum slope used in the capacity term, to keep flats from stalling. */
  readonly minSlope: number;
  readonly seed: number;
}

export const DEFAULT_EROSION: ErosionOptions = {
  droplets: 140_000,
  maxSteps: 42,
  inertia: 0.06,
  capacity: 3.6,
  // Gentler and wider than the first pass, which cut channels one cell
  // across and several times too deep. Real valleys are broad relative to
  // their depth at this scale, and narrow deep ones read as cracks in the
  // ground rather than as landform.
  erode: 0.15,
  deposit: 0.32,
  evaporation: 0.02,
  radius: 4.2,
  minSlope: 0.008,
  seed: 20260822,
};

/** Deterministic PRNG so a seed always produces the same landscape. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A precomputed weighted brush.
 *
 * Eroding only the cell a droplet is standing in produces single-pixel
 * gullies and a surface full of spikes. Spreading the removal over a small
 * disc, weighted towards the centre, is what makes the channels look cut
 * rather than punched.
 */
function makeBrush(radius: number): { offsets: Int32Array; weights: Float32Array } {
  const r = Math.ceil(radius);
  const offsets: number[] = [];
  const weights: number[] = [];
  let total = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const distance = Math.hypot(dx, dy);
      if (distance > radius) continue;
      const weight = 1 - distance / radius;
      offsets.push(dx, dy);
      weights.push(weight);
      total += weight;
    }
  }
  return {
    offsets: Int32Array.from(offsets),
    weights: Float32Array.from(weights.map((w) => w / total)),
  };
}

export interface ErosionResult {
  /** Height after erosion, same layout as the input. */
  readonly height: Float32Array;
  /** Signed change per cell, which is what the mesh actually applies. */
  readonly delta: Float32Array;
  /** Largest absolute change, for sanity checking. */
  readonly maxDelta: number;
  readonly droplets: number;
}

/**
 * Erode a heightfield in place on a copy.
 *
 * `height` is row-major, `width` by `depth`, in world units. The cell size is
 * needed because slope has to be a real gradient: running this on a grid
 * without knowing its scale makes the erosion strength depend on resolution,
 * which is the kind of thing that looks fine at one map size and destroys
 * the next.
 */
export function erode(
  source: Float32Array,
  width: number,
  depth: number,
  cellSize: number,
  /*
   * Partial on purpose. A plain default parameter REPLACES the whole object,
   * so a caller who wanted to change only the droplet count would silently
   * lose every other tuned constant and get an unrecognisably different
   * landscape. Merging means a caller can override one number and mean it.
   */
  partial: Partial<ErosionOptions> = {},
): ErosionResult {
  const options: ErosionOptions = { ...DEFAULT_EROSION, ...partial };
  const height = Float32Array.from(source);
  const brush = makeBrush(options.radius);
  const random = mulberry32(options.seed);
  const brushCount = brush.weights.length;

  const at = (x: number, y: number) => height[y * width + x]!;

  /**
   * Bilinear height and analytic gradient at a continuous position.
   *
   * Returning both together matters: the gradient must be the gradient of
   * the same interpolant the droplet is walking on, or the droplet drifts
   * uphill on a surface it believes is flat.
   */
  function sample(px: number, py: number): { h: number; gx: number; gy: number } {
    const x = Math.min(width - 2, Math.max(0, Math.floor(px)));
    const y = Math.min(depth - 2, Math.max(0, Math.floor(py)));
    const fx = px - x;
    const fy = py - y;

    const h00 = at(x, y);
    const h10 = at(x + 1, y);
    const h01 = at(x, y + 1);
    const h11 = at(x + 1, y + 1);

    const gx = ((h10 - h00) * (1 - fy) + (h11 - h01) * fy) / cellSize;
    const gy = ((h01 - h00) * (1 - fx) + (h11 - h10) * fx) / cellSize;
    const h =
      h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
    return { h, gx, gy };
  }

  function change(px: number, py: number, amount: number): void {
    const cx = Math.round(px);
    const cy = Math.round(py);
    for (let i = 0; i < brushCount; i++) {
      const x = cx + brush.offsets[i * 2]!;
      const y = cy + brush.offsets[i * 2 + 1]!;
      if (x < 0 || y < 0 || x >= width || y >= depth) continue;
      height[y * width + x] = height[y * width + x]! + amount * brush.weights[i]!;
    }
  }

  for (let d = 0; d < options.droplets; d++) {
    let px = random() * (width - 1);
    let py = random() * (depth - 1);
    let dx = 0;
    let dy = 0;
    let speed = 1;
    let water = 1;
    let sediment = 0;

    for (let step = 0; step < options.maxSteps; step++) {
      const here = sample(px, py);

      // Blend the previous heading with the downhill direction.
      dx = dx * options.inertia - here.gx * (1 - options.inertia);
      dy = dy * options.inertia - here.gy * (1 - options.inertia);
      const length = Math.hypot(dx, dy);
      if (length < 1e-8) break;
      dx /= length;
      dy /= length;

      const nx = px + dx;
      const ny = py + dy;
      if (nx < 1 || ny < 1 || nx >= width - 2 || ny >= depth - 2) break;

      const next = sample(nx, ny);
      const drop = here.h - next.h;

      // Capacity falls to nothing on flat ground, so a droplet that reaches
      // a plain unloads there. That deposition is what builds the fans at
      // the mouth of every valley, and it is half of why the result reads
      // as landscape rather than as scratches.
      const capacity = Math.max(drop, options.minSlope) * speed * water * options.capacity;

      if (sediment > capacity || drop < 0) {
        // Uphill means a pit: fill it, but never above the lip.
        const amount = drop < 0 ? Math.min(-drop, sediment) : (sediment - capacity) * options.deposit;
        sediment -= amount;
        change(px, py, amount);
      } else {
        const amount = Math.min((capacity - sediment) * options.erode, drop);
        sediment += amount;
        change(px, py, -amount);
      }

      speed = Math.sqrt(Math.max(0, speed * speed + drop * 12));
      water *= 1 - options.evaporation;
      if (water < 0.01) break;

      px = nx;
      py = ny;
    }
  }

  const delta = new Float32Array(height.length);
  let maxDelta = 0;
  for (let i = 0; i < height.length; i++) {
    delta[i] = height[i]! - source[i]!;
    const magnitude = Math.abs(delta[i]!);
    if (magnitude > maxDelta) maxDelta = magnitude;
  }

  return { height, delta, maxDelta, droplets: options.droplets };
}

/** Bilinear sample of a grid, for reading the delta back at mesh vertices. */
export function sampleGrid(
  grid: Float32Array,
  width: number,
  depth: number,
  gx: number,
  gy: number,
): number {
  if (gx < 0 || gy < 0 || gx > width - 1 || gy > depth - 1) return 0;
  const x = Math.min(width - 2, Math.floor(gx));
  const y = Math.min(depth - 2, Math.floor(gy));
  const fx = gx - x;
  const fy = gy - y;
  const h00 = grid[y * width + x]!;
  const h10 = grid[y * width + x + 1]!;
  const h01 = grid[(y + 1) * width + x]!;
  const h11 = grid[(y + 1) * width + x + 1]!;
  return h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
}
