import type { FerryModelSpec } from './types';

/**
 * Victor Chang — HarbourCat class.
 * Livery and hull proportions matched to the reference photo in
 * `public/ferries/Victor_Chang.jpg`.
 */
export const FERRY_SPEC: FerryModelSpec = {
  name: 'Victor Chang',
  fleetClass: 'HarbourCat class',
  hullType: 'catamaran',
  livery: {
    hull: 0x1c6b39,
    boot: 0x0b1712,
    cabin: 0xe6b12b,
    roof: 0x2c6b3c,
    trim: 0xf2cf4e,
    glass: 0x15191b,
    funnel: 0x2c6b3c,
  },
  scale: { length: 0.85, beam: 0.9 },
  decks: 1,
  hasFunnel: false,
  wheelhouse: 'center',
};
