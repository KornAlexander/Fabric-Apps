/**
 * Footer attribution, one list per scene.
 *
 * ⚠️ Rheinland-Pfalz publishes under dl-de/by-2-0, which *requires* attribution; North
 * Rhine-Westphalia under dl-de/zero-2-0, which does not. Showing the RLP line under a map built
 * from NRW tiles credits the wrong authority and states the wrong terms — the footer follows the
 * scene rather than being one fixed list.
 *
 * The survey line is read from the AOI config rather than retyped here. It had already drifted:
 * the footer credited "Land NRW (2021)" — the scenario year, evidently taken from the AOI id —
 * for tiles retrieved in 2026, while the config and the terrain sidecar both said 2026. The Ahr
 * line, which nobody had retyped, was correct. Taking both from the config removes the copy that
 * can go stale.
 */

import ahrtal from '@config/aoi/ahrtal-2021.json';
import castelbolognese from '@config/aoi/castelbolognese-2023.json';
import hortasud from '@config/aoi/hortasud-2024.json';
import steinbach from '@config/aoi/steinbach-2021.json';

export const ATTRIBUTION = [
  ahrtal.geobasis.attribution,
  '© European Union, Copernicus Emergency Management Service (EMSR517)',
  '© Deutscher Wetterdienst (DWD)',
  '© OpenStreetMap contributors (ODbL)',
  '© Landesamt für Umwelt Rheinland-Pfalz / HVZ',
];

export const CORRIDOR_ATTRIBUTION = [
  steinbach.geobasis.attribution,
  '© OpenStreetMap contributors (ODbL)',
  'Hydrotec / e-regio — Dammbruchszenario Steinbachtalsperre',
];

/**
 * Every scene's credits, by scene id.
 *
 * ⚠️ This replaces a two-way choice, and the two-way choice was already wrong the moment a third
 * scene existed. The footer read `isValley ? ATTRIBUTION : CORRIDOR_ATTRIBUTION`, so the Spanish
 * and Italian reaches were credited to Geobasis NRW under dl-de/zero-2-0, with the Steinbach
 * dam-break study attached — the wrong authority, the wrong licence and a study about a different
 * country, on a scene showing neither. It is the same mistake the split footer was written to
 * prevent, reintroduced by adding scenes rather than by editing the footer.
 *
 * Keyed by scene id and read from each AOI's own config, so a new AOI cannot inherit someone
 * else's credit by falling through a branch. `attribution.test.ts` asserts every registered scene
 * has an entry.
 */
export const SCENE_ATTRIBUTION: Record<string, string[]> = {
  'ahrtal-2021': ATTRIBUTION,
  'steinbach-2021': CORRIDOR_ATTRIBUTION,
  'hortasud-2024': [
    hortasud.geobasis.attribution,
    '© European Union, Copernicus Emergency Management Service (EMSR773)',
    '© OpenStreetMap contributors (ODbL)',
  ],
  'castelbolognese-2023': [
    castelbolognese.geobasis.attribution,
    '© European Union, Copernicus Emergency Management Service (EMSR664)',
    '© OpenStreetMap contributors (ODbL)',
  ],
};

/** The credits for a scene. Throws rather than guessing: a wrong credit is a licence breach. */
export function attributionFor(sceneId: string): string[] {
  const lines = SCENE_ATTRIBUTION[sceneId];
  if (!lines) {
    throw new Error(
      `No attribution registered for scene '${sceneId}'. Add it to SCENE_ATTRIBUTION — falling ` +
        `back to another scene's credits would state the wrong authority and the wrong licence.`
    );
  }
  return lines;
}
