import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { buildAssetConfig, buildOutput } from './tools/asset-build-config.mjs';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export default defineConfig(async () => {
  const config = await buildAssetConfig();
  const outDir = await buildOutput();

  /**
   * The two upstreams that a browser cannot call directly.
   *
   * ⚠️ MEASURED 2026-09-21, AND IT IS NOT A SOURCE-SELECTION PROBLEM. Five public ADS-B feeds
   * were tried from a real browser — adsb.lol, adsb.fi, adsb.one, airplanes.live and OpenSky —
   * and every one failed with `TypeError: Failed to fetch`. None of them sends an
   * `Access-Control-Allow-Origin` header, so a page cannot read them at all, whatever its origin.
   * The same requests succeed from a terminal on the same machine, which is exactly what a CORS
   * refusal looks like from the outside. The Umweltbundesamt's Air Data API behaves the same way.
   *
   * ⚠️ THIS PROXY IS THE DEV PATH ONLY. The hosted Fabric App has no server side (Rayfin
   * functions are disabled in this tenant), so it calls the Azure Container App relay in
   * `relay/` instead. That relay's origin allow-list deliberately does NOT include localhost, so
   * dev genuinely needs its own path rather than pointing at the relay.
   *
   * ⚠️ `air-data`, WITH A HYPHEN, AND THE `luftdaten` SUBDOMAIN. The widely documented
   * `www.umweltbundesamt.de/api/air_data/v3` now answers 301 to this host. Tools that follow
   * redirects silently hide the move; the relay, which refuses redirects on purpose, does not.
   */
  const liveProxy = {
    '/api/adsb': {
      target: 'https://api.adsb.lol',
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/api\/adsb/, '/v2'),
    },
    '/api/uba': {
      target: 'https://luftdaten.umweltbundesamt.de',
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/api\/uba/, '/api/air-data/v3'),
    },
    // ⚠️ THE AGENT BACKEND, PROXIED IN DEV FOR THE SAME REASON AS THE RELAY: its CORS allow-list
    // contains only the deployed Fabric origin, deliberately, so a browser on localhost cannot
    // read its responses directly. Proxying keeps the deployed allow-list narrow instead of
    // widening a production boundary for local convenience.
    '/api/agent': {
      target: process.env.AGENT_ORIGIN || 'http://127.0.0.1:8000',
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/api\/agent/, ''),
    },
  };

  return {
  base: './',
  publicDir: config.mode === 'external' ? false : 'public',
  define: { __SWM_ASSETS__: JSON.stringify(config.binding) },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { proxy: liveProxy },
  preview: { proxy: liveProxy },
  build: {
    outDir,
    sourcemap: false,
    chunkSizeWarningLimit: 650,
    // ⚠️ TWO ENTRY POINTS. `auth.html` is the MSAL redirect bridge and must ship as its own tiny
    // page. Without it here, the built app has no callback page and a popup sign-in can never
    // complete: the redirect would load the whole map instead of broadcasting the response.
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        auth: fileURLToPath(new URL('./auth.html', import.meta.url)),
      },
    },
  },
  plugins: [{ name: 'external-map-notices', closeBundle() {
    if (config.mode !== 'external') return;
    mkdirSync(outDir, { recursive: true });
    for (const name of ['LICENSE.txt', 'THIRD-PARTY-NOTICES.txt']) copyFileSync(fileURLToPath(new URL(`./public/${name}`, import.meta.url)), join(outDir, name));
  } }],
};
});