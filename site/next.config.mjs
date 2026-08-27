/**
 * Static export, because the site is hosted on GitHub Pages and later embedded in
 * actionablereporting.com the same way the Power BI Fixer pages are. No server, no
 * runtime, just files.
 *
 * ⚠️ basePath matters here. A GitHub *project* page is served from
 * /Fabric-Apps, not from the domain root, so every asset URL needs that prefix or the
 * site renders as unstyled HTML with broken images. It is supplied by the workflow via
 * NEXT_PUBLIC_BASE_PATH and left empty for `npm run dev`, where the site IS at the root.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath,
  // Several lockfiles exist further up this machine's tree, so Next guesses the wrong
  // workspace root and warns. Pin it to this folder.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  // next/image needs a server to optimise. There isn't one.
  images: { unoptimized: true },
  // GitHub Pages serves /apps/doom/ as a directory, so emit apps/doom/index.html.
  trailingSlash: true,
  reactStrictMode: true,
};

export default nextConfig;
