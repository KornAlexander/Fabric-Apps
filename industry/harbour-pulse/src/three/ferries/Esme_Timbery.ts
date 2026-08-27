import type { FerryModelSpec } from './types';

/**
 * Esme Timbery — River class.
 * Livery and hull proportions matched to the reference photo in
 * `public/ferries/Esme_Timbery.jpg`.
 */
export const FERRY_SPEC: FerryModelSpec = {
  name: 'Esme Timbery',
  fleetClass: 'River class',
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
  scale: { length: 1.0, beam: 0.95 },
  decks: 2,
  hasFunnel: false,
  wheelhouse: 'forward',
};
