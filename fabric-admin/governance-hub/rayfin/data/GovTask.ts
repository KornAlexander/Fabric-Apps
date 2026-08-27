import { entity, role, uuid, text, date } from '@microsoft/rayfin-core';

/**
 * A manual governance task (PLAN.md §12.1, §13 page 10).
 *
 * Raised when a binding has **no write API** and a human has to do it in a
 * portal. Kept as transactional app state rather than a lakehouse table,
 * because it is edited by people — the same reasoning as `GovRequest`.
 *
 * `status` distinguishes **Attested** (a human says they did it) from
 * **Verified** (a machine check re-read the plane and confirmed it). Collapsing
 * those two would turn a claim into governance evidence.
 */
@entity()
@role('authenticated', '*')
export class GovTask {
  @uuid() id!: string;

  /** Drift | Request | Policy */
  @text() source!: string;

  @text() binding_kind!: string;
  @text() module!: string;

  /** Non-localised summary of what has to happen. */
  @text() detail!: string;

  @text() scope_type!: string;
  @text() scope_id!: string;
  @text() scope_name!: string;

  @text({ optional: true }) principal_id?: string;
  @text({ optional: true }) principal_name?: string;

  /** Open | InProgress | Attested | Verified | Cancelled */
  @text() status!: string;

  @date() created_at!: Date;

  @text({ optional: true }) assignee?: string;
  @date({ optional: true }) due_date?: Date;

  @text({ optional: true }) completed_by?: string;
  @date({ optional: true }) completed_at?: Date;

  /** What the machine check found, or what the human claimed. */
  @text({ optional: true }) evidence?: string;

  /** The request that produced this task, when there was one. */
  @text({ optional: true }) request_id?: string;
}
