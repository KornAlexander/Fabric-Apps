/** App-wide tunables for the 3D harbour. */
export const CONFIG = {
  /** How often to poll the ferry feed (ms). */
  pollMs: 5000,
  /** Ferries whose sample is older than this (ms) fade out and despawn. */
  staleMs: 6 * 60 * 60 * 1000,
  /** Sea-level plane height. */
  seaLevel: 0,
  /** Fly speed (m/s) in first-person mode. */
  walkSpeed: 120,
  colors: {
    water: 0x1f6f8b,
    waterDeep: 0x123f52,
    land: 0x5f8a3a,
    landHi: 0x82a84e,
    sand: 0xd9c89a,
    rock: 0x8a8f96,
    sky: 0x9ec7e8,
    fog: 0xcfe6f5,
    // Sydney Ferries (TfNSW) livery
    hull: 0xf4f6f7, // white superstructure
    hullBand: 0xf3c000, // yellow lower band
    hullStripe: 0x0a7d3f, // green stripe
    window: 0x24333d, // dark glazing
    deck: 0xe7e3d6,
    funnel: 0x0a7d3f,
    // Landmarks
    bridge: 0x9aa3ab, // steel grey
    bridgeDeck: 0x5c6169,
    opera: 0xf3f1ea, // sail shells
    tower: 0x8fa6b8,
    towerHi: 0xb7c6d4,
    wharf: 0x6b4f2a,
    wharfPost: 0x4a3720,
  },
} as const;
