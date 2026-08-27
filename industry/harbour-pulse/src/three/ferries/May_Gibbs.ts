import type { FerryModelSpec } from './types';

/**
 * May Gibbs — Emerald class.
 * Livery and hull proportions matched to the reference photo in
 * `public/ferries/May_Gibbs.jpg`.
 */
export const FERRY_SPEC: FerryModelSpec = {
  name: 'May Gibbs',
  fleetClass: 'Emerald class',
  hullType: 'catamaran',
  livery: {
    hull: 0x0d5c2e,
    boot: 0x0a1a12,
    cabin: 0xf2c94c,
    roof: 0x123f22,
    trim: 0xf5f0dc,
    glass: 0x202b33,
    funnel: 0x123f22,
  },
  scale: { length: 1.05, beam: 1.05 },
  decks: 1,
  hasFunnel: false,
  wheelhouse: 'center',
};
