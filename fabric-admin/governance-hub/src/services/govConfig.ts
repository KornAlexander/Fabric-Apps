/**
 * Typed access to the `gov_config` store (PLAN.md §12.1, §8.2, §8.7).
 *
 * Configuration is key/value so that new modules and new binding kinds never
 * require a schema migration. Values are JSON-encoded, so a boolean and the
 * string `"true"` stay distinguishable.
 *
 * **Defaults are deliberately conservative.** A fresh install has every write
 * disarmed, an empty scope allow-list and telemetry off. A new deployment must
 * be incapable of changing anything until a human arms it (PLAN.md §19).
 */
import type { WriteConfig } from '@/domain/writeGates';
import { MODULE_IDS, type ModuleId } from '@/modules/types';

import { getRayfinClient } from './rayfinClient';

export const GOV_CONFIG_KEYS = {
  modulesEnabled: 'modules.enabled',
  writesEnabled: 'writes.enabled',
  writeKinds: 'writes.kinds',
  writeScopeAllowlist: 'writes.scopeAllowlist',
  localeDefault: 'locale.default',
  approverEmails: 'approvers.emails',
  telemetryEnabled: 'telemetry.enabled',
} as const;

export type GovConfigKey = (typeof GOV_CONFIG_KEYS)[keyof typeof GOV_CONFIG_KEYS];

export interface GovConfigValues {
  modulesEnabled: ModuleId[];
  writesEnabled: boolean;
  writeKinds: string[];
  writeScopeAllowlist: string[];
  localeDefault: 'en' | 'de';
  approverEmails: string[];
  telemetryEnabled: false;
}

/** Safe, ship-with defaults. Everything that can change a tenant is off. */
export const DEFAULT_CONFIG: GovConfigValues = {
  modulesEnabled: [...MODULE_IDS],
  writesEnabled: false,
  writeKinds: [],
  writeScopeAllowlist: [],
  localeDefault: 'en',
  approverEmails: [],
  telemetryEnabled: false,
};

interface GovConfigRow {
  id: string;
  config_key: string;
  config_value: string;
  user_editable: boolean;
  updated_by: string;
  updated_at: Date;
  note?: string;
}

type Db = ReturnType<typeof getRayfinClient>['data'];
function rows(): Db['GovConfig'] {
  return getRayfinClient().data.GovConfig;
}

function decode<T>(raw: string | undefined, fallback: T): T {
  if (raw === undefined) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isModuleId(value: string): value is ModuleId {
  return (MODULE_IDS as readonly string[]).includes(value);
}

export interface LoadConfigResult {
  config: GovConfigValues;
  /**
   * False when the app backend could not be read at all.
   *
   * This has to be reported rather than swallowed: falling back to defaults is
   * the right *behaviour*, but if the caller cannot tell the difference between
   * "defaults because that is what is stored" and "defaults because nothing
   * could be read", the Setup pre-flight claims the backend is reachable when
   * it is not, and Settings offers toggles that cannot persist.
   */
  reachable: boolean;
}

/** Read the whole configuration, falling back to defaults per key. */
export async function loadConfig(): Promise<LoadConfigResult> {
  let all: GovConfigRow[] = [];
  try {
    all = (await rows().findMany({})) as GovConfigRow[];
  } catch {
    // Backend not reachable yet (fresh deployment, or T0 without the data
    // service). Defaults are correct and safe — and the caller is told.
    return { config: { ...DEFAULT_CONFIG }, reachable: false };
  }

  const byKey = new Map(all.map((r) => [r.config_key, r.config_value]));
  const modules = decode<string[]>(
    byKey.get(GOV_CONFIG_KEYS.modulesEnabled),
    DEFAULT_CONFIG.modulesEnabled
  ).filter(isModuleId);

  const locale = decode<string>(
    byKey.get(GOV_CONFIG_KEYS.localeDefault),
    DEFAULT_CONFIG.localeDefault
  );

  return {
    config: {
      modulesEnabled: modules,
      writesEnabled: decode(byKey.get(GOV_CONFIG_KEYS.writesEnabled), false),
      writeKinds: decode<string[]>(byKey.get(GOV_CONFIG_KEYS.writeKinds), []),
      writeScopeAllowlist: decode<string[]>(
        byKey.get(GOV_CONFIG_KEYS.writeScopeAllowlist),
        []
      ),
      localeDefault: locale === 'de' ? 'de' : 'en',
      approverEmails: decode<string[]>(byKey.get(GOV_CONFIG_KEYS.approverEmails), []),
      // Telemetry is not a setting a deployment can turn on. It exists as a key
      // purely so that "we send nothing" is auditable rather than asserted.
      telemetryEnabled: false,
    },
    reachable: true,
  };
}

/** Upsert a single key. Returns false when the backend is unreachable. */
export async function setConfigValue(
  key: GovConfigKey,
  value: unknown,
  updatedBy: string,
  note?: string
): Promise<boolean> {
  const config_value = JSON.stringify(value);
  try {
    const existing = (await rows().findMany({
      config_key: { eq: key },
    })) as GovConfigRow[];

    if (existing.length > 0) {
      await rows().update(
        { id: existing[0].id },
        { config_value, updated_by: updatedBy, updated_at: new Date(), note }
      );
    } else {
      await rows().create({
        config_key: key,
        config_value,
        user_editable: true,
        updated_by: updatedBy,
        updated_at: new Date(),
        note,
      });
    }
    return true;
  } catch {
    return false;
  }
}

/** Project the configuration onto the shape the write gates expect. */
export function toWriteConfig(config: GovConfigValues): WriteConfig {
  return {
    writesEnabled: config.writesEnabled,
    armedKinds: config.writeKinds,
    scopeAllowlist: config.writeScopeAllowlist,
    enabledModules: config.modulesEnabled,
  };
}
