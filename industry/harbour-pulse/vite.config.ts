import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import { resolve } from 'path';
import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';

import { ferryApiPlugin } from './vite/ferryApi';
import { scheduleSnapshotPlugin } from './vite/scheduleSnapshot';

export default defineConfig({
  plugins: [react(), tailwindcss(), cesium(), ferryApiPlugin(), scheduleSnapshotPlugin()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  build: {
    target: 'es2022',
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
