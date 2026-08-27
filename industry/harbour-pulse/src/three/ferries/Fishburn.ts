import type { FerryModelSpec } from './types';

/**
 * Fishburn — First Fleet class.
 * Livery and hull proportions matched to the reference photo in
 * `public/ferries/Fishburn.jpg`.
 */
export const FERRY_SPEC: FerryModelSpec = {
  name: 'Fishburn',
  fleetClass: 'First Fleet class',
  hullType: 'catamaran',
  livery: {
    hull: 0x0e7a3d,
    boot: 0x14181c,
    cabin: 0xe6c34a,
    roof: 0x145c34,
    trim: 0xf0e0a0,
    glass: 0x24303a,
    funnel: 0x0e7a3d,
  },
  scale: { length: 1.0, beam: 1.0 },
  decks: 2,
  hasFunnel: false,
  wheelhouse: 'forward',
};
