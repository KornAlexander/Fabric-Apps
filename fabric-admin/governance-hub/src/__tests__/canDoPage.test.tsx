import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_SNAPSHOT, type GovernanceSnapshot } from '@/domain/effective';
import { I18nProvider } from '@/i18n';

const loadSnapshot = vi.fn();
const getModelTarget = vi.fn();

vi.mock('@/services/effectiveData', () => ({
  loadSnapshot: (...args: unknown[]) => loadSnapshot(...args),
}));

vi.mock('@/services/govModel', () => ({
  getModelTarget: (...args: unknown[]) => getModelTarget(...args),
}));

vi.mock('@/hooks/GovernanceContext', () => ({
  useGovernance: () => ({ config: { modulesEnabled: ['fabric', 'pp', 'agent', 'entra'] } }),
}));

const { CanDoPage } = await import('@/pages/CanDoPage');

/** A tenant with the Default-environment problem and one governed environment. */
const tenant: GovernanceSnapshot = {
  ...EMPTY_SNAPSHOT,
  environments: [
    { environment_id: 'e-default', environment_name: 'Default', environment_type: 'Default' },
    { environment_id: 'e-coe', environment_name: 'CoE', environment_type: 'Production' },
  ],
  ppRoles: [
    { environment_id: 'e-default', role_id: 'r-maker', role_name: 'Environment Maker' },
    { environment_id: 'e-coe', role_id: 'r-agent', role_name: 'Agent Author' },
  ],
  ppPrivileges: [
    {
      environment_id: 'e-default',
      role_id: 'r-maker',
      table_logical_name: 'bot',
      privilege: 'Create',
      depth: 'User',
      gates_agent_authoring: 'true',
    },
    {
      environment_id: 'e-coe',
      role_id: 'r-agent',
      table_logical_name: 'bot',
      privilege: 'Create',
      depth: 'Organization',
      gates_agent_authoring: 'true',
    },
  ],
  ppAssignments: [
    {
      environment_id: 'e-coe',
      principal_id: 't1',
      principal_type: 'Team',
      principal_name: 'GOV-PP-ENV-CoE-AgentAuthor',
      azure_group_id: 'g-agent',
      role_id: 'r-agent',
    },
  ],
  groupMembers: [
    {
      group_id: 'g-agent',
      principal_id: 'u-marcel',
      principal_type: 'User',
      principal_name: 'Marcel',
      is_transitive: 'false',
      depth: '0',
    },
  ],
};

function renderPage(locale: 'en' | 'de' = 'en') {
  return render(
    <I18nProvider initialLocale={locale}>
      <CanDoPage />
    </I18nProvider>
  );
}

afterEach(() => {
  loadSnapshot.mockReset();
  getModelTarget.mockReset();
});

/**
 * Phase 6 exit criterion (PLAN.md §17 Track C):
 * *"'who can create Copilot Studio agents?' returns a list that matches a
 * manual PPAC check"*.
 */
describe('Can-Do Explorer', () => {
  it('answers "who can create Copilot Studio agents" out of the box', async () => {
    getModelTarget.mockReturnValue({ workspaceId: 'w', modelId: 'm' });
    loadSnapshot.mockResolvedValue({ snapshot: tenant, failures: [], emptyTables: [] });

    renderPage();

    // Both answers a manual PPAC check would give: the Default environment's
    // structural grant, and the governed environment's group team.
    // "Everyone" appears in the result row and again in the reach summary.
    await waitFor(() => expect(screen.getAllByText('Everyone').length).toBeGreaterThan(0));
    expect(screen.getByText('GOV-PP-ENV-CoE-AgentAuthor')).toBeInTheDocument();
  });

  it('drills from the group down to the actual person', async () => {
    // Since D38 the answer is held at group level and expanded on demand — a
    // tenant-wide list of 300,000 names was never usable. The promise is
    // unchanged: the question is still answerable down to the individual.
    getModelTarget.mockReturnValue({ workspaceId: 'w', modelId: 'm' });
    loadSnapshot.mockResolvedValue({ snapshot: tenant, failures: [], emptyTables: [] });

    renderPage();
    await waitFor(() =>
      expect(screen.getByText('GOV-PP-ENV-CoE-AgentAuthor')).toBeInTheDocument()
    );

    // The group says how many people it reaches, so the exposure is not hidden.
    expect(screen.getByText('1 principals')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /who exactly\?/i }));
    expect(await screen.findByText(/Marcel/)).toBeInTheDocument();
  });

  it('calls out tenant-wide exposure rather than burying it in a list', async () => {
    getModelTarget.mockReturnValue({ workspaceId: 'w', modelId: 'm' });
    loadSnapshot.mockResolvedValue({ snapshot: tenant, failures: [], emptyTables: [] });

    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/everyone in the tenant holds this/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/cannot be removed/i)).toBeInTheDocument();
  });

  it('shows the derivation path on demand', async () => {
    getModelTarget.mockReturnValue({ workspaceId: 'w', modelId: 'm' });
    loadSnapshot.mockResolvedValue({ snapshot: tenant, failures: [], emptyTables: [] });

    renderPage();
    await waitFor(() =>
      expect(screen.getByText('GOV-PP-ENV-CoE-AgentAuthor')).toBeInTheDocument()
    );

    const rows = screen.getAllByRole('button', { name: /why\?/i });
    await userEvent.click(rows[rows.length - 1]);

    expect(await screen.findByText(/Create on bot/)).toBeInTheDocument();
  });

  it('switches to the principal direction', async () => {
    getModelTarget.mockReturnValue({ workspaceId: 'w', modelId: 'm' });
    loadSnapshot.mockResolvedValue({ snapshot: tenant, failures: [], emptyTables: [] });

    renderPage();
    await waitFor(() =>
      expect(screen.getByText('GOV-PP-ENV-CoE-AgentAuthor')).toBeInTheDocument()
    );

    await userEvent.click(screen.getByRole('button', { name: /what can/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^Marcel/ }));

    // The capability id also appears in the picker and the reach summary.
    await waitFor(() =>
      expect(screen.getAllByText('create:CopilotStudioAgent').length).toBeGreaterThan(1)
    );
  });

  it('warns that a failed source makes the answer under-report access', async () => {
    getModelTarget.mockReturnValue({ workspaceId: 'w', modelId: 'm' });
    loadSnapshot.mockResolvedValue({
      snapshot: EMPTY_SNAPSHOT,
      failures: [{ table: 'gov_actual_pp_role_privileges', message: 'boom' }],
      emptyTables: [],
    });

    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/under-reports access/i)).toBeInTheDocument()
    );
  });

  it('says the model is not provisioned rather than showing an empty answer', async () => {
    getModelTarget.mockReturnValue(null);
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/governance model is not provisioned/i)).toBeInTheDocument()
    );
    expect(loadSnapshot).not.toHaveBeenCalled();
  });

  it('renders in German without falling back to English', async () => {
    getModelTarget.mockReturnValue({ workspaceId: 'w', modelId: 'm' });
    loadSnapshot.mockResolvedValue({ snapshot: tenant, failures: [], emptyTables: [] });

    renderPage('de');
    await waitFor(() =>
      expect(screen.getByText(/alle im mandanten besitzen dies/i)).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: /wer darf/i })).toBeInTheDocument();
  });
});
