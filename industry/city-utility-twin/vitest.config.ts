import react from '@vitejs/plugin-react-swc';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Component and i18n tests only. ⚠️ A SEPARATE FILE ON PURPOSE: vite.config.ts resolves the
 * terrain asset release before it returns, which a unit test has no business waiting for.
 * The node:test suites in tests/*.test.mjs keep running under `node --test`.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: { __TWIN_ASSETS__: 'null' },
  test: {
    environment: 'jsdom',
    include: ['tests/ui/**/*.test.{ts,tsx}'],
  },
});
