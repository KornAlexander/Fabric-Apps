/**
 * M-ENTRA — Entra ID (PLAN.md §8.1).
 *
 * Entra is the compiler's target instruction set: security groups are the one
 * currency every other plane accepts. The app should say so at setup rather
 * than silently degrading, so a missing Entra module is reported loudly.
 *
 * Probe: `/v1.0/groups?$top=1` (needs directory read) → T1;
 *        `/v1.0/me/memberOf?$top=1` (always available) → T0 degraded.
 */
import {
  availability,
  type CollectContext,
  type GovernanceModule,
  type InventoryItem,
  type InventoryResult,
  type ModuleAvailability,
  type ProbeContext,
} from '../types';

async function probe(ctx: ProbeContext): Promise<ModuleAvailability> {
  try {
    await ctx.graphGet<unknown>('/v1.0/groups?$top=1&$select=id');
    return availability('available', 'T1', 'live', { reasonKey: 'reason.ok.tenantWide' });
  } catch (directoryError) {
    const detail =
      directoryError instanceof Error ? directoryError.message : String(directoryError);
    try {
      await ctx.graphGet<unknown>('/v1.0/me/memberOf?$top=1&$select=id');
      return availability('degraded', 'T0', 'live', {
        reasonKey: 'reason.entra.noGraphConsent',
        detail,
      });
    } catch (tokenError) {
      return availability('unavailable', 'T0', 'live', {
        reasonKey: 'reason.entra.noToken',
        detail: tokenError instanceof Error ? tokenError.message : String(tokenError),
      });
    }
  }
}

/** Page size for the directory read. Deliberately modest at first run. */
export const GROUP_PAGE_SIZE = 100;

interface GraphGroup {
  id?: string;
  displayName?: string;
  mailNickname?: string;
  securityEnabled?: boolean;
  '@odata.type'?: string;
}

async function collect(ctx: CollectContext): Promise<InventoryResult> {
  const toItem = (g: GraphGroup): InventoryItem | null =>
    g.id
      ? {
          id: g.id,
          module: 'entra',
          kind: 'group',
          name: g.displayName ?? g.id,
          itemType: g.securityEnabled === false ? 'Distribution' : 'Security',
          detail: g.mailNickname,
        }
      : null;

  // T1: the whole directory.
  try {
    const res = await ctx.graphGet<{ value?: GraphGroup[]; '@odata.nextLink'?: string }>(
      `/v1.0/groups?$top=${GROUP_PAGE_SIZE}&$select=id,displayName,mailNickname,securityEnabled`
    );
    const items = (res.value ?? []).map(toItem).filter((i): i is InventoryItem => !!i);
    const more = Boolean(res['@odata.nextLink']);
    return {
      items,
      tier: 'T1',
      partial: more,
      partialReasonKey: more ? 'partial.entra.firstPage' : undefined,
      errors: [],
    };
  } catch (directoryError) {
    // T0: only the groups this user belongs to. Genuinely useful — those are
    // the groups their own entitlements would compile onto.
    try {
      const res = await ctx.graphGet<{ value?: GraphGroup[] }>(
        `/v1.0/me/memberOf?$top=${GROUP_PAGE_SIZE}&$select=id,displayName,mailNickname,securityEnabled`
      );
      const groups = (res.value ?? []).filter(
        (g) => !g['@odata.type'] || g['@odata.type'].includes('group')
      );
      return {
        items: groups.map(toItem).filter((i): i is InventoryItem => !!i),
        tier: 'T0',
        partial: true,
        partialReasonKey: 'partial.entra.ownMembershipOnly',
        errors: [],
      };
    } catch (tokenError) {
      return {
        items: [],
        tier: 'T0',
        partial: true,
        partialReasonKey: 'reason.entra.noToken',
        errors: [
          directoryError instanceof Error ? directoryError.message : String(directoryError),
          tokenError instanceof Error ? tokenError.message : String(tokenError),
        ],
      };
    }
  }
}

export const entraModule: GovernanceModule = {
  id: 'entra',
  nameKey: 'module.entra.name',
  descriptionKey: 'module.entra.description',
  dependsOn: [],
  bindingKinds: [
    {
      id: 'entra_group_member',
      module: 'entra',
      controlMode: 'preventive-auto',
      writable: true,
      reversible: true,
      description:
        'Group membership. POST /groups/{id}/members/$ref. The safest, most reversible write in the whole system — armed first.',
    },
    {
      id: 'entra_license_group',
      module: 'entra',
      controlMode: 'preventive-auto',
      writable: true,
      reversible: true,
      description: 'Group-based licensing assignment.',
    },
    {
      id: 'entra_agent_blueprint',
      module: 'entra',
      controlMode: 'preventive-auto',
      writable: true,
      reversible: false,
      description:
        'Agent identity blueprint (Graph v1.0). Class-level governance — every current and future agent instance inherits it.',
    },
    {
      id: 'entra_access_package',
      module: 'entra',
      controlMode: 'preventive-auto',
      writable: true,
      reversible: true,
      description: 'Entitlement-management access package assignment, incl. for agents.',
    },
  ],
  notebooks: [
    {
      role: 'collector',
      envVar: 'VITE_GOV_ENTRA_COLLECTOR_NOTEBOOK_ID',
      description: 'Groups, transitive membership, group-based licensing.',
    },
  ],
  routes: [
    {
      path: '/groups',
      labelKey: 'nav.groups',
      element: () => import('./GroupsPage'),
    },
  ],
  probe,
  collect,
};

export default entraModule;
