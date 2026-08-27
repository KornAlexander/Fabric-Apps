import { describe, expect, it } from 'vitest';

import {
  APP_ROLE_BINDING,
  BINDING_RECIPES,
  CAPABILITIES,
  CORE_MODULE,
  SCOPE_TYPES,
  getCapability,
  knownBindingKinds,
  recipesFor,
} from '@/domain/capabilities';
import {
  compileAll,
  compilePersona,
  mergePersonas,
  SEED_PERSONAS,
  type Persona,
} from '@/domain/personas';
import { en } from '@/i18n';
import { MODULE_IDS } from '@/modules';

const ALL_MODULES = [...MODULE_IDS, CORE_MODULE];

describe('capability catalogue', () => {
  it('gives every capability a unique id', () => {
    const ids = CAPABILITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('assigns every capability to a real module or core', () => {
    for (const capability of CAPABILITIES) {
      expect(ALL_MODULES, capability.id).toContain(capability.module);
    }
  });

  it('uses description keys that exist in the catalogue', () => {
    for (const capability of CAPABILITIES) {
      expect(en[capability.descriptionKey], capability.id).toBeDefined();
    }
  });

  it('declares at least one valid scope type per capability', () => {
    for (const capability of CAPABILITIES) {
      expect(capability.scopeTypes.length, capability.id).toBeGreaterThan(0);
      for (const scope of capability.scopeTypes) {
        expect(SCOPE_TYPES, capability.id).toContain(scope);
      }
    }
  });

  it('covers every artifact the product claims to govern', () => {
    // These are the ten artifacts from PLAN.md §1. If one loses its capability,
    // the app quietly stops being able to answer the question it exists for.
    const artifacts = new Set(CAPABILITIES.map((c) => c.artifactType));
    for (const artifact of [
      'PowerBIReport',
      'SemanticModel',
      'FabricItem',
      'FabricDataAgent',
      'FabricApp',
      'Workspace',
      'OrgApp',
      'OrgAppAudience',
      'PowerApp',
      'Flow',
      'CopilotStudioAgent',
      'M365DeclarativeAgent',
    ]) {
      expect(artifacts, `no capability covers ${artifact}`).toContain(artifact);
    }
  });

  it('marks the two documented portal-only controls as manual, not automated', () => {
    // Overclaiming here would be the single most damaging inaccuracy in the app.
    expect(getCapability('manage:OrgAppAudience')?.controlMode).toBe('preventive-manual');
    expect(getCapability('create:M365DeclarativeAgent')?.controlMode).toBe(
      'preventive-manual'
    );
  });
});

describe('binding recipes', () => {
  it('references only binding kinds some module implements', () => {
    const valid = knownBindingKinds({});
    for (const recipe of BINDING_RECIPES) {
      expect(valid, `${recipe.capabilityId} → ${recipe.bindingKind}`).toContain(
        recipe.bindingKind
      );
    }
  });

  it('references only known capabilities', () => {
    for (const recipe of BINDING_RECIPES) {
      expect(getCapability(recipe.capabilityId), recipe.capabilityId).toBeDefined();
    }
  });

  it('provides a recipe for every capability × declared scope', () => {
    for (const capability of CAPABILITIES) {
      for (const scope of capability.scopeTypes) {
        expect(
          recipesFor(capability.id, scope).length,
          `${capability.id} has no recipe at ${scope}`
        ).toBeGreaterThan(0);
      }
    }
  });

  it('never emits a recipe for a scope the capability does not declare', () => {
    for (const recipe of BINDING_RECIPES) {
      const capability = getCapability(recipe.capabilityId)!;
      expect(capability.scopeTypes, `${recipe.capabilityId}@${recipe.scopeType}`).toContain(
        recipe.scopeType
      );
    }
  });

  it('routes plane capabilities through an Entra group wherever a user is involved', () => {
    // Group-first is the whole write strategy: one Graph call per person,
    // instant revocation, graceful degradation when a plane API is down.
    for (const capability of CAPABILITIES) {
      if (capability.module === CORE_MODULE) continue;
      if (capability.controlMode !== 'preventive-auto') continue;
      const perUser = recipesFor(capability.id).filter((r) => r.isPerUser);
      expect(perUser.length, `${capability.id} has no per-user binding`).toBeGreaterThan(0);
    }
  });

  it('keeps app-internal capabilities out of the control planes', () => {
    for (const capability of CAPABILITIES.filter((c) => c.module === CORE_MODULE)) {
      for (const recipe of recipesFor(capability.id)) {
        expect(recipe.bindingKind).toBe(APP_ROLE_BINDING);
        expect(recipe.requiresModule).toBe(CORE_MODULE);
      }
    }
  });
});

describe('seed personas', () => {
  it('ships a stable, uniquely-identified set', () => {
    const ids = SEED_PERSONAS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SEED_PERSONAS.length).toBe(15);
  });

  it('references only known capabilities', () => {
    for (const persona of SEED_PERSONAS) {
      for (const capabilityId of persona.capabilityIds) {
        expect(getCapability(capabilityId), `${persona.id} → ${capabilityId}`).toBeDefined();
      }
    }
  });

  /** The Phase 5 exit criterion, written down. */
  it('every seed persona compiles without error', () => {
    for (const { persona, result } of compileAll(SEED_PERSONAS, {
      enabledModules: ALL_MODULES,
      env: {},
    })) {
      expect(result.issues, `${persona.id}: ${JSON.stringify(result.issues)}`).toEqual([]);
      expect(result.ok, persona.id).toBe(true);
      expect(result.bindings.length, `${persona.id} compiles to nothing`).toBeGreaterThan(0);
    }
  });

  it('gives agent and platform personas a high enough risk tier', () => {
    const byId = new Map(SEED_PERSONAS.map((p) => [p.id, p]));
    expect(byId.get('platform-admin')!.riskTier).toBe('Critical');
    expect(byId.get('agent-platform-owner')!.riskTier).toBe('Critical');
    expect(byId.get('cs-agent-author')!.riskTier).toBe('High');
    expect(byId.get('consumer')!.riskTier).toBe('Low');
  });
});

describe('compilation', () => {
  const persona: Persona = {
    id: 'test',
    name: 'Test',
    description: '',
    riskTier: 'Medium',
    capabilityIds: ['create:PowerBIReport'],
    isActive: true,
    isSeed: false,
  };

  it('emits a per-user group binding and a per-scope wiring binding', () => {
    const result = compilePersona(persona, { enabledModules: ALL_MODULES, env: {} });
    const kinds = result.bindings.map((b) => b.bindingKind);
    expect(kinds).toContain('entra_group_member');
    expect(kinds).toContain('fabric_workspace_role');
    expect(result.bindings.find((b) => b.bindingKind === 'fabric_workspace_role')?.roleValue)
      .toBe('Contributor');
  });

  it('treats an unknown capability as an error, not a shrug', () => {
    const result = compilePersona(
      { ...persona, capabilityIds: ['create:Nonsense'] },
      { enabledModules: ALL_MODULES, env: {} }
    );
    expect(result.ok).toBe(false);
    expect(result.issues[0].code).toBe('unknown-capability');
  });

  it('reports a disabled module as dark, not as an error', () => {
    // A switched-off module is a deliberate configuration, not a defect. The UI
    // strikes the capability through; it must not scream "broken persona".
    const result = compilePersona(persona, { enabledModules: ['entra', CORE_MODULE], env: {} });
    expect(result.ok).toBe(true);
    expect(result.darkCapabilityIds).toContain('create:PowerBIReport');
    expect(result.bindings.every((b) => !b.moduleEnabled)).toBe(true);
  });

  it('never darkens app-internal capabilities', () => {
    const result = compilePersona(
      { ...persona, capabilityIds: ['app:Audit'] },
      { enabledModules: [], env: {} }
    );
    expect(result.darkCapabilityIds).toEqual([]);
    expect(result.bindings[0].moduleEnabled).toBe(true);
  });

  it('filters to a single scope type when asked', () => {
    const result = compilePersona(
      { ...persona, capabilityIds: ['create:FabricItem'] },
      { enabledModules: ALL_MODULES, scopeType: 'Tenant', env: {} }
    );
    expect(result.bindings.every((b) => b.scopeType === 'Tenant')).toBe(true);
    expect(result.bindings.length).toBeGreaterThan(0);
  });

  it('reports an unsupported scope rather than silently emitting nothing', () => {
    const result = compilePersona(
      { ...persona, capabilityIds: ['create:Workspace'] },
      { enabledModules: ALL_MODULES, scopeType: 'Environment', env: {} }
    );
    expect(result.ok).toBe(false);
    expect(result.issues[0].code).toBe('scope-not-supported');
  });
});

describe('persona overrides', () => {
  it('returns the seed when nothing is stored', () => {
    expect(mergePersonas([]).length).toBe(SEED_PERSONAS.length);
  });

  it('applies an override field by field', () => {
    // A customer who only renamed a persona still picks up capability
    // corrections when the product updates.
    const merged = mergePersonas([{ id: 'consumer', name: 'Leser' }]);
    const consumer = merged.find((p) => p.id === 'consumer')!;
    expect(consumer.name).toBe('Leser');
    expect(consumer.capabilityIds).toEqual(['read:Report']);
    expect(consumer.isSeed).toBe(true);
  });

  it('lets a customer replace a capability set entirely', () => {
    const merged = mergePersonas([
      { id: 'report-author', capabilityIds: ['read:Report'] },
    ]);
    expect(merged.find((p) => p.id === 'report-author')!.capabilityIds).toEqual([
      'read:Report',
    ]);
  });

  it('adds custom personas and marks them as not seeded', () => {
    const merged = mergePersonas([
      {
        id: 'patent-analyst',
        name: 'Patent Analyst',
        capabilityIds: ['read:Report'],
        isCustom: true,
      },
    ]);
    const custom = merged.find((p) => p.id === 'patent-analyst')!;
    expect(custom.isSeed).toBe(false);
    expect(merged.length).toBe(SEED_PERSONAS.length + 1);
  });

  it('supports deactivating a seeded persona', () => {
    const merged = mergePersonas([{ id: 'consumer', isActive: false }]);
    expect(merged.find((p) => p.id === 'consumer')!.isActive).toBe(false);
  });

  it('sorts by name so the editor is stable', () => {
    const names = mergePersonas([]).map((p) => p.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });

  it('custom personas still compile', () => {
    const merged = mergePersonas([
      {
        id: 'patent-analyst',
        name: 'Patent Analyst',
        capabilityIds: ['read:Report', 'create:PowerBIReport'],
        isCustom: true,
      },
    ]);
    const result = compilePersona(merged.find((p) => p.id === 'patent-analyst')!, {
      enabledModules: ALL_MODULES,
      env: {},
    });
    expect(result.ok).toBe(true);
  });
});
