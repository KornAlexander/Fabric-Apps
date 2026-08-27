/*
 * Shared Rayfin stats bridge for the IBCS mini-games.
 *
 * The React host (src/pages/GamePage.tsx) listens for a window message of type
 * 'rayfin-game-stats' and persists the payload to the GameStats entity. Every
 * game must therefore emit the same schema-complete payload. This helper fills
 * the full set of required GameStats fields with sensible defaults so each game
 * only needs to override the metrics that are meaningful to it.
 */
(function (global) {
  'use strict';

  function publishRayfinStats(partial) {
    const payload = Object.assign({
      player_name: 'Player',
      timestamp: new Date().toISOString(),
      duration_seconds: 0,
      score: 0,
      won: false,
      lives_left: 0,
      deaths_total: 0,
      deaths_enemy: 0,
      deaths_water: 0,
      deaths_fall: 0,
      deaths_lava: 0,
      coins_collected: 0,
      enemies_stomped: 0,
      enemies_zapped: 0,
      bosses_killed: 0,
      attacks_used: 0,
      jumps: 0,
      forms_collected: '',
      final_form: '',
      max_x_reached: 0,
      level_reached: 0,
    }, partial || {});
    try {
      if (global.parent && global.parent !== global) {
        // Target the page's own origin (the host embeds these games same-origin)
        // so the payload is never delivered to an unexpected cross-origin parent.
        const origin = (global.location && global.location.origin) || '/';
        global.parent.postMessage({ type: 'rayfin-game-stats', payload }, origin);
      }
    } catch (_) { /* cross-origin guard */ }
    return payload;
  }

  global.publishRayfinStats = publishRayfinStats;
})(typeof window !== 'undefined' ? window : globalThis);
