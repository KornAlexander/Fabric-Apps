/**
 * Governance context — configuration + live module availability (PLAN.md §8.2).
 *
 * One place owns "which modules are on" and "what can each of them actually
 * reach right now", so no screen has to guess. Probes run in parallel and a
 * failing probe degrades only its own module.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { getGovEnv } from '@/config/govEnv';
import type { WriteConfig } from '@/domain/writeGates';
import {
  collectInventory,
  compiledModules,
  effectiveTier,
  probeModules,
  unmetDependencies,
  type GovernanceModule,
  type MergedInventory,
  type ModuleAvailability,
  type ModuleId,
  type ReachTier,
} from '@/modules';
import {
  DEFAULT_CONFIG,
  loadConfig,
  setConfigValue,
  toWriteConfig,
  GOV_CONFIG_KEYS,
  type GovConfigKey,
  type GovConfigValues,
} from '@/services/govConfig';
import { fabricProxy, graphGet } from '@/services/udfClient';

interface GovernanceContextValue {
  config: GovConfigValues;
  modules: GovernanceModule[];
  availability: Partial<Record<ModuleId, ModuleAvailability>>;
  tier: ReachTier;
  unmet: { module: ModuleId; missing: ModuleId[] }[];
  probing: boolean;
  /** False when the app backend could not be reached (config is read-only). */
  backendReachable: boolean;
  refresh: () => Promise<void>;
  setModuleEnabled: (id: ModuleId, enabled: boolean, actor: string) => Promise<boolean>;
  /**
   * Persist one write-gate setting. Arming here changes what the **actuator**
   * will accept; it never writes to a control plane by itself, and the notebook
   * re-reads this same config server-side on every call (PLAN.md §8.7).
   */
  setWriteConfig: (
    patch: Partial<Pick<GovConfigValues, 'writesEnabled' | 'writeKinds' | 'writeScopeAllowlist'>>,
    actor: string
  ) => Promise<boolean>;
  writeConfig: WriteConfig;
  /** Browser-side T0/T1 inventory (PLAN.md §8.8). */
  inventory: MergedInventory;
  inventoryLoading: boolean;
  refreshInventory: () => Promise<void>;
}

const EMPTY_INVENTORY: MergedInventory = {
  items: [],
  byModule: {},
  partial: false,
  tier: 'T0',
  errors: [],
};

const GovernanceContext = createContext<GovernanceContextValue | null>(null);

export function GovernanceProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<GovConfigValues>(DEFAULT_CONFIG);
  const [availability, setAvailability] = useState<
    Partial<Record<ModuleId, ModuleAvailability>>
  >({});
  const [probing, setProbing] = useState(true);
  const [backendReachable, setBackendReachable] = useState(false);
  const [inventory, setInventory] = useState<MergedInventory>(EMPTY_INVENTORY);
  const [inventoryLoading, setInventoryLoading] = useState(false);

  const env = useMemo(() => getGovEnv(), []);
  const modules = useMemo(() => compiledModules(env), [env]);

  const refresh = useCallback(async () => {
    setProbing(true);
    let loaded = DEFAULT_CONFIG;
    let reachable = false;
    try {
      const result = await loadConfig();
      loaded = result.config;
      reachable = result.reachable;
    } catch {
      reachable = false;
    }
    setConfig(loaded);
    setBackendReachable(reachable);

    const results = await probeModules(
      { env, fabricProxy, graphGet },
      loaded.modulesEnabled
    );
    setAvailability(results);
    setProbing(false);
  }, [env]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshInventory = useCallback(async () => {
    setInventoryLoading(true);
    try {
      const merged = await collectInventory(
        { env, fabricProxy, graphGet },
        config.modulesEnabled
      );
      setInventory(merged);
    } catch (error) {
      // A total collection failure is itself reportable state, not a crash.
      setInventory({
        ...EMPTY_INVENTORY,
        partial: true,
        errors: [error instanceof Error ? error.message : String(error)],
      });
    } finally {
      setInventoryLoading(false);
    }
  }, [env, config.modulesEnabled]);

  const setModuleEnabled = useCallback(
    async (id: ModuleId, enabled: boolean, actor: string) => {
      const next = enabled
        ? Array.from(new Set([...config.modulesEnabled, id]))
        : config.modulesEnabled.filter((m) => m !== id);
      const ok = await setConfigValue(GOV_CONFIG_KEYS.modulesEnabled, next, actor);
      // Optimistic either way: an operator flipping a toggle must see the
      // effect immediately during a demo, even if persistence failed. The
      // Settings page surfaces the persistence failure separately.
      setConfig((c) => ({ ...c, modulesEnabled: next }));
      // Toggling a plane must visibly change the inventory too — that is the
      // demo lever, and a stale table would undercut it.
      setInventory(EMPTY_INVENTORY);
      await refresh();
      return ok;
    },
    [config.modulesEnabled, refresh]
  );

  /**
   * Persist one or more write-gate settings.
   *
   * Unlike the module toggle this is **not** optimistic on failure: an operator
   * must never see "armed" for a setting that did not reach `gov_config`,
   * because the actuator reads that table and would refuse. A UI that showed a
   * comfortable lie here is worse than one that shows an error.
   */
  const setWriteConfig = useCallback(
    async (
      patch: Partial<
        Pick<GovConfigValues, 'writesEnabled' | 'writeKinds' | 'writeScopeAllowlist'>
      >,
      actor: string
    ) => {
      const entries: [GovConfigKey, unknown][] = [];
      if (patch.writesEnabled !== undefined) {
        entries.push([GOV_CONFIG_KEYS.writesEnabled, patch.writesEnabled]);
      }
      if (patch.writeKinds !== undefined) {
        entries.push([GOV_CONFIG_KEYS.writeKinds, patch.writeKinds]);
      }
      if (patch.writeScopeAllowlist !== undefined) {
        entries.push([GOV_CONFIG_KEYS.writeScopeAllowlist, patch.writeScopeAllowlist]);
      }

      const results = await Promise.all(
        entries.map(([key, value]) => setConfigValue(key, value, actor))
      );
      const ok = results.every(Boolean);
      if (ok) setConfig((c) => ({ ...c, ...patch }));
      return ok;
    },
    []
  );

  const value = useMemo<GovernanceContextValue>(
    () => ({
      config,
      modules,
      availability,
      tier: effectiveTier(availability),
      unmet: unmetDependencies(availability, env),
      probing,
      backendReachable,
      refresh,
      setModuleEnabled,
      setWriteConfig,
      writeConfig: toWriteConfig(config),
      inventory,
      inventoryLoading,
      refreshInventory,
    }),
    [
      config,
      modules,
      availability,
      env,
      probing,
      backendReachable,
      refresh,
      setModuleEnabled,
      setWriteConfig,
      inventory,
      inventoryLoading,
      refreshInventory,
    ]
  );

  return (
    <GovernanceContext.Provider value={value}>{children}</GovernanceContext.Provider>
  );
}

export function useGovernance(): GovernanceContextValue {
  const ctx = useContext(GovernanceContext);
  if (!ctx) throw new Error('useGovernance must be used inside <GovernanceProvider>');
  return ctx;
}
