/**
 * The world: two high-resolution cores on one continuous terrain.
 *
 * ⚠️ NOTHING HERE IS A POSITION IN THE SCENE. Every world coordinate is derived at runtime from
 * the generated `heightmap.json` of each core (its UTM origin and grid size), so a re-bake that
 * snaps a grid origin a few metres cannot silently slide a camera target across the map. What
 * this file holds is the part a human decided: which cores exist, what they are called, and where
 * the camera should look when you arrive at one.
 *
 * The `u`/`v` anchors are normalised positions inside each core's own heightmap, which is the one
 * form that survives a re-bake at a different resolution.
 */

export interface SiteConfig {
  /** Directory under `public/terrain/`, and the value of the `?ort=` deep link. */
  readonly id: string;
  /** German label. The app's UI is German; the audience and all four data owners are German. */
  readonly name: string;
  /** One line under the name in the switcher. */
  readonly subtitle: string;
  /** Normalised east position of the camera target inside this core's heightmap. */
  readonly u: number;
  /** Normalised south position (v = 0 is the NORTH edge, matching the raster row order). */
  readonly v: number;
  /**
   * Ground elevation at the anchor, in metres. ⚠️ MEASURED BY THE BUILD, not typed: each value
   * below was printed by `build_terrain.py` when it sampled the focus places, and re-checked by
   * `verify_registration.py` check C.
   */
  readonly groundM: number;
  /** Camera distance on arrival, in metres. */
  readonly rangeM: number;
  /** Whether this core ships tree instances. The airfield core deliberately does not. */
  readonly hasVegetation: boolean;
}

/**
 * ⚠️ The FIRST entry is the default arrival site and the world origin. Everything else is placed
 * relative to it, so reordering this array moves the origin of the scene.
 */
export const SITES: readonly SiteConfig[] = [
  {
    id: 'munich',
    name: 'München Zentrum',
    subtitle: 'Maxvorstadt und Altstadtrand',
    // Geschwister-Scholl-Platz. A measured map anchor, not a displayed place label.
    u: 0.60175,
    v: 0.30707,
    groundM: 511.89,
    rangeM: 1700,
    hasVegetation: true,
  },
  {
    id: 'flughafen',
    name: 'Flughafen München',
    subtitle: 'Nord- und Südbahn, Terminal 1 und 2',
    // Munich Airport Center, OSM way/4446890. build_terrain.py sampled u=0.502 v=0.528 at 452.3 m.
    u: 0.502,
    v: 0.528,
    groundM: 452.3,
    // Larger than the city anchor because the subject here is an 8.5 km airfield rather than a
    // square, and arriving at 1700 m puts the camera inside Terminal 2's roof.
    rangeM: 3400,
    hasVegetation: false,
  },
];

export const DEFAULT_SITE = SITES[0].id;

/** The core that defines the world origin. */
export const ORIGIN_SITE = SITES[0].id;

/**
 * Which core's directory holds the shell that covers the WHOLE world.
 *
 * ⚠️ NOT THE ORIGIN CORE. The union shell was built under the airport AOI, because that is the
 * AOI whose `shell` box is the union of both sites' surroundings (see config/aoi/flughafen.json).
 * The city core still carries its own older, smaller shell on disk; loading that one would leave
 * the airfield sitting outside the terrain entirely.
 */
export const WORLD_SHELL_SITE = 'flughafen';

export function siteById(id: string): SiteConfig | undefined {
  return SITES.find((site) => site.id === id);
}

/**
 * Which site the app should open at.
 *
 * ⚠️ VALIDATED AGAINST THE SHIPPED LIST, never used as a path fragment directly. `?ort=` arrives
 * from the address bar, and the asset reader builds a URL from the site id; an unchecked value
 * would be a path-traversal seam straight into the fetch layer.
 */
export function requestedSiteId(search: string): string {
  const raw = new URLSearchParams(search).get('ort');
  return raw && SITES.some((site) => site.id === raw) ? raw : DEFAULT_SITE;
}
