import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { DriftRow } from '@/domain/drift';
import { I18nProvider } from '@/i18n';

const drift: DriftRow[] = [
  {
    id: 'missing:1',
    driftType: 'Missing',
    severity: 'Medium',
    principalId: 'u1',
    principalName: 'Alice',
    capabilityId: 'create:PowerBIReport',
    scopeType: 'Workspace',
    scopeId: 'ws1',
    scopeName: 'Finance',
    detail: 'entitled via persona "p-report-author" but the capability is not held',
    autoRemediable: true,
  },
  {
    id: 'extra:1',
    driftType: 'Extra',
    severity: 'Critical',
    principalId: '*',
    principalName: 'Everyone',
    capabilityId: 'create:CopilotStudioAgent',
    scopeType: 'Environment',
    scopeId: 'e-default',
    scopeName: 'Default',
    detail: 'held, but no active entitlement justifies it',
    autoRemediable: false,
    path: [{ kind: 'auto-assignment', label: 'Environment Maker is auto-assigned in Default' }],
  },
];

const analysis = {
  state: 'ready' as const,
  drift,
  assignments: [{ id: 'a1' }],
  assignmentsUnavailable: false,
  failures: [],
  reload: vi.fn(),
};

vi.mock('@/hooks/useAnalysis', () => ({
  useAnalysis: () => analysis,
}));

const { DriftPage } = await import('@/pages/DriftPage');

function renderPage() {
  return render(
    <I18nProvider>
      <DriftPage />
    </I18nProvider>
  );
}

describe('Drift page', () => {
  it('shows the deliberately broken binding at its severity', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(screen.getAllByText('Medium').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/create:PowerBIReport/)).toBeInTheDocument();
  });

  it('never offers to fix Extra access automatically', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Everyone')).toBeInTheDocument());
    // The Missing row may be auto-remediable; the Extra row must say the
    // opposite, in the UI and not just in the domain layer.
    expect(screen.getByText('Never removed automatically')).toBeInTheDocument();
    expect(screen.getAllByText('Can be fixed automatically')).toHaveLength(1);
  });

  it('filters by drift type', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /^Extra/ }));
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    expect(screen.getByText('Everyone')).toBeInTheDocument();
  });

  it('explains the derivation on request', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Why?' }));
    expect(
      screen.getByText(/Environment Maker is auto-assigned in Default/)
    ).toBeInTheDocument();
  });
});
