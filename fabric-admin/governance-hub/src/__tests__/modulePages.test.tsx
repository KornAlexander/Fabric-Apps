import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/i18n';

const queryTable = vi.fn();
const getModelTarget = vi.fn();

vi.mock('@/services/govModel', () => ({
  queryTable: (...args: unknown[]) => queryTable(...args),
  getModelTarget: (...args: unknown[]) => getModelTarget(...args),
}));

const { AgentsPage } = await import('@/modules/agent/AgentsPage');
const { EnvironmentsPage } = await import('@/modules/pp/EnvironmentsPage');

function renderPage(node: React.ReactElement, locale: 'en' | 'de' = 'en') {
  return render(<I18nProvider initialLocale={locale}>{node}</I18nProvider>);
}

afterEach(() => {
  queryTable.mockReset();
  getModelTarget.mockReset();
});

/**
 * Phase 4 exit criterion (PLAN.md §17 Track C):
 * *"app renders live inventory through Fabric SSO with any module subset"*.
 *
 * The three states below are the honesty contract. "Nothing here" and "we
 * cannot see" look identical in a table and mean completely different things to
 * someone deciding whether their tenant is governed.
 */
describe('module pages over the Governance Model', () => {
  it('says the model is not provisioned rather than showing an empty table', async () => {
    getModelTarget.mockReturnValue(null);
    renderPage(<AgentsPage />);
    await waitFor(() =>
      expect(screen.getByText(/governance model is not provisioned/i)).toBeInTheDocument()
    );
    expect(queryTable).not.toHaveBeenCalled();
  });

  it('distinguishes "collector has not run" from "nothing is there"', async () => {
    getModelTarget.mockReturnValue({ workspaceId: 'w', modelId: 'm' });
    queryTable.mockResolvedValue([]);
    renderPage(<AgentsPage />);
    await waitFor(() =>
      expect(screen.getByText(/collector has not run/i)).toBeInTheDocument()
    );
  });

  it('surfaces a query failure instead of rendering as empty', async () => {
    getModelTarget.mockReturnValue({ workspaceId: 'w', modelId: 'm' });
    queryTable.mockRejectedValue(new Error('DAX blew up'));
    renderPage(<AgentsPage />);
    await waitFor(() =>
      expect(screen.getByText(/model query failed/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/DAX blew up/)).toBeInTheDocument();
  });

  it('renders agents and flags shadow and ownerless ones', async () => {
    getModelTarget.mockReturnValue({ workspaceId: 'w', modelId: 'm' });
    queryTable.mockResolvedValue([
      {
        agent_id: 'a1',
        name: 'Sales Agent',
        platform: 'CopilotStudio',
        state: 'Published',
        owner_principal: 'user-1',
        sponsor_principal: 'sponsor-1',
        is_shadow: 'false',
        is_ownerless: 'false',
      },
      {
        agent_id: 'a2',
        name: 'Rogue Agent',
        platform: 'ThirdParty',
        state: 'Published',
        owner_principal: '',
        sponsor_principal: '',
        is_shadow: 'true',
        is_ownerless: 'true',
      },
    ]);

    renderPage(<AgentsPage />);
    await waitFor(() => expect(screen.getByText('Sales Agent')).toBeInTheDocument());
    expect(screen.getByText('Rogue Agent')).toBeInTheDocument();
    expect(screen.getByText('shadow · ownerless')).toBeInTheDocument();
    // And the standing caveat must always be on the page.
    expect(screen.getByText(/does not gate creation/i)).toBeInTheDocument();
  });

  it('distinguishes "not bound" from "cannot be bound" for environments', async () => {
    getModelTarget.mockReturnValue({ workspaceId: 'w', modelId: 'm' });
    queryTable.mockResolvedValue([
      {
        environment_id: 'e1',
        environment_name: 'Default',
        environment_type: 'Default',
        security_group_assignable: 'false',
        security_group_bound: 'false',
        is_managed_env: 'false',
        region: 'europe',
      },
      {
        environment_id: 'e2',
        environment_name: 'Prod',
        environment_type: 'Production',
        security_group_assignable: 'true',
        security_group_bound: 'false',
        is_managed_env: 'false',
        region: 'europe',
      },
    ]);

    renderPage(<EnvironmentsPage />);
    // "Default" appears more than once by design: as the environment name, as
    // its type, and again in the structural-hole callout below the table.
    await waitFor(() =>
      expect(screen.getAllByText('Default').length).toBeGreaterThanOrEqual(2)
    );
    expect(screen.getByText('Prod')).toBeInTheDocument();

    // The Default environment is a structural fact, not a misconfiguration.
    expect(screen.getByText('Not possible')).toBeInTheDocument();
    expect(screen.getByText('Not bound')).toBeInTheDocument();
    expect(
      screen.getByText(/cannot be secured with a group/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/no supported way to remove environment maker/i)).toBeInTheDocument();
  });

  it('renders in German without falling back to English', async () => {
    getModelTarget.mockReturnValue(null);
    renderPage(<EnvironmentsPage />, 'de');
    await waitFor(() =>
      expect(screen.getByText(/noch nicht bereitgestellt/i)).toBeInTheDocument()
    );
    expect(screen.getByText('Umgebungen')).toBeInTheDocument();
  });
});
