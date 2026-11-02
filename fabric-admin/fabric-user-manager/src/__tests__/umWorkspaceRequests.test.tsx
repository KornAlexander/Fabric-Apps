import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/i18n';
import { WorkspaceRequestsPage } from '@/um/components/WorkspaceRequestsPage';
import { PROVISIONED_ROLES, canContinueWorkspace, validWorkspaceDecision, validWorkspaceInput, workspaceGroupName, type WorkspaceDecision, type WorkspaceRequest } from '@/um/domain/workspaceRequest';
import { notReadable, ok, type DirectoryMember, type RoleAssignment } from '@/um/domain/types';
import { SETTING_BINDING_CHANGES } from '@/um/services/bindingChanges';
import { SETTING_GROUP_CREATION } from '@/um/services/groupCreation';
import { createUmServices } from '@/um/services/services';
import { MemoryUmStore, SETTING_MEMBER_CHANGES } from '@/um/services/store';
import { MemoryWorkspaceRequestStore } from '@/um/services/workspaceRequestStore';
import { PRINCIPAL_RESOLUTION_DELAYS_MS, continueWorkspace, decideWorkspace, type WorkspaceApprovalDeps } from '@/um/services/workspaceRequests';

const g = (n: number) => `abcdefab-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { objectId: g(1), displayName: 'Alex Admin', userPrincipalName: 'admin@x.example' };
const requester = { objectId: g(2), displayName: 'Uwe User', userPrincipalName: 'uwe@x.example' };
const request: WorkspaceRequest = { id: g(3), displayName: 'Finance Development', description: 'Finance project', reason: 'Build finance reports for the team.', requester, createdAt: '2026-11-02T10:00:00Z' };
const person: DirectoryMember = { id: requester.objectId, displayName: requester.displayName, userPrincipalName: requester.userPrincipalName, type: 'user', userType: 'Member', accountEnabled: true };
const capacityId = g(4);
const workspaceId = g(5);
const principalNotFound = { ok: false, code: 'failed', status: 400, serviceCode: 'PrincipalNotFound', message: 'The provided principal was not found' } as const;
afterEach(() => vi.useRealTimers());

async function setup() {
  const services = createUmServices({ mock: true, adminUserIds: [] }, '?as=admin');
  const store = new MemoryWorkspaceRequestStore();
  await store.submit(request);
  const umStore = new MemoryUmStore();
  for (const key of [SETTING_MEMBER_CHANGES, SETTING_BINDING_CHANGES, SETTING_GROUP_CREATION]) await umStore.setSetting(key, true);
  const assignments: RoleAssignment[] = [];
  const members: DirectoryMember[] = [];
  const groupNames = new Map<string, string>();
  let next = 10;
  const deps: WorkspaceApprovalDeps = {
    actor, isAppAdmin: true, writesInBuild: true, store, umStore,
    directory: {
      ...services.directory,
      resolveUser: vi.fn(async () => ok(person)),
      listOwners: vi.fn(async () => ok([{ id: actor.objectId, type: 'user' as const }])),
      listMembers: vi.fn(async () => ok(members)),
      getGroup: vi.fn(async (id) => ok({
        id, displayName: groupNames.get(id) ?? '', securityEnabled: true, mailEnabled: false,
        groupTypes: [], isAssignableToRole: null, onPremisesSyncEnabled: null,
      })),
    },
    fabric: { ...services.fabric, listRoleAssignments: vi.fn(async () => ok(assignments)) },
    provisioner: {
      listCapacities: vi.fn(async () => [{ id: capacityId, displayName: 'F4', state: 'Active' }]),
      createWorkspace: vi.fn(async () => workspaceId),
      verifyWorkspace: vi.fn(async () => {}),
    },
    groupCreator: { create: vi.fn(async (input) => {
      const id = g(next++);
      groupNames.set(id, input.displayName);
      return { ok: true as const, id };
    }) },
    bindingWriter: { write: vi.fn(async (change) => {
      if (change.action !== 'add') throw new Error('Expected add');
      assignments.push({ id: g(next++), principalId: change.groupId, principalType: 'Group', role: change.role });
      return { ok: true as const };
    }) },
    memberWriter: { write: vi.fn(async () => { members.push(person); return { ok: true as const }; }) },
  };
  return deps;
}

describe('workspace request planning and provisioning', () => {
  it('validates exact input bounds and preserves role suffixes for long names', () => {
    expect(validWorkspaceInput(request)).toBe(true);
    for (const displayName of ['ab', 'x'.repeat(101), 'Admin monitoring', 'Name\nInjected']) expect(validWorkspaceInput({ ...request, displayName })).toBe(false);
    expect(validWorkspaceInput({ ...request, displayName: 'x'.repeat(100), reason: 'x'.repeat(10), description: 'x'.repeat(1000) })).toBe(true);
    expect(validWorkspaceInput({ ...request, reason: 'x'.repeat(9) })).toBe(false);
    expect(validWorkspaceInput({ ...request, reason: 'x'.repeat(1001) })).toBe(false);
    expect(validWorkspaceInput({ ...request, description: 'x'.repeat(1001) })).toBe(false);
    expect(new Set(PROVISIONED_ROLES.map((role) => workspaceGroupName({ ...request, displayName: 'x'.repeat(100) }, role))).size).toBe(4);
  });

  it('creates a capacity-backed workspace, four group roles, and only Contributor membership', async () => {
    const deps = await setup();
    const result = await decideWorkspace(deps, request.id, { approve: true, capacityId, note: 'Approved for Finance' });
    expect(result).toMatchObject({ status: 'Approved', step: 'complete', workspaceId, capacityId });
    expect(result.groups.map((group) => group.role)).toEqual(PROVISIONED_ROLES);
    expect(deps.provisioner.createWorkspace).toHaveBeenCalledExactlyOnceWith(request, capacityId, actor.objectId);
    expect(deps.groupCreator.create).toHaveBeenCalledTimes(4);
    for (const role of PROVISIONED_ROLES) {
      expect(deps.groupCreator.create).toHaveBeenCalledWith(expect.objectContaining({ displayName: workspaceGroupName(request, role), ownerIds: [actor.objectId] }), actor.objectId);
    }
    expect(deps.memberWriter.write).toHaveBeenCalledExactlyOnceWith('add', result.groups[2].id, requester.objectId, actor.objectId);
    const managed = await deps.umStore.load();
    expect(managed.groups.map((group) => group.requestable)).toEqual([false, false, true, true]);
    expect(managed.bindings).toHaveLength(4);
    expect(managed.bindings.every((binding) => binding.provenance === 'read' && binding.scopeId === workspaceId)).toBe(true);
    expect((await deps.store.list()).decisions[0]).toEqual(result);
  });

  it('denies without making any external calls', async () => {
    const deps = await setup();
    expect(await decideWorkspace(deps, request.id, { approve: false, note: 'Use the existing workspace' })).toMatchObject({ status: 'Denied' });
    expect(deps.provisioner.listCapacities).not.toHaveBeenCalled();
    expect(deps.provisioner.createWorkspace).not.toHaveBeenCalled();
    expect(deps.groupCreator.create).not.toHaveBeenCalled();
    await expect(decideWorkspace(deps, request.id, { approve: true, capacityId, note: '' })).rejects.toThrow('already decided');
  });

  it('allows exactly one of two concurrent approvals to claim and provision', async () => {
    const deps = await setup();
    const results = await Promise.allSettled([
      decideWorkspace(deps, request.id, { approve: true, capacityId, note: '' }),
      decideWorkspace(deps, request.id, { approve: true, capacityId, note: '' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(deps.provisioner.createWorkspace).toHaveBeenCalledTimes(1);
  });

  it.each(['admin', 'build', 'switch', 'self', 'identity', 'capacity', 'audit'] as const)('sends no writes when blocked by %s', async (block) => {
    const deps = await setup();
    if (block === 'admin') deps.isAppAdmin = false;
    if (block === 'build') deps.writesInBuild = false;
    if (block === 'switch') await deps.umStore.setSetting(SETTING_GROUP_CREATION, false, actor.userPrincipalName);
    if (block === 'self') deps.actor = requester;
    if (block === 'identity') deps.directory.resolveUser = async () => ok({ ...person, displayName: 'Someone else' });
    if (block === 'capacity') deps.provisioner.listCapacities = async () => [{ id: capacityId, displayName: 'F4', state: 'Inactive' }];
    if (block === 'audit') deps.store.claim = async () => { throw new Error('Database unavailable'); };
    await expect(decideWorkspace(deps, request.id, { approve: true, capacityId, note: '' })).rejects.toThrow();
    expect(deps.provisioner.createWorkspace).not.toHaveBeenCalled();
    expect(deps.groupCreator.create).not.toHaveBeenCalled();
  });

  it('records partial resource IDs, stops at failure and never retries a decided request', async () => {
    const deps = await setup();
    deps.bindingWriter.write = vi.fn(async () => ({ ok: false as const, code: 'uncertain' as const }));
    const result = await decideWorkspace(deps, request.id, { approve: true, capacityId, note: '' });
    expect(result).toMatchObject({ status: 'Failed', step: 'assign-role-Admin', workspaceId, error: 'role-uncertain' });
    expect(result.groups).toHaveLength(1);
    expect(deps.memberWriter.write).not.toHaveBeenCalled();
    await expect(decideWorkspace(deps, request.id, { approve: true, capacityId, note: '' })).rejects.toThrow('already decided');
    expect(deps.provisioner.createWorkspace).toHaveBeenCalledTimes(1);
  });

  it('keeps an uncertain workspace creation locked, even without a returned resource ID', async () => {
    const deps = await setup();
    deps.provisioner.createWorkspace = vi.fn(async () => { throw new Error('Response lost'); });
    const result = await decideWorkspace(deps, request.id, { approve: true, capacityId, note: '' });
    expect(result).toMatchObject({ status: 'Failed', step: 'create-workspace', error: 'Response lost' });
    expect(deps.groupCreator.create).not.toHaveBeenCalled();
    expect((await deps.store.list()).decisions).toHaveLength(1);
  });

  it('does not claim success if read-back cannot confirm membership or roles', async () => {
    const deps = await setup();
    deps.directory.listMembers = async () => ok([]);
    expect(await decideWorkspace(deps, request.id, { approve: true, capacityId, note: '' })).toMatchObject({ status: 'Failed', step: 'verify-access', error: 'membership-not-confirmed' });
    expect((await deps.umStore.load()).groups).toHaveLength(0);
  });

  it('persists demo requests and decisions across persona reloads', async () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const first = new MemoryWorkspaceRequestStore(storage);
    await first.submit(request);
    const decision: WorkspaceDecision = { id: request.id, actor, status: 'Denied', note: 'Duplicate project', at: request.createdAt, groups: [], step: 'decision' };
    await new MemoryWorkspaceRequestStore(storage).claim(decision);
    expect(await new MemoryWorkspaceRequestStore(storage).list()).toEqual({ requests: [request], decisions: [decision] });
  });

  it('continues a legacy failed Admin assignment, reuses resources and skips a manually repaired role', async () => {
    vi.useFakeTimers();
    const deps = await setup();
    const writer = deps.bindingWriter;
    deps.bindingWriter = { write: vi.fn(async () => ({
      ok: false as const, code: 'failed' as const, status: 400,
      serviceCode: 'PrincipalNotFound', message: 'Group not resolvable', requestId: g(99),
    })) };
    const pending = decideWorkspace(deps, request.id, { approve: true, capacityId, note: 'Original approval' });
    await vi.runAllTimersAsync();
    const failed = await pending;
    vi.useRealTimers();
    expect(failed.error).toBe(`role-failed: HTTP 400; PrincipalNotFound; Group not resolvable; requestId=${g(99)}`);
    expect(failed.attempt).toBeUndefined();
    expect(canContinueWorkspace(failed)).toBe(true);
    deps.bindingWriter = writer;
    await writer.write({ action: 'add', workspaceId, groupId: failed.groups[0].id, role: 'Admin' }, actor.objectId);
    const result = await continueWorkspace(deps, request.id);
    expect(result).toMatchObject({ status: 'Approved', step: 'complete', attempt: 1, workspaceId, capacityId, note: 'Original approval' });
    expect(result.error).toBeUndefined();
    expect(result.groups[0]).toEqual(failed.groups[0]);
    expect(deps.provisioner.createWorkspace).toHaveBeenCalledTimes(1);
    expect(deps.groupCreator.create).toHaveBeenCalledTimes(4);
    expect(writer.write).toHaveBeenCalledTimes(4);
    expect(deps.memberWriter.write).toHaveBeenCalledTimes(1);
    expect((await deps.umStore.load()).groups).toHaveLength(4);
  });

  it('waits exactly 2 then 4 seconds for a rejected principal and finishes without recreating resources', async () => {
    vi.useFakeTimers();
    const deps = await setup();
    const writer = deps.bindingWriter;
    let remainingRejections = 2;
    deps.bindingWriter = { write: vi.fn(async (change, owner) => {
      if (change.action === 'add' && change.role === 'Admin' && remainingRejections-- > 0) return principalNotFound;
      return writer.write(change, owner);
    }) };
    const pending = decideWorkspace(deps, request.id, { approve: true, capacityId, note: '' });
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.bindingWriter.write).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(deps.bindingWriter.write).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(deps.bindingWriter.write).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3999);
    expect(deps.bindingWriter.write).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ status: 'Approved', step: 'complete' });
    expect(deps.bindingWriter.write).toHaveBeenCalledTimes(6);
    expect(writer.write).toHaveBeenCalledTimes(4);
    expect(deps.provisioner.createWorkspace).toHaveBeenCalledTimes(1);
    expect(deps.groupCreator.create).toHaveBeenCalledTimes(4);
  });

  it('handles propagation for each of the four roles, including Viewer', async () => {
    vi.useFakeTimers();
    const deps = await setup();
    const writer = deps.bindingWriter;
    const rejected = new Set<string>();
    deps.bindingWriter = { write: vi.fn(async (change, owner) => {
      if (change.action === 'add' && !rejected.has(change.role)) {
        rejected.add(change.role);
        return principalNotFound;
      }
      return writer.write(change, owner);
    }) };
    const pending = decideWorkspace(deps, request.id, { approve: true, capacityId, note: '' });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ status: 'Approved' });
    expect(rejected.size).toBe(4);
    expect(deps.bindingWriter.write).toHaveBeenCalledTimes(8);
    expect(deps.groupCreator.create).toHaveBeenCalledTimes(4);
    expect(deps.memberWriter.write).toHaveBeenCalledTimes(1);
  });

  it('stops after six rejected assignments and exactly 60 seconds of waits, retaining the final diagnostics', async () => {
    vi.useFakeTimers();
    const deps = await setup();
    let attempts = 0;
    deps.bindingWriter = { write: vi.fn(async () => ({ ...principalNotFound, requestId: g(100 + ++attempts) })) };
    const started = Date.now();
    const pending = decideWorkspace(deps, request.id, { approve: true, capacityId, note: '' });
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(PRINCIPAL_RESOLUTION_DELAYS_MS.reduce((total, delay) => total + delay, 0)).toBe(60_000);
    expect(Date.now() - started).toBe(60_000);
    expect(deps.bindingWriter.write).toHaveBeenCalledTimes(6);
    expect(result).toMatchObject({ status: 'Failed', step: 'assign-role-Admin' });
    expect(result.error).toContain(`HTTP 400; PrincipalNotFound; The provided principal was not found; requestId=${g(106)}`);
    expect(canContinueWorkspace(result)).toBe(true);
    expect(deps.groupCreator.create).toHaveBeenCalledTimes(1);
    expect(deps.memberWriter.write).not.toHaveBeenCalled();
  });

  it('reconciles an assignment added during a principal wait instead of posting it again', async () => {
    vi.useFakeTimers();
    const deps = await setup();
    const writer = deps.bindingWriter;
    deps.bindingWriter = { write: vi.fn(async (change, owner) => change.action === 'add' && change.role === 'Admin' ? principalNotFound : writer.write(change, owner)) };
    const pending = decideWorkspace(deps, request.id, { approve: true, capacityId, note: '' });
    await vi.advanceTimersByTimeAsync(0);
    const snapshot = (await deps.store.list()).decisions[0];
    await writer.write({ action: 'add', workspaceId, groupId: snapshot.groups[0].id, role: 'Admin' }, actor.objectId);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toMatchObject({ status: 'Approved' });
    expect(deps.bindingWriter.write).toHaveBeenCalledTimes(4);
    expect(writer.write).toHaveBeenCalledTimes(4);
  });

  it.each([
    { ok: false, code: 'failed', status: 400, serviceCode: 'InvalidRequest' },
    { ok: false, code: 'failed', status: 400 },
    { ok: false, code: 'not-found', status: 404, serviceCode: 'PrincipalNotFound' },
    { ok: false, code: 'denied', status: 403, serviceCode: 'PrincipalNotFound' },
    { ok: false, code: 'rate-limited', status: 429 },
    { ok: false, code: 'conflict', status: 409 },
    { ok: false, code: 'uncertain', status: 503, serviceCode: 'PrincipalNotFound' },
    { ok: false, code: 'uncertain' },
  ] as const)('never retries other errors or uncertain outcomes: %j', async (failure) => {
    vi.useFakeTimers();
    const deps = await setup();
    deps.bindingWriter = { write: vi.fn(async () => failure) };
    const pending = decideWorkspace(deps, request.id, { approve: true, capacityId, note: '' });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ status: 'Failed', step: 'assign-role-Admin' });
    expect(deps.bindingWriter.write).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['role-read', 'role-conflict', 'switch', 'switch-with-existing-role'] as const)('does not send another assignment when %s changes during the wait', async (block) => {
    vi.useFakeTimers();
    const deps = await setup();
    deps.bindingWriter = { write: vi.fn(async () => principalNotFound) };
    const pending = decideWorkspace(deps, request.id, { approve: true, capacityId, note: '' });
    await vi.advanceTimersByTimeAsync(0);
    const snapshot = (await deps.store.list()).decisions[0];
    if (block === 'role-read') deps.fabric.listRoleAssignments = async () => notReadable('access-denied');
    if (block === 'role-conflict') deps.fabric.listRoleAssignments = async () => ok([{ id: g(90), principalId: snapshot.groups[0].id, principalType: 'Group', role: 'Viewer' }]);
    if (block.startsWith('switch')) await deps.umStore.setSetting(SETTING_GROUP_CREATION, false, actor.userPrincipalName);
    if (block === 'switch-with-existing-role') deps.fabric.listRoleAssignments = async () => ok([{ id: g(90), principalId: snapshot.groups[0].id, principalType: 'Group', role: 'Admin' }]);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ status: 'Failed', step: 'assign-role-Admin' });
    expect(deps.bindingWriter.write).toHaveBeenCalledTimes(1);
    expect(deps.groupCreator.create).toHaveBeenCalledTimes(1);
  });

  it('arbitrates concurrent continuations and never replays workspace or recorded group creation', async () => {
    const deps = await setup();
    const writer = deps.bindingWriter;
    deps.bindingWriter = { write: async () => ({ ok: false, code: 'uncertain' }) };
    await decideWorkspace(deps, request.id, { approve: true, capacityId, note: '' });
    deps.bindingWriter = writer;
    const results = await Promise.allSettled([continueWorkspace(deps, request.id), continueWorkspace(deps, request.id)]);
    expect(results.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    expect(deps.provisioner.createWorkspace).toHaveBeenCalledTimes(1);
    expect(deps.groupCreator.create).toHaveBeenCalledTimes(4);
    expect(writer.write).toHaveBeenCalledTimes(4);
  });

  it('does not bypass an uncertain continuation claim, including after a demo reload', async () => {
    const deps = await setup();
    const writer = deps.bindingWriter;
    deps.bindingWriter = { write: async () => ({ ok: false, code: 'failed' }) };
    const failed = await decideWorkspace(deps, request.id, { approve: true, capacityId, note: '' });
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const store = new MemoryWorkspaceRequestStore(storage);
    await store.submit(request);
    await store.claim(failed);
    const claim = store.claimContinuation.bind(store);
    store.claimContinuation = async (value) => { await claim(value); throw new Error('Claim response lost'); };
    deps.store = store;
    deps.bindingWriter = writer;
    await expect(continueWorkspace(deps, request.id)).rejects.toThrow('Claim response lost');
    deps.store = new MemoryWorkspaceRequestStore(storage);
    await expect(continueWorkspace(deps, request.id)).rejects.toThrow('already claimed');
    expect(deps.groupCreator.create).toHaveBeenCalledTimes(1);
    expect(writer.write).not.toHaveBeenCalled();
  });

  it('locks uncertain creation of a remaining group instead of creating it again on continuation', async () => {
    const deps = await setup();
    const create = deps.groupCreator.create.bind(deps.groupCreator);
    deps.groupCreator.create = vi.fn(async (input, owner) => input.displayName.includes('-Member-')
      ? { ok: false as const, code: 'uncertain' as const }
      : create(input, owner));
    const result = await decideWorkspace(deps, request.id, { approve: true, capacityId, note: '' });
    expect(result).toMatchObject({ status: 'Failed', step: 'create-group-Member' });
    expect(result.groups).toHaveLength(1);
    await expect(continueWorkspace(deps, request.id)).rejects.toThrow('Cannot safely continue');
    expect(deps.groupCreator.create).toHaveBeenCalledTimes(2);
  });

  it('can explicitly continue a second failure without duplicating membership or activated rows', async () => {
    const deps = await setup();
    const activate = deps.umStore.activate.bind(deps.umStore);
    deps.umStore.activate = vi.fn(async (input, owner) => {
      if (input.nameSnapshot.includes('-Member-')) throw new Error('Database temporarily unavailable');
      return activate(input, owner);
    });
    const failed = await decideWorkspace(deps, request.id, { approve: true, capacityId, note: '' });
    expect(failed.step).toBe('activate-groups');
    expect((await deps.umStore.load()).groups).toHaveLength(1);
    const managedAdmin = (await deps.umStore.load()).groups[0];
    await deps.umStore.updateFields(managedAdmin, { description: 'Preserve this setting', maxDays: 12, requestable: false, active: true });
    const extraBinding = { groupId: failed.groups[0].id, kind: 'Workspace' as const, scopeId: g(98), scopeName: 'Another workspace', label: 'Viewer', provenance: 'read' as const };
    await deps.umStore.setBindings(failed.groups[0].id, 'read', [...(await deps.umStore.load()).bindings, extraBinding], actor);
    expect(await continueWorkspace(deps, request.id)).toMatchObject({ status: 'Failed', attempt: 1 });
    deps.umStore.activate = vi.fn(activate);
    expect(await continueWorkspace(deps, request.id)).toMatchObject({ status: 'Approved', attempt: 2 });
    expect(deps.memberWriter.write).toHaveBeenCalledTimes(1);
    expect(deps.bindingWriter.write).toHaveBeenCalledTimes(4);
    expect(deps.groupCreator.create).toHaveBeenCalledTimes(4);
    expect((await deps.umStore.load()).groups).toHaveLength(4);
    expect((await deps.umStore.load()).groups[0]).toMatchObject({ description: 'Preserve this setting', maxDays: 12 });
    expect((await deps.umStore.load()).bindings).toHaveLength(5);
    expect((await deps.umStore.load()).bindings).toContainEqual(extraBinding);
  });

  it.each(['admin', 'build', 'actor', 'self', 'switch', 'identity', 'capacity', 'claim', 'group', 'owner', 'roles', 'role-conflict', 'workspace'] as const)('makes no further external writes when continuation is blocked by %s', async (block) => {
    const deps = await setup();
    const writer = deps.bindingWriter;
    deps.bindingWriter = { write: async () => ({ ok: false, code: 'failed' }) };
    await decideWorkspace(deps, request.id, { approve: true, capacityId, note: '' });
    deps.bindingWriter = writer;
    if (block === 'admin') deps.isAppAdmin = false;
    if (block === 'build') deps.writesInBuild = false;
    if (block === 'actor') deps.actor = { ...actor, objectId: g(90) };
    if (block === 'self') deps.actor = requester;
    if (block === 'switch') await deps.umStore.setSetting(SETTING_GROUP_CREATION, false, actor.userPrincipalName);
    if (block === 'identity') deps.directory.resolveUser = async () => ok({ ...person, accountEnabled: false });
    if (block === 'capacity') deps.provisioner.listCapacities = async () => [];
    if (block === 'claim') deps.store.claimContinuation = async () => { throw new Error('Database unavailable'); };
    if (block === 'group') deps.directory.getGroup = async () => notReadable('access-denied');
    if (block === 'owner') deps.directory.listOwners = async () => ok([{ id: g(90), type: 'user' }]);
    if (block === 'roles') deps.fabric.listRoleAssignments = async () => notReadable('access-denied');
    if (block === 'role-conflict') deps.fabric.listRoleAssignments = async () => ok([{ id: g(90), principalId: g(10), principalType: 'Group', role: 'Viewer' }]);
    if (block === 'workspace') deps.provisioner.verifyWorkspace = async () => { throw new Error('workspace-name-not-confirmed'); };
    if (['group', 'owner', 'roles', 'role-conflict', 'workspace'].includes(block)) expect(await continueWorkspace(deps, request.id)).toMatchObject({ status: 'Failed' });
    else await expect(continueWorkspace(deps, request.id)).rejects.toThrow();
    expect(deps.provisioner.createWorkspace).toHaveBeenCalledTimes(1);
    expect(deps.groupCreator.create).toHaveBeenCalledTimes(1);
    expect(writer.write).not.toHaveBeenCalled();
    expect(deps.memberWriter.write).not.toHaveBeenCalled();
  });

  it.each(['create-workspace', 'create-group-Admin', 'create-group-Member', 'unexpected-step', 'Provisioning', 'Approved', 'Denied'])('refuses to continue unknown creates or an ineligible state: %s', async (stepOrStatus) => {
    const deps = await setup();
    const decision: WorkspaceDecision = {
      id: request.id, actor, status: 'Failed', at: request.createdAt, note: '', groups: [],
      step: stepOrStatus, workspaceId, capacityId,
    };
    if (['Provisioning', 'Approved', 'Denied'].includes(stepOrStatus)) {
      decision.status = stepOrStatus as 'Provisioning' | 'Approved' | 'Denied';
      decision.step = 'verify-workspace';
    }
    await deps.store.claim(decision);
    await expect(continueWorkspace(deps, request.id)).rejects.toThrow('Cannot safely continue');
    expect(deps.provisioner.createWorkspace).not.toHaveBeenCalled();
    expect(deps.groupCreator.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate IDs, out-of-order roles, invalid attempts and incomplete resume checkpoints', () => {
    const decision: WorkspaceDecision = { id: request.id, actor, status: 'Failed', at: request.createdAt, note: '', groups: [{ role: 'Admin', id: g(10), name: 'Admin' }], step: 'assign-role-Admin', workspaceId, capacityId };
    expect(validWorkspaceDecision(decision)).toBe(true);
    expect(validWorkspaceDecision({ ...decision, attempt: -1 })).toBe(false);
    expect(validWorkspaceDecision({ ...decision, groups: [...decision.groups, { role: 'Member', id: g(10), name: 'Member' }] })).toBe(false);
    expect(validWorkspaceDecision({ ...decision, groups: [{ ...decision.groups[0], role: 'Viewer' }] })).toBe(false);
    expect(canContinueWorkspace({ ...decision, step: 'assign-role-Member' })).toBe(false);
    expect(canContinueWorkspace({ ...decision, step: 'activate-groups' })).toBe(false);
  });
});

const context = vi.hoisted(() => ({ value: {} }));
vi.mock('@/um/hooks/UmContext', () => ({ useUm: () => context.value }));

describe('workspace request page', () => {
  it('exposes continuation only to the original approver, gates permissions and finishes the existing request', async () => {
    const deps = await setup();
    const writer = deps.bindingWriter;
    deps.bindingWriter = { write: async () => ({ ok: false, code: 'failed', status: 400 }) };
    await decideWorkspace(deps, request.id, { approve: true, capacityId, note: '' });
    const services = createUmServices({ mock: true, adminUserIds: [] }, '?as=admin');
    Object.assign(services, {
      workspaceRequests: deps.store, store: deps.umStore, directory: deps.directory, fabric: deps.fabric,
      loadWorkspaceProvisioner: async () => deps.provisioner, loadGroupCreator: async () => deps.groupCreator,
      loadWriter: async () => deps.memberWriter, loadBindingWriter: async () => deps.bindingWriter,
    });
    context.value = {
      services, identity: { ...actor, objectId: g(90) }, isAppAdmin: true,
      armed: true, bindingsArmed: true, groupsArmed: true,
      grants: { directory: true, fabric: true, fabricWrite: true, groupCreate: true, memberChange: true },
      grant: vi.fn(), reload: vi.fn().mockRejectedValueOnce(new Error('Refresh failed')).mockResolvedValue(undefined),
    };
    const page = () => <I18nProvider initialLocale="en"><MemoryRouter><WorkspaceRequestsPage /></MemoryRouter></I18nProvider>;
    const { rerender } = render(page());
    await screen.findByText(request.displayName);
    expect(screen.queryByRole('button', { name: 'Continue provisioning' })).not.toBeInTheDocument();
    context.value = { ...context.value, identity: actor };
    rerender(page());
    expect(await screen.findByRole('button', { name: 'Continue provisioning' })).toBeDisabled();
    context.value = { ...context.value, grants: { directory: true, fabric: true, fabricWrite: true, groupCreate: true, memberChange: true, capacity: true } };
    rerender(page());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Continue provisioning' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Last recorded step: assign-role-Admin.');
    expect(alert).toHaveTextContent('role-failed: HTTP 400');
    await waitFor(() => expect(alert).toHaveTextContent('Refresh failed'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue provisioning' })).toBeEnabled());
    deps.bindingWriter = writer;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Continue provisioning' }));
    await screen.findByText('Workspace, group roles and requester membership created and verified.');
    expect((await deps.store.list()).decisions[0]).toMatchObject({ status: 'Approved', attempt: 2 });
    expect(deps.provisioner.createWorkspace).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Continue provisioning' })).not.toBeInTheDocument();
  });
  it('submits a new request, shows its status and does not expose admin actions to a requester', async () => {
    const deps = await setup();
    const services = createUmServices({ mock: true, adminUserIds: [] }, '?as=user');
    services.workspaceRequests = deps.store;
    context.value = { services, identity: requester, isAppAdmin: false, grants: {}, grant: vi.fn(), reload: vi.fn() };
    render(<I18nProvider initialLocale="en"><MemoryRouter><WorkspaceRequestsPage /></MemoryRouter></I18nProvider>);
    await screen.findByText(request.displayName);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Workspace name (3–100 characters)'), 'Sales Development');
    await user.type(screen.getByLabelText('Business reason (at least 10 characters)'), 'We need sales analytics.');
    await user.click(screen.getByRole('button', { name: 'Request new workspace' }));
    await screen.findByText('Workspace request submitted for approval.');
    expect(await screen.findByText('Sales Development')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve and create workspace' })).not.toBeInTheDocument();
    expect((await deps.store.list()).requests).toHaveLength(2);
  });

  it('shows actionable read-only and failure notices rather than silently hiding the workflow', async () => {
    const services = createUmServices({ mock: true, adminUserIds: [] }, '?as=user');
    services.writesInBuild = false;
    services.workspaceRequests.list = vi.fn(async () => { throw new Error('Database unavailable'); });
    context.value = { services, identity: requester, isAppAdmin: false, grants: {} };
    render(<I18nProvider initialLocale="en"><MemoryRouter><WorkspaceRequestsPage /></MemoryRouter></I18nProvider>);
    expect(await screen.findByText(/VITE_UM_WRITES=true/)).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable');
    expect(screen.queryByText('No workspace requests yet.')).not.toBeInTheDocument();
  });

  it('lets admins deny a request with a note', async () => {
    const deps = await setup();
    const services = createUmServices({ mock: true, adminUserIds: [] }, '?as=admin');
    services.workspaceRequests = deps.store;
    context.value = { services, identity: actor, isAppAdmin: true, grants: {}, grant: vi.fn(), reload: vi.fn(async () => {}) };
    render(<I18nProvider initialLocale="en"><MemoryRouter><WorkspaceRequestsPage /></MemoryRouter></I18nProvider>);
    const card = (await screen.findByText(request.displayName)).closest('.rounded-xl');
    expect(card).not.toBeNull();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Decision note (required for denial)'), 'Use the existing workspace');
    await user.click(screen.getByRole('button', { name: 'Deny workspace request' }));
    await waitFor(() => expect((within(card as HTMLElement).getByText('Denied'))).toBeInTheDocument());
  });

  it('provisions through the real demo gateways from the admin UI', async () => {
    const services = createUmServices({ mock: true, adminUserIds: [] }, '?as=admin');
    const admin = await services.directory.me();
    const userServices = createUmServices({ mock: true, adminUserIds: [] }, '?as=user');
    const demoRequester = await userServices.directory.me();
    await services.workspaceRequests.submit({ ...request, id: g(80), requester: demoRequester });
    for (const key of [SETTING_MEMBER_CHANGES, SETTING_BINDING_CHANGES, SETTING_GROUP_CREATION]) await services.store.setSetting(key, true, admin.userPrincipalName);
    context.value = {
      services, identity: admin, isAppAdmin: true, armed: true, bindingsArmed: true, groupsArmed: true,
      grants: { directory: true, fabric: true, fabricWrite: true, groupCreate: true, memberChange: true },
      grant: vi.fn(async () => true), reload: vi.fn(async () => {}),
    };
    render(<I18nProvider initialLocale="en"><MemoryRouter><WorkspaceRequestsPage /></MemoryRouter></I18nProvider>);
    await screen.findByText(request.displayName);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Load available capacities' }));
    const capacityOption = await screen.findByRole('option', { name: 'Demo F4 capacity' });
    await user.selectOptions(screen.getByLabelText('Capacity'), capacityOption);
    await user.click(screen.getByRole('button', { name: 'Approve and create workspace' }));
    await screen.findByText('Workspace, group roles and requester membership created and verified.');
    const created = (await services.workspaceRequests.list()).decisions[0];
    expect(created.status).toBe('Approved');
    const contributor = created.groups.find((group) => group.role === 'Contributor')!;
    const members = await services.directory.listMembers(contributor.id);
    expect(members.state === 'ok' && members.value.some((member) => member.id === demoRequester.objectId)).toBe(true);
    expect(await services.fabric.listRoleAssignments(created.workspaceId!)).toMatchObject({ state: 'ok', value: expect.any(Array) });
  });
});
