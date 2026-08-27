import type { FerryModelSpec } from './types';

/**
 * Me-mel — Inner Harbour utility ferry.
 * Livery and hull proportions matched to the reference photo in
 * `public/ferries/Me-mel.jpg`.
 */
export const FERRY_SPEC: FerryModelSpec = {
  name: 'Me-mel',
  fleetClass: 'Inner Harbour utility ferry',
  hullType: 'monohull',
  livery: {
    hull: 0x166a34,
    boot: 0x14181c,
    cabin: 0xe6c34a,
    roof: 0x0e4a24,
    trim: 0xf0e0a0,
    glass: 0x26323c,
    funnel: 0x0e4a24,
  },
  scale: { length: 0.45, beam: 0.55 },
  decks: 1,
  hasFunnel: false,
  wheelhouse: 'center',
};
