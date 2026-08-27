import * as THREE from 'three';

import { configureDrapeTexture } from './terrainLoader';

/**
 * High-resolution aerial detail tiles — the sharpness the base drape cannot hold.
 *
 * `fetch_drape.py` fetches one photograph for the whole AOI, and one photograph for the whole AOI
 * is as sharp as WebGL2's guaranteed 8192 px texture side allows: **2.878 m/px** over the Ahr's
 * 23.6 km box. The source, Rheinland-Pfalz's DOP20, is flown at **0.20 m**. So fourteen times the
 * detail exists, is free, is already licensed for this use — and simply has nowhere to sit.
 *
 * `tools/geodata/fetch_drape_detail.py` cuts that missing detail into small windows centred on the
 * focus places, in two sizes. This module decides which one the camera is currently looking at,
 * fetches it, and keeps exactly one resident.
 *
 * Three properties are deliberate:
 *
 * - **One tile at a time.** A 4096 px RGBA texture is ~67 MB of video memory. Two tiers resident
 *   at once would be 134 MB on top of a 62 MB building mesh, which is more than an integrated GPU
 *   should be asked for. The base drape covers everything the window does not.
 * - **Nothing is fetched unless asked.** All forty tiles are 154 MB on disk; a visitor downloads
 *   at most one of them, and only after switching photorealistic rendering on.
 * - **The window is not a cliff.** Outside the rect the shader falls back to the base drape, with
 *   a feathered margin. The photograph never stops — it only stops being sharp.
 */

export interface DetailRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface DetailTileMeta {
  file: string;
  px: number;
  spanM: number;
  metresPerPixel: number;
  bytes: number;
  /** Exposure correction measured from this tile's own ground pixels, not inherited from the AOI. */
  renderGamma: number;
  meanGroundLuma: number;
  /** The window, in the uv the heightmap, the base drape and the buildings all share. */
  rect: DetailRect;
  centre: { easting: number; northing: number };
}

export interface DetailPlaceMeta {
  id: string;
  name: string;
  tiles: Record<string, DetailTileMeta>;
}

export interface DetailTierMeta {
  id: string;
  spanM: number;
  px: number;
  metresPerPixel: number;
}

export interface DrapeDetailManifest {
  alignedTo: string;
  crs: string;
  tiers: DetailTierMeta[];
  source: string;
  layer: string;
  licence: string;
  attribution: string;
  acquisitionNote: string;
  places: DetailPlaceMeta[];
}

/**
 * How much finer than a screen pixel a texture has to be before it looks sharp.
 *
 * Not a fudge factor: a texture sampled at exactly one texel per pixel is still visibly soft,
 * because mipmap selection works on the texel footprint and picks the blurrier level as soon as
 * the footprint exceeds one. 1.5 is modest headroom for that, and it is the difference between
 * "technically enough resolution" and "reads as a photograph".
 */
export const SHARPNESS_HEADROOM = 1.5;

/**
 * How far past a boundary the view has to go before a loaded tile is replaced.
 *
 * Without it, parking the camera on a threshold and nudging the wheel re-downloads several
 * megabytes per nudge. Applied symmetrically — the resident tier is easier to keep and every other
 * tier is harder to take over — so the dead band sits around the boundary rather than beside it.
 */
export const TIER_HYSTERESIS = 1.18;

/**
 * How much of the visible width a window has to span before it is worth loading.
 *
 * A window narrower than the view puts a sharp rectangle in the middle of a soft picture, and the
 * feathered edge — which is invisible when the window is off screen — becomes a band across the
 * hillside. Requiring the window to cover most of the width keeps the transition out at the
 * margins, where the ground is most oblique and least legible anyway.
 *
 * 0.8 rather than 1.0: the view is wider than the window is deep in any case, because an oblique
 * camera sees ground all the way to the haze, so demanding full coverage would only ever be met
 * from directly overhead.
 */
export const MIN_WINDOW_COVER = 0.8;

export interface DetailChoice {
  placeId: string;
  tier: string;
  tile: DetailTileMeta;
}

/** The key that identifies a resident tile. Exported so tests can name one without a texture. */
export function detailKey(choice: DetailChoice | null): string | null {
  return choice ? `${choice.placeId}:${choice.tier}` : null;
}

/**
 * How much ground one pixel of the drawing buffer covers, at the point being looked at.
 *
 * ⚠️ Drawing-buffer pixels, not CSS pixels. The renderer runs at up to `devicePixelRatio` 2, so a
 * 800 px-tall canvas on a retina display is resolving 1600 rows and needs twice the texture.
 * Measuring in CSS pixels would under-fetch on exactly the machines that can show the difference.
 */
export function screenMetresPerPixel(
  rangeM: number,
  verticalFovDeg: number,
  bufferHeightPx: number
): number {
  if (!(bufferHeightPx > 0)) return Infinity;
  return (2 * rangeM * Math.tan((verticalFovDeg * Math.PI) / 360)) / bufferHeightPx;
}

/**
 * Which tier is worth having, given what the screen can actually resolve.
 *
 * This started life as a table of camera distances and that was wrong in a way the shader could
 * not show: at the opening framing — 3.4 km — one screen pixel covers about 3.3 m of ground, so
 * the 2.878 m/px base drape is ALREADY finer than the screen and a 4 MB window changes nothing
 * anybody can see. A distance table also cannot know the viewport or the pixel ratio, so the same
 * threshold was simultaneously wasteful on a small window and stingy on a retina one.
 *
 * So the question is asked properly: is the base photograph coarser than this screen, and if so
 * what is the *coarsest* window that is not? Coarsest, not finest — the finer tier is not better
 * once neither is the limiting factor, it is just four more megabytes.
 *
 * Returns null when the base drape is enough, which is most of the time and is the whole reason
 * this feature costs a distant viewer nothing.
 */
export function tierForScreen(
  tiers: readonly DetailTierMeta[],
  screenMpp: number,
  baseMpp: number,
  currentTierId: string | null
): DetailTierMeta | null {
  if (Number.isNaN(screenMpp) || Number.isNaN(baseMpp)) return null;
  if (!Number.isFinite(screenMpp)) return null;
  const demand = screenMpp / SHARPNESS_HEADROOM;

  // Nothing to gain while the AOI-wide photograph already out-resolves the screen.
  const baseLimit = currentTierId ? baseMpp * TIER_HYSTERESIS : baseMpp;
  if (demand >= baseLimit) return null;

  const sorted = [...tiers].sort((a, b) => a.metresPerPixel - b.metresPerPixel);
  let pick: DetailTierMeta | null = sorted[0] ?? null;
  for (const tier of sorted) {
    // With nothing resident the boundaries are exactly where the resolutions say they are. Once a
    // tile IS resident it becomes cheaper to keep and every other tier has to clear the bar by the
    // same margin to displace it, which puts the dead band ON the boundary rather than beside it.
    let limit = tier.metresPerPixel;
    if (currentTierId !== null) {
      limit =
        tier.id === currentTierId
          ? tier.metresPerPixel / TIER_HYSTERESIS
          : tier.metresPerPixel * TIER_HYSTERESIS;
    }
    if (limit <= demand) pick = tier;
  }
  return pick;
}

function rectContains(rect: DetailRect, u: number, v: number): boolean {
  return u >= rect.u0 && u <= rect.u1 && v >= rect.v0 && v <= rect.v1;
}

function rectCentreDistance(rect: DetailRect, u: number, v: number): number {
  const du = (rect.u0 + rect.u1) / 2 - u;
  const dv = (rect.v0 + rect.v1) / 2 - v;
  return Math.hypot(du, dv);
}

/**
 * Which detail tile, if any, the camera is currently looking at.
 *
 * Pure, so the decision can be tested without a GPU: it is the part that can be wrong in a way no
 * screenshot would obviously show — the wrong village's photograph is still a photograph of a
 * village in the Ahr valley.
 *
 * A tier whose windows do not cover the view falls through to the next coarser one, which spans
 * more ground. Between two villages that is the difference between a sharp window and none.
 */
export function chooseDetailTile(
  manifest: DrapeDetailManifest | null,
  focus: { u: number; v: number },
  view: { screenMpp: number; baseMpp: number; viewWidthM: number },
  current: DetailChoice | null = null
): DetailChoice | null {
  if (!manifest) return null;
  if (!Number.isFinite(focus.u) || !Number.isFinite(focus.v)) return null;

  // A window that does not span what is on screen is not an improvement, it is a patch.
  const wide = Number.isFinite(view.viewWidthM)
    ? manifest.tiers.filter((t) => t.spanM >= view.viewWidthM * MIN_WINDOW_COVER)
    : manifest.tiers;
  if (wide.length === 0) return null;

  const wanted = tierForScreen(wide, view.screenMpp, view.baseMpp, current?.tier ?? null);
  if (!wanted) return null;

  const byResolution = [...wide].sort((a, b) => a.metresPerPixel - b.metresPerPixel);
  const from = byResolution.findIndex((t) => t.id === wanted.id);

  for (let i = Math.max(0, from); i < byResolution.length; i++) {
    const tierId = byResolution[i].id;
    let best: DetailChoice | null = null;
    let bestDistance = Infinity;
    for (const place of manifest.places) {
      const tile = place.tiles[tierId];
      if (!tile || !rectContains(tile.rect, focus.u, focus.v)) continue;
      const d = rectCentreDistance(tile.rect, focus.u, focus.v);
      if (d < bestDistance) {
        bestDistance = d;
        best = { placeId: place.id, tier: tierId, tile };
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * Where on the ground the camera is looking, and how far away that is.
 *
 * Pure ray-plane intersection, because it has to work in both camera modes and they disagree
 * about what the view centre is. Orbiting, `controls.target` is the answer; in free flight the
 * controls are disabled and their target is wherever the camera left it, which can be kilometres
 * behind the drone. Intersecting the view direction with the ground plane gives the same answer as
 * the orbit target when orbiting, and the right one when flying.
 *
 * Looking at or above the horizon there is no intersection, so the range is clamped — the view
 * centre is then somewhere beyond the far end of the valley and no detail tile applies anyway.
 */
export function groundFocusPoint(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  planeY: number,
  maxRangeM: number
): { x: number; z: number; rangeM: number } {
  let range = maxRangeM;
  if (direction.y < -1e-4) {
    const t = (planeY - origin.y) / direction.y;
    if (t > 0) range = Math.min(t, maxRangeM);
  }
  return {
    x: origin.x + direction.x * range,
    z: origin.z + direction.z * range,
    rangeM: range,
  };
}

/**
 * The manifest, or null when this AOI has no detail tiles.
 *
 * Null is an ordinary answer, not a failure: only the Ahr has been through
 * `fetch_drape_detail.py`, and the other three scenes must keep rendering exactly as they did.
 */
export async function loadDrapeDetailManifest(
  root: string
): Promise<DrapeDetailManifest | null> {
  try {
    const response = await fetch(`${root}/drape_detail.json`);
    if (!response.ok) return null;
    const body = (await response.json()) as DrapeDetailManifest;
    // ⚠️ The Fabric static host answers a missing asset with index.html and HTTP 200, so "it
    // parsed as JSON and has places" is the check, not "the request succeeded".
    if (!Array.isArray(body?.places) || !Array.isArray(body?.tiers)) return null;
    return body;
  } catch {
    return null;
  }
}

/**
 * Keeps at most one detail texture resident, and disposes the one it replaces.
 *
 * The load is not cancellable — a decoding JPEG runs to completion — so instead each request
 * carries a token and a result that is no longer wanted is disposed on arrival rather than
 * installed. Without that, flying quickly through three villages leaves whichever tile happened
 * to decode last on screen, which is the wrong village's photograph and looks like a
 * mis-registration rather than a race.
 */
export class DetailTileCache {
  private token = 0;
  private currentKey: string | null = null;
  private texture: THREE.Texture | null = null;
  private loader = new THREE.TextureLoader();

  constructor(
    private readonly root: string,
    /**
     * Max anisotropy of this renderer, applied on install rather than by a separate call.
     *
     * ⚠️ It has to be set on every tile, not once on the first. A detail tile is a photograph
     * lying flat on the ground and is therefore almost always seen at a grazing angle — the one
     * case isotropic filtering turns to mush, and the one this whole feature exists to sharpen.
     */
    private readonly anisotropy: number,
    private readonly onChange: (texture: THREE.Texture | null, choice: DetailChoice | null) => void
  ) {}

  /** The tile currently on the GPU, so the caller can pass it back as `current` next frame. */
  get key(): string | null {
    return this.currentKey;
  }

  /**
   * Ask for a tile. Idempotent: requesting what is already resident does nothing at all, which is
   * what makes this safe to call from the animation loop.
   */
  request(choice: DetailChoice | null): void {
    const key = detailKey(choice);
    if (key === this.currentKey) return;

    const mine = ++this.token;
    this.currentKey = key;

    if (!choice) {
      this.install(null, null, mine);
      return;
    }
    void this.loader
      .loadAsync(`${this.root}/${choice.tile.file}`)
      .then((texture) => {
        if (mine !== this.token) {
          texture.dispose();
          return;
        }
        this.install(this.configure(texture), choice, mine);
      })
      .catch(() => {
        // A tile that will not load is not an error the viewer needs: the base drape is still
        // there and still correct, just softer.
        if (mine === this.token) this.install(null, null, mine);
      });
  }

  /** Give the texture the same grazing-angle treatment the base drape gets. */
  private configure(texture: THREE.Texture): THREE.Texture {
    configureDrapeTexture(texture);
    texture.anisotropy = this.anisotropy;
    texture.needsUpdate = true;
    return texture;
  }

  private install(texture: THREE.Texture | null, choice: DetailChoice | null, mine: number): void {
    if (mine !== this.token) {
      texture?.dispose();
      return;
    }
    this.texture?.dispose();
    this.texture = texture;
    this.onChange(texture, choice);
  }

  dispose(): void {
    this.token++;
    this.texture?.dispose();
    this.texture = null;
    this.currentKey = null;
  }
}
