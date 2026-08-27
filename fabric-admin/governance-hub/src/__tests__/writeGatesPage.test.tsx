import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/i18n';
import type { LedgerData } from '@/services/writes';

const loadLedgers = vi.fn<() => Promise<LedgerData>>();
const submitWrite = vi.fn();
const setWriteConfig = vi.fn();

let config = {
  modulesEnabled: ['fabric', 'pp', 'agent', 'entra'],
  writesEnabled: true,
  writeKinds: ['entra_group_member'],
  writeScopeAllowlist: ['ws-pilot'],
};

vi.mock('@/services/writes', () => ({
  loadLedgers: () => loadLedgers(),
  submitWrite: (...args: unknown[]) => submitWrite(...args),
}));

vi.mock('@/hooks/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'tester@example.com' } }),
}));

vi.mock('@/hooks/GovernanceContext', () => ({
  useGovernance: () => ({
    config,
    writeConfig: {
      writesEnabled: config.writesEnabled,
      armedKinds: config.writeKinds,
      scopeAllowlist: config.writeScopeAllowlist,
      enabledModules: config.modulesEnabled,
    },
    setWriteConfig: (...args: unknown[]) => setWriteConfig(...args),
    backendReachable: true,
  }),
}));

const { WriteGatesPage } = await import('@/pages/WriteGatesPage');

const EMPTY: LedgerData = { audit: [], dryRuns: [], noModel: false, failures: [] };

function renderPage(locale: 'en' | 'de' = 'en') {
  return render(
    <I18nProvider initialLocale={locale}>
      <WriteGatesPage />
    </I18nProvider>
  );
}

afterEach(() => {
  loadLedgers.mockReset();
  submitWrite.mockReset();
  setWriteConfig.mockReset();
  config = {
    modulesEnabled: ['fabric', 'pp', 'agent', 'entra'],
    writesEnabled: true,
    writeKinds: ['entra_group_member'],
    writeScopeAllowlist: ['ws-pilot'],
  };
});

/**
 * Phase 8 exit criterion (PLAN.md §17 Track D):
 * an armed binding kind with no prior dry run is refused with `gate:dryrun`
 * **and audited**. The domain and the Python actuator both assert the decision;
 * these tests assert the operator can actually see it.
 */
describe('Write gates console', () => {
  it('shows an armed kind still blocked by gate 4', async () => {
    loadLedgers.mockResolvedValue(EMPTY);
    renderPage();

    await waitFor(() => expect(screen.getByText('entra_group_member')).toBeInTheDocument());
    // Armed, scope allowed — and still refused, with the reason named.
    expect(screen.getByText('Never dry-run')).toBeInTheDocument();
    expect(
      screen.getByText('No successful dry run for this kind and scope in the last 30 days')
    ).toBeInTheDocument();
  });

  it('shows the same kind as allowed once a dry run exists', async () => {
    loadLedgers.mockResolvedValue({
      ...EMPTY,
      dryRuns: [
        {
          bindingKind: 'entra_group_member',
          scopeId: 'ws-pilot',
          succeededAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      ],
    });
    renderPage();

    await waitFor(() => expect(screen.getByText('All gates pass')).toBeInTheDocument());
    expect(screen.getByText(/Dry run valid/)).toBeInTheDocument();
  });

  it('surfaces the refusal from the audit trail, grouped by gate', async () => {
    loadLedgers.mockResolvedValue({
      ...EMPTY,
      audit: [
        {
          auditId: 'a1',
          ts: new Date('2026-08-04T10:00:00Z'),
          actor: 'tester@example.com',
          actorType: 'User',
          action: 'write:entra_group_member',
          plane: 'entra',
          targetType: 'Workspace',
          targetId: 'ws-pilot',
          outcome: 'Refused',
          error: 'gate:dryRun kind=entra_group_member scope=ws-pilot window=30d',
        },
      ],
    });
    renderPage();

    await waitFor(() => expect(screen.getByText('Refused')).toBeInTheDocument());
    expect(screen.getByText('write:entra_group_member')).toBeInTheDocument();
    // The gate that fired is named in the summary, not just buried in the row.
    expect(
      screen.getAllByText(/No successful dry run for this kind and scope/).length
    ).toBeGreaterThanOrEqual(2);
  });

  it('runs a dry run through the actuator, never writing directly', async () => {
    loadLedgers.mockResolvedValue(EMPTY);
    submitWrite.mockResolvedValue({ state: 'result', result: { ok: true, dry_run: true } });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText('Dry run')).toBeInTheDocument());
    await user.click(screen.getByText('Dry run'));

    await waitFor(() => expect(submitWrite).toHaveBeenCalledTimes(1));
    expect(submitWrite.mock.calls[0][0]).toMatchObject({
      dryRun: true,
      actor: 'tester@example.com',
      binding: { kind: 'entra_group_member', targetId: 'ws-pilot', module: 'entra' },
    });
  });

  it('says so plainly when the actuator is not deployed', async () => {
    loadLedgers.mockResolvedValue(EMPTY);
    submitWrite.mockResolvedValue({ state: 'not-configured' });
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getByText('Dry run')).toBeInTheDocument());
    await user.click(screen.getByText('Dry run'));

    await waitFor(() =>
      expect(screen.getByText(/actuator notebook is not configured/i)).toBeInTheDocument()
    );
  });

  it('warns that a wildcard scope removes the pilot boundary', async () => {
    config.writeScopeAllowlist = ['*'];
    loadLedgers.mockResolvedValue(EMPTY);
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/wildcard allows every scope/i)).toBeInTheDocument()
    );
    // A wildcard cannot be dry-run, so gate 4 can never be satisfied by it.
    expect(screen.getByText(/A wildcard cannot be dry-run/)).toBeInTheDocument();
  });

  it('offers no arming switch for a manual-only binding kind', async () => {
    loadLedgers.mockResolvedValue(EMPTY);
    renderPage();

    await waitFor(() => expect(screen.getByText('pp_routing_rule')).toBeInTheDocument());
    expect(screen.getAllByText('Manual control — never written').length).toBeGreaterThan(0);
  });

  it('renders in German too', async () => {
    loadLedgers.mockResolvedValue(EMPTY);
    renderPage('de');

    await waitFor(() => expect(screen.getByText('Schreib-Gates')).toBeInTheDocument());
    expect(screen.getByText('Nie im Dry Run geprüft')).toBeInTheDocument();
  });
});
