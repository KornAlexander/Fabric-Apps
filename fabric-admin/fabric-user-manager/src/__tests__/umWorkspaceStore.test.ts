import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceDecision, WorkspaceRequest } from '@/um/domain/workspaceRequest';

import { createFakeData } from './helpers/fakeRayfinData';

const fake = createFakeData();
vi.mock('@/services/rayfinClient', () => ({ getRayfinClient: () => ({ data: fake.data }) }));
const { RayfinWorkspaceRequestStore } = await import('@/um/services/workspaceRequestStore');
const g = (n: number) => `cacacaca-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { objectId: g(2), displayName: 'Alex Admin', userPrincipalName: 'alex@x.example' };
const request: WorkspaceRequest = { id: g(1), displayName: 'Finance Development', description: 'true', reason: 'Build finance reports.', requester: actor, createdAt: '2026-11-02T10:00:00.000Z' };
const decision: WorkspaceDecision = { id: request.id, actor, status: 'Provisioning', at: request.createdAt, note: '', step: 'decision', groups: [] };
beforeEach(() => { fake.reset(); vi.stubGlobal('crypto', webcrypto); });
afterEach(() => vi.unstubAllGlobals());

describe('workspace requests with the Rayfin data client', () => {
  it('selects full rows, preserves the request primary key, and round-trips checkpoints', async () => {
    const store = new RayfinWorkspaceRequestStore();
    await store.submit(request);
    await store.claim(decision);
    await store.checkpoint({ ...decision, workspaceId: g(3), step: 'create-group-Admin' });
    expect(await store.list()).toEqual({
      requests: [request],
      decisions: [{ ...decision, workspaceId: g(3), step: 'create-group-Admin' }],
    });
    expect(fake.tables.UmWorkspaceRequest[0].id).toBe(request.id);
    expect(fake.tables.UmWorkspaceDecision).toHaveLength(1);
  });

  it('uses a create, not an upsert, so two concurrent claims cannot both win', async () => {
    const store = new RayfinWorkspaceRequestStore();
    const results = await Promise.allSettled([store.claim(decision), store.claim(decision)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(fake.tables.UmWorkspaceDecision).toHaveLength(1);
  });

  it('uses stable unique continuation keys across store instances and distinct keys per attempt', async () => {
    const first = new RayfinWorkspaceRequestStore();
    const second = new RayfinWorkspaceRequestStore();
    const next = { ...decision, attempt: 1 };
    const results = await Promise.allSettled([first.claimContinuation(next), second.claimContinuation(next)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(fake.tables.UmWorkspaceContinuation).toHaveLength(1);
    await second.claimContinuation({ ...next, attempt: 2 });
    expect(new Set(fake.tables.UmWorkspaceContinuation.map((row) => row.id)).size).toBe(2);
    await expect(first.claimContinuation({ ...next, attempt: 0 })).rejects.toThrow('Invalid workspace continuation');
    fake.state.unreachable = true;
    await expect(first.claimContinuation({ ...next, attempt: 3 })).rejects.toThrow('ECONNREFUSED');
  });

  it('surfaces database failures and malformed decision records instead of returning an empty list', async () => {
    const store = new RayfinWorkspaceRequestStore();
    fake.state.unreachable = true;
    await expect(store.list()).rejects.toThrow('ECONNREFUSED');
    await expect(store.claim(decision)).rejects.toThrow('ECONNREFUSED');
    fake.state.unreachable = false;
    fake.seed('UmWorkspaceDecision', { id: g(1), state_json: JSON.stringify({ ...decision, actor: false }) });
    await expect(store.list()).rejects.toThrow('Invalid stored workspace decision');
  });
});
import { webcrypto } from 'node:crypto';
