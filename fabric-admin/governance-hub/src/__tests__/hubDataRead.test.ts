/**
 * The Hub's own stores against a data client that behaves like the real one.
 *
 * These five services used to read with a plain `findMany` and map the
 * fields of each row. Against the real client that yields rows with nothing
 * but an id: no error, every field `undefined`. Found on 2026-10-12 while
 * checking the User Manager live; see src/services/dataRows.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeData } from './helpers/fakeRayfinData';

const fake = createFakeData();
vi.mock('@/services/rayfinClient', () => ({ getRayfinClient: () => ({ data: fake.data }) }));

const { loadConfig, setConfigValue, DEFAULT_CONFIG } = await import('@/services/govConfig');
const { loadPersonas } = await import('@/services/personas');
const { loadAssignments } = await import('@/services/assignments');
const { loadRequests } = await import('@/services/requests');
const { loadTasks } = await import('@/services/tasks');
const { readRows, jsonText, plainText } = await import('@/services/dataRows');

beforeEach(() => fake.reset());

describe('reading rows the way the client really answers', () => {
  it('names the fields, so a row carries more than its id', async () => {
    fake.seed('GovTask', { source: 'manual', detail: 'check the gateway', status: 'Open', created_at: '2026-10-01T08:00:00Z' });
    expect(await fake.data.GovTask.findMany()).toEqual([{ id: expect.any(String) }]);
    const rows = await readRows<{ id: string; detail: string }>(fake.data.GovTask, ['id', 'detail']);
    expect(rows).toEqual([{ id: expect.any(String), detail: 'check the gateway' }]);
  });

  it('turns converted values back into what was stored', () => {
    expect(jsonText(true)).toBe('true');
    expect(jsonText('["fabric"]')).toBe('["fabric"]');
    expect(jsonText(undefined)).toBeUndefined();
    expect(plainText(false)).toBe('false');
    expect(plainText(new Date('2026-10-12'))).toBe('2026-10-12T00:00:00.000Z');
    expect(plainText(null)).toBeUndefined();
  });
});

describe('settings', () => {
  it('reads stored values, including a stored true', async () => {
    fake.seed('GovConfig', { config_key: 'modules.enabled', config_value: '["fabric","entra"]' });
    fake.seed('GovConfig', { config_key: 'writes.enabled', config_value: 'true' });
    fake.seed('GovConfig', { config_key: 'locale.default', config_value: '"de"' });
    const result = await loadConfig();
    expect(result.reachable).toBe(true);
    expect(result.config.modulesEnabled).toEqual(['fabric', 'entra']);
    expect(result.config.writesEnabled).toBe(true);
    expect(result.config.localeDefault).toBe('de');
  });

  it('reads back what it saved', async () => {
    expect(await setConfigValue('locale.default', 'de', 'admin@x.example')).toBe(true);
    expect((await loadConfig()).config.localeDefault).toBe('de');
    expect(await setConfigValue('locale.default', 'en', 'admin@x.example')).toBe(true);
    expect((await loadConfig()).config.localeDefault).toBe('en');
    expect(fake.tables.GovConfig).toHaveLength(1);
  });

  it('says so when nothing can be read, instead of presenting defaults as stored', async () => {
    fake.state.unreachable = true;
    expect(await loadConfig()).toEqual({ config: DEFAULT_CONFIG, reachable: false });
  });
});

describe('personas, assignments, requests and tasks', () => {
  it('reads a persona override with its fields', async () => {
    fake.seed('GovPersona', { persona_id: 'custom-analyst', name: 'Custom analyst', description: 'Reads reports', risk_tier: 'low', capability_ids_json: '["pbi.report.read"]', is_active: true, is_custom: true, updated_by: 'a', updated_at: '2026-10-01T08:00:00Z' });
    const result = await loadPersonas();
    expect(result.backendReachable).toBe(true);
    expect(result.personas.find((p) => p.id === 'custom-analyst')).toMatchObject({ name: 'Custom analyst', description: 'Reads reports' });
  });

  it('reads an assignment with its fields', async () => {
    fake.seed('GovAssignment', { principal_id: 'p1', principal_name: 'Uwe User', principal_type: 'User', persona_id: 'analyst', scope_type: 'workspace', scope_id: 'w1', scope_name: 'Sales', granted_via: 'request', granted_by: 'a', granted_at: '2026-10-01T08:00:00Z', valid_until: '2026-12-01T00:00:00Z', is_active: true });
    const result = await loadAssignments();
    expect(result.backendReachable).toBe(true);
    expect(result.assignments).toEqual([
      { id: expect.any(String), principalId: 'p1', principalName: 'Uwe User', principalType: 'User', personaId: 'analyst', scopeType: 'workspace', scopeId: 'w1', scopeName: 'Sales', validUntil: '2026-12-01T00:00:00.000Z', isActive: true },
    ]);
  });

  it('reads a request with its fields', async () => {
    fake.seed('GovRequest', { requester_id: 'uwe@x.example', requester_name: 'Uwe User', persona_id: 'analyst', scope_type: 'workspace', scope_id: 'w1', scope_name: 'Sales', justification: 'I work on the sales reports.', status: 'Pending', created_at: '2026-10-01T08:00:00Z' });
    const result = await loadRequests();
    expect(result.backendReachable).toBe(true);
    expect(result.requests[0]).toMatchObject({ requesterName: 'Uwe User', personaId: 'analyst', scopeName: 'Sales', justification: 'I work on the sales reports.', status: 'Pending', createdAt: '2026-10-01T08:00:00.000Z' });
  });

  it('reads a task with its fields, also when its text reads like a boolean', async () => {
    fake.seed('GovTask', { source: 'manual', binding_kind: 'k', module: 'fabric', detail: 'true', scope_type: 'workspace', scope_id: 'w1', scope_name: 'Sales', status: 'Open', created_at: '2026-10-01T08:00:00Z' });
    const result = await loadTasks();
    expect(result.backendReachable).toBe(true);
    expect(result.tasks[0]).toMatchObject({ source: 'manual', module: 'fabric', detail: 'true', scopeName: 'Sales', status: 'Open', createdAt: '2026-10-01T08:00:00.000Z' });
  });

  it('reports each store as unreachable when the backend is', async () => {
    fake.state.unreachable = true;
    expect((await loadPersonas()).backendReachable).toBe(false);
    expect((await loadAssignments()).backendReachable).toBe(false);
    expect((await loadRequests()).backendReachable).toBe(false);
    expect((await loadTasks()).backendReachable).toBe(false);
  });
});
