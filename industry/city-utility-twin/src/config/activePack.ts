/**
 * The config pack this build runs with, and what it decides at runtime.
 *
 * Which pack: `virtual:config-pack`, resolved by vite.config.ts from CONFIG_PACK (a path to a
 * pack JSON) and defaulting to the public `config/packs/generic.json`. Customer packs live in
 * the private repository and are only ever named by a private build.
 *
 * What it decides today: the brand name and colours, which shipped sites appear and where the
 * app opens, and which divisions' layers exist. Everything else in the pack (texts, KPI targets,
 * assistant persona) is validated now and used as the divisions arrive.
 */
import raw from 'virtual:config-pack';
import { assertPack, assertPackSites } from './pack.mjs';
import { SHELL_SITES, SITES, type SiteConfig } from './world';
import { both, type Text } from '../i18n';

export type Division =
  | 'transit' | 'construction' | 'water' | 'power' | 'heat' | 'emobility' | 'fibre' | 'aviation';

export interface ConfigPack {
  id: string;
  brand: { name: { de: string; en: string }; logo?: string | null; colors?: Record<string, string> };
  defaultCity: string;
  cities: { id: string; aois: string[]; status: 'ready' | 'planned' }[];
  divisions: Partial<Record<Division, boolean>>;
  texts: Record<string, { de: string; en: string }>;
  kpiTargets: Record<string, number>;
  agent: { persona: string; language: 'de' | 'en' };
}

export function loadPack(value: unknown): ConfigPack {
  return assertPack(value) as ConfigPack;
}

export const PACK: ConfigPack = loadPack(raw);

export function brandName(pack: ConfigPack = PACK): Text {
  return both(pack.brand.name.de, pack.brand.name.en);
}

export function divisionOn(division: Division | null, pack: ConfigPack = PACK): boolean {
  return division === null || pack.divisions[division] === true;
}

/**
 * The shipped sites this pack shows, in shipped order (the first stays the world origin).
 *
 * ⚠️ ONLY READY CITIES, AND EVERY READY AOI MUST SHIP. A planned city in the pack is a promise,
 * not terrain; listing it would offer a site the scene cannot load. A ready city whose AOI this
 * build lacks is an error, not a quiet omission, and each ready city must ship its own world's
 * shell core. vite.config.ts runs the same check at build time.
 */
export function packSites(pack: ConfigPack = PACK, sites: readonly SiteConfig[] = SITES): SiteConfig[] {
  assertPackSites(pack, Object.fromEntries(sites.map((site) => [site.id, site.world])), SHELL_SITES);
  const wanted = new Set(pack.cities.filter((city) => city.status === 'ready').flatMap((city) => city.aois));
  return sites.filter((site) => wanted.has(site.id));
}

/** Where the app opens: the default city's first shipped AOI. Never a different city. */
export function packStartSite(pack: ConfigPack = PACK, sites: readonly SiteConfig[] = packSites(pack)): string {
  const city = pack.cities.find((entry) => entry.id === pack.defaultCity);
  const start = city?.aois.find((aoi) => sites.some((site) => site.id === aoi));
  if (!start) throw new Error(`Config pack "${pack.id}": default city ${pack.defaultCity} has no shipped site.`);
  return start;
}

/**
 * Brand colours as CSS custom properties. Alerts keep their own colour (plan D20).
 *
 * ⚠️ PACK VARIABLES, NOT THE THEME TOKENS. Writing `--cp-accent` inline on <html> would beat the
 * dark theme's own value, so `?clawpilotTheme=dark` kept the light accent (review 2026-10-05).
 * style.css derives `--cp-accent` from `--pack-accent` (light) and `--pack-accent-dark` (dark,
 * falling back to the light one).
 */
export function applyBrand(pack: ConfigPack = PACK, root: HTMLElement = document.documentElement): void {
  const { accent, accentDark, alert } = pack.brand.colors ?? {};
  if (accent) root.style.setProperty('--pack-accent', accent);
  if (accentDark) root.style.setProperty('--pack-accent-dark', accentDark);
  if (alert) root.style.setProperty('--pack-alert', alert);
}
