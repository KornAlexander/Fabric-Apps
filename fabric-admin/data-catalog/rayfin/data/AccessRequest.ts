import { entity, role, uuid, text, date } from '@microsoft/rayfin-core';

/**
 * One row per access request submitted through the catalog's request front
 * door (PLAN.md §7). Mirrors the `cat_access_requests` Delta table so the
 * app-side store and the lakehouse catalog share one shape.
 *
 * Fulfilment of an approved request is performed server-side by a dedicated
 * service principal (Decision D6) — never from the browser. This entity only
 * captures the request/approval lifecycle and audit trail.
 */
@entity()
@role('authenticated', '*')
export class AccessRequest {
  @uuid() id!: string;

  /** Workspace | RLS | AppAudience */
  @text() request_type!: string;

  /** Target item id (workspace / model / app). */
  @text() target_id!: string;
  @text() target_name!: string;

  /** Requested role (workspace role) or RLS role / audience name. */
  @text({ optional: true }) requested_role?: string;

  @text() requester!: string;
  @text({ optional: true }) justification?: string;

  /** Draft | Submitted | Approved | Denied | Fulfilled | Failed | Cancelled */
  @text() status!: string;

  @text({ optional: true }) approver?: string;
  @text({ optional: true }) decision?: string;
  @text({ optional: true }) fulfilment_status?: string;
  @text({ optional: true }) fulfilment_detail?: string;
  @text({ optional: true }) error?: string;

  @date() requested_at!: Date;
  @date({ optional: true }) decided_at?: Date;

  /** Requester association populated from the JWT `sub` claim. */
  @text() user_id!: string;
}
