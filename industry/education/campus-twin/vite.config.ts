import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Delete excluded sites' terrain from the bundle, after Vite has written it.
 *
 * ⚠️ THIS HAS TO BE A PLUGIN, AND A STANDALONE SCRIPT WAS TRIED FIRST AND SILENTLY DID NOTHING.
 * `rayfin up` does not package whatever is sitting in `dist/` — it runs `npm run build:fabric`
 * ITSELF and packages the result. So a prune step between `npm run build` and `npm run deploy` is
 * undone before the packager ever looks: the failing size came back **byte for byte identical**
 * (117.3 MB both times), which is the only reason the rebuild was noticed at all. Inside the build
 * there is no ordering left to get wrong.
 *
 * ⚠️ AND `excludeAois` DID NOT DO WHAT IT SAID BEFORE THIS. `config/release.json` calls that lever
 * "drop whole sites", and on the app side it does — the site leaves the switcher, its map dot stops
 * offering to open it, `?aoi=` falls back. But Vite copies `public/` wholesale, so the excluded
 * site's heightmap, orthophoto and building mesh were still shipped. That is a size problem and,
 * worse, a licensing one: `release.json` states the exposure it closes is "the DEPLOYED BUILD,
 * which would otherwise ship public/terrain/garching/rooms.json and occupancy.bin". Hiding a link
 * is not withholding a file.
 */
function pruneExcludedAois(): Plugin {
  const size = (dir: string): number =>
    readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => {
      const full = join(dir, entry.name);
      return total + (entry.isDirectory() ? size(full) : statSync(full).size);
    }, 0);

  /**
   * ⚠️ `process.env` KENNT `.env.local` NICHT, UND DAS WAERE HIER STILL SCHIEFGEGANGEN.
   *
   * Vite laedt die `.env`-Dateien in `import.meta.env` fuer den ANWENDUNGSCODE. In der
   * Konfigurationsdatei selbst ist `process.env.VITE_TERRAIN_BASE` deshalb leer, auch wenn die
   * Variable in `.env.local` steht. Die erste Fassung dieses Blocks las genau das, htte also nie
   * ausgeloest — der Build wre gruen gewesen, das Paket wre gross geblieben, und die Anwendung
   * htte die Kacheln zusaetzlich aus dem Netz geholt. Ein Fehler ohne Fehlermeldung.
   *
   * `configResolved` liefert den aufgeloesten Wert, den auch die Anwendung sieht.
   */
  let terrainBase = '';

  return {
    name: 'campus-prune-excluded-aois',
    apply: 'build',
    configResolved(config) {
      terrainBase = String(config.env?.VITE_TERRAIN_BASE ?? '').trim();
    },
    closeBundle() {
      /**
       * ⚠️ LIEGT DAS GELAENDE WOANDERS, DARF ES GAR NICHT ERST MITGEPACKT WERDEN.
       *
       * `VITE_TERRAIN_BASE` sagt der Anwendung, WOHER sie die Kacheln holt. Es sagt Vite nichts:
       * `public/` wird weiterhin vollstaendig nach `dist/` kopiert. Ohne diesen Block bleibt das
       * Paket also genauso gross wie vorher, die Kacheln werden nur zusaetzlich aus dem Netz
       * geholt — das Schlechteste aus beiden Welten, und es faellt nicht auf, weil die Anwendung
       * einwandfrei laeuft.
       *
       * Die Bedingung ist bewusst "eine absolute URL" und nicht "die Variable ist gesetzt": ein
       * relativer Wert wie `/kacheln` zeigt weiterhin auf dieses Paket, und dann muessen die
       * Dateien drinbleiben.
       */
      const base = terrainBase;
      if (/^https?:\/\//i.test(base)) {
        const dir = resolve(__dirname, 'dist/terrain');
        if (existsSync(dir)) {
          const mb = (size(dir) / 1e6).toFixed(1);
          rmSync(dir, { recursive: true, force: true });
          console.log(`prune: terrain comes from ${base} — dropped all ${mb} MB from the bundle`);
        }
        return;
      }

      let excluded: string[] = [];
      try {
        const release = JSON.parse(
          readFileSync(resolve(__dirname, 'config/release.json'), 'utf8')
        ) as { excludeAois?: unknown };
        excluded = Array.isArray(release.excludeAois)
          ? (release.excludeAois as unknown[]).filter((s): s is string => typeof s === 'string')
          : [];
      } catch {
        // ⚠️ Fail OPEN here, which is the opposite of the app's rule and deliberate. A missing or
        // malformed release file means "exclude nothing" everywhere else in this project; a prune
        // that invented exclusions from a parse error would quietly ship a build missing sites
        // nobody asked to drop.
        excluded = [];
      }
      if (excluded.length === 0) return;

      for (const aoi of excluded) {
        const dir = resolve(__dirname, 'dist/terrain', aoi);
        // Absent is normal, not an error: the site may never have been built on this machine.
        if (!existsSync(dir)) continue;
        const mb = (size(dir) / 1e6).toFixed(1);
        rmSync(dir, { recursive: true, force: true });
        console.log(`prune: dropped excluded site ${aoi} from the bundle (${mb} MB)`);
      }
    },
  };
}

/**
 * No dev proxies.
 *
 * The app this was forked from proxied a raw-TCP APRS relay and a token-minting service. Neither
 * exists here: every source Campus-Insights reads — LDBV, LGL, Copernicus, Overpass, NavigaTUM —
 * is fetched **at build time by the Python pipeline** and shipped as static assets, or served from
 * Fabric through the Rayfin client. Nothing is fetched from a third party at page load, which is
 * also what makes the demo survive a conference network (PLAN D4).
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), pruneExcludedAois()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      '@config': resolve(import.meta.dirname, 'config'),
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      /**
       * TWO ENTRY POINTS: the planner twin, and the consumer's own timetable.
       *
       * ⚠️ SEPARATE ENTRIES RATHER THAN A ROUTE, because the import graph is fixed at build time.
       * A `/mein-plan` route inside `index.html` would still pull `three`, the terrain loaders and
       * every lens into the bundle a lecturer downloads to find out when they teach on Thursday.
       * Two entries let Rollup discover that `consumer.html` reaches none of it.
       *
       * ⚠️ `manualChunks` BELOW NAMES `three`, WHICH THE CONSUMER ENTRY NEVER IMPORTS. That is
       * harmless and worth stating: Rollup only emits a manual chunk for entries that actually
       * reach the module, so the consumer build does not gain an empty `three` chunk. If a future
       * edit makes `src/consumer/` import anything under `src/twin3d/`, the giveaway will be a
       * `three` chunk appearing in the consumer output, and `tools/check_bundle.mjs` is where that
       * regression should be caught.
       */
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        consumer: resolve(import.meta.dirname, 'consumer.html'),
      },
      output: {
        /**
         * Split `three` into its own chunk — TASK 1 of the 2026-08-19 handoff.
         *
         * ⚠️ BE HONEST ABOUT WHAT THIS DOES AND DOES NOT BUY. It does **not** shrink the total
         * number of bytes the browser downloads — `tools/check_bundle.mjs`'s ceiling barely moves
         * (measured: total JS raw/gzip changed by well under 1%, see that file's header). What it
         * buys instead:
         *
         *   1. **Parallel download.** Two chunks over HTTP/2 on the same origin download
         *      concurrently instead of the browser waiting for one 1.2 MB file start-to-finish.
         *   2. **A shell that can parse and paint before the 3D engine does.** The app shell
         *      (React, the routing/state glue, the panels) no longer sits behind `three`'s parse
         *      time in the same chunk; it can begin rendering while `three` is still arriving.
         *   3. **A `three` chunk that survives an app-code deploy.** `three` changes only when the
         *      dependency itself is bumped, which is rare. Splitting it out means a browser that
         *      already has it cached from a previous visit does not re-download it just because
         *      `src/` changed — today, with one chunk, it does.
         *
         * If a future measurement shows none of the above actually helps this app's real-world
         * load time, say so in this comment and keep the budget anyway — a split that buys nothing
         * is still not a reason to delete the ceiling that catches a bundle regression.
         */
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  esbuild: {
    target: 'es2022',
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2022',
    },
  },
});
