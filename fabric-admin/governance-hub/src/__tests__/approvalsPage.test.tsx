import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_SNAPSHOT } from '@/domain/effective';
import { SEED_PERSONAS } from '@/domain/personas';
import type { AccessRequest } from '@/domain/requests';
import { I18nProvider } from '@/i18n';

const loadRequests = vi.fn();
const approveRequest = vi.fn();
const denyRequest = vi.fn();
const verifyAndClose = vi.fn();

let approverEmails = ['approver@example.com'];
let currentUser = { email: 'approver@example.com', name: 'Approver' };

vi.mock('@/services/requests', () => ({
  loadRequests: () => loadRequests(),
}));
vi.mock('@/services/approvals', () => ({
  approveRequest: (...args: unknown[]) => approveRequest(...args),
  denyRequest: (...args: unknown[]) => denyRequest(...args),
  verifyAndClose: (...args: unknown[]) => verifyAndClose(...args),
}));
vi.mock('@/hooks/AuthContext', () => ({
  useAuth: () => ({ user: currentUser }),
}));
vi.mock('@/hooks/GovernanceContext', () => ({
  useGovernance: () => ({
    config: {
      modulesEnabled: ['fabric', 'pp', 'entra', 'agent'],
      approverEmails,
    },
  }),
}));
vi.mock('@/hooks/useAnalysis', () => ({
  useAnalysis: () => ({
    personas: SEED_PERSONAS,
    snapshot: EMPTY_SNAPSHOT,
    reload: vi.fn(),
  }),
}));

const { ApprovalsPage } = await import('@/pages/ApprovalsPage');

const pending: AccessRequest = {
  id: 'r1',
  requesterId: 'marcel@example.com',
  requesterName: 'Marcel',
  personaId: 'report-author',
  scopeType: 'Workspace',
  scopeId: 'ws-finance',
  scopeName: 'Finance',
  justification: 'Quarterly close reporting.',
  status: 'Pending',
  createdAt: '2026-08-01T09:00:00Z',
};

function renderPage(locale: 'en' | 'de' = 'en') {
  return render(
    <I18nProvider initialLocale={locale}>
      <ApprovalsPage />
    </I18nProvider>
  );
}

beforeEach(() => {
  loadRequests.mockReset().mockResolvedValue({ requests: [pending], backendReachable: true });
  approveRequest.mockReset().mockResolvedValue({
    ok: true,
    status: 'Approved',
    planned: [],
    outcomes: [{ bindingKind: 'entra_group_member', scopeId: 'ws-finance', ok: true }],
    assignmentId: 'a1',
  });
  denyRequest.mockReset().mockResolvedValue(true);
  verifyAndClose.mockReset().mockResolvedValue({ verified: true, missing: [], status: 'Verified' });
  approverEmails = ['approver@example.com'];
  currentUser = { email: 'approver@example.com', name: 'Approver' };
});

describe('Approvals queue', () => {
  it('shows what approving will actually write, before the decision', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Marcel')).toBeInTheDocument());

    expect(screen.getByText('Approving will write:')).toBeInTheDocument();
    // The compiled bindings, not just a persona name.
    expect(screen.getAllByText(/entra_group_member|fabric_workspace_role/).length).toBeGreaterThan(
      0
    );
  });

  it('approves and reports how many bindings landed', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Approve')).toBeInTheDocument());

    await user.click(screen.getByText('Approve'));

    await waitFor(() => expect(approveRequest).toHaveBeenCalledTimes(1));
    expect(approveRequest.mock.calls[0][0]).toMatchObject({
      principalId: 'marcel@example.com',
      actor: { actorId: 'approver@example.com', isApprover: true },
    });
    expect(await screen.findByText(/1 bindings applied/)).toBeInTheDocument();
  });

  it('shows the gate that refused instead of a generic failure', async () => {
    approveRequest.mockResolvedValue({
      ok: false,
      status: 'Failed',
      planned: [],
      outcomes: [
        {
          bindingKind: 'fabric_workspace_role',
          scopeId: 'ws-finance',
          ok: false,
          error: 'gate:dryRun',
        },
      ],
    });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Approve')).toBeInTheDocument());

    await user.click(screen.getByText('Approve'));

    expect(await screen.findByText(/gate:dryRun/)).toBeInTheDocument();
  });

  it('blocks self-approval in the UI, with the reason', async () => {
    // The service refuses it too; this is the operator-facing half.
    currentUser = { email: 'marcel@example.com', name: 'Marcel' };
    approverEmails = ['marcel@example.com'];
    renderPage();

    await waitFor(() => expect(screen.getByText('Approve')).toBeDisabled());
    expect(screen.getByText(/cannot decide your own request/)).toBeInTheDocument();
  });

  it('tells a non-approver they may read but not decide', async () => {
    currentUser = { email: 'bystander@example.com', name: 'Bystander' };
    renderPage();

    await waitFor(() =>
      expect(screen.getAllByText(/not on the approver list/).length).toBeGreaterThan(0)
    );
    expect(screen.getByText('Approve')).toBeDisabled();
  });

  it('verifies an approved request and closes the loop', async () => {
    loadRequests.mockResolvedValue({
      requests: [{ ...pending, id: 'r2', status: 'Approved' }],
      backendReachable: true,
    });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText('Verify')).toBeInTheDocument());
    await user.click(screen.getByText('Verify'));

    await waitFor(() => expect(verifyAndClose).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/drift row is closed/)).toBeInTheDocument();
  });

  it('says plainly when a verified write is not in effect yet', async () => {
    loadRequests.mockResolvedValue({
      requests: [{ ...pending, id: 'r2', status: 'Approved' }],
      backendReachable: true,
    });
    verifyAndClose.mockResolvedValue({
      verified: false,
      missing: ['create:FabricItem'],
      status: 'Failed',
    });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText('Verify')).toBeInTheDocument());
    await user.click(screen.getByText('Verify'));

    expect(await screen.findByText(/create:FabricItem/)).toBeInTheDocument();
  });

  it('renders in German', async () => {
    renderPage('de');
    await waitFor(() => expect(screen.getByText('Genehmigungen')).toBeInTheDocument());
    expect(screen.getByText('Genehmigen')).toBeInTheDocument();
  });
});
