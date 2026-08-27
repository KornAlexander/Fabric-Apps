import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GovernanceTask } from '@/domain/tasks';
import { I18nProvider } from '@/i18n';

const loadTasks = vi.fn();
const updateTask = vi.fn();

vi.mock('@/services/tasks', () => ({
  loadTasks: () => loadTasks(),
  updateTask: (...args: unknown[]) => updateTask(...args),
}));
vi.mock('@/hooks/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'operator@example.com', name: 'Operator' } }),
}));

const { TasksPage } = await import('@/pages/TasksPage');

const attestationTask: GovernanceTask = {
  id: 't1',
  source: 'Request',
  bindingKind: 'orgapp_audience_member',
  module: 'fabric',
  detail: 'Marcel needs orgapp_audience_member in Audience "Finance app"',
  scopeType: 'Audience',
  scopeId: 'aud1',
  scopeName: 'Finance app',
  status: 'Open',
  createdAt: '2026-08-01T09:00:00Z',
};

const machineTask: GovernanceTask = {
  ...attestationTask,
  id: 't2',
  bindingKind: 'a365_registry_action',
  module: 'agent',
  detail: 'Block the shadow agent "Invoice bot"',
};

function renderPage(locale: 'en' | 'de' = 'en') {
  return render(
    <I18nProvider initialLocale={locale}>
      <TasksPage />
    </I18nProvider>
  );
}

beforeEach(() => {
  loadTasks.mockReset().mockResolvedValue({ tasks: [attestationTask], backendReachable: true });
  updateTask.mockReset().mockResolvedValue(true);
});

describe('Task queue', () => {
  it('shows the work with its click-path and a portal link', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getByText('Add the group to an org-app audience')).toBeInTheDocument()
    );
    expect(screen.getByRole('link', { name: /open the portal/i })).toHaveAttribute(
      'href',
      expect.stringContaining('https://')
    );

    await user.click(screen.getByRole('button', { name: /what to do/i }));
    expect(await screen.findByText(/Manage access/)).toBeInTheDocument();
  });

  /**
   * The rule this whole page exists to protect: a human click is a claim, not
   * evidence. Verification is a machine re-reading the plane.
   */
  it('offers attestation — never verification — where no API can read it back', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('Only a human can attest this')).toBeInTheDocument()
    );

    expect(screen.getByRole('button', { name: /mark as done/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /verify now/i })).not.toBeInTheDocument();
    expect(screen.getByText(/This is a claim, not evidence/)).toBeInTheDocument();
  });

  it('does not offer attestation for something a machine can check', async () => {
    loadTasks.mockResolvedValue({ tasks: [machineTask], backendReachable: true });
    renderPage();

    await waitFor(() =>
      expect(
        screen.getByText('Can be verified by re-reading the plane')
      ).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: /mark as done/i })).not.toBeInTheDocument();
  });

  it('records an attestation as the claim it is, attributed by name', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText(/Marcel needs/)).toBeInTheDocument());

    await user.type(
      screen.getByPlaceholderText(/what did you change/i),
      'added GOV-FAB-Finance to the audience'
    );
    await user.click(screen.getByRole('button', { name: /mark as done/i }));

    await waitFor(() => expect(updateTask).toHaveBeenCalledTimes(1));
    const [, patch] = updateTask.mock.calls[0];
    expect(patch.status).toBe('Attested');
    expect(patch.evidence).toContain('attested by operator@example.com');
    expect(patch.evidence).toContain('added GOV-FAB-Finance');
  });

  it('counts what can never be machine-verified, and says why', async () => {
    loadTasks.mockResolvedValue({
      tasks: [attestationTask, machineTask],
      backendReachable: true,
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/can never be machine-verified/)).toBeInTheDocument()
    );
    // One of the two: the org-app audience. Not the registry action.
    expect(screen.getByText(/^1 of these/)).toBeInTheDocument();
  });

  it('styles a claim differently from a verified fact', async () => {
    loadTasks.mockResolvedValue({
      tasks: [
        { ...attestationTask, status: 'Attested', evidence: 'attested by operator' },
        { ...machineTask, status: 'Verified' },
      ],
      backendReachable: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText('Claimed done')).toBeInTheDocument());
    const claimed = screen.getByText('Claimed done');
    const verified = screen.getByText('Verified');
    // Verified is the only one allowed to read as success.
    expect(verified.className).toContain('emerald');
    expect(claimed.className).not.toContain('emerald');
  });

  it('says plainly when the store is unreachable', async () => {
    loadTasks.mockResolvedValue({ tasks: [], backendReachable: false });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/task store is unreachable/i)).toBeInTheDocument()
    );
  });

  it('renders in German', async () => {
    renderPage('de');
    await waitFor(() => expect(screen.getByText('Aufgaben')).toBeInTheDocument());
    expect(screen.getByText('Nur eine Person kann das bezeugen')).toBeInTheDocument();
  });
});
