import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['engine/test/**/*.test.ts', 'learn/test/**/*.test.ts', 'app/test/**/*.test.ts'],
    // The default. The one suite that needs a DOM asks for jsdom in its own
    // docblock, rather than making every engine test pay for one.
    environment: 'node',
  },
});
