import { describe, expect, it, vi } from 'vitest';

import {
  EMPTY_FILTERS,
  buildGapReport,
  countByKind,
  filterInventory,
  presentKinds,
} from '@/domain/inventoryView';
import { en } from '@/i18n';
import { collectInventory, getModule, MODULE_IDS } from '@/modules';
import type { InventoryItem, ProbeContext } from '@/modules/types';

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

/**
 * `fabricProxy` is generic (`<T>(...) => Promise<T>`), which a route-dispatching
 * mock cannot satisfy structurally. These adapters keep the casts in one place
 * instead of scattering them through every test.
 */
function asFabricProxy(
  fn: (api: string, path: string) => Promise<unknown>
): ProbeContext['fabricProxy'] {
  return fn as unknown as ProbeContext['fabricProxy'];
}

/** Fabric proxy that refuses admin endpoints — the T0 situation. */
function userScopedFabric(
  workspaces: unknown[],
  itemsByWorkspace: Record<string, unknown[]> = {}
) {
  return asFabricProxy(async (_api, path) => {
    if (path.startsWith('/admin')) throw new Error('403 Forbidden');
    if (path === '/workspaces') return { value: workspaces };
    const match = path.match(/^\/workspaces\/([^/]+)\/items$/);
    if (match) return { value: itemsByWorkspace[match[1]] ?? [] };
    throw new Error(`unexpected path ${path}`);
  });
}

describe('fabric collector', () => {
  it('reads workspaces and their items at T0 when admin read is refused', async () => {
    const fabricProxy = userScopedFabric(
      [{ id: 'ws-1', displayName: 'Finance', capacityId: 'cap-1' }],
      {
        'ws-1': [
          { id: 'it-1', displayName: 'Sales Report', type: 'Report' },
          { id: 'it-2', displayName: 'Model', type: 'SemanticModel' },
        ],
      }
    );
    const result = await getModule('fabric')!.collect!(ctx({ fabricProxy }));

    expect(result.tier).toBe('T0');
    expect(result.partial).toBe(true);
    expect(result.partialReasonKey).toBe('reason.fabric.noAdmin');
    expect(result.items.map((i) => i.kind)).toEqual([
      'workspace',
      'fabricItem',
      'fabricItem',
    ]);
    expect(result.items[1]).toMatchObject({
      name: 'Sales Report',
      itemType: 'Report',
      scopeId: 'ws-1',
      scopeName: 'Finance',
    });
  });

  it('prefers the tenant-wide admin list and reports T1', async () => {
    const fabricProxy = asFabricProxy(async (_api, path) => {
      if (path === '/admin/workspaces') {
        return { workspaces: [{ id: 'ws-1', displayName: 'Finance' }] };
      }
      return { value: [] };
    });
    const result = await getModule('fabric')!.collect!(ctx({ fabricProxy }));
    expect(result.tier).toBe('T1');
    expect(result.partial).toBe(false);
  });

  it('classifies org apps distinctly from ordinary items', async () => {
    const fabricProxy = userScopedFabric([{ id: 'ws-1', displayName: 'W' }], {
      'ws-1': [{ id: 'app-1', displayName: 'Program Insights', type: 'OrgApp' }],
    });
    const result = await getModule('fabric')!.collect!(ctx({ fabricProxy }));
    expect(result.items.find((i) => i.id === 'app-1')?.kind).toBe('orgApp');
  });

  it('caps item expansion and says so, rather than being slow or silent', async () => {
    const workspaces = Array.from({ length: 20 }, (_, i) => ({
      id: `ws-${i}`,
      displayName: `W${i}`,
    }));
    const fabricProxy = userScopedFabric(workspaces);
    const result = await getModule('fabric')!.collect!(ctx({ fabricProxy }));

    expect(result.items.filter((i) => i.kind === 'workspace')).toHaveLength(20);
    expect(result.partialReasonKey).toBe('partial.fabric.capped');
    expect(result.partialReasonParams).toEqual({ limit: 15 });
  });

  it('survives an unreadable workspace instead of losing the whole inventory', async () => {
    const fabricProxy = asFabricProxy(async (_api, path) => {
      if (path.startsWith('/admin')) throw new Error('403');
      if (path === '/workspaces') {
        return {
          value: [
            { id: 'ws-good', displayName: 'Good' },
            { id: 'ws-bad', displayName: 'Bad' },
          ],
        };
      }
      if (path === '/workspaces/ws-bad/items') throw new Error('401 Unauthorized');
      return { value: [{ id: 'ok', displayName: 'Item', type: 'Notebook' }] };
    });
    const result = await getModule('fabric')!.collect!(ctx({ fabricProxy }));

    expect(result.items.some((i) => i.id === 'ok')).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Bad');
  });

  it('returns nothing but a reason when the proxy is unconfigured', async () => {
    const result = await getModule('fabric')!.collect!(ctx({ env: {} }));
    expect(result.items).toEqual([]);
    expect(result.partialReasonKey).toBe('reason.fabric.noProxy');
  });
});

describe('entra collector', () => {
  it('reads the directory at T1', async () => {
    const graphGet = vi.fn().mockResolvedValue({
      value: [{ id: 'g-1', displayName: 'GOV-FAB-WS-Finance-Contributor' }],
    });
    const result = await getModule('entra')!.collect!(ctx({ graphGet }));
    expect(result.tier).toBe('T1');
    expect(result.partial).toBe(false);
    expect(result.items[0]).toMatchObject({ kind: 'group', itemType: 'Security' });
  });

  it('flags a truncated first page', async () => {
    const graphGet = vi.fn().mockResolvedValue({
      value: [{ id: 'g-1', displayName: 'A' }],
      '@odata.nextLink': 'https://graph.microsoft.com/next',
    });
    const result = await getModule('entra')!.collect!(ctx({ graphGet }));
    expect(result.partial).toBe(true);
    expect(result.partialReasonKey).toBe('partial.entra.firstPage');
  });

  it('falls back to the user own memberships at T0', async () => {
    const graphGet = vi
      .fn()
      .mockRejectedValueOnce(new Error('Authorization_RequestDenied'))
      .mockResolvedValueOnce({
        value: [
          { id: 'g-1', displayName: 'My Group', '@odata.type': '#microsoft.graph.group' },
          { id: 'r-1', displayName: 'A Role', '@odata.type': '#microsoft.graph.directoryRole' },
        ],
      });
    const result = await getModule('entra')!.collect!(ctx({ graphGet }));

    expect(result.tier).toBe('T0');
    expect(result.partialReasonKey).toBe('partial.entra.ownMembershipOnly');
    // Directory roles are not groups and must not be smuggled into the list.
    expect(result.items.map((i) => i.id)).toEqual(['g-1']);
  });

  it('reports both failures when Graph is unreachable', async () => {
    const graphGet = vi.fn().mockRejectedValue(new Error('no token'));
    const result = await getModule('entra')!.collect!(ctx({ graphGet }));
    expect(result.items).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.partialReasonKey).toBe('reason.entra.noToken');
  });
});

describe('server-side-only modules', () => {
  it.each(['pp', 'agent'] as const)(
    '%s returns an explicitly empty, explicitly partial result',
    async (id) => {
      const result = await getModule(id)!.collect!(ctx());
      expect(result.items).toEqual([]);
      expect(result.partial).toBe(true);
      expect(result.partialReasonKey).toBeDefined();
      expect(en[result.partialReasonKey!]).toBeDefined();
    }
  );
});

describe('merged inventory', () => {
  it('merges items across modules and keeps per-module results', async () => {
    const fabricProxy = userScopedFabric([{ id: 'ws-1', displayName: 'W' }]);
    const graphGet = vi.fn().mockResolvedValue({ value: [{ id: 'g-1', displayName: 'G' }] });
    const merged = await collectInventory(ctx({ fabricProxy, graphGet }), [...MODULE_IDS]);

    expect(merged.items.map((i) => i.module).sort()).toEqual(['entra', 'fabric']);
    expect(Object.keys(merged.byModule).sort()).toEqual([...MODULE_IDS].sort());
  });

  it('is partial when any contributing module is partial', async () => {
    const fabricProxy = asFabricProxy(async (_api, path) => {
      if (path === '/admin/workspaces') return { workspaces: [] };
      return { value: [] };
    });
    const graphGet = vi.fn().mockResolvedValue({ value: [] });
    // Fabric and Entra are both complete here, but PP and Agent never are.
    const merged = await collectInventory(ctx({ fabricProxy, graphGet }), [...MODULE_IDS]);
    expect(merged.partial).toBe(true);

    const onlyComplete = await collectInventory(ctx({ fabricProxy, graphGet }), [
      'fabric',
      'entra',
    ]);
    expect(onlyComplete.partial).toBe(false);
  });

  it('takes the lowest tier across contributing modules', async () => {
    const fabricProxy = userScopedFabric([]); // T0
    const graphGet = vi.fn().mockResolvedValue({ value: [] }); // T1
    const merged = await collectInventory(ctx({ fabricProxy, graphGet }), [
      'fabric',
      'entra',
    ]);
    expect(merged.tier).toBe('T0');
  });

  it('skips disabled modules entirely', async () => {
    const graphGet = vi.fn().mockResolvedValue({ value: [] });
    const merged = await collectInventory(ctx({ graphGet }), ['entra']);
    expect(Object.keys(merged.byModule)).toEqual(['entra']);
  });

  it('turns a throwing collector into a reported gap, not a crash', async () => {
    const graphGet = vi.fn().mockImplementation(() => {
      throw new Error('sync boom');
    });
    const merged = await collectInventory(ctx({ graphGet }), ['entra']);
    expect(merged.byModule.entra?.partial).toBe(true);
    expect(merged.errors.join()).toContain('entra');
  });
});

describe('inventory view derivation', () => {
  const merged = {
    items: [],
    byModule: {
      fabric: {
        items: [],
        tier: 'T0' as const,
        partial: true,
        partialReasonKey: 'partial.fabric.capped' as const,
        partialReasonParams: { limit: 15 },
        errors: [],
      },
      entra: {
        items: [],
        tier: 'T1' as const,
        partial: false,
        errors: [],
      },
    },
    partial: true,
    tier: 'T0' as const,
    errors: [],
  };

  it('reports one gap per partial module and stays quiet otherwise', () => {
    const gaps = buildGapReport(merged);
    expect(gaps).toEqual([
      {
        module: 'fabric',
        reasonKey: 'partial.fabric.capped',
        reasonParams: { limit: 15 },
      },
    ]);
  });

  it('uses reason keys that exist in the catalogue', () => {
    for (const gap of buildGapReport(merged)) {
      expect(en[gap.reasonKey!]).toBeDefined();
    }
  });

  const items: InventoryItem[] = [
    { id: '1', module: 'fabric', kind: 'workspace', name: 'Finance' },
    {
      id: '2',
      module: 'fabric',
      kind: 'fabricItem',
      name: 'Sales Report',
      itemType: 'Report',
      scopeName: 'Finance',
    },
    { id: '3', module: 'entra', kind: 'group', name: 'GOV-FAB-WS-Finance-Contributor' },
  ];

  it('returns everything with empty filters', () => {
    expect(filterInventory(items, EMPTY_FILTERS)).toHaveLength(3);
  });

  it('filters by module and kind', () => {
    expect(filterInventory(items, { ...EMPTY_FILTERS, module: 'entra' })).toHaveLength(1);
    expect(filterInventory(items, { ...EMPTY_FILTERS, kind: 'workspace' })).toHaveLength(1);
  });

  it('searches name, type and container case-insensitively', () => {
    expect(filterInventory(items, { ...EMPTY_FILTERS, search: 'REPORT' })).toHaveLength(1);
    expect(filterInventory(items, { ...EMPTY_FILTERS, search: 'finance' })).toHaveLength(3);
    expect(filterInventory(items, { ...EMPTY_FILTERS, search: '  ' })).toHaveLength(3);
  });

  it('counts by kind, busiest first', () => {
    expect(countByKind(items)).toEqual([
      { kind: 'workspace', count: 1 },
      { kind: 'fabricItem', count: 1 },
      { kind: 'group', count: 1 },
    ]);
  });

  it('lists only the kinds actually present', () => {
    expect(presentKinds(items)).toEqual(['fabricItem', 'group', 'workspace']);
    expect(presentKinds([])).toEqual([]);
  });
});
