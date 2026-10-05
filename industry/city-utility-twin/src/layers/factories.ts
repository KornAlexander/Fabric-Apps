import type { PickDetail, WorldMap } from '../map/worldScene';
import { createFlugverkehrLayer } from '../live/flugverkehr';
import { createBaustellenLayer } from '../live/baustellen';
import { createMvgLayer } from '../live/mvg';
import { createLuftAmtlichLayer } from '../live/luftAmtlich';
import { createLuftBuergerLayer, type SensorArea } from '../live/luftBuerger';
import { createKoordinationLayer, type KoordinationLayer } from '../live/koordination';
import { createWfsLayer } from '../live/wfs';
import { createFahrzeugeLayer } from '../live/fahrzeuge';
import { createRoadworksLayer } from '../live/strassenbaustellen';
import { WFS_LAYERS, GROUP } from '../live/wfsCatalogue';
import type { LiveStatus } from '../live/source';
import type { MessageKey } from '../i18n';
import { ENABLED_FEEDS, isUnofficial } from '../config/feeds';
import { PACK, divisionOn, type ConfigPack, type Division } from '../config/activePack';
import type { WorldId } from '../config/world';
import { layersIn, type AvailabilityMatrix } from '../config/availability';
import type { DataMode } from '../live/dataMode';

/**
 * A layer is only constructed the first time it is switched on.
 *
 * ⚠️ DELIBERATE, NOT LAZINESS. Every layer here opens a connection to a third-party endpoint, and
 * all of them are public services run by other people. An app that fires them all on page load,
 * including on every reload during a rehearsal, is rude and, on a hosted app whose CSP has never
 * been proven, produces a screenful of console failures before the user has asked for anything.
 *
 * ⚠️ A STRING ID, NOT A UNION. The hand-written layers each have their own module; the open-data
 * layers are data, so a new dataset is one entry in `wfsCatalogue.ts`. The panel refuses any row
 * with no factory behind it, so an unknown id cannot slip through unnoticed.
 */
export type LayerFactory = (world: WorldMap, onStatus: (status: LiveStatus) => void) => Promise<void>;

export interface LayerHooks {
  /** MVG pushes a stop's departures into the open panel when they arrive after the click. */
  showDetail(detail: PickDetail | null): void;
  /** The notes layer, once built, so saving a note can refresh it at once. */
  notesReady(layer: KoordinationLayer): void;
}

/** The hand-written layers, in panel order, with the message keys for their name and source. */
export const BUILT_IN_LAYERS = [
  'flugverkehr', 'baustellen', 'baustellen-hamburg', 'baustellen-bw', 'mvg', 'fahrzeuge',
  'luft-amtlich', 'luft-buerger', 'koordination',
] as const;

export type BuiltInLayer = (typeof BUILT_IN_LAYERS)[number];

export function layerNameKey(id: BuiltInLayer): MessageKey {
  return `layer.${id}.name` as MessageKey;
}

/** Where a layer's rows says its data comes from; the vehicle layer reads each city's own feed. */
export function layerSourceKey(id: BuiltInLayer, world: WorldId = 'munich'): MessageKey {
  if (id === 'fahrzeuge' && world !== 'munich') return `layer.fahrzeuge.source.${world}` as MessageKey;
  return `layer.${id}.source` as MessageKey;
}

/**
 * Which utility division a layer belongs to; null for context layers that every pack keeps
 * (air quality, city structure, accessibility).
 */
const BUILT_IN_DIVISION: Record<BuiltInLayer, Division | null> = {
  flugverkehr: 'aviation',
  baustellen: 'construction',
  'baustellen-hamburg': 'construction',
  'baustellen-bw': 'construction',
  koordination: 'construction',
  mvg: 'transit',
  fahrzeuge: 'transit',
  'luft-amtlich': null,
  'luft-buerger': null,
};
const GROUP_DIVISION = new Map<unknown, Division>([
  [GROUP.charging, 'emobility'],
  [GROUP.traffic, 'transit'],
  [GROUP.lines, 'transit'],
]);

export function layerDivision(id: string): Division | null {
  if (id in BUILT_IN_DIVISION) return BUILT_IN_DIVISION[id as BuiltInLayer];
  const spec = WFS_LAYERS.find((entry) => entry.id === id);
  return spec ? GROUP_DIVISION.get(spec.group) ?? null : null;
}

/** Whether a layer exists at all under this pack (its division is switched on). */
export function layerInPack(id: string, pack: ConfigPack = PACK): boolean {
  return divisionOn(layerDivision(id), pack);
}

/**
 * What kind of data each hand-written layer draws; every open-data catalogue layer is a dataset.
 *
 * ⚠️ A REGISTER IS NOT A MEASUREMENT. The roadworks WFS and the geoportal layers are what the
 * city has published, fetched now; badging them "Live" would claim a sensor behind them.
 */
const BUILT_IN_MODE: Record<BuiltInLayer, DataMode> = {
  flugverkehr: 'live',
  baustellen: 'dataset',
  'baustellen-hamburg': 'dataset',
  'baustellen-bw': 'dataset',
  mvg: 'live',
  fahrzeuge: 'planned',
  'luft-amtlich': 'live',
  'luft-buerger': 'live',
  koordination: 'entries',
};

export function layerDataMode(id: string): DataMode {
  return id in BUILT_IN_MODE ? BUILT_IN_MODE[id as BuiltInLayer] : 'dataset';
}

/**
 * How old measured data may be before the badge says "Veraltet" instead of "Live".
 *
 * Each bound sits well above the layer's own poll interval plus the source's usual lag, so a
 * healthy layer never flips: ADS-B polls every 12 s, MVG every 30 s, Sensor.Community every 3 min
 * with readings minutes old, and the Umweltbundesamt publishes an hour about an hour late.
 */
const STALE_AFTER_MS: Partial<Record<BuiltInLayer, number>> = {
  flugverkehr: 2 * 60_000,
  mvg: 5 * 60_000,
  'luft-buerger': 15 * 60_000,
  'luft-amtlich': 2 * 3_600_000,
};

export function layerStaleAfterMs(id: string): number | null {
  return STALE_AFTER_MS[id as BuiltInLayer] ?? null;
}

/** The Umweltbundesamt's `station city` for each world (verified 2026-10-05: 5, 15 and 4 active). */
const UBA_CITY: Record<WorldId, string> = { munich: 'München', hamburg: 'Hamburg', stuttgart: 'Stuttgart' };

/** Sensor.Community query areas: centred on each core, 6 km like Munich's city area. */
const SENSOR_AREAS: Record<WorldId, readonly SensorArea[] | undefined> = {
  munich: undefined, // the layer's own city + airport areas
  hamburg: [{ label: 'Stadt', lat: 53.5455, lon: 10.0035, radiusKm: 6 }],
  stuttgart: [{ label: 'Stadt', lat: 48.7758, lon: 9.177, radiusKm: 6 }],
};

/**
 * Whether a layer has a data source in this city: config/availability.json decides. Most layers
 * are Munich services (its geoportal WFS, MVG, the roadworks and the notes on them, and ADS-B,
 * whose relay only answers for a box around Munich); air quality covers every city.
 */
export function layerAvailableIn(id: string, world: WorldId, matrix?: AvailabilityMatrix): boolean {
  return layersIn(world, matrix).has(id);
}

export function createFactories(
  hooks: LayerHooks,
  enabled: ReadonlySet<string> = ENABLED_FEEDS,
  pack: ConfigPack = PACK,
  worldId: WorldId = 'munich',
): Record<string, LayerFactory> {
  const factories: Record<string, LayerFactory> = {
    flugverkehr: async (world, onStatus) =>
      world.registerLayer(await createFlugverkehrLayer({
        placement: world.placement, onStatus, signal: world.signal,
      })),
    baustellen: async (world, onStatus) =>
      world.registerLayer(await createBaustellenLayer({ placement: world.placement, onStatus })),
    'baustellen-hamburg': async (world, onStatus) =>
      world.registerLayer(await createRoadworksLayer({ placement: world.placement, onStatus, source: 'baustellen-hamburg' })),
    'baustellen-bw': async (world, onStatus) =>
      world.registerLayer(await createRoadworksLayer({ placement: world.placement, onStatus, source: 'baustellen-bw' })),
    mvg: async (world, onStatus) =>
      world.registerLayer(await createMvgLayer({
        placement: world.placement,
        onStatus,
        // Only ten stops are polled on a timer, so a click on any other stop has nothing to show
        // at the moment of the click. This lets the layer push the answer in when it arrives.
        onDetail: (detail) => hooks.showDetail(detail),
      })),
    fahrzeuge: async (world, onStatus) =>
      world.registerLayer(await createFahrzeugeLayer({ placement: world.placement, onStatus, city: worldId })),
    'luft-amtlich': async (world, onStatus) =>
      world.registerLayer(await createLuftAmtlichLayer({
        placement: world.placement,
        onStatus,
        city: UBA_CITY[worldId],
        // Frame the stations the first time they are drawn. Without this the layer switches on,
        // reports five stations and shows an empty view, because none of them happen to fall in
        // the default camera's frame.
        //
        // ⚠️ 4 km, AND THE NUMBER IS MEASURED. Horizontal distance from the default München target
        // to each station: 1838, 1920, 3224, 5667 and 9252 m. A 6 km preference pulled in
        // Johanneskirchen at 5667 m and pushed the camera to 13.7 km altitude, which frames five
        // columns and no city. At 4 km the three inner stations are framed from about 4 km up,
        // and those three are the interesting comparison anyway: two Verkehr stations and one
        // Hintergrund station within 3 km of each other.
        onFirstDraw: (points) => world.flyToPoints(points, 4000),
        onSelectionStale: () => world.clearPick(),
      })),
    'luft-buerger': async (world, onStatus) =>
      world.registerLayer(await createLuftBuergerLayer({
        placement: world.placement,
        onStatus,
        areas: SENSOR_AREAS[worldId],
        onSelectionStale: () => world.clearPick(),
      })),
    koordination: async (world, onStatus) => {
      const layer = await createKoordinationLayer({
        placement: world.placement,
        onStatus,
        onSelectionStale: () => world.clearPick(),
      });
      hooks.notesReady(layer);
      world.registerLayer(layer);
    },
  };

  // Every measured open dataset becomes a layer without a line of layer-specific code: the engine
  // handles point, line and polygon, so another dataset of the city is an entry, not a module.
  for (const spec of WFS_LAYERS) {
    factories[spec.id] = async (world, onStatus) =>
      world.registerLayer(await createWfsLayer(spec, { placement: world.placement, onStatus }));
  }
  // Unofficial interfaces are dropped unless this build enabled them; the panel then shows the
  // row as switched off rather than offering a layer that would call them.
  for (const id of Object.keys(factories)) {
    if (isUnofficial(id) && !enabled.has(id)) delete factories[id];
    // A division the pack switches off has no layers at all, not disabled ones.
    else if (!layerInPack(id, pack)) delete factories[id];
    // A layer with no source in this city is not offered; the panel says why.
    else if (!layerAvailableIn(id, worldId)) delete factories[id];
  }
  return factories;
}
