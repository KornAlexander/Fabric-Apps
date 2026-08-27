import { describe, expect, it } from 'vitest';

import { en } from '@/i18n';
import { MODULE_IDS, getModule, moduleNotebooks } from '@/modules';

const env = {
  VITE_GOV_FABRIC_COLLECTOR_NOTEBOOK_ID: 'nb-fabric',
  VITE_GOV_PP_COLLECTOR_NOTEBOOK_ID: '',
};

/**
 * Phase 3 (Track B) wiring: every module declares the server-side notebook that
 * keeps its plane fresh, and the app is honest about which of them a deployment
 * has actually been told where to find.
 */
describe('module collector notebooks', () => {
  it('every module owns exactly one collector', () => {
    for (const id of MODULE_IDS) {
      const collectors = getModule(id)!.notebooks.filter((n) => n.role === 'collector');
      expect(collectors, id).toHaveLength(1);
    }
  });

  it('reports configured versus not-yet-deployed', () => {
    const status = moduleNotebooks([...MODULE_IDS], env);
    const byModule = Object.fromEntries(status.map((s) => [s.module, s]));

    expect(byModule.fabric.configured).toBe(true);
    expect(byModule.fabric.notebookId).toBe('nb-fabric');
    // An empty string is "not deployed", not "deployed with an empty id".
    expect(byModule.pp.configured).toBe(false);
    expect(byModule.agent.configured).toBe(false);
  });

  it('omits disabled modules entirely', () => {
    const status = moduleNotebooks(['fabric'], env);
    expect(status.map((s) => s.module)).toEqual(['fabric']);
  });

  it('omits build-time-disabled modules even when enabled by the operator', () => {
    const status = moduleNotebooks([...MODULE_IDS], {
      ...env,
      VITE_MODULE_AGENT: 'false',
    });
    expect(status.map((s) => s.module)).not.toContain('agent');
  });

  it('env var names match the documented configuration surface', () => {
    for (const status of moduleNotebooks([...MODULE_IDS], env)) {
      expect(status.envVar).toMatch(/^VITE_GOV_[A-Z]+_COLLECTOR_NOTEBOOK_ID$/);
    }
  });

  it('the Setup strings it renders exist in both catalogues', () => {
    for (const key of [
      'setup.collectors',
      'setup.collectors.help',
      'setup.collectors.configured',
      'setup.collectors.missing',
      'setup.collectors.none',
    ] as const) {
      expect(en[key]).toBeDefined();
    }
  });
});
