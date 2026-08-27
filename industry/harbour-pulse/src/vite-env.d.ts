/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FERRY_API?: string;
  readonly VITE_CESIUM_ION_TOKEN?: string;
  readonly VITE_FERRY_MODEL_URL?: string;
  readonly VITE_KUSTO_CLUSTER?: string;
  readonly VITE_KUSTO_DATABASE?: string;
  readonly VITE_KUSTO_SCOPE?: string;
  readonly VITE_ENTRA_CLIENT_ID?: string;
  readonly VITE_ENTRA_TENANT_ID?: string;
}
