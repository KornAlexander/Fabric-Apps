import { afterEach, describe, expect, it, vi } from 'vitest';

describe('powerBiDirect without the standalone variables', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('loads, so the app can start inside the Fabric portal', async () => {
    const mod = await import('@/services/powerBiDirect');
    expect(() => mod.initPowerBiAuth()).not.toThrow();
  });

  it('names the client id when the MSAL path is used', async () => {
    const { acquirePowerBiToken } = await import('@/services/powerBiDirect');
    await expect(acquirePowerBiToken(false)).rejects.toThrow('VITE_PBI_CLIENT_ID is not set');
  });

  it('names the tenant id instead of using a placeholder', async () => {
    vi.stubEnv('VITE_PBI_CLIENT_ID', 'test-client');
    const { acquirePowerBiToken } = await import('@/services/powerBiDirect');
    await expect(acquirePowerBiToken(false)).rejects.toThrow('VITE_PBI_TENANT_ID is not set');
  });

  it('names the dataset id for a direct query', async () => {
    const { executeQueriesDirect } = await import('@/services/powerBiDirect');
    await expect(executeQueriesDirect('EVALUATE {1}', 'token')).rejects.toThrow(
      'VITE_PBI_DATASET_ID is not set',
    );
  });
});
