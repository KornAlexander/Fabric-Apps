/**
 * Config for the shared Fabric `fabric_proxy` User Data Function read path.
 * All values are non-secret ids injected at build time via Vite env vars
 * (see the app-root `.env`). VITE_FABRIC_TENANT_ID is provided by `rayfin env`.
 */
export interface UdfConfig {
  tenantId: string;
  clientId: string;
  urls: { fabricProxy: string };
}

export function getUdfConfig(): UdfConfig {
  const tenantId = import.meta.env.VITE_FABRIC_TENANT_ID as string | undefined;
  const clientId = import.meta.env.VITE_FABRIC_SPA_CLIENT_ID as string | undefined;
  const fabricProxy = import.meta.env.VITE_UDF_FABRIC_PROXY_URL as string | undefined;

  if (!tenantId || !clientId || !fabricProxy) {
    throw new Error(
      'Missing Fabric read-path config. Set VITE_FABRIC_TENANT_ID, ' +
        'VITE_FABRIC_SPA_CLIENT_ID and VITE_UDF_FABRIC_PROXY_URL.'
    );
  }
  return { tenantId, clientId, urls: { fabricProxy } };
}
