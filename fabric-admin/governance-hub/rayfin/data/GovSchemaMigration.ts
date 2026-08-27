import { entity, role, uuid, text, date, int } from '@microsoft/rayfin-core';

/**
 * Applied schema migrations — `gov_schema_migrations` (PLAN.md §12.1, §8.3).
 *
 * Reusable IP has to be upgradable: a customer running v1 must be able to take
 * v2 without losing their entitlement model. Every structural change to the
 * `gov_*` Delta tables or to these entities ships as an idempotent migration
 * notebook that appends exactly one row here.
 *
 * This table is written by the `Gov Bootstrap` notebook, never by the SPA.
 */
@entity()
@role('authenticated', '*')
export class GovSchemaMigration {
  @uuid() id!: string;

  /** Monotonic schema version this migration brings the deployment to. */
  @int() version!: number;

  /** Stable migration id, e.g. `0001_initial`. */
  @text() migration_id!: string;

  /** Applied | Skipped | Failed */
  @text() status!: string;

  @text({ optional: true }) notes?: string;
  @text({ optional: true }) error?: string;

  @text() applied_by!: string;
  @date() applied_at!: Date;
}
