import { sameRequester } from '@/um/domain/accessRequest';
import { assessGroup } from '@/um/domain/eligibility';
import { mailNicknameFor } from '@/um/domain/groupCreate';
import { bindingKey, type Binding, type GraphIdentity } from '@/um/domain/types';
import {
  PROVISIONED_ROLES, canContinueWorkspace, validWorkspaceDecision, validWorkspaceRequest, workspaceGroupName,
  type Capacity, type WorkspaceDecision, type WorkspaceRequest, type WorkspaceRequestInput,
} from '@/um/domain/workspaceRequest';

import { SETTING_BINDING_CHANGES, type BindingWriter } from './bindingChanges';
import type { DirectoryGateway, FabricGateway } from './gateways';
import { SETTING_GROUP_CREATION, type GroupCreator } from './groupCreation';
import type { MemberWriter } from './memberChanges';
import { SETTING_MEMBER_CHANGES, type UmStore } from './store';
import type { WorkspaceRequestStore } from './workspaceRequestStore';

export const PRINCIPAL_RESOLUTION_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 30_000] as const;

export interface WorkspaceProvisioner {
  listCapacities(actorId: string): Promise<Capacity[]>;
  createWorkspace(input: WorkspaceRequestInput, capacityId: string, actorId: string): Promise<string>;
  verifyWorkspace(workspaceId: string, capacityId: string, actorId: string, expectedName?: string): Promise<void>;
}

export interface WorkspaceApprovalDeps {
  store: WorkspaceRequestStore;
  umStore: UmStore;
  actor: GraphIdentity;
  isAppAdmin: boolean;
  writesInBuild: boolean;
  directory: DirectoryGateway;
  fabric: FabricGateway;
  provisioner: WorkspaceProvisioner;
  groupCreator: GroupCreator;
  memberWriter: MemberWriter;
  bindingWriter: BindingWriter;
}

export async function decideWorkspace(
  deps: WorkspaceApprovalDeps,
  requestId: string,
  choice: { approve: false; note: string } | { approve: true; capacityId: string; note: string }
): Promise<WorkspaceDecision> {
  if (!deps.isAppAdmin || !deps.writesInBuild) throw new Error('Workspace approval requires an app admin and a write-enabled build');
  const { requests, decisions } = await deps.store.list();
  const request = requests.find((r) => r.id === requestId);
  if (!request || !validWorkspaceRequest(request) || decisions.some((d) => d.id === requestId)) throw new Error('Workspace request is invalid or already decided');
  if (request.requester.objectId.toLowerCase() === deps.actor.objectId.toLowerCase()) throw new Error('Another app admin must decide your request');
  if (choice.note.length > 500 || (!choice.approve && !choice.note.trim())) throw new Error('A denial needs a note (maximum 500 characters)');

  if (choice.approve) await verifyApproval(deps, request, choice.capacityId);

  const decision: WorkspaceDecision = {
    id: requestId, actor: deps.actor, status: choice.approve ? 'Provisioning' : 'Denied',
    at: new Date().toISOString(), note: choice.note.trim(), groups: [], step: 'decision',
    ...(choice.approve ? { capacityId: choice.capacityId.toLowerCase() } : {}),
  };
  // The database primary key arbitrates concurrent decisions, unlike read-then-update.
  await deps.store.claim(decision);
  if (!choice.approve) return decision;
  return provisionWorkspace(deps, request, decision, false);
}

async function verifyChangeSwitches(deps: WorkspaceApprovalDeps) {
  const settings = await Promise.all([SETTING_MEMBER_CHANGES, SETTING_BINDING_CHANGES, SETTING_GROUP_CREATION].map((key) => deps.umStore.getSetting(key)));
  if (settings.some((value) => value !== true)) throw new Error('Enable member changes, workspace role changes and group creation in Setup');
}

async function verifyApproval(deps: WorkspaceApprovalDeps, request: WorkspaceRequest, capacityId: string) {
  await verifyChangeSwitches(deps);
  const [capacities, person] = await Promise.all([
    deps.provisioner.listCapacities(deps.actor.objectId),
    deps.directory.resolveUser(request.requester.objectId),
  ]);
  if (!capacities.some((c) => c.id.toLowerCase() === capacityId.toLowerCase() && c.state === 'Active')) throw new Error('Selected capacity is not active or assignable by this approver');
  if (person.state !== 'ok' || !person.value || person.value.id.toLowerCase() !== request.requester.objectId.toLowerCase() ||
    person.value.type !== 'user' || person.value.accountEnabled !== true || person.value.userType !== 'Member' ||
    !sameRequester({ requesterUpn: request.requester.userPrincipalName, requesterName: request.requester.displayName }, person.value)) {
    throw new Error('Requester identity could not be verified as an enabled internal user');
  }
}

export async function continueWorkspace(deps: WorkspaceApprovalDeps, requestId: string): Promise<WorkspaceDecision> {
  if (!deps.isAppAdmin || !deps.writesInBuild) throw new Error('Workspace continuation requires an app admin and a write-enabled build');
  const { requests, decisions } = await deps.store.list();
  const request = requests.find((value) => value.id === requestId);
  const previous = decisions.find((value) => value.id === requestId);
  if (!request || !validWorkspaceRequest(request) || !validWorkspaceDecision(previous) || !canContinueWorkspace(previous)) {
    throw new Error('Cannot safely continue this request; inspect Fabric and Entra manually, especially creates without recorded IDs');
  }
  if (previous.actor.objectId.toLowerCase() !== deps.actor.objectId.toLowerCase() ||
    request.requester.objectId.toLowerCase() === deps.actor.objectId.toLowerCase()) throw new Error('Only the original approving app admin may continue this request');
  await verifyApproval(deps, request, previous.capacityId!);
  const decision: WorkspaceDecision = { ...previous, status: 'Provisioning', attempt: (previous.attempt ?? 0) + 1 };
  delete decision.error;
  // An immutable unique insert arbitrates each continuation, including across tabs.
  await deps.store.claimContinuation(decision);
  return provisionWorkspace(deps, request, decision, true);
}

async function provisionWorkspace(deps: WorkspaceApprovalDeps, request: WorkspaceRequest, decision: WorkspaceDecision, continuing: boolean): Promise<WorkspaceDecision> {
  const checkpoint = async (step: string) => {
    decision.step = step;
    await deps.store.checkpoint(decision);
  };
  try {
    if (!continuing) {
      await checkpoint('create-workspace');
      decision.workspaceId = await deps.provisioner.createWorkspace(request, decision.capacityId!, deps.actor.objectId);
    }
    const workspaceId = decision.workspaceId!;
    await checkpoint('verify-workspace');
    await deps.provisioner.verifyWorkspace(workspaceId, decision.capacityId!, deps.actor.objectId, request.displayName);

    const readAssignments = async () => {
      const read = await deps.fabric.listRoleAssignments(workspaceId);
      if (read.state !== 'ok') throw new Error('roles-not-readable');
      return read.value;
    };
    const existingRole = (assignments: Awaited<ReturnType<typeof readAssignments>>, group: WorkspaceDecision['groups'][number]) => {
      const found = assignments.filter((a) => a.principalId.toLowerCase() === group.id.toLowerCase());
      if (found.some((a) => a.principalType !== 'Group' || a.role !== group.role) || found.length > 1) throw new Error(`role-mismatch-${group.role}; manual inspection required`);
      return found.length === 1;
    };
    if (continuing) {
      await checkpoint('verify-resources');
      const assignments = await readAssignments();
      for (const group of decision.groups) {
        const [facts, owners] = await Promise.all([deps.directory.getGroup(group.id), deps.directory.listOwners(group.id)]);
        if (group.name !== workspaceGroupName(request, group.role) || facts.state !== 'ok' ||
          facts.value.id.toLowerCase() !== group.id.toLowerCase() || facts.value.displayName !== group.name || !assessGroup(facts.value).eligible) throw new Error(`recorded-group-not-confirmed-${group.role}`);
        if (owners.state !== 'ok' || !owners.value.length || owners.value.some((o) => o.id.toLowerCase() !== deps.actor.objectId.toLowerCase())) throw new Error(`recorded-group-owner-not-confirmed-${group.role}`);
        existingRole(assignments, group);
      }
    }

    for (const role of PROVISIONED_ROLES) {
      let group = decision.groups.find((value) => value.role === role);
      if (!group) {
        const name = workspaceGroupName(request, role);
        await checkpoint(`create-group-${role}`);
        const outcome = await deps.groupCreator.create({
          displayName: name, description: `Workspace ${request.displayName}: ${role}`,
          mailNickname: mailNicknameFor(name, `${request.id.replace(/-/g, '')}${role}`),
          ownerIds: [deps.actor.objectId],
        }, deps.actor.objectId);
        if (!outcome.ok) throw new Error(`group-${outcome.code}`);
        group = { role, name, id: outcome.id };
        decision.groups.push(group);
      }
      await checkpoint(`verify-owner-${role}`);
      const owners = await deps.directory.listOwners(group.id);
      if (owners.state !== 'ok' || !owners.value.length || owners.value.some((o) => o.id.toLowerCase() !== deps.actor.objectId.toLowerCase())) throw new Error('group-owner-not-confirmed');
      for (let retry = 0; ; retry++) {
        await checkpoint(`assign-role-${role}`);
        if (retry > 0) await verifyChangeSwitches(deps);
        if (existingRole(await readAssignments(), group)) break;
        const binding = await deps.bindingWriter.write({ action: 'add', workspaceId, groupId: group.id, role }, deps.actor.objectId);
        if (binding.ok) break;
        if (binding.code === 'failed' && binding.status === 400 && binding.serviceCode === 'PrincipalNotFound' && retry < PRINCIPAL_RESOLUTION_DELAYS_MS.length) {
          // Fabric explicitly rejected this assignment; reconcile before another POST.
          await new Promise<void>((resolve) => setTimeout(resolve, PRINCIPAL_RESOLUTION_DELAYS_MS[retry]));
          continue;
        }
        const details = [binding.status === undefined ? '' : `HTTP ${binding.status}`, binding.serviceCode, binding.message, binding.requestId ? `requestId=${binding.requestId}` : ''].filter(Boolean).join('; ');
        throw new Error(`role-${binding.code}${details ? `: ${details}` : ''}`);
      }
    }

    const contributor = decision.groups.find((g) => g.role === 'Contributor')!;
    await checkpoint('add-requester');
    const currentMembers = await deps.directory.listMembers(contributor.id);
    if (currentMembers.state !== 'ok') throw new Error('membership-not-readable');
    if (!currentMembers.value.some((m) => m.id.toLowerCase() === request.requester.objectId.toLowerCase())) {
      const member = await deps.memberWriter.write('add', contributor.id, request.requester.objectId, deps.actor.objectId);
      if (!member.ok && member.code !== 'already-member') throw new Error(`membership-${member.code}`);
    }
    await checkpoint('verify-access');
    const [members, assignments] = await Promise.all([
      deps.directory.listMembers(contributor.id),
      deps.fabric.listRoleAssignments(workspaceId),
    ]);
    if (members.state !== 'ok' || !members.value.some((m) => m.id.toLowerCase() === request.requester.objectId.toLowerCase())) throw new Error('membership-not-confirmed');
    if (assignments.state !== 'ok' || decision.groups.some((g) => !assignments.value.some((a) =>
      a.principalType === 'Group' && a.principalId.toLowerCase() === g.id.toLowerCase() && a.role === g.role))) throw new Error('roles-not-confirmed');

    await checkpoint('activate-groups');
    for (const group of decision.groups) {
      const stored = await deps.umStore.load();
      if (!stored.reachable) throw new Error('managed-groups-not-readable');
      const existing = stored.groups.find((value) => value.groupId.toLowerCase() === group.id.toLowerCase());
      if (existing && (!existing.active || ((group.role === 'Admin' || group.role === 'Member') && existing.requestable))) throw new Error('managed-group-settings-changed; manual inspection required');
      if (!existing) {
        await deps.umStore.activate({
          groupId: group.id, nameSnapshot: group.name, requestable: group.role === 'Viewer' || group.role === 'Contributor',
          description: `Workspace ${request.displayName}: ${group.role}`, maxDays: 0,
        }, deps.actor);
      }
      const binding: Binding = {
        groupId: group.id, kind: 'Workspace', scopeId: workspaceId,
        scopeName: request.displayName, label: group.role, provenance: 'read',
      };
      const readBindings = stored.bindings.filter((value) => value.groupId.toLowerCase() === group.id.toLowerCase() && value.provenance === 'read' && bindingKey(value) !== bindingKey(binding));
      await deps.umStore.setBindings(group.id, 'read', [...readBindings, binding], deps.actor);
    }
    decision.status = 'Approved';
    await checkpoint('complete');
    return decision;
  } catch (error) {
    decision.status = 'Failed';
    decision.error = error instanceof Error ? error.message.slice(0, 1000) : 'Provisioning failed';
    // Keep every known resource ID. No rollback or automatic retry of creates.
    await deps.store.checkpoint(decision);
    return decision;
  }
}
