import { defineConfig } from 'vite';

export default defineConfig({
  /*
   * Relative asset URLs, so the built game runs from whatever path it is
   * dropped at: the root of a Fabric App, a GitHub Pages project site at
   * /fabric-empires/, or a file listing. The default of '/' would have
   * produced a blank page with two 404s at every one of those except the
   * root, and the fallback host exists precisely so the submitted link
   * cannot die.
   */
  base: './',
  server: { port: 5180 },
  build: { target: 'es2022' },
});
