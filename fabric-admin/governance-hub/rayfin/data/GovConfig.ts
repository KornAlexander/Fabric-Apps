import { entity, role, uuid, text, date, boolean } from '@microsoft/rayfin-core';

/**
 * App configuration — the `gov_config` store from PLAN.md §12.1.
 *
 * Modelled as key/value rather than a single wide row so that new modules and
 * new write-gate kinds can be added without a schema migration. Values are
 * JSON-encoded strings; typed accessors live in `src/services/govConfig.ts`.
 *
 * Nothing secret is ever stored here. Service-principal secrets live in the
 * customer's Key Vault and are only ever read inside a notebook actuator
 * (PLAN.md §19).
 *
 * Known keys (see `src/services/govConfig.ts` → `GOV_CONFIG_KEYS`):
 *   modules.enabled          string[]   e.g. ["fabric","entra"]
 *   writes.enabled           boolean    master kill switch — ships `false`
 *   writes.kinds             string[]   armed binding kinds — ships `[]`
 *   writes.scopeAllowlist    string[]   scope ids or ["*"] — ships `[]`
 *   locale.default           string     "en" | "de"
 *   approvers.emails         string[]
 *   telemetry.enabled        boolean    always false; present so it is auditable
 */
@entity()
@role('authenticated', '*')
export class GovConfig {
  @uuid() id!: string;

  /** Dotted config key, unique per deployment. */
  @text() config_key!: string;

  /** JSON-encoded value. Scalars are encoded too (`"true"`, `"\"en\""`). */
  @text() config_value!: string;

  /** Free-text note explaining why this value was set (audit aid). */
  @text({ optional: true }) note?: string;

  /** False for keys the app manages itself and users should not hand-edit. */
  @boolean() user_editable!: boolean;

  @text() updated_by!: string;
  @date() updated_at!: Date;
}
