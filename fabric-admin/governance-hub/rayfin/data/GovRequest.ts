import { entity, role, uuid, text, date } from '@microsoft/rayfin-core';

/**
 * A self-service access request (PLAN.md §13, page 6).
 *
 * The front door: *"I want to be able to create X in scope Y"*. It is kept
 * separate from `GovAssignment` on purpose — the request is the **decision
 * record** (who asked, who approved, why), the assignment is the **entitlement**
 * that drift is measured against. Collapsing them would make a withdrawn or
 * denied request indistinguishable from one that was never made.
 */
@entity()
@role('authenticated', '*')
export class GovRequest {
  @uuid() id!: string;

  @text() requester_id!: string;
  @text() requester_name!: string;

  @text() persona_id!: string;

  /** Tenant | Capacity | Workspace | Environment | Audience */
  @text() scope_type!: string;
  @text() scope_id!: string;
  @text() scope_name!: string;

  @text() justification!: string;

  /** Pending | Approved | Denied | Failed | Verified | Withdrawn */
  @text() status!: string;

  @date() created_at!: Date;

  @text({ optional: true }) decided_by?: string;
  @date({ optional: true }) decided_at?: Date;
  @text({ optional: true }) decision_note?: string;

  /** Time-bound access, carried through to the entitlement on approval. */
  @date({ optional: true }) valid_until?: Date;

  /** The entitlement created on approval, if it got that far. */
  @text({ optional: true }) assignment_id?: string;
}
