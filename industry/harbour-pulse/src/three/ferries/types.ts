/**
 * Data-only description of one real Sydney ferry's look, used by `VoxelFerry`
 * to build a voxel model that matches its actual fleet class and livery. Each
 * real vessel gets its own spec file under `src/three/ferries/`; the shared
 * hull builder in `VoxelFerry` turns a spec into geometry.
 */

/** Twin-pontoon catamarans vs. a single-hull "monohull" vessel. */
export type HullType = 'catamaran' | 'monohull';

/** Where the wheelhouse sits: a separate raised block forward, or built into
 * the roof of the main cabin (as on single-deck catamarans). */
export type WheelhousePosition = 'forward' | 'center';

export interface FerryLivery {
  hull: number;
  boot: number;
  cabin: number;
  roof: number;
  trim: number;
  glass: number;
  funnel: number;
}

export interface FerryModelSpec {
  /** Matches the `ferry_name` business key / public/ferries photo file stem. */
  name: string;
  /** Real-world fleet class, shown in the UI (e.g. "First Fleet class"). */
  fleetClass: string;
  hullType: HullType;
  livery: FerryLivery;
  /** Hull length/beam relative to the class-average baseline (1 = baseline). */
  scale: { length: number; beam: number };
  /** 1 = single enclosed saloon deck, 2 = lower saloon + set-back upper deck. */
  decks: 1 | 2;
  hasFunnel: boolean;
  wheelhouse: WheelhousePosition;
}

/** Look used for live ferries not yet matched to a researched real vessel. */
export const DEFAULT_FERRY_SPEC: FerryModelSpec = {
  name: 'Unknown',
  fleetClass: 'Sydney Ferries fleet',
  hullType: 'catamaran',
  livery: {
    hull: 0x0e7a3d,
    boot: 0x14181c,
    cabin: 0xeee0a4,
    roof: 0xe7dfc0,
    trim: 0x0e7a3d,
    glass: 0x2a3b47,
    funnel: 0x0e7a3d,
  },
  scale: { length: 1, beam: 1 },
  decks: 2,
  hasFunnel: false,
  wheelhouse: 'forward',
};
