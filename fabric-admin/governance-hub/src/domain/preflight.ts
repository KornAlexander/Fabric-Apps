/**
 * Pre-flight checks (PLAN.md §8.4).
 *
 * Pure derivation from configuration + probe results, so it is unit-testable
 * and so the Setup page has no logic of its own. The checks are deliberately
 * pessimistic: anything unproven is reported as `unknown`, never as `pass`.
 */
import type { PreflightCheck } from '@/components/CheckRow';
import type { GovEnv } from '@/config/govEnv';
import type { ModuleAvailability, ModuleId } from '@/modules/types';
import type { GovConfigValues } from '@/services/govConfig';

export interface PreflightInput {
  env: Readonly<GovEnv>;
  config: GovConfigValues;
  availability: Partial<Record<ModuleId, ModuleAvailability>>;
  backendReachable: boolean;
}

/**
 * The one step a service principal can never perform for you. Kept verbatim so
 * it can be pasted straight into an elevated PowerShell session.
 */
export const PP_MANAGEMENT_APP_COMMAND =
  'New-PowerAppManagementApp -ApplicationId <your-app-registration-client-id>';

export function buildPreflight(input: PreflightInput): PreflightCheck[] {
  const { env, config, availability, backendReachable } = input;
  const checks: PreflightCheck[] = [];

  checks.push({
    id: 'rayfin',
    titleKey: 'check.rayfin.title',
    status: backendReachable ? 'pass' : 'warn',
    fixKey: 'check.rayfin.fix',
  });

  checks.push({
    id: 'udf',
    titleKey: 'check.udf.title',
    status: env.VITE_UDF_FABRIC_PROXY_URL ? 'pass' : 'fail',
    fixKey: 'check.udf.fix',
  });

  const fabric = availability.fabric;
  checks.push({
    id: 'fabricAdmin',
    titleKey: 'check.fabricAdmin.title',
    status:
      fabric?.status === 'available'
        ? 'pass'
        : fabric?.status === 'degraded'
          ? 'warn'
          : fabric?.status === 'disabled'
            ? 'unknown'
            : 'fail',
    fixKey: 'check.fabricAdmin.fix',
    detail: fabric?.detail,
  });

  const entra = availability.entra;
  checks.push({
    id: 'graph',
    titleKey: 'check.graph.title',
    status:
      entra?.status === 'available'
        ? 'pass'
        : entra?.status === 'degraded'
          ? 'warn'
          : entra?.status === 'disabled'
            ? 'unknown'
            : 'fail',
    fixKey: 'check.graph.fix',
    detail: entra?.detail,
  });

  // Nothing in the browser can prove the Power Platform management app is
  // registered, and a service principal cannot register itself — so this stays
  // `unknown` until the collector reports back. Claiming `pass` here would be
  // exactly the kind of overclaiming this product refuses to do.
  checks.push({
    id: 'ppManagementApp',
    titleKey: 'check.ppManagementApp.title',
    status: env.VITE_GOV_PP_COLLECTOR_NOTEBOOK_ID ? 'unknown' : 'fail',
    fixKey: 'check.ppManagementApp.fix',
    command: PP_MANAGEMENT_APP_COMMAND,
    needsHuman: true,
  });

  checks.push({
    id: 'lakehouse',
    titleKey: 'check.lakehouse.title',
    status: env.VITE_GOV_MODEL_ID ? 'pass' : 'fail',
    fixKey: 'check.lakehouse.fix',
  });

  const agent = availability.agent;
  checks.push({
    id: 'agent365',
    titleKey: 'check.agent365.title',
    status:
      agent?.status === 'available'
        ? 'pass'
        : agent?.status === 'disabled'
          ? 'unknown'
          : 'warn',
    fixKey: 'check.agent365.fix',
    detail: agent?.detail,
  });

  // A disarmed deployment is the *desired* state, so this is a pass, not a
  // warning. Armed writes are the thing worth drawing attention to.
  const armed = config.writesEnabled && config.writeKinds.length > 0;
  checks.push({
    id: 'writesDisarmed',
    titleKey: 'check.writesDisarmed.title',
    status: armed ? 'warn' : 'pass',
    fixKey: 'check.writesDisarmed.fix',
    detail: armed
      ? `kinds=${config.writeKinds.join(',')} scopes=${config.writeScopeAllowlist.join(',') || 'none'}`
      : undefined,
  });

  // The actuator is the *only* write path. Missing it is a pass while writes
  // are disarmed — nothing is trying to write — but it becomes a hard failure
  // the moment somebody arms a kind, because every attempt will then fail at
  // the transport rather than at a gate, which reads like a bug.
  checks.push({
    id: 'actuator',
    titleKey: 'check.actuator.title',
    status: env.VITE_GOV_ACTUATOR_NOTEBOOK_ID ? 'pass' : armed ? 'fail' : 'unknown',
    fixKey: 'check.actuator.fix',
  });

  return checks;
}

/** Worst status present — drives the page-level summary. */
export function overallStatus(checks: PreflightCheck[]): 'pass' | 'warn' | 'fail' {
  if (checks.some((c) => c.status === 'fail')) return 'fail';
  if (checks.some((c) => c.status === 'warn' || c.status === 'unknown')) return 'warn';
  return 'pass';
}
