/**
 * Non-secret build-time configuration (PLAN.md §8.3).
 *
 * A customer deployment must be able to point this app at *their* tenant with
 * nothing but env vars — no code change, no hard-coded ids. My MCAPS instance
 * is one config, not *the* config. Anything secret (service-principal client
 * secrets) lives in the customer's Key Vault and is only ever read inside a
 * notebook actuator.
 */
export interface GovEnv extends Record<string, string | undefined> {
  /** Tenant the app is deployed into. Emitted by `rayfin env`. */
  VITE_FABRIC_TENANT_ID?: string;
  /** SPA app registration used for the Power BI / Graph token hops. */
  VITE_FABRIC_SPA_CLIENT_ID?: string;
  /** Workspace hosting the app item. Emitted by `rayfin env`. */
  VITE_FABRIC_WORKSPACE_ID?: string;

  /** `fabric_proxy` User Data Function invoke URL (server-side REST hop). */
  VITE_UDF_FABRIC_PROXY_URL?: string;

  /** Workspace hosting `governance_lh` + the Governance Model + notebooks. */
  VITE_GOV_WORKSPACE_ID?: string;
  /** Direct Lake semantic model id, once the bootstrap has created it. */
  VITE_GOV_MODEL_ID?: string;

  /** Bootstrap notebook (provisions lakehouse, tables, model, schedules). */
  VITE_GOV_BOOTSTRAP_NOTEBOOK_ID?: string;
  /**
   * The single write path. Every privileged change goes through this notebook,
   * which re-evaluates all four gates server-side (PLAN.md §8.7, §14).
   * Unset ⇒ the app cannot write anything at all, which is the safe default.
   */
  VITE_GOV_ACTUATOR_NOTEBOOK_ID?: string;
  /** Per-module collector notebooks. */
  VITE_GOV_FABRIC_COLLECTOR_NOTEBOOK_ID?: string;
  VITE_GOV_PP_COLLECTOR_NOTEBOOK_ID?: string;
  VITE_GOV_AGENT_COLLECTOR_NOTEBOOK_ID?: string;
  VITE_GOV_ENTRA_COLLECTOR_NOTEBOOK_ID?: string;

  /** Build-time module kill switches (`false` compiles the module out). */
  VITE_MODULE_FABRIC?: string;
  VITE_MODULE_PP?: string;
  VITE_MODULE_AGENT?: string;
  VITE_MODULE_ENTRA?: string;
}

export function getGovEnv(): Readonly<GovEnv> {
  return import.meta.env as unknown as GovEnv;
}

/** `true` unless the env var is explicitly the string `false`. */
export function isTruthyEnv(value: string | undefined, fallback = true): boolean {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() !== 'false' && value !== '0';
}
