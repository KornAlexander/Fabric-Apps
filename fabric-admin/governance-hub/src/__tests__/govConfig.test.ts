import { beforeEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();

vi.mock('@/services/rayfinClient', () => ({
  getRayfinClient: () => ({ data: { GovConfig: { findMany, create: vi.fn(), update: vi.fn() } } }),
}));

const { DEFAULT_CONFIG, loadConfig } = await import('@/services/govConfig');

beforeEach(() => {
  findMany.mockReset();
});

/**
 * Regression: found by driving the app in a real browser, not by the unit
 * suite (PLAN.md §17.4).
 *
 * `loadConfig` used to swallow a backend failure and return defaults, so the
 * caller could not distinguish *"defaults because that is what is stored"* from
 * *"defaults because nothing could be read"*. The consequences were both
 * dishonest: the Setup pre-flight reported the app backend as reachable when it
 * was not — the one check whose entire job is to say otherwise — and Settings
 * offered module toggles that could never persist.
 */
describe('loadConfig reachability', () => {
  it('reports the backend as unreachable when the read fails', async () => {
    findMany.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await loadConfig();

    expect(result.reachable).toBe(false);
    // Falling back to defaults is still the right behaviour…
    expect(result.config).toEqual(DEFAULT_CONFIG);
  });

  it('reports it as reachable when the read succeeds, even with no rows', async () => {
    // An empty table is a real, valid state: a fresh deployment. It must not be
    // confused with an unreachable backend.
    findMany.mockResolvedValue([]);

    const result = await loadConfig();

    expect(result.reachable).toBe(true);
    expect(result.config).toEqual(DEFAULT_CONFIG);
  });

  it('decodes stored values and still reports reachable', async () => {
    findMany.mockResolvedValue([
      { config_key: 'modules.enabled', config_value: '["fabric","entra"]' },
      { config_key: 'writes.enabled', config_value: 'true' },
      { config_key: 'locale.default', config_value: '"de"' },
    ]);

    const result = await loadConfig();

    expect(result.reachable).toBe(true);
    expect(result.config.modulesEnabled).toEqual(['fabric', 'entra']);
    expect(result.config.writesEnabled).toBe(true);
    expect(result.config.localeDefault).toBe('de');
  });

  it('never reports telemetry as enabled, whatever is stored', async () => {
    // The key exists so that "we send nothing" is auditable rather than
    // asserted — it is not a setting a deployment can turn on.
    findMany.mockResolvedValue([
      { config_key: 'telemetry.enabled', config_value: 'true' },
    ]);

    const result = await loadConfig();

    expect(result.config.telemetryEnabled).toBe(false);
  });

  it('ignores an unknown module id rather than trusting the stored value', async () => {
    findMany.mockResolvedValue([
      { config_key: 'modules.enabled', config_value: '["fabric","not-a-module"]' },
    ]);

    const result = await loadConfig();

    expect(result.config.modulesEnabled).toEqual(['fabric']);
  });

  it('falls back per key when a stored value is corrupt', async () => {
    findMany.mockResolvedValue([
      { config_key: 'writes.kinds', config_value: '{not json' },
    ]);

    const result = await loadConfig();

    expect(result.reachable).toBe(true);
    expect(result.config.writeKinds).toEqual([]);
  });
});
