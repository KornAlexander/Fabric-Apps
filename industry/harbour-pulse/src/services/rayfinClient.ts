import { RayfinClient } from '@microsoft/rayfin-client';

import type { AppSchema } from '../../rayfin/data/schema';

export interface RayfinClientConfig {
  baseUrl: string;
  publishableKey: string;
  /** True when the API URL points at localhost. Exposed via {@link isLocalBackend}. */
  localDev: boolean;
}

let client: RayfinClient<AppSchema> | null = null;
let localDev = false;
let reauth: (() => Promise<boolean>) | null = null;
let reauthInFlight: Promise<boolean> | null = null;

export function initRayfinClient(
  config: RayfinClientConfig
): RayfinClient<AppSchema> {
  if (client) {
    throw new Error('Rayfin client is already initialized.');
  }
  client = new RayfinClient<AppSchema>({
    baseUrl: config.baseUrl,
    publishableKey: config.publishableKey,
    useProxy: false,
    authStorage: true,
  });
  localDev = config.localDev;
  return client;
}

export function getRayfinClient(): RayfinClient<AppSchema> {
  if (!client) {
    throw new Error(
      'Rayfin client not initialized. Call bootstrapAuth() first.'
    );
  }
  return client;
}

/** True when the app was bootstrapped against a localhost backend. */
export function isLocalBackend(): boolean {
  return localDev;
}

/**
 * Register how to mint a fresh Rayfin session. The SDK can only refresh with a
 * refresh token; when that fails it clears the session and every later request
 * 401s. Embedded in Fabric the only way back is to re-run the postMessage
 * handoff, which lives in the auth service — so bootstrap hands it over here.
 */
export function setSessionRecovery(fn: () => Promise<boolean>): void {
  reauth = fn;
}

/** Re-run the registered recovery, coalescing concurrent callers. */
export function recoverSession(): Promise<boolean> {
  if (!reauth) return Promise.resolve(false);
  reauthInFlight ??= reauth().finally(() => {
    reauthInFlight = null;
  });
  return reauthInFlight;
}
