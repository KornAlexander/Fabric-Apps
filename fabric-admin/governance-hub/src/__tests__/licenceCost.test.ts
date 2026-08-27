import { describe, expect, it } from 'vitest';

import { CAPABILITY_BY_ID } from '@/domain/capabilities';
import {
  LICENCE_BY_BINDING_KIND,
  WITHOUT_MANAGED_ENVIRONMENTS,
  licenceCostOf,
  licenceImpact,
} from '@/domain/licenceCost';
import { compilePersona, SEED_PERSONAS } from '@/domain/personas';
import { allBindingKinds } from '@/modules';

const MODULES = ['fabric', 'pp', 'entra', 'agent'];

describe('licence table integrity', () => {
  it('records a licence impact for every binding kind the modules declare', () => {
    // An unrecorded kind would silently default to "free", which is exactly the
    // claim this table exists to substantiate.
    for (const kind of allBindingKinds()) {
      expect(LICENCE_BY_BINDING_KIND[kind.id], `${kind.id} has no licence note`).toBeDefined();
    }
  });

  it('has no stale entries for binding kinds that do not exist', () => {
    const declared = new Set(allBindingKinds().map((k) => k.id));
    declared.add('app_role'); // internal, not owned by a plane module
    for (const kind of Object.keys(LICENCE_BY_BINDING_KIND)) {
      expect(declared, `${kind} is recorded but not declared by any module`).toContain(kind);
    }
  });

  it('gives every note a specific, quotable reason', () => {
    for (const [kind, note] of Object.entries(LICENCE_BY_BINDING_KIND)) {
      expect(note.detail.length, kind).toBeGreaterThan(30);
    }
  });
});

describe('the writable set stays licence-free', () => {
  it('no writable binding kind consumes a premium licence', () => {
    const writable = allBindingKinds().filter((k) => k.writable);
    const impact = licenceImpact(writable.map((k) => k.id));
    // `pp_managed_env` is writable in principle but is the one kind that
    // triggers a premium requirement, so it is called out rather than hidden.
    expect(impact.premiumTriggers).toEqual(['pp_managed_env']);
  });

  it('flags Managed Environments as enabling a premium requirement, not as free', () => {
    const note = licenceCostOf('pp_managed_env');
    expect(note.cost).toBe('enables-premium-requirement');
    expect(note.detail).toContain('ACTIVE USAGE');
  });

  it('treats manual-only controls as not-a-write rather than free', () => {
    // "Free" would imply we can do it. We cannot — it is a portal task.
    expect(licenceCostOf('orgapp_audience_member').cost).toBe('not-a-write');
    expect(licenceCostOf('m365_agent_access').cost).toBe('not-a-write');
    expect(licenceCostOf('pp_routing_rule').cost).toBe('not-a-write');
  });
});

/**
 * Phase 10 exit criterion (PLAN.md §17 Track D):
 * *"agent author in env X" granted via a group team, with **zero premium
 * licences consumed**.*
 */
describe('the exit criterion, in the entitlement model', () => {
  const persona = SEED_PERSONAS.find((p) => p.id === 'cs-agent-author')!;

  it('compiles Copilot Studio agent authoring to an environment-scoped set', () => {
    const compiled = compilePersona(persona, {
      enabledModules: MODULES as never,
      scopeType: 'Environment',
    });
    expect(compiled.issues).toEqual([]);
    expect(compiled.bindings.length).toBeGreaterThan(0);
    expect(compiled.bindings.every((b) => b.scopeType === 'Environment')).toBe(true);
  });

  it('routes the grant through a group, never a named person', () => {
    const compiled = compilePersona(persona, {
      enabledModules: MODULES as never,
      scopeType: 'Environment',
    });
    const kinds = compiled.bindings.map((b) => b.bindingKind);
    // The person joins a group; the group team holds the Dataverse role.
    expect(kinds).toContain('entra_group_member');
    expect(kinds).toContain('pp_dataverse_role');
    expect(compiled.bindings.find((b) => b.bindingKind === 'pp_dataverse_role')!.isPerUser).toBe(
      false
    );
  });

  it('consumes zero premium licences', () => {
    const compiled = compilePersona(persona, {
      enabledModules: MODULES as never,
      scopeType: 'Environment',
    });
    const impact = licenceImpact(compiled.bindings.map((b) => b.bindingKind));

    expect(impact.free).toBe(true);
    expect(impact.premiumTriggers).toEqual([]);
    // And specifically: nothing here turns on Managed Environments.
    expect(compiled.bindings.some((b) => b.bindingKind === 'pp_managed_env')).toBe(false);
  });

  it('is a preventive control, not a detective one', () => {
    // Agent creation cannot be disabled tenant-wide, so the per-environment
    // Dataverse privilege is the only genuinely preventive lever that exists.
    const capability = CAPABILITY_BY_ID.get('create:CopilotStudioAgent')!;
    expect(capability.controlMode).toBe('preventive-auto');
  });
});

describe('every seed persona is licence-free to grant', () => {
  it('none of them would trigger a premium requirement at any scope', () => {
    for (const persona of SEED_PERSONAS) {
      const compiled = compilePersona(persona, { enabledModules: MODULES as never });
      const impact = licenceImpact(compiled.bindings.map((b) => b.bindingKind));
      expect(impact.premiumTriggers, `${persona.id}`).toEqual([]);
    }
  });
});

describe('what is lost without Managed Environments', () => {
  it('is stated as capability loss, not as a reason to buy', () => {
    expect(WITHOUT_MANAGED_ENVIRONMENTS.length).toBeGreaterThanOrEqual(5);
    // The Default-environment consequence is the one that matters most.
    expect(WITHOUT_MANAGED_ENVIRONMENTS.join(' ')).toContain('Default');
  });
});
