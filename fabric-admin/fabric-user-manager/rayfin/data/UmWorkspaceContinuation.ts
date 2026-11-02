import { entity, role, uuid, text } from '@microsoft/rayfin-core';

/** Immutable claim per request and attempt; a lost claim response never permits replay. */
@entity()
@role('authenticated', ['create', 'read'])
export class UmWorkspaceContinuation {
  @uuid() id!: string;
  @text() state_json!: string;
}
