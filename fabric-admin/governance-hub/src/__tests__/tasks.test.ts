import { describe, expect, it } from 'vitest';

import { en } from '@/i18n';
import { allBindingKinds } from '@/modules';
import {
  TASK_TEMPLATES,
  canAct,
  isDuplicate,
  isManualBinding,
  statusAfterVerification,
  summariseTasks,
  taskForBinding,
  taskQueue,
  templateFor,
  type GovernanceTask,
  type TaskStatus,
} from '@/domain/tasks';

const task = (over: Partial<GovernanceTask> = {}): GovernanceTask => ({
  id: 't1',
  source: 'Request',
  bindingKind: 'orgapp_audience_member',
  module: 'fabric',
  detail: 'Marcel needs orgapp_audience_member in Audience "Finance app"',
  scopeType: 'Audience',
  scopeId: 'aud1',
  scopeName: 'Finance app',
  status: 'Open',
  createdAt: '2026-08-01T09:00:00Z',
  ...over,
});

describe('the template pack', () => {
  it('covers every binding kind the modules declare as not writable', () => {
    // A manual kind with no template would reach the actuator and be refused
    // with `executor:not-implemented` — which reads like a defect rather than a
    // documented platform gap.
    const manual = allBindingKinds().filter((k) => !k.writable);
    for (const kind of manual) {
      expect(templateFor(kind.id), `${kind.id} has no task template`).toBeDefined();
    }
  });

  it('never claims a template for a kind the tool can write itself', () => {
    // Raising a task for something we could have done pushes work onto a human
    // for no reason, and makes the queue impossible to trust.
    const writable = allBindingKinds().filter((k) => k.writable);
    for (const kind of writable) {
      expect(isManualBinding(kind.id), `${kind.id} is writable`).toBe(false);
    }
  });

  it('gives every template a real title, steps and a verification note', () => {
    for (const [id, template] of Object.entries(TASK_TEMPLATES)) {
      expect(en[template.titleKey], id).toBeDefined();
      expect(template.steps.length, id).toBeGreaterThan(1);
      expect(template.verificationNote.length, id).toBeGreaterThan(40);
    }
  });

  it('links only to portal roots, never to a guessed deep link', () => {
    // A link that 404s destroys trust in the whole queue, and these portals
    // reorganise regularly. The click-path lives in `steps` instead.
    for (const [id, template] of Object.entries(TASK_TEMPLATES)) {
      const url = template.portal({ scopeId: 'ws1', scopeType: 'Workspace' });
      expect(url, id).toMatch(/^https:\/\//);
      expect(url, id).not.toContain('undefined');
    }
  });

  it('is honest that only one of the five can be machine-verified', () => {
    const modes = Object.values(TASK_TEMPLATES).map((t) => t.verification);
    expect(modes.filter((m) => m === 'machine')).toHaveLength(1);
    expect(templateFor('a365_registry_action')!.verification).toBe('machine');
  });
});

describe('taskForBinding', () => {
  const manual = {
    bindingKind: 'orgapp_audience_member',
    module: 'fabric',
    scopeType: 'Audience',
    scopeId: 'aud1',
    scopeName: 'Finance app',
  };

  it('turns a manual binding into a task naming the person and the scope', () => {
    const draft = taskForBinding(manual, {
      source: 'Request',
      principalId: 'u1',
      principalName: 'Marcel',
      requestId: 'r1',
    })!;
    expect(draft.detail).toContain('Marcel');
    expect(draft.detail).toContain('Finance app');
    expect(draft.requestId).toBe('r1');
  });

  it('returns nothing for a binding the actuator can execute', () => {
    expect(
      taskForBinding({ ...manual, bindingKind: 'entra_group_member' }, { source: 'Drift' })
    ).toBeNull();
  });

  it('still describes the work when no principal is involved', () => {
    const draft = taskForBinding(
      { ...manual, bindingKind: 'pp_routing_rule', module: 'pp' },
      { source: 'Policy' }
    )!;
    expect(draft.detail).toContain('pp_routing_rule');
  });
});

/**
 * The rule this whole phase exists to protect: a human click produces
 * `Attested`, and only a machine check produces `Verified`.
 */
describe('attestation is never verification', () => {
  it('refuses to attest something a machine can check', () => {
    const decision = canAct(task({ bindingKind: 'a365_registry_action' }), 'attest');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('machine-verified');
  });

  it('refuses to verify something no machine can check, and says why', () => {
    const decision = canAct(task({ bindingKind: 'orgapp_audience_member' }), 'verify');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('no public read API');
  });

  it('allows attestation only where no machine check exists', () => {
    expect(canAct(task(), 'attest').allowed).toBe(true);
  });

  it('never returns Verified from a failed machine check', () => {
    expect(statusAfterVerification({ confirmed: false, evidence: 'not found' })).toBe('Open');
    expect(statusAfterVerification({ confirmed: true, evidence: 'agent blocked' })).toBe(
      'Verified'
    );
  });
});

describe('task lifecycle', () => {
  it('can be claimed only while open', () => {
    expect(canAct(task(), 'claim').allowed).toBe(true);
    expect(canAct(task({ status: 'InProgress' }), 'claim').allowed).toBe(false);
    expect(canAct(task({ status: 'Verified' }), 'claim').allowed).toBe(false);
  });

  it('lets a claim be withdrawn but not a machine verification', () => {
    // An attestation is a statement, so it can be retracted. A verification is
    // a fact about the plane; if reality drifts back, drift raises a new task.
    expect(canAct(task({ status: 'Attested' }), 'reopen').allowed).toBe(true);
    expect(canAct(task({ status: 'Verified' }), 'reopen').allowed).toBe(false);
  });

  it('refuses to cancel something already verified', () => {
    expect(canAct(task({ status: 'Verified' }), 'cancel').allowed).toBe(false);
    expect(canAct(task(), 'cancel').allowed).toBe(true);
  });
});

describe('the queue', () => {
  it('shows only open work, oldest first', () => {
    const queue = taskQueue([
      task({ id: 'new', createdAt: '2026-08-03T09:00:00Z' }),
      task({ id: 'old', createdAt: '2026-07-01T09:00:00Z' }),
      task({ id: 'done', status: 'Verified' }),
      task({ id: 'claimed', status: 'InProgress', createdAt: '2026-08-02T09:00:00Z' }),
    ]);
    expect(queue.map((t) => t.id)).toEqual(['old', 'claimed', 'new']);
  });

  it('counts how much of the queue can never be machine-verified', () => {
    // The honest subtotal — it is a property of the platform, not of the tool.
    const summary = summariseTasks([
      task({ bindingKind: 'orgapp_audience_member' }),
      task({ bindingKind: 'm365_agent_access' }),
      task({ bindingKind: 'a365_registry_action' }),
    ]);
    expect(summary.attestationOnly).toBe(2);
    expect(summary.open).toBe(3);
  });

  it('counts overdue work only while it is still open', () => {
    const now = new Date('2026-08-05T00:00:00Z');
    const summary = summariseTasks(
      [
        task({ id: 'a', dueDate: '2026-08-01T00:00:00Z' }),
        task({ id: 'b', dueDate: '2026-08-01T00:00:00Z', status: 'Verified' }),
        task({ id: 'c', dueDate: '2026-09-01T00:00:00Z' }),
      ],
      now
    );
    expect(summary.overdue).toBe(1);
  });

  it('tracks every status without losing a task', () => {
    const statuses: TaskStatus[] = [
      'Open',
      'InProgress',
      'Attested',
      'Verified',
      'Cancelled',
    ];
    const summary = summariseTasks(statuses.map((status, i) => task({ id: `t${i}`, status })));
    expect(summary.total).toBe(5);
    expect(Object.values(summary.byStatus).reduce((a, b) => a + b, 0)).toBe(5);
  });
});

describe('duplicate suppression', () => {
  const draft = taskForBinding(
    {
      bindingKind: 'orgapp_audience_member',
      module: 'fabric',
      scopeType: 'Audience',
      scopeId: 'aud1',
      scopeName: 'Finance app',
    },
    { source: 'Drift', principalId: 'u1', principalName: 'Marcel' }
  )!;

  it('does not raise the same task twice', () => {
    expect(isDuplicate(draft, [task({ principalId: 'u1' })])).toBe(true);
  });

  it('raises it again once the previous one was cancelled', () => {
    expect(isDuplicate(draft, [task({ principalId: 'u1', status: 'Cancelled' })])).toBe(false);
  });

  it('treats a different person or scope as a different task', () => {
    expect(isDuplicate(draft, [task({ principalId: 'u2' })])).toBe(false);
    expect(isDuplicate(draft, [task({ principalId: 'u1', scopeId: 'aud2' })])).toBe(false);
  });
});
