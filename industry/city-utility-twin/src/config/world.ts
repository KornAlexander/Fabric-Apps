/**
 * The worlds: one per city, each with its own high-resolution cores on one continuous terrain.
 *
 * ⚠️ A WORLD IS A CITY, AND CITIES DO NOT SHARE ONE. Munich's two cores (city and airport, 28 km
 * apart) sit on one shell and the camera flies between them. Hamburg and Stuttgart are 600 and
 * 200 km away: one scene for all of them would put cores beyond the far plane, cost float32
 * precision at the far ones and exceed the shell shader's two-core limit. So each city is its own
 * world with its own origin and shell, and switching city rebuilds the scene (decided 2026-10-05).
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

import { both, type Text } from '../i18n';

/** A city with its own scene. The id is also the config pack's city id. */
export type WorldId = 'munich' | 'hamburg' | 'stuttgart';

export interface SiteConfig {
  /** Directory under `public/terrain/`, and the value of the `?ort=` deep link. */
  readonly id: string;
  /** Which city's scene this core belongs to. */
  readonly world: WorldId;
  /** Site name in the switcher, German or English with the app. */
  readonly name: Text;
  /** One line under the name in the switcher. */
  readonly subtitle: Text;
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
 * ⚠️ The FIRST entry of each world is that world's default arrival site and its origin. Everything
 * else in the world is placed relative to it, so reordering a world's entries moves its origin.
 */
export const SITES: readonly SiteConfig[] = [
  {
    id: 'munich',
    world: 'munich',
    name: both('München Zentrum', 'Munich city centre'),
    subtitle: both('Maxvorstadt und Altstadtrand', 'Maxvorstadt and the old town edge'),
    // Geschwister-Scholl-Platz. A measured map anchor, not a displayed place label.
    u: 0.60175,
    v: 0.30707,
    groundM: 511.89,
    rangeM: 1700,
    hasVegetation: true,
  },
  {
    id: 'flughafen',
    world: 'munich',
    name: both('Flughafen München', 'Munich Airport'),
    subtitle: both('Nord- und Südbahn, Terminal 1 und 2', 'North and south runways, Terminals 1 and 2'),
    // Munich Airport Center, OSM way/4446890. build_terrain.py sampled u=0.502 v=0.528 at 452.3 m.
    u: 0.502,
    v: 0.528,
    groundM: 452.3,
    // Larger than the city anchor because the subject here is an 8.5 km airfield rather than a
    // square, and arriving at 1700 m puts the camera inside Terminal 2's roof.
    rangeM: 3400,
    hasVegetation: false,
  },
  {
    id: 'hamburg-centre',
    world: 'hamburg',
    name: both('Hamburg Innenstadt', 'Hamburg city centre'),
    subtitle: both('Altstadt, Speicherstadt und HafenCity', 'Old Town, Speicherstadt and HafenCity'),
    // Over the Speicherstadt, between the Rathaus and HafenCity (53.5442 N 10.0035 E).
    // Measured 2026-10-05 from the built heightmap (2022 LGV DGM1).
    u: 0.50084,
    v: 0.56121,
    groundM: 7.29,
    rangeM: 1700,
    // No tree layer yet: the Munich one comes from the Bavarian single-tree cadastre, and no
    // equivalent source has been built for Hamburg.
    hasVegetation: false,
  },
  {
    id: 'stuttgart-centre',
    world: 'stuttgart',
    name: both('Stuttgart Zentrum', 'Stuttgart city centre'),
    subtitle: both('Hauptbahnhof bis Marienplatz', 'Main station to Marienplatz'),
    // Schlossplatz (OSM node/265921689). Measured 2026-10-05 from the built heightmap (LGL DGM1).
    u: 0.5465,
    v: 0.40925,
    groundM: 247.18,
    rangeM: 1700,
    // No tree layer yet, as for Hamburg: no tree source has been built for Baden-Wuerttemberg.
    hasVegetation: false,
  },
];

/**
 * Each world's shell core: the one whose AOI declares that world's surrounding box.
 *
 * ⚠️ For Munich it is NOT the origin core. The union shell was built under the airport AOI,
 * because that is the AOI whose `shell` box covers both Munich sites (see config/aoi/flughafen.json);
 * loading the city core's own older shell would leave the airfield outside the terrain.
 */
export const WORLDS: Readonly<Record<WorldId, { readonly shellSite: string }>> = {
  munich: { shellSite: 'flughafen' },
  hamburg: { shellSite: 'hamburg-centre' },
  stuttgart: { shellSite: 'stuttgart-centre' },
};

export const DEFAULT_SITE = SITES[0].id;

/** Each world's shell core, keyed by world (= config pack city) id. */
export const SHELL_SITES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(WORLDS).map(([id, world]) => [id, world.shellSite]),
);

/** The sites of one world, in declaration order (the first is that world's origin). */
export function worldSites(world: WorldId, sites: readonly SiteConfig[] = SITES): SiteConfig[] {
  return sites.filter((site) => site.world === world);
}

export function siteById(id: string): SiteConfig | undefined {
  return SITES.find((site) => site.id === id);
}

/**
 * Which site the app should open at.
 *
 * ⚠️ VALIDATED AGAINST THE SHIPPED LIST, never used as a path fragment directly. `?ort=` arrives
 * from the address bar, and the asset reader builds a URL from the site id; an unchecked value
 * would be a path-traversal seam straight into the fetch layer. The config pack narrows the list
 * further (`sites`) and names the fallback (`fallback`).
 */
export function requestedSiteId(
  search: string,
  sites: readonly SiteConfig[] = SITES,
  fallback: string = DEFAULT_SITE,
): string {
  const raw = new URLSearchParams(search).get('ort');
  return raw && sites.some((site) => site.id === raw) ? raw : fallback;
}
