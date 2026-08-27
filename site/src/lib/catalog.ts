/**
 * Read the app catalogue straight out of the repository at build time.
 *
 * Deliberately the SAME source tools/generate_index.py uses: the `template` block in each
 * app's package.json. A hand-maintained list on the website would be wrong the first time
 * somebody adds an app in a hurry, and nobody would notice because the website is the one
 * place you do not run the checks against.
 *
 * Everything here runs at build time in Node. There is no runtime.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { marked } from 'marked';

export const REPO = join(process.cwd(), '..');
export const GITHUB = 'https://github.com/KornAlexander/Fabric-Apps';
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Prefix an absolute site path with the GitHub Pages basePath. */
export const asset = (p: string) => `${BASE}${p.startsWith('/') ? p : `/${p}`}`;

const CATEGORY_DIRS = ['games-and-learn', 'fabric-admin', 'industry'];

export type Category = {
  id: string;
  icon: string;
  title: string;
  blurb: string;
};

export const CATEGORIES: Category[] = [
  { id: 'digital-twins', icon: '🌍', title: 'Digital twins and geospatial', blurb: '3D, map and live-operations views of real-world systems.' },
  { id: 'analytics', icon: '📊', title: 'Analytical apps', blurb: 'Apps that put data and insight in front of an end user.' },
  { id: 'fabric-tools', icon: '🧰', title: 'Fabric and Power BI tools', blurb: 'Apps that inspect, document or administer the data platform itself.' },
  { id: 'games', icon: '🎮', title: 'Games and interactive learning', blurb: 'Canvas and game-engine apps. Proof there is no UI ceiling.' },
  { id: 'starters', icon: '🚀', title: 'Starters', blurb: 'Minimal scaffolds to build on.' },
  { id: 'business', icon: '🏢', title: 'Business apps', blurb: 'Everyday operational apps.' },
  { id: 'other', icon: '📦', title: 'More apps', blurb: 'Apps that have not picked a category yet.' },
];

export type App = {
  slug: string;
  path: string;
  display: string;
  description: string;
  category: string;
  wip: boolean;
  preview: string | null;
  gif: string | null;
  mp4: string | null;
  stack: string[];
  upstream: { name: string; url: string | null } | null;
  /**
   * A publicly playable deployment, if the app has one.
   *
   * ⚠️ Opt-in per app via `template.liveUrl`, never derived. Phase 0 deliberately
   * stripped every deployment hostname from this repository, because a
   * `*.webapp.fabricapps.net` host names a live app in a tenant. Publishing one is a
   * decision, so it has to be written down deliberately - and only for an app that is
   * safe to hand to strangers.
   */
  liveUrl: string | null;
};

function walk(folder: string, depth: number, out: string[]) {
  if (existsSync(join(folder, 'package.json'))) {
    out.push(folder);
    return;
  }
  if (depth >= 2) return;
  for (const name of readdirSync(folder).sort()) {
    const child = join(folder, name);
    if (name === 'node_modules' || name === 'dist') continue;
    try {
      if (statSync(child).isDirectory()) walk(child, depth + 1, out);
    } catch {
      /* unreadable entry, skip */
    }
  }
}

/** Which technologies the app actually uses, read from its dependencies. */
function detectStack(folder: string): string[] {
  try {
    const pkg = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const has = (n: string) => Object.keys(deps).some((d) => d === n || d.startsWith(`${n}/`));
    const stack: string[] = [];
    if (has('react')) stack.push('React');
    if (has('three') || has('@react-three')) stack.push('three.js');
    if (has('cesium') || has('resium')) stack.push('Cesium');
    if (has('maplibre-gl')) stack.push('MapLibre');
    if (has('leaflet') || has('react-leaflet')) stack.push('Leaflet');
    if (has('d3')) stack.push('D3');
    if (has('@microsoft/rayfin-client')) stack.push('Rayfin');
    if (has('vite')) stack.push('Vite');
    return stack;
  } catch {
    return [];
  }
}

/**
 * Is this app somebody else's work?
 *
 * Same phrasings check_gallery_drafts.py looks for. The website is the most public
 * surface of all, so an upstream credit has to reach it too. Three apps here are built on
 * other people's work and every one of them is easy to forget.
 */
function detectUpstream(readme: string): App['upstream'] {
  const patterns: RegExp[] = [
    /Credit to \*\*([^*]+)\*\*/,
    /This is \[([^\]]+)\]\(([^)]*)\)'s project/,
    /entirely ([A-Z][\w.-]+(?: [A-Z]?[\w.-]+){1,3})'s work/,
  ];
  for (const p of patterns) {
    const m = readme.match(p);
    if (m) {
      const url = m[2] ?? null;
      return { name: m[1].trim(), url };
    }
  }
  return null;
}

function isWip(readme: string): boolean {
  return /work in progress|\bWIP\b/i.test(readme.slice(0, 1200));
}

let cache: App[] | null = null;

export function getApps(): App[] {
  if (cache) return cache;

  const folders: string[] = [];
  for (const cat of CATEGORY_DIRS) {
    const base = join(REPO, cat);
    if (existsSync(base)) walk(base, 0, folders);
  }

  const apps: App[] = folders.map((folder) => {
    const pkg = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
    const t = pkg.template ?? {};
    const rel = relative(REPO, folder).split('\\').join('/');
    const slug: string = t.name ?? folder.split(/[\\/]/).pop()!;
    const readmePath = join(folder, 'README.md');
    const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '';

    const previewFile = join(REPO, 'docs', 'previews', `${slug}.webp`);
    const gifFile = join(REPO, 'docs', 'media', `${slug}-demo.gif`);
    const mp4File = join(REPO, 'docs', 'media', `${slug}-demo.mp4`);

    return {
      slug,
      path: rel,
      display: t.displayName ?? slug,
      description: t.description ?? '',
      category: t.category ?? 'other',
      wip: isWip(readme),
      preview: existsSync(previewFile) ? asset(`/previews/${slug}.webp`) : null,
      gif: existsSync(gifFile) ? asset(`/media/${slug}-demo.gif`) : null,
      mp4: existsSync(mp4File) ? asset(`/media/${slug}-demo.mp4`) : null,
      stack: detectStack(folder),
      upstream: detectUpstream(readme),
      liveUrl: typeof t.liveUrl === 'string' && t.liveUrl.startsWith('https://') ? t.liveUrl : null,
    };
  });

  apps.sort((a, b) => a.display.localeCompare(b.display));
  cache = apps;
  return apps;
}

export function getApp(slug: string): App | undefined {
  return getApps().find((a) => a.slug === slug);
}

/**
 * Render an app README to HTML for its detail page.
 *
 * Two rewrites are essential, and both were found by looking at what the READMEs
 * actually contain rather than assuming:
 *   * image sources are repo-relative (`../../docs/previews/x.webp`), which resolves to
 *     nothing once the file is served from /apps/<slug>/;
 *   * every other relative link points at a file in the repo, so it should go to GitHub
 *     rather than 404 on the site.
 */
export function renderReadme(app: App): string {
  const file = join(REPO, app.path, 'README.md');
  if (!existsSync(file)) return '';
  let md = readFileSync(file, 'utf8');

  // Drop the first H1: the page already shows the title, twice is clutter.
  md = md.replace(/^#\s+.*\n/, '');

  const renderer = new marked.Renderer();

  const resolve = (href: string): string => {
    if (/^(https?:|mailto:|#)/.test(href)) return href;
    const clean = href.replace(/^\.\//, '');
    // Anything under docs/previews or docs/media was copied into the site.
    const m = clean.match(/docs\/(previews|media)\/(.+)$/);
    if (m) return asset(`/${m[1]}/${m[2]}`);
    // Everything else lives in the repo.
    const inRepo = clean.replace(/^(\.\.\/)+/, '');
    const target = clean.startsWith('..') ? inRepo : `${app.path}/${inRepo}`;
    return `${GITHUB}/blob/main/${target}`;
  };

  renderer.image = ({ href, title, text }) => {
    const src = resolve(href ?? '');
    // Repo-relative images that are not in docs/ (an app's own screenshots) still live in
    // the repo, so point them at the raw host rather than a blob page, which is HTML.
    const fixed = src.includes('/blob/main/') ? src.replace('/blob/main/', '/raw/main/') : src;
    return `<img src="${fixed}" alt="${text ?? ''}"${title ? ` title="${title}"` : ''} loading="lazy" />`;
  };

  renderer.link = function ({ href, title, tokens }) {
    const url = resolve(href ?? '');
    // Render the label through the parser so a link containing **bold** or `code` keeps
    // its formatting. This needs a real function, not an arrow: marked binds `this` to
    // the renderer, and that is where the parser lives.
    const label = this.parser.parseInline(tokens);
    const external = /^https?:/.test(url);
    return `<a href="${url}"${title ? ` title="${title}"` : ''}${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`;
  };

  return marked.parse(md, { renderer, async: false }) as string;
}

export function byCategory(): { category: Category; apps: App[] }[] {
  const apps = getApps();
  return CATEGORIES.map((category) => ({
    category,
    apps: apps.filter((a) => a.category === category.id),
  })).filter((g) => g.apps.length > 0);
}
