import react from '@vitejs/plugin-react-swc';
import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // The performance benchmark (D32) is slow and machine-dependent, so it is
    // not part of the default suite — it is named `*.perf.ts` so this include
    // pattern cannot match it. Run it deliberately with `npm run bench`.
    // Excluded, never skipped: a skipped test reads as passing.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'src/__perf__/**'],
    setupFiles: ['./src/__tests__/setup.ts'],
  },
});
