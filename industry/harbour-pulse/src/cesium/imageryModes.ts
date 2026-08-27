/**
 * ── The three ways this app can paint the world ────────────────────────────────────────────────
 *
 * They differ in what they cost and what they oblige us to say, not just in how they look:
 *
 *   osm  — OpenStreetMap raster + our own extruded footprints. No account anywhere. A road map,
 *          not photography: correct, free, and flat-looking. The honest baseline.
 *   ion  — Google Photorealistic 3D Tiles brokered through Cesium ion. The real "wow", and the
 *          only mode that spends anything. ion's free tier is NON-COMMERCIAL, so this is fine for
 *          an internal demo and needs a paid tier before it goes in front of a customer.
 *   nsw  — New South Wales Government aerial orthophotography. Real photography of the actual
 *          harbour, no token, no metered API, no account — the same trick as the Helsinki twin,
 *          which streams the city's own open data instead of buying it back from a broker.
 *
 * ⚠️ `nsw` is NOT a photogrammetric mesh. Sydney does not publish one openly: NSW's reality-mesh
 * scene layers cover four City-West blocks plus Fort Denison, they are I3S rather than 3D Tiles,
 * and — checked from this app's own origin — they serve NO CORS headers, so a browser cannot read
 * them at all. What NSW does publish is a full aerial tile cache, and it does send CORS. So `nsw`
 * gives a photographed ground with modelled buildings on top, which from ferry altitude is where
 * nearly all of the visual difference lives anyway.
 */
export type ImageryMode = 'osm' | 'ion' | 'nsw';

/**
 * NSW Spatial Services' public tile cache (the one behind SIX Maps).
 * ArcGIS caches are addressed `/tile/{level}/{row}/{col}` — i.e. z/y/x, NOT z/x/y — and this one
 * uses the standard Web Mercator scheme, verified by deriving tiles for the Opera House with the
 * plain slippy-map formula and getting back real imagery at z12/14/16/18.
 */
export const NSW_IMAGERY_URL =
  'https://portal.spatial.nsw.gov.au/aid/tile/rest/services/NSWWebImagery/MapServer';

export const NSW_IMAGERY_TILE_TEMPLATE = `${NSW_IMAGERY_URL}/tile/{z}/{y}/{x}`;

/**
 * Required attribution. The imagery datasets are published CC BY on data.nsw.gov.au; the wording
 * is Spatial Services' own.
 */
export const NSW_CREDIT =
  'Imagery © State of New South Wales (Spatial Services, Department of Customer Service) · CC BY';

/** Roughly the NSW state bounding box — outside it the service has nothing, so don't ask. */
export const NSW_BOUNDS = { west: 140.9, south: -37.6, east: 153.7, north: -28.1 } as const;

/**
 * Sydney sea level sits ~23 m above the WGS84 ellipsoid. Cesium works in ellipsoidal heights and
 * the baked terrain/building/tree files store metres above SEA LEVEL, so this is added to every
 * one of them — the same constant the ferry models use, which is what makes the vessels float on
 * the water instead of 23 m under it.
 */
export const GEOID_OFFSET_M = 23;

export interface ImageryModeInfo {
  id: ImageryMode;
  /** Shown in the dropdown. */
  label: string;
  /** Shown in the status pill — shorter. */
  short: string;
  /** Tooltip: what it actually does and what it costs. */
  hint: string;
  /** True when the mode needs a Cesium ion token to be present in the bundle. */
  needsIonToken: boolean;
  /**
   * Always-visible credit line for this mode, or null to leave it to Cesium.
   *
   * ⚠️ Cesium collects registered credits behind a "Data attribution" link. That is fine for a
   * logo, but the baked buildings and trees are OpenStreetMap under **ODbL**, whose share-alike
   * attribution should not sit behind a click the viewer has no reason to press. ion mode is left
   * to Cesium deliberately — Google and ion require their own rendered logos, and reproducing
   * those by hand would be worse, not better.
   */
  attribution: string | null;
}

export const IMAGERY_MODES: ImageryModeInfo[] = [
  {
    id: 'osm',
    label: '🗺 OpenStreetMap',
    short: 'OpenStreetMap',
    hint: 'Keyless OpenStreetMap map tiles with extruded building footprints. No account, no API key — but a drawn map, not photography.',
    needsIonToken: false,
    attribution:
      '© OpenStreetMap contributors (ODbL) · Elevation: AWS Terrain Tiles / Geoscience Australia',
  },
  {
    id: 'nsw',
    label: '🛩 NSW aerial (open data)',
    short: 'NSW aerial',
    hint: 'Real aerial photography of Sydney from the NSW Government open-data tile service, with buildings and trees on top. No token and nothing metered.',
    needsIonToken: false,
    attribution:
      'Imagery © State of New South Wales (Spatial Services, CC BY) · Buildings & trees © OpenStreetMap contributors (ODbL) · Elevation: AWS Terrain Tiles / Geoscience Australia',
  },
  {
    id: 'ion',
    label: '🛰 Photorealistic 3D (Cesium ion)',
    short: 'Photoreal 3D',
    hint: 'Google Photorealistic 3D Tiles streamed through Cesium ion. The full photogrammetric city mesh — this is the only mode that uses your key.',
    needsIonToken: true,
    attribution: null,
  },
];

export function modeInfo(id: ImageryMode): ImageryModeInfo {
  return IMAGERY_MODES.find((m) => m.id === id) ?? IMAGERY_MODES[0];
}
