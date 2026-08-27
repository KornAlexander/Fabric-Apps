/**
 * M-PP — Power Platform (PLAN.md §8.1, §8.5, §8.6).
 *
 * The Power Platform admin APIs (`api.bap.microsoft.com`, `Set-TenantSettings`,
 * the Dataverse Web API) are **not reachable from a browser** — CORS, and the
 * management-app registration is a server-side identity concern. So this
 * module is `declared`, not live-probed: its availability follows from whether
 * the collector notebook is configured.
 *
 * That is not a workaround, it is the honest answer. Reporting "available"
 * because a config value exists would be exactly the kind of overclaiming this
 * product refuses to do — hence `probeKind: 'declared'` shown in the UI.
 *
 * Licence position (verified, PLAN.md §8.5): this module needs **zero premium
 * licences** and works **without Managed Environments**. It drives Power
 * Platform through an unlicensed Dataverse *application user* plus admins who
 * can administer without a licence.
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

async function probe(ctx: ProbeContext): Promise<ModuleAvailability> {
  const notebookId = ctx.env.VITE_GOV_PP_COLLECTOR_NOTEBOOK_ID;
  if (!notebookId) {
    return availability('unavailable', 'T0', 'declared', {
      reasonKey: 'reason.pp.noNotebook',
    });
  }
  // Configured, but nothing in the browser can prove the server-side identity
  // works. The collector's own `gov_runs` row is the real evidence, and it is
  // read once the Governance Model exists (Track C, Phase 4).
  return availability('degraded', 'T1', 'declared', {
    reasonKey: 'reason.pp.needsCollector',
    detail: `collector=${notebookId}`,
  });
}

/**
 * There is no T0 browser path into Power Platform: the BAP admin API and the
 * Dataverse Web API are not CORS-reachable from a SPA, and the management-app
 * identity is a server-side concern.
 *
 * So this returns an explicitly empty, explicitly partial result. Rendering
 * nothing with a stated reason is the honest answer; inventing a plausible
 * placeholder would be the dishonest one.
 */
async function collect(_ctx: CollectContext): Promise<InventoryResult> {
  return emptyInventory('T0', 'partial.pp.serverSideOnly');
}

export const ppModule: GovernanceModule = {
  id: 'pp',
  nameKey: 'module.pp.name',
  descriptionKey: 'module.pp.description',
  dependsOn: ['entra'],
  bindingKinds: [
    {
      id: 'pp_env_security_group',
      module: 'pp',
      controlMode: 'preventive-auto',
      writable: true,
      reversible: true,
      description:
        'Bind an environment to an Entra security group. NOT possible for Default or Developer environments.',
    },
    {
      id: 'pp_dataverse_role',
      module: 'pp',
      controlMode: 'preventive-auto',
      writable: true,
      reversible: true,
      description:
        'Assign a Dataverse security role, preferably to an Entra group team. The supported lever for Copilot Studio agent authoring (bot / botcomponent privileges).',
    },
    {
      id: 'pp_data_policy',
      module: 'pp',
      controlMode: 'preventive-auto',
      writable: true,
      reversible: true,
      description:
        'DLP data policy. No licence prerequisite — the primary licence-free lever for the Default environment.',
    },
    {
      id: 'pp_tenant_isolation',
      module: 'pp',
      controlMode: 'preventive-auto',
      writable: true,
      reversible: true,
      description: 'Inbound/outbound tenant isolation allow-list.',
    },
    {
      id: 'pp_tenant_setting',
      module: 'pp',
      controlMode: 'preventive-auto',
      writable: true,
      reversible: true,
      description:
        'Environment-creation restrictions, disableShareWithEveryone, governance error message.',
    },
    {
      id: 'pp_managed_env',
      module: 'pp',
      controlMode: 'preventive-auto',
      writable: true,
      reversible: true,
      description:
        'Managed Environments configuration. OPTIONAL — everything above works without it, and enabling it makes premium licences a requirement for active usage.',
    },
    {
      id: 'pp_routing_rule',
      module: 'pp',
      controlMode: 'preventive-manual',
      writable: false,
      reversible: false,
      description:
        'Default-environment routing. Portal-only, and requires Managed Environments — raised as a task, never written.',
    },
  ],
  notebooks: [
    {
      role: 'collector',
      envVar: 'VITE_GOV_PP_COLLECTOR_NOTEBOOK_ID',
      description:
        'Environments, security roles, role privileges, role assignments, data policies, tenant isolation, maker and resource inventory.',
    },
  ],
  routes: [
    {
      path: '/environments',
      labelKey: 'nav.environments',
      element: () => import('./EnvironmentsPage'),
    },
    {
      path: '/default-posture',
      labelKey: 'nav.defaultPosture',
      element: () => import('./DefaultPosturePage'),
    },
  ],
  probe,
  collect,
};

export default ppModule;
