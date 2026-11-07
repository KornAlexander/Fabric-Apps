import { entity, role, uuid, text, date } from '@microsoft/rayfin-core';

/** Advisory requests, immutable after submission. Identity is verified again before provisioning. */
@entity()
@role('authenticated', ['create', 'read'])
export class UmWorkspaceRequest {
  @uuid() id!: string;
  @text({ max: 100 }) display_name!: string;
  @text({ max: 1000 }) description!: string;
  @text({ max: 1000 }) reason!: string;
  @text({ max: 36 }) requester_oid!: string;
  @text({ max: 256 }) requester_upn!: string;
  @text({ max: 256 }) requester_name!: string;
  @date() created_at!: Date;
}
