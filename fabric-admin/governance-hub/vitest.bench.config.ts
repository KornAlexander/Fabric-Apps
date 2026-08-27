import react from '@vitejs/plugin-react-swc';
import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

/**
 * The performance benchmark (PLAN.md D32) — run with `npm run bench`.
 *
 * Kept out of the default suite on purpose: it takes seconds, allocates
 * millions of objects and its numbers are machine-dependent, so running it on
 * every save would train everyone to ignore it.
 *
 * It is **excluded, never skipped**. A skipped test reads as a passing one, and
 * this assertion is currently red by design — the budget is the target, and the
 * measured baseline is recorded in the plan.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    globals: true,
    // No jsdom: this measures pure domain logic, and jsdom only adds noise.
    environment: 'node',
    include: ['src/__perf__/**/*.perf.ts'],
  },
});
