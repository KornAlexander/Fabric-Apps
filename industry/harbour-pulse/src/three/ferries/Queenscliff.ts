import type { FerryModelSpec } from './types';

/**
 * Queenscliff — Freshwater class.
 * Livery and hull proportions matched to the reference photo in
 * `public/ferries/Queenscliff.jpg`.
 */
export const FERRY_SPEC: FerryModelSpec = {
  name: 'Queenscliff',
  fleetClass: 'Freshwater class',
  hullType: 'monohull',
  livery: {
    hull: 0x0d3322,
    boot: 0x0c0f12,
    cabin: 0xf2f1ea,
    roof: 0xeceae0,
    trim: 0x16232c,
    glass: 0x1c262c,
    funnel: 0x123322,
  },
  scale: { length: 1.35, beam: 1.1 },
  decks: 2,
  hasFunnel: true,
  wheelhouse: 'forward',
};
