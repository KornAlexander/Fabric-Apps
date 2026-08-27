import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/i18n';
import { SEED_PERSONAS } from '@/domain/personas';

const loadPersonas = vi.fn();
const savePersona = vi.fn();
const resetPersona = vi.fn();
let enabledModules: string[] = ['fabric', 'pp', 'agent', 'entra'];

vi.mock('@/services/personas', async () => {
  const actual =
    await vi.importActual<typeof import('@/services/personas')>('@/services/personas');
  return {
    ...actual,
    loadPersonas: () => loadPersonas(),
    savePersona: (...args: unknown[]) => savePersona(...args),
    resetPersona: (...args: unknown[]) => resetPersona(...args),
  };
});

vi.mock('@/hooks/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'tester@example.com' } }),
}));

vi.mock('@/hooks/GovernanceContext', () => ({
  useGovernance: () => ({ config: { modulesEnabled: enabledModules } }),
}));

const { PersonasPage } = await import('@/pages/PersonasPage');

function renderPage(locale: 'en' | 'de' = 'en') {
  return render(
    <I18nProvider initialLocale={locale}>
      <PersonasPage />
    </I18nProvider>
  );
}

afterEach(() => {
  loadPersonas.mockReset();
  savePersona.mockReset();
  resetPersona.mockReset();
  enabledModules = ['fabric', 'pp', 'agent', 'entra'];
});

/**
 * Phase 5 exit criterion (PLAN.md §17 Track C):
 * *"the 13 seed personas compile without error; recipes needing a disabled
 * module are shown struck-through"*.
 */
describe('Personas & Recipes editor', () => {
  it('lists the shipped personas', async () => {
    loadPersonas.mockResolvedValue({ personas: SEED_PERSONAS, backendReachable: true });
    renderPage();
    await waitFor(() => expect(screen.getByText('Report Author')).toBeInTheDocument());
    expect(screen.getByText('Copilot Studio Agent Author')).toBeInTheDocument();
    // None of them may be flagged as failing to compile.
    expect(screen.queryByText('Does not compile')).not.toBeInTheDocument();
  });

  it('strikes through a capability whose module is switched off', async () => {
    enabledModules = ['entra'];
    loadPersonas.mockResolvedValue({
      personas: [SEED_PERSONAS.find((p) => p.id === 'report-author')!],
      backendReachable: true,
    });
    renderPage();

    await waitFor(() => expect(screen.getByText('Report Author')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /show capabilities/i }));

    const capability = await screen.findByText('create:PowerBIReport');
    expect(capability.className).toContain('line-through');
    expect(screen.getAllByText(/module is switched off/i).length).toBeGreaterThan(0);
    // Dark, not broken: a disabled module is a configuration, not a defect.
    expect(screen.queryByText('Does not compile')).not.toBeInTheDocument();
  });

  it('shows what a persona compiles to', async () => {
    loadPersonas.mockResolvedValue({
      personas: [SEED_PERSONAS.find((p) => p.id === 'cs-agent-author')!],
      backendReachable: true,
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText('Copilot Studio Agent Author')).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole('button', { name: /show capabilities/i }));

    expect(await screen.findByText(/compiles to \d+ bindings/i)).toBeInTheDocument();
    // The supported lever for agent authoring, spelled out.
    expect(
      screen.getAllByText(/Environment → pp_dataverse_role/).length
    ).toBeGreaterThan(0);
  });

  it('says so when overrides cannot be saved instead of pretending', async () => {
    loadPersonas.mockResolvedValue({ personas: SEED_PERSONAS, backendReachable: false });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/this is the shipped seed/i)).toBeInTheDocument()
    );
  });

  it('saves an edited persona through the service', async () => {
    loadPersonas.mockResolvedValue({
      personas: [SEED_PERSONAS.find((p) => p.id === 'consumer')!],
      backendReachable: true,
    });
    savePersona.mockResolvedValue(true);
    renderPage();

    await waitFor(() => expect(screen.getByText('Consumer')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(savePersona).toHaveBeenCalledTimes(1));
    expect(savePersona.mock.calls[0][0]).toMatchObject({ id: 'consumer' });
    expect(savePersona.mock.calls[0][1]).toBe('tester@example.com');
  });

  it('renders in German without falling back to English', async () => {
    loadPersonas.mockResolvedValue({ personas: SEED_PERSONAS, backendReachable: true });
    renderPage('de');
    await waitFor(() =>
      expect(screen.getByText('Personas & Rezepte')).toBeInTheDocument()
    );
    expect(screen.getAllByRole('button', { name: /bearbeiten/i }).length).toBeGreaterThan(0);
  });
});
