/**
 * The catalog client singleton the views share.
 *
 * When the Fabric read-path config is present (VITE_CATALOG_MODEL_ID +
 * VITE_CATALOG_WORKSPACE_ID), it runs real DAX against the "Data Catalog Model"
 * Direct Lake semantic model through the shared `fabric_proxy` UDF. Otherwise it
 * falls back to the bundled `MockCatalogClient` (local dev without Fabric).
 */
import { type CatalogClient, DaxCatalogClient, MockCatalogClient } from './catalog';
import { executeDax } from './udfClient';

const modelId = import.meta.env.VITE_CATALOG_MODEL_ID as string | undefined;
const workspaceId = (import.meta.env.VITE_CATALOG_WORKSPACE_ID ||
  import.meta.env.VITE_FABRIC_WORKSPACE_ID) as string | undefined;

/** True when the app is wired to the live catalog model. */
export const isLiveCatalog = Boolean(modelId && workspaceId);

export const catalogClient: CatalogClient = isLiveCatalog
  ? new DaxCatalogClient((dax) => executeDax(workspaceId!, modelId!, dax))
  : new MockCatalogClient();
