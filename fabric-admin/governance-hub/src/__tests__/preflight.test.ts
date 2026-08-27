import { describe, expect, it } from 'vitest';

import { buildPreflight, overallStatus, PP_MANAGEMENT_APP_COMMAND } from '@/domain/preflight';
import { en } from '@/i18n';
import type { ModuleAvailability } from '@/modules/types';
import { DEFAULT_CONFIG } from '@/services/govConfig';

const avail = (
  status: ModuleAvailability['status'],
  tier: ModuleAvailability['tier'] = 'T1'
): ModuleAvailability => ({ status, tier, probeKind: 'live', checkedAt: '' });

const fullEnv = {
  VITE_UDF_FABRIC_PROXY_URL: 'https://example.invalid/invoke',
  VITE_GOV_PP_COLLECTOR_NOTEBOOK_ID: 'nb-pp',
  VITE_GOV_MODEL_ID: 'model-1',
};

describe('pre-flight checks', () => {
  it('every check maps to real translation keys', () => {
    const checks = buildPreflight({
      env: fullEnv,
      config: DEFAULT_CONFIG,
      availability: {},
      backendReachable: true,
    });
    for (const check of checks) {
      expect(en[check.titleKey], check.id).toBeDefined();
      if (check.fixKey) expect(en[check.fixKey], check.id).toBeDefined();
    }
  });

  it('fails when the fabric_proxy URL is missing', () => {
    const checks = buildPreflight({
      env: {},
      config: DEFAULT_CONFIG,
      availability: {},
      backendReachable: true,
    });
    expect(checks.find((c) => c.id === 'udf')?.status).toBe('fail');
  });

  it('never claims the Power Platform management app is registered', () => {
    // Nothing in a browser can prove this, and a service principal cannot
    // register itself — so the honest answer is `unknown`, never `pass`.
    const checks = buildPreflight({
      env: fullEnv,
      config: DEFAULT_CONFIG,
      availability: { pp: avail('available') },
      backendReachable: true,
    });
    const check = checks.find((c) => c.id === 'ppManagementApp')!;
    expect(check.status).toBe('unknown');
    expect(check.needsHuman).toBe(true);
    expect(check.command).toBe(PP_MANAGEMENT_APP_COMMAND);
  });

  it('treats a disarmed deployment as a pass, not a warning', () => {
    const checks = buildPreflight({
      env: fullEnv,
      config: DEFAULT_CONFIG,
      availability: {},
      backendReachable: true,
    });
    expect(checks.find((c) => c.id === 'writesDisarmed')?.status).toBe('pass');
  });

  it('warns once writes are armed', () => {
    const checks = buildPreflight({
      env: fullEnv,
      config: { ...DEFAULT_CONFIG, writesEnabled: true, writeKinds: ['entra_group_member'] },
      availability: {},
      backendReachable: true,
    });
    expect(checks.find((c) => c.id === 'writesDisarmed')?.status).toBe('warn');
  });

  it('does not nag about the missing actuator while writes are disarmed', () => {
    // Nothing is trying to write, so its absence changes nothing.
    const checks = buildPreflight({
      env: fullEnv,
      config: DEFAULT_CONFIG,
      availability: {},
      backendReachable: true,
    });
    expect(checks.find((c) => c.id === 'actuator')?.status).toBe('unknown');
  });

  it('fails hard when a kind is armed but the actuator is not deployed', () => {
    // Otherwise every attempt fails at the transport instead of at a gate,
    // which reads like a bug in the tool rather than a missing deployment step.
    const checks = buildPreflight({
      env: fullEnv,
      config: { ...DEFAULT_CONFIG, writesEnabled: true, writeKinds: ['entra_group_member'] },
      availability: {},
      backendReachable: true,
    });
    expect(checks.find((c) => c.id === 'actuator')?.status).toBe('fail');
  });

  it('passes once the actuator notebook id is configured', () => {
    const checks = buildPreflight({
      env: { ...fullEnv, VITE_GOV_ACTUATOR_NOTEBOOK_ID: 'nb-actuator' },
      config: { ...DEFAULT_CONFIG, writesEnabled: true, writeKinds: ['entra_group_member'] },
      availability: {},
      backendReachable: true,
    });
    expect(checks.find((c) => c.id === 'actuator')?.status).toBe('pass');
  });

  it('maps a degraded Fabric module to a warning, not a failure', () => {
    const checks = buildPreflight({
      env: fullEnv,
      config: DEFAULT_CONFIG,
      availability: { fabric: avail('degraded', 'T0') },
      backendReachable: true,
    });
    expect(checks.find((c) => c.id === 'fabricAdmin')?.status).toBe('warn');
  });

  it('summarises the worst status', () => {
    expect(
      overallStatus([
        { id: 'a', titleKey: 'app.name', status: 'pass' },
        { id: 'b', titleKey: 'app.name', status: 'warn' },
      ])
    ).toBe('warn');
    expect(
      overallStatus([
        { id: 'a', titleKey: 'app.name', status: 'warn' },
        { id: 'b', titleKey: 'app.name', status: 'fail' },
      ])
    ).toBe('fail');
    expect(overallStatus([{ id: 'a', titleKey: 'app.name', status: 'pass' }])).toBe('pass');
  });
});

describe('shipped defaults', () => {
  it('is incapable of changing anything on a fresh install', () => {
    expect(DEFAULT_CONFIG.writesEnabled).toBe(false);
    expect(DEFAULT_CONFIG.writeKinds).toEqual([]);
    expect(DEFAULT_CONFIG.writeScopeAllowlist).toEqual([]);
  });

  it('never sends telemetry', () => {
    expect(DEFAULT_CONFIG.telemetryEnabled).toBe(false);
  });
});
