import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * The specs of the two tabs ported from Caldova Köln (D51), run as they ran there: jsdom, globals,
 * the React plugin and the `@`, `@reorder`, `@finanzen` roots. Kept apart from vitest.config.ts,
 * whose twin tests are pure TypeScript in node.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      '@reorder': resolve(import.meta.dirname, 'src', 'reorder'),
      '@finanzen': resolve(import.meta.dirname, 'src', 'finanzen'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/{reorder,finanzen,nachbestellung}/**/*.{test,spec}.{ts,tsx}'],
    testTimeout: 30_000,
  },
})
