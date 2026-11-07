// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ pinned: vi.fn(), token: vi.fn(async () => 'token') }));
vi.mock('@/um/services/graphAuth', () => ({ getPinnedObjectId: auth.pinned, getGraphToken: auth.token }));
const { FabricWorkspaceProvisioner } = await import('@/um/services/workspaceProvisioningApi');

const g = (n: number) => `abababab-0000-4000-8000-${String(n).padStart(12, '0')}`;
const input = { displayName: 'Finance Development', description: 'Finance', reason: 'Build finance reports.' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => { auth.pinned.mockReturnValue(g(1)); auth.token.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

describe('workspace provisioning API', () => {
  it('calls the default browser fetch without binding it to the provisioner instance', async () => {
    const responses = [
      json({ value: [{ id: g(2), displayName: 'F4', state: 'Active' }] }),
      json({ id: g(4) }, 201),
      json({ id: g(4), capacityId: g(2) }),
    ];
    const browserFetch = vi.fn(function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      const response = responses.shift();
      if (!response) throw new Error('Unexpected fetch');
      return Promise.resolve(response);
    });
    vi.stubGlobal('fetch', browserFetch);
    const api = new FabricWorkspaceProvisioner();
    expect(await api.listCapacities(g(1))).toHaveLength(1);
    expect(await api.createWorkspace(input, g(2), g(1))).toBe(g(4));
    await api.verifyWorkspace(g(4), g(2), g(1));
    expect(browserFetch).toHaveBeenCalledTimes(3);
  });

  it('paginates capacities on a fixed origin without trusting continuation URLs', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ value: [{ id: g(2), displayName: 'F4', state: 'Active' }], continuationToken: 'next & page', continuationUri: 'https://evil.example' }))
      .mockResolvedValueOnce(json({ value: [{ id: g(3), displayName: 'F8', state: 'Inactive' }] }));
    const result = await new FabricWorkspaceProvisioner(fetcher).listCapacities(g(1));
    expect(result).toHaveLength(2);
    expect(fetcher.mock.calls[1][0]).toBe('https://api.fabric.microsoft.com/v1/capacities?continuationToken=next%20%26%20page');
    expect(auth.token).toHaveBeenCalledWith('capacity');
  });

  it('creates once with selected capacity and delegated workspace permission', async () => {
    const fetcher = vi.fn(async () => json({ id: g(4) }, 201));
    expect(await new FabricWorkspaceProvisioner(fetcher).createWorkspace(input, g(2), g(1))).toBe(g(4));
    expect(auth.token).toHaveBeenCalledWith('fabricWrite');
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://api.fabric.microsoft.com/v1/workspaces', expect.objectContaining({
      method: 'POST', redirect: 'manual', body: JSON.stringify({ displayName: input.displayName, description: input.description, capacityId: g(2) }),
    }));
  });

  it('rejects invalid IDs, account switches, read failures, and uncertain creates without retrying', async () => {
    const fetcher = vi.fn(async () => json({}, 503));
    const api = new FabricWorkspaceProvisioner(fetcher);
    await expect(api.createWorkspace(input, '../admin', g(1))).rejects.toThrow('invalid-workspace');
    auth.pinned.mockReturnValueOnce(g(1)).mockReturnValueOnce(g(9));
    await expect(api.createWorkspace(input, g(2), g(1))).rejects.toThrow('actor-mismatch');
    expect(fetcher).not.toHaveBeenCalled();
    await expect(api.createWorkspace(input, g(2), g(1))).rejects.toThrow('workspace-create-503');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(api.listCapacities(g(1))).rejects.toThrow('capacity-read-503');
  });

  it('verifies the selected capacity and refuses incomplete responses or repeated pagination', async () => {
    const fetcher = vi.fn(async () => json({ id: g(4), capacityId: g(2) }));
    await new FabricWorkspaceProvisioner(fetcher).verifyWorkspace(g(4), g(2), g(1));
    fetcher.mockResolvedValueOnce(json({ id: g(4), capacityId: g(9) }));
    await expect(new FabricWorkspaceProvisioner(fetcher).verifyWorkspace(g(4), g(2), g(1))).rejects.toThrow('capacity-not-confirmed');
    fetcher.mockResolvedValueOnce(json({ id: g(4), capacityId: g(2), displayName: 'Someone else' }));
    await expect(new FabricWorkspaceProvisioner(fetcher).verifyWorkspace(g(4), g(2), g(1), input.displayName)).rejects.toThrow('name-not-confirmed');
    fetcher.mockResolvedValueOnce(json({ id: g(4), capacityId: g(2), displayName: input.displayName }));
    await new FabricWorkspaceProvisioner(fetcher).verifyWorkspace(g(4), g(2), g(1), input.displayName);
    const paging = vi.fn(async () => json({ value: [], continuationToken: 'same' }));
    await expect(new FabricWorkspaceProvisioner(paging).listCapacities(g(1))).rejects.toThrow('capacity-pagination');
    expect(paging).toHaveBeenCalledTimes(2);
  });
});
