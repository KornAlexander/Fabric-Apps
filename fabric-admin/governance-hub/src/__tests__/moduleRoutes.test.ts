import { describe, expect, it } from 'vitest';

import { en } from '@/i18n';
import { MODULE_IDS, getModule, moduleRoutes } from '@/modules';
import { getModelTarget } from '@/services/govModel';

/**
 * Module-owned routes (PLAN.md §8.2, §13).
 *
 * A disabled module's pages must be *removed*, not greyed out — the app should
 * look like a tool that does not cover that plane, because that is what it is.
 */
describe('module routes', () => {
  it('every module contributes at least one page', () => {
    for (const id of MODULE_IDS) {
      expect(getModule(id)!.routes.length, id).toBeGreaterThan(0);
    }
  });

  it('uses label keys that exist in the catalogue', () => {
    for (const route of moduleRoutes([...MODULE_IDS], {})) {
      expect(en[route.labelKey], route.path).toBeDefined();
    }
  });

  it('gives every route a unique path', () => {
    const paths = moduleRoutes([...MODULE_IDS], {}).map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('omits routes of operator-disabled modules', () => {
    const paths = moduleRoutes(['fabric', 'entra'], {}).map((r) => r.path);
    expect(paths).toContain('/workspaces');
    expect(paths).toContain('/groups');
    expect(paths).not.toContain('/environments');
    expect(paths).not.toContain('/agents');
  });

  it('omits routes of build-time-disabled modules', () => {
    const paths = moduleRoutes([...MODULE_IDS], { VITE_MODULE_AGENT: 'false' }).map(
      (r) => r.path
    );
    expect(paths).not.toContain('/agents');
  });

  it('returns nothing when every module is off', () => {
    expect(moduleRoutes([], {})).toEqual([]);
  });

  it('tags each route with its owning module', () => {
    const byPath = Object.fromEntries(
      moduleRoutes([...MODULE_IDS], {}).map((r) => [r.path, r.module])
    );
    expect(byPath['/workspaces']).toBe('fabric');
    expect(byPath['/environments']).toBe('pp');
    expect(byPath['/groups']).toBe('entra');
    expect(byPath['/agents']).toBe('agent');
  });

  it('loads pages lazily so a disabled module costs nothing', () => {
    for (const route of moduleRoutes([...MODULE_IDS], {})) {
      expect(typeof route.element).toBe('function');
    }
  });
});

describe('model target resolution', () => {
  it('needs both a model id and a workspace', () => {
    expect(getModelTarget({})).toBeNull();
    expect(getModelTarget({ VITE_GOV_MODEL_ID: 'm' })).toBeNull();
    expect(getModelTarget({ VITE_GOV_WORKSPACE_ID: 'w' })).toBeNull();
  });

  it('falls back to the app workspace when no governance workspace is set', () => {
    expect(
      getModelTarget({ VITE_GOV_MODEL_ID: 'm', VITE_FABRIC_WORKSPACE_ID: 'app-ws' })
    ).toEqual({ modelId: 'm', workspaceId: 'app-ws' });
  });

  it('prefers an explicit governance workspace', () => {
    expect(
      getModelTarget({
        VITE_GOV_MODEL_ID: 'm',
        VITE_GOV_WORKSPACE_ID: 'gov-ws',
        VITE_FABRIC_WORKSPACE_ID: 'app-ws',
      })
    ).toEqual({ modelId: 'm', workspaceId: 'gov-ws' });
  });
});
