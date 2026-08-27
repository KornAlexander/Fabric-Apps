/**
 * Rayfin data schema.
 *
 * Empty on purpose. Gleitschirm-Insights keeps its analytical data in Fabric — a Lakehouse with a Direct
 * Lake semantic model (PLAN §10.1) and an Eventhouse for the live gauge feed (§10.3) — rather than
 * in Rayfin's own data service. The front end reads precomputed assets and talks to Fabric, so
 * there are no Rayfin entities to declare.
 */
export type GleitschirmInsightsSchema = Record<string, never>;

export const schema = [];
