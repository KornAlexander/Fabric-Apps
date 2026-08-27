/**
 * Task persistence (PLAN.md §13 page 10).
 *
 * Degrades to an empty list when the backend is unreachable, so the page says
 * "nothing here" honestly rather than throwing — but raising and completing a
 * task report real failures, because a task somebody believes was filed and
 * that nobody can see is worse than an error message.
 */
import type { GovernanceTask, TaskDraft, TaskStatus } from '@/domain/tasks';

import { getRayfinClient } from './rayfinClient';

interface GovTaskRow {
  id: string;
  source: string;
  binding_kind: string;
  module: string;
  detail: string;
  scope_type: string;
  scope_id: string;
  scope_name: string;
  principal_id?: string;
  principal_name?: string;
  status: string;
  created_at: Date;
  assignee?: string;
  due_date?: Date;
  completed_by?: string;
  completed_at?: Date;
  evidence?: string;
  request_id?: string;
}

type Db = ReturnType<typeof getRayfinClient>['data'];
function rows(): Db['GovTask'] {
  return getRayfinClient().data.GovTask;
}

function toTask(row: GovTaskRow): GovernanceTask {
  return {
    id: row.id,
    source: row.source as GovernanceTask['source'],
    bindingKind: row.binding_kind,
    module: row.module,
    detail: row.detail,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    scopeName: row.scope_name,
    principalId: row.principal_id,
    principalName: row.principal_name,
    status: row.status as TaskStatus,
    createdAt: new Date(row.created_at).toISOString(),
    assignee: row.assignee,
    dueDate: row.due_date ? new Date(row.due_date).toISOString() : undefined,
    completedBy: row.completed_by,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : undefined,
    evidence: row.evidence,
    requestId: row.request_id,
  };
}

export interface LoadTasksResult {
  tasks: GovernanceTask[];
  backendReachable: boolean;
}

export async function loadTasks(): Promise<LoadTasksResult> {
  try {
    const stored = (await rows().findMany({})) as GovTaskRow[];
    return { tasks: stored.map(toTask), backendReachable: true };
  } catch {
    return { tasks: [], backendReachable: false };
  }
}

/** Returns the new task id, or `null` when it could not be stored. */
export async function raiseTask(draft: TaskDraft, dueDate?: Date): Promise<string | null> {
  try {
    const created = (await rows().create({
      source: draft.source,
      binding_kind: draft.bindingKind,
      module: draft.module,
      detail: draft.detail,
      scope_type: draft.scopeType,
      scope_id: draft.scopeId,
      scope_name: draft.scopeName,
      principal_id: draft.principalId,
      principal_name: draft.principalName,
      status: 'Open' satisfies TaskStatus,
      created_at: new Date(),
      due_date: dueDate,
      request_id: draft.requestId,
    })) as { id?: string } | undefined;
    return created?.id ?? 'created';
  } catch {
    return null;
  }
}

export interface TaskPatch {
  status?: TaskStatus;
  assignee?: string;
  completedBy?: string;
  evidence?: string;
}

export async function updateTask(id: string, patch: TaskPatch): Promise<boolean> {
  try {
    await rows().update(
      { id },
      {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.assignee !== undefined ? { assignee: patch.assignee } : {}),
        ...(patch.completedBy
          ? { completed_by: patch.completedBy, completed_at: new Date() }
          : {}),
        ...(patch.evidence !== undefined ? { evidence: patch.evidence } : {}),
      }
    );
    return true;
  } catch {
    return false;
  }
}
