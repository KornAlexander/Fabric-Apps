import { describe, expect, it, vi } from 'vitest';

import { en } from '@/i18n';
import {
  MODULE_IDS,
  allBindingKinds,
  compiledModules,
  effectiveTier,
  getModule,
  probeModules,
  unmetDependencies,
} from '@/modules';
import type { ModuleAvailability, ProbeContext } from '@/modules/types';

const baseEnv = {
  VITE_UDF_FABRIC_PROXY_URL: 'https://example.invalid/invoke',
  VITE_GOV_PP_COLLECTOR_NOTEBOOK_ID: 'nb-pp',
  VITE_GOV_AGENT_COLLECTOR_NOTEBOOK_ID: 'nb-agent',
};

function ctx(overrides: Partial<ProbeContext> = {}): ProbeContext {
  return {
    env: baseEnv,
    fabricProxy: vi.fn().mockResolvedValue({}),
    graphGet: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

describe('module registry', () => {
  it('exposes exactly the four control planes', () => {
    expect([...MODULE_IDS]).toEqual(['fabric', 'pp', 'agent', 'entra']);
    expect(compiledModules(baseEnv)).toHaveLength(4);
  });

  it('honours the build-time kill switch', () => {
    const compiled = compiledModules({ ...baseEnv, VITE_MODULE_PP: 'false' });
    expect(compiled.map((m) => m.id)).not.toContain('pp');
    expect(compiled).toHaveLength(3);
  });

  it('reports a build-time-disabled module without probing it', async () => {
    const probeCtx = ctx({ env: { ...baseEnv, VITE_MODULE_AGENT: 'false' } });
    const results = await probeModules(probeCtx, [...MODULE_IDS]);
    expect(results.agent.status).toBe('disabled');
    expect(results.agent.reasonKey).toBe('reason.disabledAtBuild');
  });

  it('reports an operator-disabled module distinctly', async () => {
    const results = await probeModules(ctx(), ['fabric', 'entra']);
    expect(results.pp.status).toBe('disabled');
    expect(results.pp.reasonKey).toBe('reason.disabledByOperator');
  });

  it('uses translation keys that actually exist', () => {
    for (const id of MODULE_IDS) {
      const mod = getModule(id)!;
      expect(en[mod.nameKey]).toBeDefined();
      expect(en[mod.descriptionKey]).toBeDefined();
    }
  });

  it('gives every binding kind a unique id and an owning module', () => {
    const kinds = allBindingKinds(baseEnv);
    const ids = kinds.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const kind of kinds) {
      expect(MODULE_IDS).toContain(kind.module);
      // A detective-only control must never claim to be writable.
      if (kind.controlMode === 'detective') expect(kind.writable).toBe(false);
    }
  });
});

describe('module probes', () => {
  it('fabric reports T1 when the admin API answers', async () => {
    const result = await getModule('fabric')!.probe(ctx());
    expect(result.status).toBe('available');
    expect(result.tier).toBe('T1');
    expect(result.probeKind).toBe('live');
  });

  it('fabric degrades to T0 when admin read is refused', async () => {
    const fabricProxy = vi
      .fn()
      .mockRejectedValueOnce(new Error('403 Forbidden'))
      .mockResolvedValueOnce({});
    const result = await getModule('fabric')!.probe(ctx({ fabricProxy }));
    expect(result.status).toBe('degraded');
    expect(result.tier).toBe('T0');
    expect(result.reasonKey).toBe('reason.fabric.noAdmin');
  });

  it('fabric is unavailable without the proxy configured', async () => {
    const result = await getModule('fabric')!.probe(ctx({ env: {} }));
    expect(result.status).toBe('unavailable');
    expect(result.reasonKey).toBe('reason.fabric.noProxy');
  });

  it('entra degrades when directory read is not consented', async () => {
    const graphGet = vi
      .fn()
      .mockRejectedValueOnce(new Error('Authorization_RequestDenied'))
      .mockResolvedValueOnce({});
    const result = await getModule('entra')!.probe(ctx({ graphGet }));
    expect(result.status).toBe('degraded');
    expect(result.reasonKey).toBe('reason.entra.noGraphConsent');
  });

  it('pp is honest that it cannot be live-checked from a browser', async () => {
    const result = await getModule('pp')!.probe(ctx());
    expect(result.probeKind).toBe('declared');
    expect(result.reasonKey).toBe('reason.pp.needsCollector');
  });

  it('pp is unavailable without its collector configured', async () => {
    const result = await getModule('pp')!.probe(ctx({ env: {} }));
    expect(result.status).toBe('unavailable');
    expect(result.reasonKey).toBe('reason.pp.noNotebook');
  });

  it('agent falls back when no agent licence plan is present', async () => {
    const graphGet = vi.fn().mockResolvedValue({ assignedPlans: [] });
    const result = await getModule('agent')!.probe(ctx({ graphGet }));
    expect(result.status).toBe('degraded');
    expect(result.reasonKey).toBe('reason.agent.noLicense');
  });

  it('never lets one failing probe take down the others', async () => {
    const fabricProxy = vi.fn().mockRejectedValue(new Error('boom'));
    const results = await probeModules(ctx({ fabricProxy }), [...MODULE_IDS]);
    expect(results.fabric.status).toBe('unavailable');
    expect(results.entra.status).toBe('available');
  });

  it('reports every probed module even when a probe throws synchronously', async () => {
    const results = await probeModules(
      ctx({
        graphGet: vi.fn().mockImplementation(() => {
          throw new Error('sync boom');
        }),
      }),
      [...MODULE_IDS]
    );
    expect(Object.keys(results).sort()).toEqual([...MODULE_IDS].sort());
  });
});

describe('effective reach tier', () => {
  const avail = (tier: 'T0' | 'T1' | 'T2', status: ModuleAvailability['status']) =>
    ({ status, tier, probeKind: 'live', checkedAt: '' }) as ModuleAvailability;

  it('is T0 when nothing contributes', () => {
    expect(effectiveTier({})).toBe('T0');
    expect(effectiveTier({ fabric: avail('T1', 'disabled') })).toBe('T0');
  });

  it('takes the lowest tier among contributing modules', () => {
    expect(
      effectiveTier({ fabric: avail('T1', 'available'), entra: avail('T0', 'degraded') })
    ).toBe('T0');
    expect(
      effectiveTier({ fabric: avail('T1', 'available'), entra: avail('T1', 'available') })
    ).toBe('T1');
  });

  it('ignores unavailable modules when computing the tier', () => {
    expect(
      effectiveTier({ fabric: avail('T1', 'available'), pp: avail('T0', 'unavailable') })
    ).toBe('T1');
  });
});

describe('module dependencies', () => {
  const avail = (status: ModuleAvailability['status']) =>
    ({ status, tier: 'T1', probeKind: 'live', checkedAt: '' }) as ModuleAvailability;

  it('flags a contributing module whose substrate is missing', () => {
    const unmet = unmetDependencies(
      { fabric: avail('available'), entra: avail('unavailable') },
      baseEnv
    );
    expect(unmet).toEqual([{ module: 'fabric', missing: ['entra'] }]);
  });

  it('reports nothing when dependencies are satisfied', () => {
    expect(
      unmetDependencies(
        { fabric: avail('available'), entra: avail('degraded') },
        baseEnv
      )
    ).toEqual([]);
  });
});
