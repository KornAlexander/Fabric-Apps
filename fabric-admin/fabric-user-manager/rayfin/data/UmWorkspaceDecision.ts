import { entity, role, uuid, text } from '@microsoft/rayfin-core';

/**
 * One decision per request: its primary key is the request ID. Inserting it
 * claims the request before any external write. Checkpoints never authorize
 * writes; Fabric and Entra enforce the approver's delegated permissions.
 */
@entity()
@role('authenticated', ['create', 'read', 'update'])
export class UmWorkspaceDecision {
  @uuid() id!: string;
  @text() state_json!: string;
}
