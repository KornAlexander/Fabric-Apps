import { entity, role, uuid, text, date, boolean } from '@microsoft/rayfin-core';

/**
 * A customer's override of a seeded persona, or an entirely custom one
 * (PLAN.md §12.1, decision D28).
 *
 * Only the *deltas* are stored. A customer who renamed a persona still picks up
 * capability corrections when the product updates, and a seeded persona can
 * always be reset by deleting its row.
 *
 * Personas are customer data; capabilities and binding recipes are product
 * knowledge and live in code (`src/domain/capabilities.ts`).
 */
@entity()
@role('authenticated', '*')
export class GovPersona {
  @uuid() id!: string;

  /** Stable persona id — matches a seed id, or is customer-invented. */
  @text() persona_id!: string;

  @text({ optional: true }) name?: string;
  @text({ optional: true }) description?: string;

  /** Low | Medium | High | Critical */
  @text({ optional: true }) risk_tier?: string;

  /** JSON array of capability ids. Absent means "inherit the seed". */
  @text({ optional: true }) capability_ids_json?: string;

  @boolean({ optional: true }) is_active?: boolean;

  /** True when this row defines a persona that is not in the seed. */
  @boolean() is_custom!: boolean;

  @text() updated_by!: string;
  @date() updated_at!: Date;
}
