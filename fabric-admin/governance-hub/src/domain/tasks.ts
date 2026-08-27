/**
 * The manual task queue (PLAN.md §13 page 10, §14, Phase 11).
 *
 * Five binding kinds have **no write API at all**. The product's answer is not
 * to pretend otherwise: it raises a task with the exact click-path, a deep link,
 * and — crucially — an honest statement of *how the result can be proven*.
 *
 * That last part is what separates this from a to-do list. A queue that lets a
 * human tick "done" and records the result as governance evidence is worse than
 * no queue, because it launders a claim into a fact. So:
 *
 *   - **Verified** is only ever set by a *machine check* that re-reads the plane.
 *   - **Attested** is what a human click produces, and it is a visibly weaker
 *     state that says who claimed it and when.
 *
 * Of the five kinds, exactly **one** can be machine-verified today. Saying that
 * out loud is more useful than a queue that looks uniformly green.
 */
import type { TranslationKey } from '@/i18n';

export type TaskStatus =
  /** Raised, nobody has picked it up. */
  | 'Open'
  /** Somebody is on it. */
  | 'InProgress'
  /** A human says they did it. Not proof. */
  | 'Attested'
  /** A machine check re-read the plane and confirmed it. */
  | 'Verified'
  /** Deliberately not doing it — with a reason. */
  | 'Cancelled';

export const OPEN_STATUSES: TaskStatus[] = ['Open', 'InProgress'];

export type TaskSource = 'Drift' | 'Request' | 'Policy';

/** How the outcome of a task can be established. */
export type VerificationMode =
  /** A collector or API read can confirm it. */
  | 'machine'
  /** No API exists. A human attests; the app records who and when. */
  | 'attestation';

export interface TaskTemplate {
  bindingKind: string;
  module: string;
  titleKey: TranslationKey;
  /** Ordered click-path. Non-localised: these are portal labels, not prose. */
  steps: string[];
  /**
   * Portal entry point.
   *
   * Deliberately shallow but *correct*: the base admin surface plus the click
   * path in `steps`, rather than a deep link into a blade whose URL shape is not
   * documented. A link that 404s destroys trust in the whole queue, and these
   * portals reorganise regularly.
   */
  portal: (params: TaskParams) => string;
  verification: VerificationMode;
  /** Why it cannot be machine-verified, when it cannot. Non-localised. */
  verificationNote: string;
}

export interface TaskParams {
  scopeId?: string;
  scopeType?: string;
  principalId?: string;
}

const POWER_BI = 'https://app.powerbi.com';
const PPAC = 'https://admin.powerplatform.microsoft.com';
const M365_ADMIN = 'https://admin.microsoft.com';

export const TASK_TEMPLATES: Record<string, TaskTemplate> = {
  orgapp_audience_member: {
    bindingKind: 'orgapp_audience_member',
    module: 'fabric',
    titleKey: 'task.orgAppAudience.title',
    steps: [
      'Open the workspace that owns the org app',
      'Select the app → Manage access',
      'Add the governance group to the audience',
      'Save and republish the app if prompted',
    ],
    portal: (p) => (p.scopeId ? `${POWER_BI}/groups/${p.scopeId}` : `${POWER_BI}/home`),
    verification: 'attestation',
    verificationNote:
      'Org-app audience membership has no public read API. The collector can see that the audience exists, but not who is in it, so it stamps membership_known=false. Nobody can machine-verify this today.',
  },

  m365_agent_access: {
    bindingKind: 'm365_agent_access',
    module: 'agent',
    titleKey: 'task.m365AgentAccess.title',
    steps: [
      'Microsoft 365 admin center → Copilot → Agents & connectors',
      'Open Settings → User access',
      'Set "Allow the following users access to Copilot agents" to Specific users or groups',
      'Add the governance group',
    ],
    portal: () => M365_ADMIN,
    verification: 'attestation',
    verificationNote:
      'The declarative-agent access setting is admin-center only, with no documented API to read it back.',
  },

  a365_registry_action: {
    bindingKind: 'a365_registry_action',
    module: 'agent',
    titleKey: 'task.a365Registry.title',
    steps: [
      'Microsoft 365 admin center → Agents',
      'Find the agent in the registry',
      'Apply the action: Block, Delete or Reassign the sponsor',
    ],
    portal: () => M365_ADMIN,
    // The one kind we can actually prove. The registry Graph API is list+get:
    // the *actions* are UI-only, but the resulting state is readable.
    verification: 'machine',
    verificationNote:
      'Block / Delete / Reassign are UI-only, but the Agent 365 registry exposes list and get — so re-reading the agent proves whether the action took effect.',
  },

  pp_routing_rule: {
    bindingKind: 'pp_routing_rule',
    module: 'pp',
    titleKey: 'task.ppRouting.title',
    steps: [
      'Power Platform admin center → Manage → Environment groups',
      'Open the environment group and its rules',
      'Configure the default-environment routing rule',
    ],
    portal: () => `${PPAC}/manage`,
    verification: 'attestation',
    verificationNote:
      'Routing is PPAC-only and requires Managed Environments, which this tool deliberately never enables (D35). There is no read API for the rule.',
  },

  fabric_item_permission: {
    bindingKind: 'fabric_item_permission',
    module: 'fabric',
    titleKey: 'task.fabricItemPermission.title',
    steps: [
      'Open the workspace and locate the item',
      'Use Manage permissions on the item',
      'Prefer fixing this at workspace-role level instead — item-level permissions are invisible to governance tooling',
    ],
    portal: (p) => (p.scopeId ? `${POWER_BI}/groups/${p.scopeId}` : `${POWER_BI}/home`),
    verification: 'attestation',
    verificationNote:
      'There is no write API and no admin read API for item-level permissions. This is a detective-only control.',
  },
};

export function templateFor(bindingKind: string): TaskTemplate | undefined {
  return TASK_TEMPLATES[bindingKind];
}

/** Binding kinds that must become a task rather than an actuator call. */
export function isManualBinding(bindingKind: string): boolean {
  return bindingKind in TASK_TEMPLATES;
}

export interface GovernanceTask {
  id: string;
  source: TaskSource;
  bindingKind: string;
  module: string;
  /** Non-localised summary of what has to happen, incl. the target. */
  detail: string;
  scopeType: string;
  scopeId: string;
  scopeName: string;
  principalId?: string;
  principalName?: string;
  status: TaskStatus;
  createdAt: string;
  assignee?: string;
  dueDate?: string;
  completedBy?: string;
  completedAt?: string;
  /** What the machine check found, or what the human claimed. */
  evidence?: string;
  /** Links the task back to the request that produced it. */
  requestId?: string;
}

export interface TaskDraft {
  source: TaskSource;
  bindingKind: string;
  module: string;
  detail: string;
  scopeType: string;
  scopeId: string;
  scopeName: string;
  principalId?: string;
  principalName?: string;
  requestId?: string;
}

export interface BindingLike {
  bindingKind: string;
  module: string;
  scopeType: string;
  scopeId: string;
  scopeName: string;
  roleValue?: string;
}

/**
 * Turn a binding the actuator cannot execute into a task.
 *
 * Returns `null` for a binding that *is* writable — raising a task for
 * something the tool could have done itself would push work onto a human for no
 * reason, and would make the queue impossible to trust.
 */
export function taskForBinding(
  binding: BindingLike,
  context: {
    source: TaskSource;
    principalId?: string;
    principalName?: string;
    requestId?: string;
  }
): TaskDraft | null {
  const template = templateFor(binding.bindingKind);
  if (!template) return null;

  const who = context.principalName ?? context.principalId;
  return {
    source: context.source,
    bindingKind: binding.bindingKind,
    module: binding.module,
    detail: who
      ? `${who} needs ${binding.bindingKind} in ${binding.scopeType} "${binding.scopeName}"`
      : `${binding.bindingKind} in ${binding.scopeType} "${binding.scopeName}"`,
    scopeType: binding.scopeType,
    scopeId: binding.scopeId,
    scopeName: binding.scopeName,
    principalId: context.principalId,
    principalName: context.principalName,
    requestId: context.requestId,
  };
}

export type TaskAction = 'claim' | 'attest' | 'verify' | 'cancel' | 'reopen';

export interface ActionDecision {
  allowed: boolean;
  /** Non-localised reason, for the audit row. */
  reason?: string;
}

const no = (reason: string): ActionDecision => ({ allowed: false, reason });

/**
 * Which actions a task allows.
 *
 * `verify` is only offered where a machine check exists. Offering it everywhere
 * and quietly downgrading the result would teach people that "Verified" means
 * nothing.
 */
export function canAct(task: GovernanceTask, action: TaskAction): ActionDecision {
  const template = templateFor(task.bindingKind);

  switch (action) {
    case 'claim':
      return task.status === 'Open'
        ? { allowed: true }
        : no(`task is ${task.status}, not Open`);

    case 'attest':
      if (!OPEN_STATUSES.includes(task.status)) {
        return no(`task is ${task.status}`);
      }
      if (template?.verification === 'machine') {
        return no('this task can be machine-verified, so attestation is not the right evidence');
      }
      return { allowed: true };

    case 'verify':
      if (template?.verification !== 'machine') {
        return no(
          template?.verificationNote ?? 'no machine check exists for this binding kind'
        );
      }
      return task.status === 'Verified'
        ? no('already verified')
        : { allowed: true };

    case 'cancel':
      return task.status === 'Verified'
        ? no('a verified task cannot be cancelled')
        : { allowed: true };

    case 'reopen':
      // Attestation is a claim, so it can be withdrawn. Machine verification is
      // a fact about the plane, and re-opening it would not change that fact —
      // if reality drifts back, drift raises a *new* task.
      return task.status === 'Attested' || task.status === 'Cancelled'
        ? { allowed: true }
        : no(`task is ${task.status}`);
  }
}

export interface VerificationInput {
  /** True when the plane now shows the intended state. */
  confirmed: boolean;
  /** What was read. Non-localised, goes into the audit trail. */
  evidence: string;
}

/** The status a machine check produces. Never `Verified` on a negative result. */
export function statusAfterVerification(input: VerificationInput): TaskStatus {
  return input.confirmed ? 'Verified' : 'Open';
}

export interface TaskSummary {
  total: number;
  byStatus: Record<TaskStatus, number>;
  open: number;
  /** Tasks nobody can ever machine-verify — the honest subtotal. */
  attestationOnly: number;
  overdue: number;
}

export function summariseTasks(
  tasks: GovernanceTask[],
  now: Date = new Date()
): TaskSummary {
  const byStatus: Record<TaskStatus, number> = {
    Open: 0,
    InProgress: 0,
    Attested: 0,
    Verified: 0,
    Cancelled: 0,
  };
  let attestationOnly = 0;
  let overdue = 0;

  for (const task of tasks) {
    byStatus[task.status] += 1;
    if (templateFor(task.bindingKind)?.verification === 'attestation') attestationOnly += 1;
    if (
      task.dueDate &&
      OPEN_STATUSES.includes(task.status) &&
      Date.parse(task.dueDate) < now.getTime()
    ) {
      overdue += 1;
    }
  }

  return {
    total: tasks.length,
    byStatus,
    open: byStatus.Open + byStatus.InProgress,
    attestationOnly,
    overdue,
  };
}

/** Oldest first — a queue sorted newest-first starves its oldest item. */
export function taskQueue(tasks: GovernanceTask[]): GovernanceTask[] {
  return tasks
    .filter((t) => OPEN_STATUSES.includes(t.status))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** Avoid raising the same task twice for the same binding, scope and principal. */
export function isDuplicate(draft: TaskDraft, existing: GovernanceTask[]): boolean {
  return existing.some(
    (t) =>
      t.bindingKind === draft.bindingKind &&
      t.scopeId === draft.scopeId &&
      (t.principalId ?? '') === (draft.principalId ?? '') &&
      t.status !== 'Cancelled'
  );
}
