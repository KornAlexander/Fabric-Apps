import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['engine/test/**/*.test.ts', 'learn/test/**/*.test.ts', 'app/test/**/*.test.ts'],
    // The default. The one suite that needs a DOM asks for jsdom in its own
    // docblock, rather than making every engine test pay for one.
    environment: 'node',
    // The engine suites generate whole maps per seed. On a loaded machine or a small CI runner a
    // few of them pass the 5 s default when many files run in parallel, and fail a different set
    // each run. They pass alone in well under that, so this is time, not a hidden hang.
    testTimeout: 30_000,
    // Cap parallel files. Uncapped on a 12-core machine, CPU contention pushed even the
    // 60 s question-bank decryption past its limit; with 4 workers all 1418 tests pass.
    maxWorkers: 4,
  },
});
