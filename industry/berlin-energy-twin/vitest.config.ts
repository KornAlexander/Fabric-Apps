import { defineConfig } from 'vitest/config'

/**
 * Separate from vite.config.ts on purpose: the unit tests are pure TypeScript
 * with no CSS and no React plugin, so they must not pull in Tailwind. That also
 * lets the suite run with a vitest binary borrowed from another repo (see the
 * `test` script in package.json for why that is necessary here).
 *
 * .tsx is allowed for one narrow case: the error boundary. React elements are
 * plain objects, so its fallback can be asserted without a DOM - and an error
 * boundary that throws while rendering its own fallback is worse than none.
 */
export default defineConfig({
  test: {
    include: [
      'src/**/__tests__/**/*.test.ts',
      'src/**/__tests__/**/*.test.tsx',
      // The build tools are covered too. The bundle loader in particular runs
      // before any of the app exists, so a mistake there is a white page.
      'tools/__tests__/**/*.test.ts',
    ],
    environment: 'node',
    reporters: ['default'],
    /**
     * ⚠️ RAISED FROM THE 5 s DEFAULT ON PURPOSE, AND IT IS ABOUT THE GUARDS,
     * NOT ABOUT SLOW TESTS.
     *
     * `sabotage.ps1` decides whether a guard caught its sabotage by reading the
     * suite's EXIT CODE. So a test that fails for *timing* reasons - because the
     * machine happened to be building something else - makes every sabotage case
     * report "caught" whether or not the guard works, and makes the final
     * "restored and green" check report a failure that is not real. Both
     * happened here: the whole-network lane test ran 1.4 s alone and 15 s under
     * load, and a later run reported a green suite as red.
     *
     * These tests are pure computation with no I/O waits, so 30 s cannot mean
     * "slow machine" - it can only mean genuinely stuck. The one test that was
     * actually doing too much work (an assertion per segment) was fixed rather
     * than hidden behind this.
     */
    testTimeout: 30_000,
  },
  esbuild: { jsx: 'automatic' },
})
