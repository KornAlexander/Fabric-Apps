// The config pack chosen at build time (see vite.config.ts, CONFIG_PACK). Validated at startup by
// src/config/activePack.ts, so it is typed as unknown here on purpose.
declare module 'virtual:config-pack' {
  const pack: unknown;
  export default pack;
}

// Allow `import ... from './pack.mjs'` from TypeScript with loose types; the runtime checks it.
declare module '*/pack.mjs' {
  export const DIVISIONS: readonly string[];
  export function validatePack(pack: unknown): string[];
  export function assertPack(pack: unknown): unknown;
  export function packSiteErrors(pack: unknown, siteWorld: Readonly<Record<string, string>>, shells: Readonly<Record<string, string>>): string[];
  export function assertPackSites(pack: unknown, siteWorld: Readonly<Record<string, string>>, shells: Readonly<Record<string, string>>): void;
}
