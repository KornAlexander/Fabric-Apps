import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // The Caldova order tab writes reorders to the app's own SQL database (D51).
  // `rayfin up` writes the deployment's API url, key and ids into rayfin/.env;
  // reading that managed file keeps one source of truth (as in Caldova Köln).
  const rayfin = loadEnv(mode, resolve(import.meta.dirname, 'rayfin'), 'RAYFIN_PUBLIC_')
  return {
    plugins: [react(), tailwindcss()],
    server: { port: 5290, strictPort: true },
    // ⚠️ ONE FILE (D51). tools/gzip_bundle.mjs runs the entry from a blob: URL, so a split chunk
    // could neither resolve its relative import nor share React with the entry (it would load the
    // plain index-*.js a second time). The finance tab's code therefore ships inside the bundle.
    build: { rollupOptions: { output: { inlineDynamicImports: true } } },
    define: {
      'import.meta.env.VITE_RAYFIN_API_URL': JSON.stringify(rayfin.RAYFIN_PUBLIC_API_URL ?? ''),
      'import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY': JSON.stringify(rayfin.RAYFIN_PUBLIC_PUBLISHABLE_KEY ?? ''),
      'import.meta.env.VITE_RAYFIN_WORKSPACE_ID': JSON.stringify(rayfin.RAYFIN_PUBLIC_WORKSPACE_ID ?? ''),
      'import.meta.env.VITE_RAYFIN_PROJECT_ID': JSON.stringify(rayfin.RAYFIN_PUBLIC_ITEM_ID ?? ''),
    },
    resolve: {
      alias: {
        // The two tabs ported from Caldova Köln keep their own roots (D51).
        '@': resolve(import.meta.dirname, 'src'),
        '@reorder': resolve(import.meta.dirname, 'src', 'reorder'),
        '@finanzen': resolve(import.meta.dirname, 'src', 'finanzen'),
      },
    },
  }
})
