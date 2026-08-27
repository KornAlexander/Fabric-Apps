/**
 * M-FABRIC — Fabric and Power BI (PLAN.md §8.1).
 *
 * Probe strategy is deliberately two-step and honest:
 *   T1 → `GET /v1/admin/tenantsettings` (needs Fabric Administrator)
 *   T0 → `GET /v1/workspaces`           (anything the signed-in user can see)
 * Falling back is reported as `degraded` with the reason, never as success.
 */
import {
  availability,
  emptyInventory,
  type CollectContext,
  type GovernanceModule,
  type InventoryItem,
  type InventoryResult,
  type ModuleAvailability,
  type ProbeContext,
} from '../types';

async function probe(ctx: ProbeContext): Promise<ModuleAvailability> {
  if (!ctx.env.VITE_UDF_FABRIC_PROXY_URL) {
    return availability('unavailable', 'T0', 'declared', {
      reasonKey: 'reason.fabric.noProxy',
    });
  }

  try {
    // Tenant-wide admin read. `top=1` keeps the probe cheap.
    await ctx.fabricProxy<unknown>('fabric', '/admin/tenantsettings');
    return availability('available', 'T1', 'live', { reasonKey: 'reason.ok.tenantWide' });
  } catch (adminError) {
    const detail = adminError instanceof Error ? adminError.message : String(adminError);
    try {
      await ctx.fabricProxy<unknown>('fabric', '/workspaces');
      return availability('degraded', 'T0', 'live', {
        reasonKey: 'reason.fabric.noAdmin',
        detail,
      });
    } catch (userError) {
      return availability('unavailable', 'T0', 'live', {
        reasonKey: 'reason.probeFailed',
        reasonParams: {
          detail: userError instanceof Error ? userError.message : String(userError),
        },
        detail,
      });
    }
  }
}

/**
 * How many workspaces to expand into items at T0.
 *
 * A user-scoped read has no server-side aggregation, so expanding every
 * workspace means one request each. Capping keeps the first-run experience fast
 * and is reported as partial — an honest subset beats a slow complete one.
 */
export const T0_WORKSPACE_EXPAND_LIMIT = 15;

interface FabricWorkspace {
  id?: string;
  displayName?: string;
  name?: string;
  type?: string;
  capacityId?: string;
}

interface FabricItem {
  id?: string;
  displayName?: string;
  type?: string;
  workspaceId?: string;
}

async function collect(ctx: CollectContext): Promise<InventoryResult> {
  if (!ctx.env.VITE_UDF_FABRIC_PROXY_URL) {
    return emptyInventory('T0', 'reason.fabric.noProxy');
  }

  const errors: string[] = [];
  let tier: 'T0' | 'T1' = 'T1';
  let workspaces: FabricWorkspace[] = [];

  // Prefer the tenant-wide admin list; fall back to what this user can see.
  try {
    const admin = await ctx.fabricProxy<{ workspaces?: FabricWorkspace[] }>(
      'fabric',
      '/admin/workspaces'
    );
    workspaces = admin.workspaces ?? [];
  } catch {
    tier = 'T0';
    try {
      const mine = await ctx.fabricProxy<{ value?: FabricWorkspace[] }>(
        'fabric',
        '/workspaces'
      );
      workspaces = mine.value ?? [];
    } catch (error) {
      return {
        ...emptyInventory('T0', 'reason.fabric.noAdmin'),
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  const items: InventoryItem[] = [];
  for (const ws of workspaces) {
    if (!ws.id) continue;
    items.push({
      id: ws.id,
      module: 'fabric',
      kind: 'workspace',
      name: ws.displayName ?? ws.name ?? ws.id,
      itemType: ws.type,
      detail: ws.capacityId ? `capacity=${ws.capacityId}` : undefined,
    });
  }

  const expandable = workspaces.filter((w) => w.id).slice(0, T0_WORKSPACE_EXPAND_LIMIT);
  const capped = workspaces.length > expandable.length;

  // Sequential on purpose: a burst of parallel calls against the admin APIs is
  // the fastest way to get throttled, and this runs on every page visit.
  for (const ws of expandable) {
    try {
      const res = await ctx.fabricProxy<{ value?: FabricItem[] }>(
        'fabric',
        `/workspaces/${ws.id}/items`
      );
      for (const item of res.value ?? []) {
        if (!item.id) continue;
        items.push({
          id: item.id,
          module: 'fabric',
          kind: item.type === 'OrgApp' ? 'orgApp' : 'fabricItem',
          name: item.displayName ?? item.id,
          itemType: item.type,
          scopeId: ws.id,
          scopeName: ws.displayName ?? ws.name,
        });
      }
    } catch (error) {
      // One unreadable workspace must never sink the whole inventory.
      errors.push(
        `${ws.displayName ?? ws.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const partial = tier === 'T0' || capped || errors.length > 0;
  return {
    items,
    tier,
    partial,
    partialReasonKey: capped
      ? 'partial.fabric.capped'
      : tier === 'T0'
        ? 'reason.fabric.noAdmin'
        : undefined,
    partialReasonParams: capped ? { limit: T0_WORKSPACE_EXPAND_LIMIT } : undefined,
    errors,
  };
}

export const fabricModule: GovernanceModule = {
  id: 'fabric',
  nameKey: 'module.fabric.name',
  descriptionKey: 'module.fabric.description',
  dependsOn: ['entra'],
  bindingKinds: [
    {
      id: 'fabric_workspace_role',
      module: 'fabric',
      controlMode: 'preventive-auto',
      writable: true,
      reversible: true,
      description:
        'Workspace role assignment (Viewer/Contributor/Member). POST /v1/workspaces/{id}/roleAssignments. Never Admin.',
    },
    {
      id: 'fabric_tenant_setting',
      module: 'fabric',
      controlMode: 'preventive-auto',
      writable: true,
      reversible: false,
      description:
        'Security group on a tenant setting. POST /v1/admin/tenantsettings/{name}/update — PREVIEW API, tenant-wide blast radius.',
    },
    {
      id: 'fabric_capacity_override',
      module: 'fabric',
      controlMode: 'preventive-auto',
      writable: true,
      reversible: false,
      description: 'Capacity-level tenant setting override.',
    },
    {
      id: 'fabric_item_permission',
      module: 'fabric',
      controlMode: 'detective',
      writable: false,
      reversible: false,
      description: 'Item-level share. No public write API — detective only.',
    },
    {
      id: 'orgapp_audience_member',
      module: 'fabric',
      controlMode: 'preventive-manual',
      writable: false,
      reversible: false,
      description:
        'Org App audience membership. Portal-only; the app raises a task and verifies afterwards.',
    },
  ],
  notebooks: [
    {
      role: 'collector',
      envVar: 'VITE_GOV_FABRIC_COLLECTOR_NOTEBOOK_ID',
      description:
        'Tenant settings, capacity overrides, workspaces and roles, items by type, org apps and audiences.',
    },
  ],
  routes: [
    {
      path: '/workspaces',
      labelKey: 'nav.workspaces',
      // Lazy so a disabled module costs nothing at runtime.
      element: () => import('./WorkspacesPage'),
    },
  ],
  probe,
  collect,
};

export default fabricModule;
