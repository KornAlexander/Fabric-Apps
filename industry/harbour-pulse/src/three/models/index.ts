import type { FerryModelSpec } from '@/three/ferries/types';
import { VoxelFerry } from '@/three/VoxelFerry';

import { EmeraldClassFerry } from './EmeraldClassFerry';
import { FirstFleetFerry } from './FirstFleetFerry';
import { FreshwaterClassFerry } from './FreshwaterClassFerry';
import { HarbourCatFerry } from './HarbourCatFerry';
import { InnerHarbourFerry } from './InnerHarbourFerry';
import { ParramattaRiverFerry } from './ParramattaRiverFerry';
import { RiverClassFerry } from './RiverClassFerry';

type FerryModelCtor = new (spec: FerryModelSpec) => VoxelFerry;

/** One voxel model class per real Sydney Ferries fleet class, keyed by the
 * `fleetClass` on each ferry spec. Add a fleet here to give it its own
 * customised model; anything unmatched falls back to the shared base look. */
const MODELS: Record<string, FerryModelCtor> = {
  'First Fleet class': FirstFleetFerry,
  'River class': RiverClassFerry,
  'Parramatta River class': ParramattaRiverFerry,
  'Emerald class': EmeraldClassFerry,
  'HarbourCat class': HarbourCatFerry,
  'Freshwater class': FreshwaterClassFerry,
  'Inner Harbour utility ferry': InnerHarbourFerry,
};

/** Build the class-specific voxel model for a ferry spec. */
export function createVoxelFerry(spec: FerryModelSpec): VoxelFerry {
  const Model = MODELS[spec.fleetClass] ?? VoxelFerry;
  return new Model(spec);
}
