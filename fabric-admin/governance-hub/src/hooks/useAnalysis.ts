/**
 * One load, one computation, shared by the analysis pages (PLAN.md §13).
 *
 * Drift, policies and the Default-environment posture all need the same
 * expensive inputs — the snapshot, the effective grants, the personas and the
 * assignments. Loading them per page would triple the queries and let the three
 * views disagree with each other, which is worse than being slow.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getGovEnv } from '@/config/govEnv';
import { computeDrift, personaCompileDrift, type Assignment, type DriftRow } from '@/domain/drift';
import {
  EMPTY_SNAPSHOT,
  computeEffectiveGrants,
  grantsForPrincipal,
  type EffectiveGrant,
  type GovernanceSnapshot,
} from '@/domain/effective';
import {
  evaluatePolicies,
  scoreDefaultPosture,
  type DefaultPosture,
  type PolicyContext,
  type PolicyFinding,
} from '@/domain/policies';
import { SEED_PERSONAS, type Persona } from '@/domain/personas';
import { useGovernance } from '@/hooks/GovernanceContext';
import { loadAssignments } from '@/services/assignments';
import { loadSnapshot } from '@/services/effectiveData';
import { getModelTarget, queryTable } from '@/services/govModel';
import { loadPersonas } from '@/services/personas';

export type AnalysisState = 'loading' | 'no-model' | 'ready';

export interface Analysis {
  state: AnalysisState;
  snapshot: GovernanceSnapshot;
  grants: EffectiveGrant[];
  drift: DriftRow[];
  findings: PolicyFinding[];
  posture: DefaultPosture;
  personas: Persona[];
  assignments: Assignment[];
  /** True when the entitlement store could not be read at all. */
  assignmentsUnavailable: boolean;
  failures: { table: string; message: string }[];
  reload: () => void;
}

export function useAnalysis(): Analysis {
  const { config } = useGovernance();
  const [state, setState] = useState<AnalysisState>('loading');
  const [snapshot, setSnapshot] = useState<GovernanceSnapshot>(EMPTY_SNAPSHOT);
  const [dlp, setDlp] = useState<Record<string, string>[]>([]);
  const [ppTenantSettings, setPpTenantSettings] = useState<Record<string, string>[]>([]);
  const [agents, setAgents] = useState<Record<string, string>[]>([]);
  const [personas, setPersonas] = useState<Persona[]>(SEED_PERSONAS);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [assignmentsUnavailable, setAssignmentsUnavailable] = useState(false);
  const [failures, setFailures] = useState<{ table: string; message: string }[]>([]);
  const [nonce, setNonce] = useState(0);

  const target = useMemo(() => getModelTarget(getGovEnv()), []);
  const modulesKey = config.modulesEnabled.join(',');

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const enabled = modulesKey ? modulesKey.split(',') : [];
      const [personaResult, assignmentResult] = await Promise.all([
        loadPersonas(),
        loadAssignments(),
      ]);
      if (cancelled) return;
      setPersonas(personaResult.personas);
      setAssignments(assignmentResult.assignments);
      setAssignmentsUnavailable(!assignmentResult.backendReachable);

      if (!target) {
        setState('no-model');
        return;
      }

      setState('loading');
      const loaded = await loadSnapshot(target, enabled);
      if (cancelled) return;
      setSnapshot(loaded.snapshot);
      setFailures(loaded.failures);

      // Tables the effective engine does not need but the policies do. Failures
      // here are non-fatal: the affected rules simply find nothing.
      const extras = await Promise.allSettled([
        enabled.includes('pp')
          ? queryTable(target, 'gov_actual_pp_dlp', { topN: 2000 })
          : Promise.resolve([]),
        enabled.includes('pp')
          ? queryTable(target, 'gov_actual_pp_tenant_settings', { topN: 200 })
          : Promise.resolve([]),
        enabled.includes('agent')
          ? queryTable(target, 'gov_actual_agents', { topN: 5000 })
          : Promise.resolve([]),
      ]);
      if (cancelled) return;
      setDlp(extras[0].status === 'fulfilled' ? extras[0].value : []);
      setPpTenantSettings(extras[1].status === 'fulfilled' ? extras[1].value : []);
      setAgents(extras[2].status === 'fulfilled' ? extras[2].value : []);
      setState('ready');
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [target, modulesKey, nonce]);

  const grants = useMemo(
    () => computeEffectiveGrants(snapshot, { enabledModules: config.modulesEnabled }),
    [snapshot, config.modulesEnabled]
  );

  /**
   * Grants as the drift engine needs to see them (PLAN.md D38).
   *
   * `grants` are holder-level, so an entitlement for a person whose access comes
   * through a group would otherwise read as `Missing`. Expansion is done only
   * for the principals that actually have an entitlement — a handful of lookups
   * rather than the tenant-wide fan-out that cost 2.1 million objects.
   *
   * Holder rows are kept as well: unjustified access held by a *group* is a
   * finding worth naming, and naming the group is more actionable than naming
   * each of its members.
   */
  const driftGrants = useMemo(() => {
    const principalIds = [...new Set(assignments.map((a) => a.principalId))];
    const expanded = principalIds.flatMap((id) =>
      grantsForPrincipal(grants, id, snapshot).filter((g) => g.principalId === id)
    );
    return [...grants, ...expanded];
  }, [grants, assignments, snapshot]);

  const drift = useMemo(
    () => [
      ...computeDrift({ assignments, personas, grants: driftGrants }),
      ...personaCompileDrift(personas, config.modulesEnabled),
    ],
    [assignments, personas, driftGrants, config.modulesEnabled]
  );

  const policyContext = useMemo<PolicyContext>(
    () => ({
      snapshot,
      grants,
      drift,
      personas,
      dlp,
      ppTenantSettings,
      agents,
      writesArmed: {
        kinds: config.writeKinds,
        scopes: config.writeScopeAllowlist,
      },
    }),
    [snapshot, grants, drift, personas, dlp, ppTenantSettings, agents, config]
  );

  const findings = useMemo(() => evaluatePolicies(policyContext), [policyContext]);
  const posture = useMemo(() => scoreDefaultPosture(policyContext), [policyContext]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return {
    state,
    snapshot,
    grants,
    drift,
    findings,
    posture,
    personas,
    assignments,
    assignmentsUnavailable,
    failures,
    reload,
  };
}
