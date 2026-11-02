import { getRayfinClient } from '@/services/rayfinClient';
import { validWorkspaceDecision, validWorkspaceRequest, type WorkspaceDecision, type WorkspaceRequest } from '@/um/domain/workspaceRequest';

import { readAllPages } from './store';

export interface WorkspaceRequestStore {
  list(): Promise<{ requests: WorkspaceRequest[]; decisions: WorkspaceDecision[] }>;
  submit(request: WorkspaceRequest): Promise<void>;
  /** Unique primary-key insert; never replace an existing decision or retry an uncertain insert. */
  claim(decision: WorkspaceDecision): Promise<void>;
  claimContinuation(decision: WorkspaceDecision): Promise<void>;
  checkpoint(decision: WorkspaceDecision): Promise<void>;
}

function continuationKey(decision: WorkspaceDecision): string {
  if (!validWorkspaceDecision(decision) || decision.status !== 'Provisioning' || !decision.attempt) throw new Error('Invalid workspace continuation');
  return `${decision.id.toLowerCase()}:${decision.attempt}`;
}

export class RayfinWorkspaceRequestStore implements WorkspaceRequestStore {
  async list() {
    const data = getRayfinClient().data;
    const [rows, decisions] = await Promise.all([
      readAllPages(async (cursor) => {
        let query = data.UmWorkspaceRequest.select(['id', 'display_name', 'description', 'reason', 'requester_oid', 'requester_upn', 'requester_name', 'created_at']).orderBy({ id: 'asc' }).first(200);
        if (cursor) query = query.after(cursor);
        return query.executePaginated();
      }),
      readAllPages(async (cursor) => {
        let query = data.UmWorkspaceDecision.select(['id', 'state_json']).orderBy({ id: 'asc' }).first(200);
        if (cursor) query = query.after(cursor);
        return query.executePaginated();
      }),
    ]);
    const requests: WorkspaceRequest[] = rows.map((row) => ({
      id: row.id,
      displayName: String(row.display_name),
      description: String(row.description),
      reason: String(row.reason),
      requester: { objectId: row.requester_oid, userPrincipalName: String(row.requester_upn), displayName: String(row.requester_name) },
      createdAt: new Date(row.created_at).toISOString(),
    }));
    if (requests.some((request) => !validWorkspaceRequest(request))) throw new Error('Invalid stored workspace request');
    return {
      requests: requests.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      decisions: decisions.map((row) => {
        const value: unknown = JSON.parse(String(row.state_json));
        if (!validWorkspaceDecision(value) || value.id !== row.id) throw new Error('Invalid stored workspace decision');
        return value;
      }),
    };
  }

  async submit(request: WorkspaceRequest) {
    if (!validWorkspaceRequest(request)) throw new Error('Invalid workspace request');
    await getRayfinClient().data.UmWorkspaceRequest.create({
      id: request.id, display_name: request.displayName, description: request.description, reason: request.reason,
      requester_oid: request.requester.objectId, requester_upn: request.requester.userPrincipalName,
      requester_name: request.requester.displayName, created_at: new Date(request.createdAt),
    });
  }

  async claim(decision: WorkspaceDecision) {
    if (!validWorkspaceDecision(decision)) throw new Error('Invalid workspace decision');
    await getRayfinClient().data.UmWorkspaceDecision.create({ id: decision.id, state_json: JSON.stringify(decision) });
  }

  async checkpoint(decision: WorkspaceDecision) {
    if (!validWorkspaceDecision(decision)) throw new Error('Invalid workspace decision');
    await getRayfinClient().data.UmWorkspaceDecision.update({ id: decision.id }, { state_json: JSON.stringify(decision) });
  }

  async claimContinuation(decision: WorkspaceDecision) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(continuationKey(decision))));
    digest[6] = (digest[6] & 15) | 128;
    digest[8] = (digest[8] & 63) | 128;
    const hex = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    // Both contenders insert the same primary key, independent of browser or actor.
    await getRayfinClient().data.UmWorkspaceContinuation.create({ id, state_json: JSON.stringify(decision) });
  }
}

export class MemoryWorkspaceRequestStore implements WorkspaceRequestStore {
  private requests: WorkspaceRequest[] = [];
  private decisions: WorkspaceDecision[] = [];
  private continuations: string[] = [];

  constructor(private storage?: Pick<Storage, 'getItem' | 'setItem'>) {
    if (storage) {
      const saved = storage.getItem('um.demo.workspaceRequests');
      if (saved) {
        const state = JSON.parse(saved) as { requests: WorkspaceRequest[]; decisions: WorkspaceDecision[]; continuations?: string[] };
        if (!Array.isArray(state.requests) || !Array.isArray(state.decisions) ||
          (state.continuations !== undefined && (!Array.isArray(state.continuations) || state.continuations.some((key) => typeof key !== 'string')))) throw new Error('Invalid workspace demo state');
        this.requests = state.requests;
        this.decisions = state.decisions;
        this.continuations = state.continuations ?? [];
      }
    }
  }

  private save() {
    this.storage?.setItem('um.demo.workspaceRequests', JSON.stringify({ requests: this.requests, decisions: this.decisions, continuations: this.continuations }));
  }

  async list() {
    return structuredClone({ requests: this.requests, decisions: this.decisions });
  }

  async submit(request: WorkspaceRequest) {
    if (!validWorkspaceRequest(request) || this.requests.some((r) => r.id === request.id)) throw new Error('Invalid or duplicate workspace request');
    this.requests.push(structuredClone(request));
    this.save();
  }

  async claim(decision: WorkspaceDecision) {
    if (this.decisions.some((d) => d.id === decision.id)) throw new Error('Workspace request already decided');
    this.decisions.push(structuredClone(decision));
    this.save();
  }

  async checkpoint(decision: WorkspaceDecision) {
    const index = this.decisions.findIndex((d) => d.id === decision.id);
    if (index < 0) throw new Error('Workspace request not claimed');
    this.decisions[index] = structuredClone(decision);
    this.save();
  }

  async claimContinuation(decision: WorkspaceDecision) {
    const key = continuationKey(decision);
    if (this.continuations.includes(key)) throw new Error('Workspace continuation already claimed; inspect the saved state before proceeding');
    this.continuations.push(key);
    this.save();
  }
}
