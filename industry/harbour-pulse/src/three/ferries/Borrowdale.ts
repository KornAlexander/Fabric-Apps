import type { FerryModelSpec } from './types';

/**
 * Borrowdale — First Fleet class.
 * Livery and hull proportions matched to the reference photo in
 * `public/ferries/Borrowdale.jpg`.
 */
export const FERRY_SPEC: FerryModelSpec = {
  name: 'Borrowdale',
  fleetClass: 'First Fleet class',
  hullType: 'monohull',
  livery: {
    hull: 0x0c5a30,
    boot: 0x14181c,
    cabin: 0xe9d488,
    roof: 0x155f36,
    trim: 0xf0e0a0,
    glass: 0x24303a,
    funnel: 0x0c5a30,
  },
  scale: { length: 0.85, beam: 0.82 },
  decks: 2,
  hasFunnel: false,
  wheelhouse: 'forward',
};
