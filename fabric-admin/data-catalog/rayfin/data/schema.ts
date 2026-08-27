import { AccessRequest } from './AccessRequest.js';

/**
 * Schema type definition for the Data Catalog app.
 *
 * Maps entity names to their model types, giving full type safety when using
 * the RayfinClient (`client.data.AccessRequest…`). The catalog inventory
 * itself lives in the catalog lakehouse (read via a Direct Lake model); this
 * app-side entity only backs the access-request front door (PLAN.md §7).
 */
export type DataAppSchema = {
  AccessRequest: AccessRequest;
};

export const schema = [AccessRequest];
