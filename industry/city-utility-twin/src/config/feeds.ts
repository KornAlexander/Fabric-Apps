/**
 * Unofficial live interfaces, switched on per build.
 *
 * ⚠️ OFF UNLESS THE BUILD SAYS OTHERWISE (plan D09). These are city services that work and are
 * widely used but publish no terms for third-party use. The public build therefore ships without
 * them; a deployment that has weighed the risk switches them on with
 * `VITE_UNOFFICIAL_FEEDS=mvg` at build time (tools/deploy-fabric.ps1 -UnofficialFeeds mvg).
 */
export const UNOFFICIAL_FEEDS = ['mvg'] as const;

export type UnofficialFeed = (typeof UNOFFICIAL_FEEDS)[number];

export function enabledFeeds(raw: string | undefined): Set<UnofficialFeed> {
  const known = new Set<string>(UNOFFICIAL_FEEDS);
  return new Set(
    (raw ?? '').split(',').map((part) => part.trim().toLowerCase())
      .filter((part): part is UnofficialFeed => known.has(part)),
  );
}

export const ENABLED_FEEDS = enabledFeeds(import.meta.env.VITE_UNOFFICIAL_FEEDS);

export function isUnofficial(id: string): id is UnofficialFeed {
  return (UNOFFICIAL_FEEDS as readonly string[]).includes(id);
}
