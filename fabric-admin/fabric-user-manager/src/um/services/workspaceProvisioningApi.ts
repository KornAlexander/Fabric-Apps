import { isGuid } from '@/um/domain/types';
import { validWorkspaceInput, type Capacity, type WorkspaceRequestInput } from '@/um/domain/workspaceRequest';

import { FABRIC_API_ORIGIN } from './fabricOps';
import { getGraphToken, getPinnedObjectId } from './graphAuth';
import type { GraphFetch } from './graphRead';
import type { WorkspaceProvisioner } from './workspaceRequests';

const BASE = `${FABRIC_API_ORIGIN}/v1`;

/** Loaded only in write-enabled builds. Non-idempotent creates are never retried. */
export class FabricWorkspaceProvisioner implements WorkspaceProvisioner {
  constructor(private fetcher: GraphFetch = (url, init) => fetch(url, init)) {}

  private async token(scope: 'capacity' | 'fabricWrite', actorId: string) {
    if (getPinnedObjectId() !== actorId.toLowerCase()) throw new Error('actor-mismatch');
    const token = await getGraphToken(scope);
    if (getPinnedObjectId() !== actorId.toLowerCase()) throw new Error('actor-mismatch');
    return token;
  }

  async listCapacities(actorId: string): Promise<Capacity[]> {
    const token = await this.token('capacity', actorId);
    const capacities: Capacity[] = [];
    const seen = new Set<string>();
    let url = `${BASE}/capacities`;
    for (let page = 0; page < 50; page++) {
      const response = await this.fetcher(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000), redirect: 'error' });
      if (!response.ok) throw new Error(`capacity-read-${response.status}`);
      const body: { value?: unknown; continuationToken?: unknown } = await response.json();
      if (!Array.isArray(body.value)) throw new Error('capacity-shape');
      for (const item of body.value) {
        if (!item || !isGuid(item.id) || typeof item.displayName !== 'string' || typeof item.state !== 'string') throw new Error('capacity-shape');
        capacities.push({ id: item.id.toLowerCase(), displayName: item.displayName, state: item.state });
      }
      if (!body.continuationToken) return capacities;
      if (typeof body.continuationToken !== 'string' || seen.has(body.continuationToken)) throw new Error('capacity-pagination');
      seen.add(body.continuationToken);
      url = `${BASE}/capacities?continuationToken=${encodeURIComponent(body.continuationToken)}`;
    }
    throw new Error('capacity-limit');
  }

  async createWorkspace(input: WorkspaceRequestInput, capacityId: string, actorId: string): Promise<string> {
    if (!validWorkspaceInput(input) || !isGuid(capacityId)) throw new Error('invalid-workspace');
    const token = await this.token('fabricWrite', actorId);
    const response = await this.fetcher(`${BASE}/workspaces`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: input.displayName.trim(), description: input.description.trim(), capacityId: capacityId.toLowerCase() }),
    });
    if (response.status !== 201) throw new Error(`workspace-create-${response.status}`);
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('id' in body) || !isGuid(body.id)) throw new Error('workspace-create-uncertain');
    return body.id.toLowerCase();
  }

  async verifyWorkspace(workspaceId: string, capacityId: string, actorId: string, expectedName?: string): Promise<void> {
    if (!isGuid(workspaceId) || !isGuid(capacityId)) throw new Error('invalid-workspace');
    const token = await this.token('fabricWrite', actorId);
    const response = await this.fetcher(`${BASE}/workspaces/${workspaceId}`, {
      method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`workspace-verify-${response.status}`);
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('id' in body) || !isGuid(body.id) || !('capacityId' in body) ||
      !isGuid(body.capacityId) || body.id.toLowerCase() !== workspaceId.toLowerCase() ||
      body.capacityId.toLowerCase() !== capacityId.toLowerCase()) throw new Error('workspace-capacity-not-confirmed');
    if (expectedName !== undefined && (!('displayName' in body) || body.displayName !== expectedName)) throw new Error('workspace-name-not-confirmed');
  }
}
