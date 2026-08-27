/**
 * Config for the shared Fabric `fabric_proxy` User Data Function read path.
 *
 * All values are non-secret ids injected at build time via Vite env vars
 * (see `.env` / `config.sample.json`). `VITE_FABRIC_TENANT_ID` is provided by
 * `rayfin env`.
 *
 * Unlike the Data Catalog, a missing proxy URL is **not** fatal here: the app
 * must still render at T0 and tell the operator exactly what is missing
 * (PLAN.md §8.8). Callers get `null` and the Setup page explains it.
 */
export interface UdfConfig {
  tenantId: string;
  clientId: string;
  urls: { fabricProxy: string };
}

export function tryGetUdfConfig(): UdfConfig | null {
  const tenantId = import.meta.env.VITE_FABRIC_TENANT_ID as string | undefined;
  const clientId = import.meta.env.VITE_FABRIC_SPA_CLIENT_ID as string | undefined;
  const fabricProxy = import.meta.env.VITE_UDF_FABRIC_PROXY_URL as string | undefined;
  if (!tenantId || !clientId || !fabricProxy) return null;
  return { tenantId, clientId, urls: { fabricProxy } };
}

export function getUdfConfig(): UdfConfig {
  const config = tryGetUdfConfig();
  if (!config) {
    // Name only what is actually absent. Listing all three sends an operator
    // hunting for settings that are already correct.
    const missing = (
      [
        ['VITE_FABRIC_TENANT_ID', import.meta.env.VITE_FABRIC_TENANT_ID],
        ['VITE_FABRIC_SPA_CLIENT_ID', import.meta.env.VITE_FABRIC_SPA_CLIENT_ID],
        ['VITE_UDF_FABRIC_PROXY_URL', import.meta.env.VITE_UDF_FABRIC_PROXY_URL],
      ] as const
    )
      .filter(([, value]) => !value)
      .map(([name]) => name);
    throw new Error(`Missing Fabric read-path config. Set ${missing.join(', ')}.`);
  }
  return config;
}
