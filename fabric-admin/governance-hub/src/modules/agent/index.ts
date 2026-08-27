/**
 * M-AGENT — agents across Copilot Studio, M365 Agent Builder, SharePoint,
 * Foundry and third-party platforms (PLAN.md §7, §8.1).
 *
 * The load-bearing fact: **Agent 365 governs agents after they exist; it does
 * not gate creation.** So this module is an inventory and reconciliation
 * surface, plus one genuinely preventive lever — agent identity *blueprints*,
 * which are writable on Graph v1.0 and are inherited by every current and
 * future instance of an agent class.
 *
 * Probe: the Agent 365 registry endpoints are preview and need AI
 * Administrator, so the browser check is limited to detecting whether the
 * signed-in user has any Copilot/agent licence plans. Everything else is
 * declared from the collector configuration, and the degraded fallback
 * (Dataverse `bot` table + Entra Agent ID) is reported explicitly.
 */
import {
  availability,
  emptyInventory,
  type CollectContext,
  type GovernanceModule,
  type InventoryResult,
  type ModuleAvailability,
  type ProbeContext,
} from '../types';

interface AssignedPlan {
  service?: string;
  capabilityStatus?: string;
}

/** Service-plan name fragments that indicate agent/Copilot entitlement. */
const AGENT_PLAN_HINTS = ['agent', 'copilot'];

async function probe(ctx: ProbeContext): Promise<ModuleAvailability> {
  const notebookId = ctx.env.VITE_GOV_AGENT_COLLECTOR_NOTEBOOK_ID;
  if (!notebookId) {
    return availability('unavailable', 'T0', 'declared', {
      reasonKey: 'reason.agent.noNotebook',
    });
  }

  // Best-effort licence sniff. A negative result is informative, not fatal:
  // the module still works from the Dataverse bot table and Entra Agent ID.
  try {
    const me = await ctx.graphGet<{ assignedPlans?: AssignedPlan[] }>(
      '/v1.0/me?$select=assignedPlans'
    );
    const hasAgentPlan = (me.assignedPlans ?? []).some(
      (p) =>
        p.capabilityStatus === 'Enabled' &&
        AGENT_PLAN_HINTS.some((hint) => (p.service ?? '').toLowerCase().includes(hint))
    );
    if (!hasAgentPlan) {
      return availability('degraded', 'T1', 'live', {
        reasonKey: 'reason.agent.noLicense',
        detail: `collector=${notebookId}`,
      });
    }
  } catch (error) {
    return availability('degraded', 'T1', 'declared', {
      reasonKey: 'reason.agent.needsCollector',
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  return availability('degraded', 'T1', 'declared', {
    reasonKey: 'reason.agent.needsCollector',
    detail: `collector=${notebookId}`,
  });
}

/**
 * The Agent 365 registry endpoints are preview and require AI Administrator,
 * and third-party/shadow agent discovery is server-side only — so there is no
 * meaningful T0 browser inventory for agents.
 *
 * Reported as empty and partial rather than absent, because "we cannot see
 * agents yet" is itself governance-relevant information.
 */
async function collect(_ctx: CollectContext): Promise<InventoryResult> {
  return emptyInventory('T0', 'partial.agent.serverSideOnly');
}

export const agentModule: GovernanceModule = {
  id: 'agent',
  nameKey: 'module.agent.name',
  descriptionKey: 'module.agent.description',
  dependsOn: ['entra', 'pp'],
  bindingKinds: [
    {
      id: 'agent_blueprint_membership',
      module: 'agent',
      controlMode: 'preventive-auto',
      writable: true,
      reversible: false,
      description:
        'Place an agent class under a managed blueprint so it inherits Conditional Access and capped permissions. The only preventive, class-level agent control with a v1.0 API.',
    },
    {
      id: 'agent_sponsor',
      module: 'agent',
      controlMode: 'preventive-auto',
      writable: true,
      reversible: true,
      description:
        'Agent sponsor reconciliation. Every agent identity requires a human sponsor; sponsorship auto-transfers to the manager when a sponsor leaves.',
    },
    {
      id: 'a365_registry_action',
      module: 'agent',
      controlMode: 'preventive-manual',
      writable: false,
      reversible: false,
      description:
        'Block / Unblock / Delete / Reassign in the Agent 365 registry. Graph coverage is list+get only — these are UI-only, so the app raises a deep-linked task and verifies afterwards.',
    },
    {
      id: 'm365_agent_access',
      module: 'agent',
      controlMode: 'preventive-manual',
      writable: false,
      reversible: false,
      description:
        'M365 Copilot agent access setting (All / None / Specific groups). Admin-center only, no documented API.',
    },
  ],
  notebooks: [
    {
      role: 'collector',
      envVar: 'VITE_GOV_AGENT_COLLECTOR_NOTEBOOK_ID',
      description:
        'Agent 365 registry, Entra Agent ID, blueprints, sponsors, risk flags; Dataverse bot table as the degraded fallback.',
    },
  ],
  routes: [
    {
      path: '/agents',
      labelKey: 'nav.agents',
      element: () => import('./AgentsPage'),
    },
  ],
  probe,
  collect,
};

export default agentModule;
