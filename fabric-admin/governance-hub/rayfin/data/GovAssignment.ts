import { entity, role, uuid, text, date, boolean } from '@microsoft/rayfin-core';

/**
 * An entitlement: *this principal holds this persona in this scope*
 * (PLAN.md §12.1).
 *
 * This is the **desired** side of drift. Without it, every piece of access in
 * the tenant is unjustified by definition — which is technically true on day
 * one and useless as a report.
 *
 * `valid_until` drives time-bound entitlements and auto-expiry (D8). An expired
 * row is kept rather than deleted, so the drift row that follows can explain
 * *why* the access disappeared.
 */
@entity()
@role('authenticated', '*')
export class GovAssignment {
  @uuid() id!: string;

  @text() principal_id!: string;
  @text() principal_name!: string;
  /** User | Group | ServicePrincipal */
  @text() principal_type!: string;

  @text() persona_id!: string;

  /** Tenant | Capacity | Workspace | Environment | Audience */
  @text() scope_type!: string;
  @text() scope_id!: string;
  @text() scope_name!: string;

  /** Request | Policy | Bulk | Inherited */
  @text() granted_via!: string;
  @text() granted_by!: string;
  @date() granted_at!: Date;

  @date({ optional: true }) valid_until?: Date;
  @boolean() is_active!: boolean;

  /** Links back to the request that produced it, once requests exist. */
  @text({ optional: true }) request_id?: string;
}
